/**
 * Domain: poll
 * Slash commands: /poll (subcommands: create, list, close)
 *
 * Dipisah dari handlers/commandHandler.js (v3.9.9 refactor).
 * Behavior: bikin poll (modal → options), list poll, close poll + update message.
 *
 * v3.9.1: simpan data poll di in-memory session (bukan di customId) supaya
 *         question panjang tidak overflow 100-char Discord limit.
 *
 * Catatan: helper `updatePollMessage` dipisah dari commandHandler.js dan
 *          dideklarasikan sebagai local function di file ini (sebelumnya
 *          ada di bottom-of-file commandHandler.js).
 */

const {
    EmbedBuilder,
    ButtonBuilder,
    ActionRowBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    createPoll,
    getPoll,
    getPollsByGuild,
    closePoll,
    getPollTotalVotes,
    createPollSession,
    logAudit,
    safeEditReply
} = require('./_shared');

module.exports = async function (interaction) {
    // ====================================================
    // === /poll ===
    // ====================================================
    if (interaction.commandName !== 'poll') return;

    const sub = interaction.options.getSubcommand();

    // --- /poll create ---
    if (sub === 'create') {
        const channel = interaction.options.getChannel('channel');
        const question = interaction.options.getString('question');
        const multiple = interaction.options.getBoolean('multiple') || false;

        // v3.9.1 FIX: simpan data poll di in-memory session, bukan di customId.
        // Sebelumnya customId = `poll_modal_create:${channel.id}:${multiple}:${encodeURIComponent(question)}`
        // yang bisa overflow 100-char Discord limit kalau question panjang
        // (esp. setelah encodeURIComponent — spasi jadi %20, dll).
        // Sekarang customId = `poll_modal_create:${sessionId}` (~50 char, aman).
        const sessionId = createPollSession({
            userId: interaction.user.id,
            channelId: channel.id,
            multiple,
            question
        });

        // Open modal untuk input options (satu field, dipisah newline)
        const modal = new ModalBuilder()
            .setCustomId(`poll_modal_create:${sessionId}`)
            .setTitle('Buat Poll — Input Options');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('options')
                    .setLabel('Options (1 per baris, min 2, maks 10)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setPlaceholder('Rank Push\nCustom Room\nTurnamen\nOff')
                    .setMaxLength(500)
            )
        );
        return interaction.showModal(modal);
    }

    // --- /poll list ---
    if (sub === 'list') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const polls = getPollsByGuild(interaction.guild.id);
        if (polls.length === 0) {
            return safeEditReply(interaction, { content: '📭 Belum ada poll di guild ini.' });
        }
        const lines = polls
            .map(p => {
                const status = p.closed ? '🔒 Closed' : '🟢 Active';
                const total = getPollTotalVotes(p);
                return `• ❓ **${p.question}** — ${status}\n  🆔 \`${p.id}\` | 👥 ${p.options.length} options | 🗳️ ${total} votes\n  📍 <#${p.channelId}> | ⏰ <t:${Math.floor(p.createdAt / 1000)}:R>`;
            })
            .join('\n\n');
        const embed = new EmbedBuilder()
            .setTitle('📊 DAFTAR POLL')
            .setDescription(`Total **${polls.length}** poll.\n\n${lines}`)
            .setColor(0x5865f2)
            .setFooter({
                text: interaction.client.user.username,
                iconURL: interaction.client.user.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp();
        return safeEditReply(interaction, { embeds: [embed] });
    }

    // --- /poll close ---
    if (sub === 'close') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const id = interaction.options.getString('id');
        const poll = getPoll(id);
        if (!poll) return safeEditReply(interaction, { content: `❌ Poll \`${id}\` tidak ditemukan.` });
        if (poll.guildId !== interaction.guild.id)
            return safeEditReply(interaction, { content: '❌ Poll ini bukan dari guild ini.' });
        if (poll.closed) return safeEditReply(interaction, { content: `❌ Poll sudah closed.` });
        const updated = closePoll(id);
        await updatePollMessage(interaction, updated);
        await logAudit(interaction.client, {
            action: 'POLL_CLOSE',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Close poll \`${id}\` ("${poll.question}")`,
            guildId: interaction.guild.id
        });
        return safeEditReply(interaction, { content: `✅ Poll **${poll.question}** ditutup! Lihat hasil di channel.` });
    }
};

// ====================================================
// === HELPER: UPDATE POLL MESSAGE (untuk close) ===
// ====================================================
// Dipisah dari handlers/commandHandler.js (v3.9.9 refactor). Function declaration
// di-hoist, jadi bisa dipanggil dari `module.exports` di atas.
async function updatePollMessage(interaction, poll) {
    try {
        const channel = interaction.guild.channels.cache.get(poll.channelId);
        if (!channel) return;
        const msg = await channel.messages.fetch(poll.messageId).catch(() => null);
        if (!msg) return;

        const total = getPollTotalVotes(poll);
        const lines = poll.options
            .map((opt, i) => {
                const pct = total > 0 ? Math.round((opt.votes.length / total) * 100) : 0;
                const bar = '█'.repeat(Math.floor(pct / 10)).padEnd(10, '░');
                return `${opt.emoji} **${opt.label}** — ${opt.votes.length} votes (${pct}%)\n\`${bar}\``;
            })
            .join('\n\n');

        const embed = new EmbedBuilder()
            .setTitle(`📊 ${poll.question}`)
            .setDescription(
                `${lines}\n\n` +
                    `🗳️ Total votes: **${total}**\n` +
                    `🔒 Status: **Closed** <t:${Math.floor(poll.closedAt / 1000)}:R>`
            )
            .setColor(0x95a5a6)
            .setFooter({ text: `Poll by ${poll.creatorTag} | Closed` })
            .setTimestamp();

        // Disable all buttons
        const disabledRows = msg.components.map(row => {
            const newRow = new ActionRowBuilder();
            for (const comp of row.components) {
                newRow.addComponents(ButtonBuilder.from(comp).setDisabled(true));
            }
            return newRow;
        });

        await msg.edit({ embeds: [embed], components: disabledRows });
    } catch (err) {
        console.warn('Gagal update poll message:', err.message);
    }
}
