/**
 * Poll domain handler — button `poll_vote:*` & modal `poll_modal_create:*`.
 *
 * Di-ekstrak dari handlers/interactionHandler.js (v3.9.9 refactor).
 * Behavior dipertahankan apa adanya — hanya pindah file.
 *
 * Helper `handlePollButton`, `handlePollModalCreate`, `updatePollVoteMessage`
 * jadi LOCAL function di file ini.
 *
 * Router (src/interactions/index.js) sudah apply:
 *   - dedup (checkAndMark)
 *   - guard `replied/deferred`
 *   - cek tipe interaction (button/select/modal)
 *   - routing by customId prefix
 * Jadi domain handler fokus ke logic-nya saja.
 */

const {
    EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
    MessageFlags
} = require('discord.js');
const { logAudit, withUserLock } = require('../commands/_shared');
// votePoll / getPollByMessage / removePoll / getPollSession / deletePollSession
// tidak di-export _shared, import langsung dari pollManager.
const {
    get: getPoll,
    vote: votePoll,
    getTotalVotes: getPollTotalVotes,
    remove: removePoll,
    getPollSession,
    deletePollSession,
    create: createPoll,
    setMessageId: setPollMessageId
} = require('../data/pollManager');

module.exports = async function (interaction) {
    // ====================================================
    // === POLL: VOTE BUTTONS ===
    // ====================================================
    if (interaction.isButton() && interaction.customId.startsWith('poll_vote:')) {
        return handlePollButton(interaction);
    }

    // ====================================================
    // === POLL: MODAL CREATE SUBMIT ===
    // ====================================================
    if (interaction.isModalSubmit() && interaction.customId.startsWith('poll_modal_create:')) {
        return handlePollModalCreate(interaction);
    }
};

// ====================================================
// === HELPER: POLL VOTE BUTTON HANDLER ===
// ====================================================
async function handlePollButton(interaction) {
    try {
        // customId: poll_vote:<pollId>:<optionIndex>
        const parts = interaction.customId.split(':');
        const pollId = parts[1];
        const optionIndex = parseInt(parts[2]);

        // Pre-check cepat untuk feedback instan (tanpa lock)
        const pollPre = getPoll(pollId);
        if (!pollPre) {
            return interaction.reply({ content: '❌ Poll tidak ditemukan.', flags: MessageFlags.Ephemeral });
        }
        if (pollPre.closed) {
            return interaction.reply({ content: '❌ Poll sudah ditutup.', flags: MessageFlags.Ephemeral });
        }

        // v3.9.2 FIX: per-user lock untuk mencegah TOCTOU race condition.
        // Sebelumnya, 2 klik cepat di option yang sama (multiple=false)
        // bisa: klik-1 toggle ON, klik-2 toggle OFF. Hasil: vote hilang
        // padahal user merasa sudah vote. Lock memaksa klik-2 baca data
        // terbaru setelah klik-1 selesai.
        const result = await withUserLock('poll', interaction.user.id, () => {
            return votePoll(pollId, interaction.user.id, optionIndex);
        });

        if (result === null) {
            // Lock gagal — user klik terlalu cepat
            return interaction.reply({
                content: '⏳ Tunggu sebentar, kamu lagi klik terlalu cepat. Coba lagi dalam 1 detik.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (!result) {
            return interaction.reply({ content: '❌ Gagal vote. Option mungkin tidak valid.', flags: MessageFlags.Ephemeral });
        }
        if (result.closed) {
            return interaction.reply({ content: '❌ Poll sudah ditutup.', flags: MessageFlags.Ephemeral });
        }
        await updatePollVoteMessage(interaction, result);
        const opt = result.options[optionIndex];
        const voted = opt.votes.includes(interaction.user.id);
        return interaction.reply({
            content: voted
                ? `✅ Vote tercatat untuk **${opt.label}**!`
                : `🚪 Vote dibatalkan untuk **${opt.label}**.`,
            flags: MessageFlags.Ephemeral
        });
    } catch (err) {
        console.error('Poll button error:', err);
        if (interaction.isRepliable() && !interaction.replied) {
            await interaction.reply({ content: '❌ Terjadi error.', flags: MessageFlags.Ephemeral }).catch(()=>{});
        }
    }
}

async function updatePollVoteMessage(interaction, poll) {
    try {
        const channel = interaction.guild.channels.cache.get(poll.channelId);
        if (!channel) return;
        const msg = await channel.messages.fetch(poll.messageId).catch(() => null);
        if (!msg) return;

        const total = getPollTotalVotes(poll);
        const lines = poll.options.map((opt, i) => {
            const pct = total > 0 ? Math.round((opt.votes.length / total) * 100) : 0;
            const bar = '█'.repeat(Math.floor(pct / 10)).padEnd(10, '░');
            return `${opt.emoji} **${opt.label}** — ${opt.votes.length} votes (${pct}%)\n\`${bar}\``;
        }).join('\n\n');

        const embed = new EmbedBuilder()
            .setTitle(`📊 ${poll.question}`)
            .setDescription(
                `${lines}\n\n` +
                `🗳️ Total votes: **${total}**\n` +
                `🔄 Mode: ${poll.multiple ? 'Multi-vote (boleh pilih banyak)' : 'Single-vote (pilih satu)'}\n` +
                `⏰ Dibuat: <t:${Math.floor(poll.createdAt / 1000)}:R>\n\n` +
                `👇 Klik tombol di bawah untuk vote (toggle)`
            )
            .setColor(0x5865F2)
            .setFooter({ text: `Poll by ${poll.creatorTag} | ID: ${poll.id}` })
            .setTimestamp();
        await msg.edit({ embeds: [embed] });
    } catch (err) {
        console.warn('Gagal update poll message:', err.message);
    }
}

// ====================================================
// === HELPER: POLL MODAL CREATE (process input options) ===
// ====================================================
async function handlePollModalCreate(interaction) {
    try {
        // v3.9.1 FIX: customId sekarang hanya `poll_modal_create:<sessionId>`.
        // Data poll (channelId, multiple, question) disimpan di in-memory session
        // supaya customId tidak overflow 100-char Discord limit kalau question panjang.
        const parts = interaction.customId.split(':');
        const sessionId = parts[1];
        const session = getPollSession(sessionId);

        if (!session) {
            return interaction.reply({
                content: '❌ Session poll sudah expired (lebih dari 5 menit). Jalankan ulang `/poll create`.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Defense-in-depth: pastikan user yang submit modal = user yang buat session.
        if (session.userId !== interaction.user.id) {
            return interaction.reply({
                content: '❌ Modal ini bukan milik kamu. Jalankan `/poll create` sendiri.',
                flags: MessageFlags.Ephemeral
            });
        }

        const { channelId, multiple, question } = session;

        const optionsRaw = interaction.components[0]?.components?.[0]?.value?.trim() || '';
        if (!optionsRaw) {
            return interaction.reply({ content: '❌ Options tidak boleh kosong.', flags: MessageFlags.Ephemeral });
        }

        const optionLines = optionsRaw.split('\n').map(s => s.trim()).filter(s => s.length > 0);
        if (optionLines.length < 2) {
            return interaction.reply({ content: '❌ Minimal 2 options (1 per baris).', flags: MessageFlags.Ephemeral });
        }
        if (optionLines.length > 10) {
            return interaction.reply({ content: '❌ Maksimal 10 options.', flags: MessageFlags.Ephemeral });
        }

        const options = optionLines.map((label, i) => ({
            label: label.slice(0, 80),
            emoji: `${i + 1}️⃣`
        }));

        const channel = interaction.guild.channels.cache.get(channelId);
        if (!channel) {
            deletePollSession(sessionId);
            return interaction.reply({ content: '❌ Channel tidak ditemukan.', flags: MessageFlags.Ephemeral });
        }

        // Create poll entry
        const poll = createPoll({
            guildId: interaction.guild.id,
            channelId: channel.id,
            question,
            options,
            multiple,
            creatorId: interaction.user.id,
            creatorTag: interaction.user.tag
        });

        // Build embed + buttons
        const total = 0;
        const lines = poll.options.map((opt, i) => {
            const pct = 0;
            const bar = '░'.repeat(10);
            return `${opt.emoji} **${opt.label}** — 0 votes (0%)\n\`${bar}\``;
        }).join('\n\n');

        const embed = new EmbedBuilder()
            .setTitle(`📊 ${question}`)
            .setDescription(
                `${lines}\n\n` +
                `🗳️ Total votes: **0**\n` +
                `🔄 Mode: ${multiple ? 'Multi-vote (boleh pilih banyak)' : 'Single-vote (pilih satu)'}\n` +
                `⏰ Dibuat: <t:${Math.floor(poll.createdAt / 1000)}:R>\n\n` +
                `👇 Klik tombol di bawah untuk vote (toggle)`
            )
            .setColor(0x5865F2)
            .setFooter({ text: `Poll by ${interaction.user.tag} | ID: ${poll.id}` })
            .setTimestamp();

        // Build buttons — 5 per row (Discord limit), wrap to next row if more
        const rows = [];
        for (let i = 0; i < poll.options.length; i += 5) {
            const row = new ActionRowBuilder();
            for (let j = i; j < Math.min(i + 5, poll.options.length); j++) {
                const opt = poll.options[j];
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`poll_vote:${poll.id}:${j}`)
                        .setLabel(opt.label.slice(0, 80))
                        .setEmoji(opt.emoji)
                        .setStyle(ButtonStyle.Primary)
                );
            }
            rows.push(row);
        }

        const msg = await channel.send({ embeds: [embed], components: rows, content: `📊 **POLL BARU** oleh ${interaction.user}` }).catch(err => null);
        if (!msg) {
            // P0-5 FIX: rollback poll entry yang sudah tersimpan kalau gagal kirim message.
            try { removePoll(poll.id); } catch (_) {}
            deletePollSession(sessionId);
            return interaction.reply({ content: `❌ Gagal kirim poll ke ${channel}. Cek permission bot. Entry di-rollback.`, flags: MessageFlags.Ephemeral });
        }
        setPollMessageId(poll.id, msg.id);
        // v3.9.1: session sudah dipakai, hapus dari memory.
        deletePollSession(sessionId);
        // P1-10 FIX: tambah audit log untuk POLL_CREATE (sebelumnya missing).
        try {
            await logAudit(interaction.client, { action: 'POLL_CREATE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Buat poll **${question}** (${poll.options.length} options, ${multiple ? 'multi' : 'single'}-vote) di ${channel}`, guildId: interaction.guild.id });
        } catch (_) {}
        return interaction.reply({ content: `✅ Poll dibuat di ${channel}!\n🆔 \`${poll.id}\`\n💡 Tutup pakai \`/poll close id:${poll.id}\``, flags: MessageFlags.Ephemeral });
    } catch (err) {
        console.error('Poll modal create error:', err);
        if (interaction.isRepliable() && !interaction.replied) {
            await interaction.reply({ content: '❌ Terjadi error: ' + err.message, flags: MessageFlags.Ephemeral }).catch(()=>{});
        }
    }
}
