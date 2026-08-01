/**
 * Domain: giveaway
 * Slash commands: /giveaway (subcommands: create, list, end, reroll)
 *
 * Dipisah dari handlers/commandHandler.js (v3.9.9 refactor).
 * Behavior: kelola giveaway (create, list, end, reroll).
 *
 * P0-3 FIX: /giveaway end panggil shared processGiveawayEnd supaya message
 *           diupdate + announce winner + DM winner + track stats.
 * P0-4 FIX: /giveaway reroll persist winner baru + announce + DM + track stats.
 * v3.9.1: jangan hardcoded @everyone ping (admin yang mau ping pakai /announce).
 * v3.9.8: validate duration, validate channel type (GuildText), wrap reroll di userLock.
 */

const {
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    MessageFlags,
    ChannelType,
    createGiveaway,
    setGiveawayMessageId,
    getGiveawaysByGuild,
    getGiveaway,
    endGiveaway,
    rerollGiveaway,
    pickWinners,
    removeGiveaway,
    withUserLock,
    logAudit,
    safeEditReply
} = require('./_shared');

module.exports = async function (interaction) {
    // ====================================================
    // === /giveaway ===
    // ====================================================
    if (interaction.commandName !== 'giveaway') return;

    const sub = interaction.options.getSubcommand();

    // --- /giveaway create ---
    if (sub === 'create') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const channel = interaction.options.getChannel('channel');
        const prize = interaction.options.getString('prize');
        const winners = interaction.options.getInteger('winners') || 1;
        const durationMin = interaction.options.getInteger('duration');
        const requiredRole = interaction.options.getRole('required_role');

        // v3.9.8 FIX: validate duration — sebelumnya `if (durationMin < 1)` lolos
        // untuk undefined (undefined < 1 === false), endsAt jadi NaN, giveaway
        // stuck active forever (NaN <= Date.now() selalu false).
        if (!durationMin || durationMin < 1) {
            return safeEditReply(interaction,{ content: '❌ Durasi wajib diisi, minimal 1 menit.' });
        }
        if (durationMin > 60 * 24 * 30) {  // 30 hari maks
            return safeEditReply(interaction,{ content: '❌ Durasi maksimal 30 hari (43200 menit).' });
        }
        if (winners < 1 || winners > 20) {
            return safeEditReply(interaction,{ content: '❌ Jumlah pemenang harus 1-20.' });
        }
        // v3.9.8 FIX: validate channel type — sebelumnya admin bisa pick voice/category
        // channel, channel.send bisa gagal atau kirim ke text-in-voice overlay.
        if (!channel || channel.type !== ChannelType.GuildText) {
            return safeEditReply(interaction,{ content: '❌ Channel harus berupa text channel.' });
        }

        const endsAt = Date.now() + durationMin * 60000;
        const gw = createGiveaway({
            guildId: interaction.guild.id,
            channelId: channel.id,
            prize,
            winnersCount: winners,
            endsAt,
            hostId: interaction.user.id,
            hostTag: interaction.user.tag,
            requiredRoleId: requiredRole?.id || null
        });

        // Build giveaway embed
        const embed = new EmbedBuilder()
            .setTitle('🎉 GIVEAWAY!')
            .setDescription(
                `🎁 **Prize:** ${prize}\n\n` +
                `👥 **Pemenang:** ${winners}\n` +
                `⏰ **Berakhir:** <t:${Math.floor(endsAt / 1000)}:R> (<t:${Math.floor(endsAt / 1000)}:F>)\n` +
                `🎟️ **Peserta:** 0\n` +
                (requiredRole ? `🔐 **Syarat:** Punya role ${requiredRole}\n` : '') +
                `\n👇 Klik tombol **🎉 Join** di bawah untuk ikut!`
            )
            .setColor(0xF1C40F)
            .setFooter({ text: `Host: ${interaction.user.tag} | ID: ${gw.id}` })
            .setTimestamp();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`gw_join:${gw.id}`).setLabel('🎉 Join').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`gw_leave:${gw.id}`).setLabel('🚪 Leave').setStyle(ButtonStyle.Secondary)
        );
        // v3.9.1 FIX: jangan hardcoded @everyone ping (terlalu mengganggu member).
        // Sebelumnya setiap giveaway baru otomatis ping @everyone, yang bisa
        // menyebabkan member mute / leave server kalau terlalu sering.
        // Sekarang admin yang mau ping @everyone bisa pakai /announce terpisah
        // atau edit pesan giveaway setelah dibuat.
        const msg = await channel.send({ embeds: [embed], components: [row], content: '🎉 **GIVEAWAY BARU!**' }).catch(err => null);
        if (!msg) {
            // P0-5 FIX: rollback giveaway entry yang sudah tersimpan kalau gagal kirim message.
            // Sebelumnya entry tetap ada dengan messageId=null → zombie giveaway.
            try { removeGiveaway(gw.id); } catch (_) {}
            return safeEditReply(interaction,{ content: `❌ Gagal kirim giveaway ke ${channel}. Cek permission bot. Entry di-rollback.` });
        }
        setGiveawayMessageId(gw.id, msg.id);
        await logAudit(interaction.client, { action: 'GIVEAWAY_CREATE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Buat giveaway **${prize}** (${winners} pemenang, ${durationMin}m) di ${channel}`, guildId: interaction.guild.id });
        return safeEditReply(interaction,{ content: `✅ Giveaway dibuat di ${channel}!\n🆔 \`${gw.id}\`\n⏰ Berakhir <t:${Math.floor(endsAt / 1000)}:R>` });
    }

    // --- /giveaway list ---
    if (sub === 'list') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const all = getGiveawaysByGuild(interaction.guild.id);
        if (all.length === 0) {
            return safeEditReply(interaction,{ content: '📭 Belum ada giveaway di guild ini.' });
        }
        const lines = all.map(g => {
            const status = g.ended ? '✅ Selesai' : (g.endsAt <= Date.now() ? '⏳ Proses' : '🟢 Aktif');
            const winnersStr = g.ended && g.winnerIds.length > 0 ? g.winnerIds.map(id => `<@${id}>`).join(', ') : '—';
            return `• **${g.prize}** — ${status}\n  🆔 \`${g.id}\` | 👥 ${g.participantIds.length} peserta | 🏆 ${winnersStr}\n  📍 <#${g.channelId}> | ⏰ <t:${Math.floor(g.endsAt / 1000)}:R>`;
        }).join('\n\n');
        const embed = new EmbedBuilder()
            .setTitle('🎉 DAFTAR GIVEAWAY')
            .setDescription(lines)
            .setColor(0xF1C40F)
            .setFooter({ text: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        return safeEditReply(interaction,{ embeds: [embed] });
    }

    // --- /giveaway end ---
    // P0-3 FIX: sebelumnya hanya pick + persist, TIDAK update message,
    // TIDAK announce winner, TIDAK DM winner, TIDAK track stats.
    // Sekarang: panggil processGiveawayEnd (shared dengan auto-end) supaya
    // message diupdate + announce + DM + track stats.
    if (sub === 'end') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const id = interaction.options.getString('id');
        const gw = getGiveaway(id);
        if (!gw) return safeEditReply(interaction,{ content: `❌ Giveaway \`${id}\` tidak ditemukan.` });
        if (gw.ended) return safeEditReply(interaction,{ content: `❌ Giveaway sudah berakhir.` });
        if (gw.guildId !== interaction.guild.id) return safeEditReply(interaction,{ content: '❌ Giveaway ini bukan dari guild ini.' });

        // Pick winners + persist ended state
        const winnerIds = pickWinners(gw.participantIds, gw.winnersCount);
        endGiveaway(id, winnerIds);

        // Re-fetch gw yang sudah di-update (winnerIds sudah persist)
        const updatedGw = getGiveaway(id);

        // Panggil shared processGiveawayEnd dengan skipPick=true supaya tidak pick 2x
        if (typeof interaction.client.processGiveawayEnd === 'function') {
            await interaction.client.processGiveawayEnd(interaction.client, updatedGw, { skipPick: true });
        }

        await logAudit(interaction.client, { action: 'GIVEAWAY_END', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `End giveaway \`${id}\` (${gw.prize}). Winners: ${winnerIds.length > 0 ? winnerIds.map(w => `<@${w}>`).join(', ') : 'tidak ada peserta'}`, guildId: interaction.guild.id });
        return safeEditReply(interaction,{ content: `✅ Giveaway **${gw.prize}** diakhiri!\n🏆 Winners: ${winnerIds.length > 0 ? winnerIds.map(w => `<@${w}>`).join(', ') : '_(tidak ada peserta)_'}\n\n📢 Pesan giveaway sudah diupdate + winner sudah di-DM + diumumkan ke channel.` });
    }

    // --- /giveaway reroll ---
    // P0-4 FIX: sebelumnya hanya return winnerId ke admin (ephemeral).
    // Sekarang: persist winner baru ke gw.winnerIds, announce ke channel,
    // DM winner, track stats. Juga exclude winner yang sudah ada supaya
    // tidak pick orang yang sama 2x.
    if (sub === 'reroll') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const id = interaction.options.getString('id');
        const gw = getGiveaway(id);
        if (!gw) return safeEditReply(interaction,{ content: `❌ Giveaway \`${id}\` tidak ditemukan.` });
        if (!gw.ended) return safeEditReply(interaction,{ content: '❌ Giveaway belum berakhir. End dulu pakai \`/giveaway end\`.' });

        // v3.9.8 FIX: wrap reroll+announce di userLock. Sebelumnya, kalau admin
        // double-click tombol reroll (atau interaction retry karena network blip),
        // 2 handler jalan paralel → 2x announce, 2x DM winner, 2x winnerIds entry
        // (meski winnerIds akhirnya numpuk, user lihat 2 "you won" message).
        // Lock di-scope per giveaway ID supaya admin berbeda tidak saling block
        // untuk giveaway berbeda, tapi 2 click ke giveaway yang sama di-serialize.
        const result = await withUserLock('gw_reroll', gw.id, async () => rerollGiveaway(id));
        if (!result) return safeEditReply(interaction,{ content: `❌ Giveaway \`${id}\` tidak ditemukan atau belum berakhir. (Atau reroll lain sedang jalan — coba lagi sebentar.)` });
        if (!result.winnerId) return safeEditReply(interaction,{ content: '❌ Tidak ada peserta untuk di-reroll.' });

        // Announce winner baru ke channel + DM + track stats
        // v3.9.8: wrap di try/catch supaya announce failure tidak bikin admin
        // retry (yang akan pick winner kedua kalinya). Reroll sudah persist winner,
        // announce gagal tidak perlu abort.
        if (typeof interaction.client.announceRerollWinner === 'function') {
            try {
                await interaction.client.announceRerollWinner(interaction.client, result.gw, result.winnerId);
            } catch (annErr) {
                console.warn(`⚠️ Reroll announce gagal (winner tetap tersimpan): ${annErr.message}`);
            }
        }

        const reuseNote = result.reused ? ' _(semua peserta sudah pernah menang, fallback pick random)_' : '';
        await logAudit(interaction.client, { action: 'GIVEAWAY_REROLL', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Reroll giveaway \`${id}\` → new winner: <@${result.winnerId}>${reuseNote}`, guildId: interaction.guild.id });
        return safeEditReply(interaction,{ content: `🎲 **Reroll!** Winner baru: <@${result.winnerId}>${reuseNote}\n\n📢 Winner sudah di-DM + diumumkan ke channel giveaway.` });
    }
};
