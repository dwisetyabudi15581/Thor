/**
 * Domain: afk
 * Slash commands: /afk, /afk-clear, /afk-list
 *
 * v3.9.13: AFK system.
 * User set AFK → bot reply otomatis saat ada yang mention dia.
 * Auto-clear AFK saat user kirim pesan lagi.
 */

const { EmbedBuilder, MessageFlags, safeEditReply } = require('./_shared');

const afkManager = require('../data/afkManager');

module.exports = async function (interaction) {
    // === AFK (set status AFK) ===
    if (interaction.commandName === 'afk') {
        const reason = interaction.options.getString('reason') || 'AFK';

        afkManager.setAFK(interaction.guild.id, interaction.user.id, reason);

        const embed = new EmbedBuilder()
            .setTitle('💤 AFK Status Set')
            .setColor(0xf1c40f)
            .setDescription(
                `Halo ${interaction.user}, kamu sekarang **AFK**.\n\n` +
                    `📝 Reason: ${reason}\n` +
                    `🕒 Sejak: <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                    `💡 Saat ada yang mention kamu, bot akan auto-reply dengan reason kamu.\n` +
                    `💡 AFK akan otomatis ter-clear saat kamu kirim pesan lagi.`
            )
            .setFooter({
                text: interaction.client.user.username,
                iconURL: interaction.client.user.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }

    // === AFK CLEAR ===
    if (interaction.commandName === 'afk-clear') {
        const cleared = afkManager.clearAFK(interaction.guild.id, interaction.user.id);
        if (!cleared) {
            return interaction.reply({
                content: 'ℹ️ Kamu memang tidak sedang AFK.',
                flags: MessageFlags.Ephemeral
            });
        }
        return interaction.reply({
            content: '✅ Status AFK kamu sudah di-clear. Selamat datang kembali! 👋',
            flags: MessageFlags.Ephemeral
        });
    }

    // === AFK LIST (admin: lihat siapa aja yang AFK di guild) ===
    if (interaction.commandName === 'afk-list') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // afkManager doesn't have listGuildAFK, so iterate manually
        const fs = require('fs');
        const path = require('path');
        const afkPath = path.join(__dirname, '..', '..', 'data', 'afk.json');
        let allAfk = {};
        try {
            allAfk = JSON.parse(fs.readFileSync(afkPath, 'utf8'));
        } catch (_) {}

        const guildPrefix = `${interaction.guild.id}:`;
        const afkUsers = Object.entries(allAfk)
            .filter(([k]) => k.startsWith(guildPrefix))
            .map(([k, data]) => ({
                userId: data.userId,
                reason: data.reason,
                since: data.since
            }))
            .sort((a, b) => b.since - a.since);

        if (afkUsers.length === 0) {
            return safeEditReply(interaction, { content: '✅ Tidak ada member yang AFK saat ini.' });
        }

        const lines = afkUsers
            .slice(0, 25)
            .map((u, i) => {
                const duration = afkManager.formatDuration(u.since);
                const reason = u.reason.length > 50 ? u.reason.slice(0, 50) + '...' : u.reason;
                return `\`${i + 1}.\` <@${u.userId}> — ${reason} *(${duration})*`;
            })
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`💤 AFK MEMBERS (${afkUsers.length})`)
            .setDescription(lines)
            .setColor(0xf1c40f)
            .setTimestamp();

        return safeEditReply(interaction, { embeds: [embed] });
    }
};
