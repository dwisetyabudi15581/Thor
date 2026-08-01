/**
 * Domain: automod
 * Slash commands: /set-automod, /automod-show, /automod-toggle, /add-link-whitelist
 *
 * v3.9.13: Anti-Spam & Auto-Mod system.
 * - Spam detection (N messages in window)
 * - Link blocking (with whitelist channel/role)
 * - Word filter
 * - Mass-mention block
 */

const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const {
    getConfig, saveConfig, logAudit, safeEditReply
} = require('./_shared');

const automod = require('../data/automodManager');

module.exports = async function (interaction) {
    // === SET AUTOMOD ===
    if (interaction.commandName === 'set-automod') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const updates = {};
        const spamThreshold = interaction.options.getInteger('spam_threshold');
        const spamAction = interaction.options.getString('spam_action');
        const blockLinks = interaction.options.getBoolean('block_links');
        const blockWords = interaction.options.getString('block_words');
        const wordAction = interaction.options.getString('word_action');
        const maxMentions = interaction.options.getInteger('max_mentions');
        const mentionAction = interaction.options.getString('mention_action');

        if (spamThreshold !== null) updates.spamThreshold = spamThreshold;
        if (spamAction) updates.spamAction = spamAction;
        if (blockLinks !== null) updates.blockLinks = blockLinks;
        if (blockWords !== null) {
            updates.blockWords = blockWords.split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
        }
        if (wordAction) updates.wordAction = wordAction;
        if (maxMentions !== null) updates.maxMentions = maxMentions;
        if (mentionAction) updates.mentionAction = mentionAction;

        const newConfig = automod.setGuildConfig(interaction.guild.id, updates);

        await logAudit(interaction.client, {
            action: 'SET_AUTOMOD',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Update auto-mod config: ${Object.keys(updates).join(', ')}`,
            guildId: interaction.guild.id
        });

        const embed = new EmbedBuilder()
            .setTitle('🛡️ AUTO-MOD CONFIG UPDATED')
            .setColor(0x57F287)
            .addFields(
                { name: '✅ Status', value: newConfig.enabled ? 'Enabled' : 'Disabled', inline: true },
                { name: '⚡ Spam Threshold', value: `${newConfig.spamThreshold} msg / ${newConfig.spamWindowMs / 1000}s`, inline: true },
                { name: '🔨 Spam Action', value: newConfig.spamAction, inline: true },
                { name: '🔗 Block Links', value: newConfig.blockLinks ? 'Yes' : 'No', inline: true },
                { name: '📝 Word Filter', value: newConfig.blockWords.length > 0 ? `${newConfig.blockWords.length} kata` : '_(none)_', inline: true },
                { name: '🔨 Word Action', value: newConfig.wordAction, inline: true },
                { name: '👥 Max Mentions', value: `${newConfig.maxMentions}`, inline: true },
                { name: '🔨 Mention Action', value: newConfig.mentionAction, inline: true }
            )
            .setFooter({ text: 'Pakai /automod-toggle untuk enable/disable. /automod-show untuk lihat detail.' });

        return safeEditReply(interaction, { embeds: [embed] });
    }

    // === AUTOMOD SHOW ===
    if (interaction.commandName === 'automod-show') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const config = automod.getGuildConfig(interaction.guild.id);
        if (!config) {
            return safeEditReply(interaction, {
                content: 'ℹ️ Auto-mod belum di-config. Pakai `/set-automod` untuk setup, lalu `/automod-toggle enabled:true`.'
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🛡️ AUTO-MOD CONFIG')
            .setColor(config.enabled ? 0x57F287 : 0x95A5A6)
            .addFields(
                { name: '✅ Status', value: config.enabled ? 'Enabled ✅' : 'Disabled ❌', inline: true },
                { name: '⚡ Spam Detection', value: `${config.spamThreshold} msg dalam ${(config.spamWindowMs || 10000) / 1000}s → ${config.spamAction || 'mute_10m'}`, inline: false },
                { name: '🔗 Link Blocking', value: config.blockLinks ? `Yes (allowed: ${config.linkAllowedChannels?.length || 0} ch, ${config.linkAllowedRoles?.length || 0} role)` : 'No', inline: false },
                { name: '📝 Word Filter', value: (config.blockWords?.length || 0) > 0 ? config.blockWords.map(w => `\`${w}\``).join(', ') : '_(none)_', inline: false },
                { name: '👥 Mention Limit', value: `Max ${config.maxMentions || 5} mentions → ${config.mentionAction || 'warn'}`, inline: false }
            )
            .setFooter({ text: `Updated: ${config.updatedAt ? new Date(config.updatedAt).toLocaleString('id-ID') : 'unknown'}` });

        return safeEditReply(interaction, { embeds: [embed] });
    }

    // === AUTOMOD TOGGLE ===
    if (interaction.commandName === 'automod-toggle') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const enabled = interaction.options.getBoolean('enabled');
        const newConfig = automod.enableAutoMod(interaction.guild.id, enabled);

        await logAudit(interaction.client, {
            action: 'TOGGLE_AUTOMOD',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Auto-mod ${enabled ? 'ENABLED' : 'DISABLED'}`,
            guildId: interaction.guild.id
        });

        return safeEditReply(interaction, {
            content: `${enabled ? '✅' : '❌'} Auto-mod ${enabled ? 'diaktifkan' : 'dinonaktifkan'}.\n\n` +
                `💡 Config saat ini masih tersimpan. Kalau enable lagi nanti, tinggal pakai tanpa setup ulang.`
        });
    }

    // === ADD LINK WHITELIST ===
    if (interaction.commandName === 'add-link-whitelist') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const channel = interaction.options.getChannel('channel');
        const role = interaction.options.getRole('role');

        const config = automod.getGuildConfig(interaction.guild.id) || automod.getDefaultConfig();
        const updates = {};

        if (channel) {
            const list = config.linkAllowedChannels || [];
            if (!list.includes(channel.id)) list.push(channel.id);
            updates.linkAllowedChannels = list;
        }
        if (role) {
            const list = config.linkAllowedRoles || [];
            if (!list.includes(role.id)) list.push(role.id);
            updates.linkAllowedRoles = list;
        }

        if (Object.keys(updates).length === 0) {
            return safeEditReply(interaction, { content: '❌ Pilih channel atau role untuk whitelist.' });
        }

        const newConfig = automod.setGuildConfig(interaction.guild.id, updates);

        await logAudit(interaction.client, {
            action: 'AUTOMOD_WHITELIST',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Add link whitelist: ${channel ? `#${channel.name}` : ''} ${role ? `@${role.name}` : ''}`,
            guildId: interaction.guild.id
        });

        return safeEditReply(interaction, {
            content: `✅ Whitelist ditambahkan!\n\n` +
                `📢 Channels: ${newConfig.linkAllowedChannels.map(id => `<#${id}>`).join(', ') || '_(none)_'}\n` +
                `🎭 Roles: ${newConfig.linkAllowedRoles.map(id => `<@&${id}>`).join(', ') || '_(none)_'}`
        });
    }
};
