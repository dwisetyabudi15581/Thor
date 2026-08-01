/**
 * Scheduler Tasks — fungsi-fungsi yang dipanggil scheduler loop di index.js.
 *
 * Tujuan (P3-6 refactor): pisahkan logic scheduler dari entry point bot
 * supaya index.js lebih lean dan mudah dibaca.
 *
 * Berisi:
 *   - processExpiredRole: proses schedule role removal yang sudah expired
 *   - processGiveawayEnd: proses giveaway yang sudah berakhir (pick winners + announce)
 *   - announceRerollWinner: kirim announce winner baru setelah reroll
 *   - processScheduledAnnouncement: kirim scheduled announcement yang sudah waktunya
 *
 * Fungsi `processGiveawayEnd` & `announceRerollWinner` di-attach ke `client`
 * supaya bisa dipanggil dari commandHandler untuk `/giveaway end` & `/giveaway reroll`.
 */

const { getExpired, removeEntry, updateExpireAt } = require('./roleScheduler');
const { hasPermanentKey, getMaxExpireAtByUserAndRole } = require('./keyManager');
const { end: endGiveaway, pickWinners: pickGiveawayWinners } = require('./giveawayManager');
const { markSent: markAnnSent, remove: removeAnn } = require('./scheduledAnnouncements');
const { recordGiveawayWin: trackGiveawayWin } = require('./statsManager');

/**
 * Proses schedule yang sudah expired — MODEL KEY-DRIVEN dengan recheck.
 *
 * Logic:
 *   1. Cek apakah user masih ada di guild. Kalau tidak → hapus schedule.
 *   2. Cek key aktif untuk user+role:
 *      a. Kalau ada key PERMANEN → hapus schedule, role tetap (permanen).
 *      b. Kalau ada key aktif dengan expireAt > now → reschedule ke max(expireAt).
 *         Role tetap. (ini kunci MAX EXTEND — schedule tidak boleh lebih pendek dari key terpanjang)
 *      c. Kalau tidak ada key aktif → hapus role + hapus schedule.
 *
 * v3.9.0 FIX: kalau terjadi transient error (Discord API 5xx, network blip),
 * JANGAN hapus schedule entry. Sebelumnya, catch block selalu removeEntry
 * yang bikin user keep role forever kalau error-nya transient. Sekarang,
 * entry tetap ada untuk di-retry tick berikutnya.
 */
async function processExpiredRole(client, entry) {
    try {
        const guild = await client.guilds.fetch(entry.guildId).catch(() => null);
        if (!guild) {
            // Guild benar-benar hilang (bot di-kick) → safe to remove.
            removeEntry(entry.id);
            return;
        }
        const member = await guild.members.fetch(entry.userId).catch(() => null);
        if (!member) {
            // User sudah leave guild → safe to remove.
            removeEntry(entry.id);
            return;
        }
        // P2-11 FIX: pakai fetch (fallback ke API) bukan cache.get
        // supaya role yang belum ter-cache tetap bisa diproses.
        const role = await guild.roles.fetch(entry.roleId).catch(() => null);
        const now = Date.now();

        // === 1. Cek key PERMANEN ===
        if (hasPermanentKey(entry.userId, entry.roleId)) {
            console.log(`♾️ ${member.user.tag}: schedule ${role?.name || entry.roleId} dihapus (ada key permanen). Role tetap.`);
            removeEntry(entry.id);
            return;
        }

        // === 2. Cek key aktif lain dengan expireAt > now ===
        const maxExpireAt = getMaxExpireAtByUserAndRole(entry.userId, entry.roleId, now);
        if (maxExpireAt !== null && maxExpireAt > now) {
            // Masih ada key aktif dengan sisa waktu → reschedule ke max
            updateExpireAt(entry.id, maxExpireAt);
            const days = Math.ceil((maxExpireAt - now) / 86400000);
            console.log(`⏰ ${member.user.tag}: schedule ${role?.name || entry.roleId} di-reschedule ke ${days} hari lagi (mengikuti key terpanjang).`);
            return;
        }

        // === 3. Tidak ada key aktif → hapus role + hapus schedule ===
        if (role && member.roles.cache.has(entry.roleId)) {
            try {
                await member.roles.remove(entry.roleId);
                console.log(`✅ Auto-remove role ${role.name} dari ${member.user.tag} (semua key sudah expired).`);
                // Kirim DM notifikasi
                try {
                    await member.send({
                        content: `⏰ Role **${role.name}** kamu di server **${guild.name}** sudah dihapus karena semua key sudah expired.\n\nKalau merasa ini salah, hubungi admin.`
                    });
                } catch (_) {}
            } catch (err) {
                // v3.9.0 FIX: kalau gagal hapus role, cek apakah error transient.
                // Kalau transient (Discord 5xx, ECONNRESET, ETIMEDOUT), JANGAN hapus
                // schedule entry — biarkan tick berikutnya retry.
                // Kalau non-transient (Missing Permissions, Unknown Role), hapus entry
                // supaya tidak stuck forever.
                const isTransient = isTransientDiscordError(err);
                if (isTransient) {
                    console.warn(`⚠️ Gagal hapus role ${entry.roleId} dari ${member.user.tag} (transient: ${err.code || err.name}). Akan di-retry tick berikutnya. Entry TIDAK dihapus.`);
                    return; // penting: jangan removeEntry
                }
                // Non-transient: log error, hapus entry supaya tidak loop forever.
                console.error(`❌ Gagal hapus role ${entry.roleId} dari ${member.user.tag} (permanent: ${err.code || err.name}):`, err.message);
                removeEntry(entry.id);
                return;
            }
        }
        removeEntry(entry.id);
    } catch (err) {
        // v3.9.0 FIX: hanya hapus entry kalau error-nya non-transient.
        // Transient error (network blip) → biarkan tick berikutnya retry.
        const isTransient = isTransientDiscordError(err);
        if (isTransient) {
            console.warn(`⚠️ Transient error di processExpiredRole ${entry.id} (${err.code || err.name}). Entry TIDAK dihapus, akan di-retry.`);
            return;
        }
        console.error(`❌ Error process expired role ${entry.id} (permanent):`, err.message);
        removeEntry(entry.id);
    }
}

/**
 * Deteksi apakah error adalah transient (network / Discord 5xx / rate limit).
 * Transient errors seharusnya di-retry, bukan dianggap permanent failure.
 */
function isTransientDiscordError(err) {
    if (!err) return false;
    const code = err.code || '';
    const status = err.status || 0;
    const name = err.name || '';

    // Network / timeout
    if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) return true;
    if (['ConnectTimeoutError', 'WebSocketClosedError'].includes(name)) return true;

    // Discord 5xx (server error, transient)
    if (status >= 500 && status < 600) return true;
    // Rate limit (transient)
    if (status === 429) return true;

    return false;
}

/**
 * Proses giveaway yang sudah berakhir — pick winners + edit message + announce.
 *
 * P0-3 FIX: tambah opsi `options.skipPick` — kalau true, tidak pick winners lagi
 * (dipakai saat manual `/giveaway end` yang sudah pick winners sebelumnya).
 *
 * Bisa diakses dari commandHandler via `client.processGiveawayEnd(gw, opts)`.
 */
async function processGiveawayEnd(client, gw, options = {}) {
    try {
        const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
        const guild = await client.guilds.fetch(gw.guildId).catch(() => null);
        if (!guild) return;

        const channel = guild.channels.cache.get(gw.channelId);
        if (!channel) return;

        // Pick winners (skip kalau sudah di-pick sebelumnya — untuk manual /giveaway end)
        let winnerIds;
        if (options.skipPick && gw.winnerIds && gw.winnerIds.length > 0) {
            winnerIds = gw.winnerIds;
        } else {
            winnerIds = pickGiveawayWinners(gw.participantIds, gw.winnersCount);
            endGiveaway(gw.id, winnerIds);
        }

        // Edit message
        const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
        const winnersStr = winnerIds.length > 0 ? winnerIds.map(id => `<@${id}>`).join(', ') : '_(tidak ada peserta)_';
        if (msg) {
            const embed = new EmbedBuilder()
                .setTitle('🎉 GIVEAWAY BERAKHIR!')
                .setDescription(
                    `🎁 **Prize:** ${gw.prize}\n\n` +
                    `🏆 **Pemenang:** ${winnersStr}\n` +
                    `👥 **Peserta:** ${gw.participantIds.length}\n` +
                    `⏰ **Berakhir:** <t:${Math.floor(gw.endsAt / 1000)}:R>\n\n` +
                    (winnerIds.length > 0 ? '🎊 Selamat kepada pemenang! Host akan DM kalian untuk klaim hadiah.' : '_(Tidak ada peserta yang ikut)_')
                )
                .setColor(winnerIds.length > 0 ? 0x57F287 : 0x95A5A6)
                .setFooter({ text: `Host: ${gw.hostTag} | ID: ${gw.id}` })
                .setTimestamp();
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`gw_join:${gw.id}`).setLabel('🎉 Join (Ended)').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId(`gw_leave:${gw.id}`).setLabel('🚪 Leave (Ended)').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );
            await msg.edit({ embeds: [embed], components: [row] }).catch(()=>{});
        }

        // Announce winners
        if (winnerIds.length > 0) {
            await channel.send({ content: `🎊 **GIVEAWAY WINNERS!** 🎊\n\nPrize: **${gw.prize}**\nPemenang: ${winnersStr}\n\nSelamat! 🎉` }).catch(()=>{});

            // DM winners
            for (const wid of winnerIds) {
                const user = await client.users.fetch(wid).catch(() => null);
                if (user) {
                    await user.send(`🎊 **Selamat! Kamu menang giveaway!**\n\nPrize: **${gw.prize}**\nHost: ${gw.hostTag}\nServer: ${guild.name}\n\nHubungi host untuk klaim hadiahmu.`).catch(()=>{});
                }
                // Track giveaway win untuk leaderboard
                // v3.9.4: scoped per guild — sebelumnya bocor ke guild lain.
                try { trackGiveawayWin(gw.guildId, wid); } catch (_) {}
            }
        } else {
            await channel.send({ content: `📭 Giveaway **${gw.prize}** berakhir tanpa pemenang (tidak ada peserta).` }).catch(()=>{});
        }

        console.log(`🎉 Giveaway ${gw.id} (${gw.prize}) berakhir. Winners: ${winnerIds.length}`);
    } catch (err) {
        console.error('Error processGiveawayEnd:', err);
    }
}

/**
 * Helper: kirim announce winner baru ke channel giveaway (untuk /giveaway reroll).
 * Dipakai oleh commandHandler setelah reroll persist winner baru.
 */
async function announceRerollWinner(client, gw, winnerId) {
    try {
        const guild = await client.guilds.fetch(gw.guildId).catch(() => null);
        if (!guild) return;
        const channel = guild.channels.cache.get(gw.channelId);
        if (!channel) return;

        await channel.send({
            content: `🎲 **REROLL!** Winner baru untuk giveaway **${gw.prize}**: <@${winnerId}>!\n\nSelamat! 🎉 Host akan DM kamu untuk klaim hadiah.`
        }).catch(()=>{});

        // DM winner baru
        const user = await client.users.fetch(winnerId).catch(() => null);
        if (user) {
            await user.send(`🎊 **Selamat! Kamu menang giveaway (reroll)!**\n\nPrize: **${gw.prize}**\nHost: ${gw.hostTag}\nServer: ${guild.name}\n\nHubungi host untuk klaim hadiahmu.`).catch(()=>{});
        }
        // Track stats
        // v3.9.4: scoped per guild
        try { trackGiveawayWin(gw.guildId, winnerId); } catch (_) {}
    } catch (err) {
        console.error('Error announceRerollWinner:', err);
    }
}

/**
 * Proses scheduled announcement yang sudah waktunya dikirim.
 * v3.9.0 FIX: kalau channel target sudah tidak ada (dihapus admin), REMOVE entry
 *   instead of markSent. Sebelumnya, markSent pada recurring announcement akan
 *   membuat entry baru untuk next cycle → next cycle juga gagal karena channel
 *   tetap tidak ada → bikin entry baru lagi → unbounded ghost entries yang
 *   menumpuk dan ngabisin disk + scheduler time.
 */
async function processScheduledAnnouncement(client, ann) {
    try {
        const { EmbedBuilder } = require('discord.js');
        const guild = await client.guilds.fetch(ann.guildId).catch(() => null);
        if (!guild) {
            // Guild hilang (bot di-kick) → hapus entry supaya tidak ghost loop.
            console.warn(`⚠️ Scheduled announce ${ann.id}: guild ${ann.guildId} tidak ditemukan, hapus entry.`);
            removeAnn(ann.id);
            return;
        }

        const channel = guild.channels.cache.get(ann.channelId);
        if (!channel) {
            // v3.9.0 FIX: channel sudah dihapus → REMOVE entry, jangan markSent
            // (karena markSent untuk recurring akan bikin entry baru yang juga gagal).
            console.warn(`⚠️ Scheduled announce ${ann.id}: channel ${ann.channelId} tidak ditemukan di guild ${guild.name}, hapus entry.`);
            removeAnn(ann.id);
            return;
        }

        const d = ann.data;
        const embed = new EmbedBuilder()
            .setTitle(d.title)
            .setDescription(d.description.replace(/\\n/g, '\n'))
            .setColor(d.color || 0x5865F2)
            .setFooter({ text: `Dijadwalkan oleh ${d.authorTag}` })
            .setTimestamp();
        if (d.image) embed.setImage(d.image);
        if (d.thumbnail) embed.setThumbnail(d.thumbnail);

        await channel.send({
            content: d.mention || null,
            embeds: [embed]
        }).catch(err => console.warn('Gagal kirim scheduled ann:', err.message));

        markAnnSent(ann.id);
        console.log(`📢 Scheduled announce ${ann.id} terkirim ke ${channel.name}.`);
    } catch (err) {
        console.error('Error processScheduledAnnouncement:', err);
    }
}

/**
 * Attach semua function ke client supaya commandHandler bisa akses.
 * Dipanggil sekali saat bot ready.
 */
function attachToClient(client) {
    client.processGiveawayEnd = processGiveawayEnd;
    client.announceRerollWinner = announceRerollWinner;
}

module.exports = {
    processExpiredRole,
    processGiveawayEnd,
    announceRerollWinner,
    processScheduledAnnouncement,
    attachToClient
};
