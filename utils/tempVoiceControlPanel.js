/**
 * Temp Voice Control Panel Builder — render embed + button untuk panel kontrol owner.
 *
 * Dipakai setiap kali owner join channel temp voice-nya. Bot kirim panel ke channel
 * teks terkait (kalau ada) atau sebagai reply ephemeral ke owner.
 *
 * Control panel berisi button:
 *   - ✏️ Rename   → modal input nama baru
 *   - 🚫 Kick     → select menu pilih member
 *   - 👥 Limit    → modal input max member (0 = unlimited)
 *   - 🔒 Lock     → toggle lock (hanya owner bisa invite)
 *   - 🔓 Unlock
 *   - 🔄 Transfer → select menu pilih member baru
 *   - 🗑️ Delete   → konfirmasi hapus channel
 */

const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

/**
 * Build embed info panel untuk owner.
 */
function buildControlEmbed(channelInfo, voiceChannel, ownerUser) {
    const memberCount = voiceChannel?.members?.size || 0;
    const limitStr = channelInfo.limit === 0 ? '♾️ Tanpa batas' : `${channelInfo.limit} member`;
    const lockStr = channelInfo.locked ? '🔒 Terkunci' : '🔓 Terbuka';

    return new EmbedBuilder()
        .setTitle('🎛️ CONTROL PANEL — TEMP VOICE')
        .setDescription(
            `Halo <@${channelInfo.ownerId}>! Kamu adalah owner channel voice ini.\n\n` +
            `**📊 Info Channel:**\n` +
            `🔊 **Nama:** ${channelInfo.name}\n` +
            `👥 **Member saat ini:** ${memberCount}${channelInfo.limit > 0 ? ` / ${channelInfo.limit}` : ''}\n` +
            `📊 **Limit:** ${limitStr}\n` +
            `${channelInfo.locked ? '🔒' : '🔓'} **Status:** ${lockStr}\n\n` +
            `**🎮 Kontrol tersedia:**\n` +
            `• ✏️ **Rename** — ubah nama channel\n` +
            `• 🚫 **Kick** — keluarkan member dari voice\n` +
            `• 👥 **Limit** — atur max member\n` +
            `• 🔒/🔓 **Lock/Unlock** — atur akses join\n` +
            `• 🔄 **Transfer** — pindah ownership ke member lain\n` +
            `• 🗑️ **Delete** — hapus channel\n\n` +
            `💡 Channel akan otomatis dihapus saat semua member keluar.`
        )
        .setColor(channelInfo.locked ? 0xE67E22 : 0x57F287)
        .setFooter({ text: `Owner: ${channelInfo.ownerTag} | Channel ID: ${voiceChannel?.id || '?'}` })
        .setTimestamp();
}

/**
 * Build 2 rows dengan 4 buttons masing-masing untuk control panel.
 */
function buildControlComponents(channelInfo) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tv_rename')
            .setLabel('Rename')
            .setEmoji('✏️')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('tv_kick')
            .setLabel('Kick')
            .setEmoji('🚫')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('tv_limit')
            .setLabel('Limit')
            .setEmoji('👥')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(channelInfo.locked ? 'tv_unlock' : 'tv_lock')
            .setLabel(channelInfo.locked ? 'Unlock' : 'Lock')
            .setEmoji(channelInfo.locked ? '🔓' : '🔒')
            .setStyle(channelInfo.locked ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tv_transfer')
            .setLabel('Transfer Owner')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('tv_delete')
            .setLabel('Delete Channel')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Danger)
    );

    return [row1, row2];
}

/**
 * Build select menu untuk kick member (hanya yang saat ini di voice).
 */
function buildKickSelectMenu(voiceChannel, ownerId) {
    const options = [];
    if (voiceChannel?.members) {
        for (const [memberId, member] of voiceChannel.members) {
            if (memberId === ownerId) continue; // skip owner
            options.push({
                label: member.user.tag.slice(0, 100),
                value: memberId,
                description: `Keluarkan ${member.user.username} dari voice`
            });
        }
    }
    if (options.length === 0) {
        return null; // tidak ada member untuk di-kick
    }
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('tv_kick_select')
            .setPlaceholder('Pilih member yang ingin di-kick...')
            .addOptions(options.slice(0, 25))
            .setMinValues(1)
            .setMaxValues(Math.min(options.length, 25))
    );
}

/**
 * Build select menu untuk transfer ownership.
 */
function buildTransferSelectMenu(voiceChannel, ownerId) {
    const options = [];
    if (voiceChannel?.members) {
        for (const [memberId, member] of voiceChannel.members) {
            if (memberId === ownerId) continue; // skip current owner
            options.push({
                label: member.user.tag.slice(0, 100),
                value: memberId,
                description: `Pindah ownership ke ${member.user.username}`
            });
        }
    }
    if (options.length === 0) {
        return null;
    }
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('tv_transfer_select')
            .setPlaceholder('Pilih member baru sebagai owner...')
            .addOptions(options.slice(0, 25))
            .setMinValues(1)
            .setMaxValues(1)
    );
}

/**
 * Build embed untuk panel setup (yang dipasang admin).
 */
function buildSetupPanelEmbed() {
    return new EmbedBuilder()
        .setTitle('🎤 BUAT VOICE CHANNEL PRIBADI')
        .setDescription(
            'Mau punya voice channel sendiri untuk nongkrong bareng tim?\n\n' +
            '👇 **Klik tombol "🎤 Buat Voice" di bawah** untuk membuat voice channel pribadi.\n\n' +
            '**✨ Fitur sebagai owner:**\n' +
            '• ✏️ Rename channel sesuai keinginan\n' +
            '• 🚫 Kick member yang bikin rusuh\n' +
            '• 👥 Atur limit member (mis. max 5 untuk squad)\n' +
            '• 🔒 Lock channel supaya private\n' +
            '• 🔄 Transfer ownership ke member lain\n' +
            '• 🗑️ Delete channel kapan saja\n\n' +
            '💡 Channel akan otomatis dihapus saat kosong.'
        )
        .setColor(0x5865F2)
        .setTimestamp();
}

function buildSetupPanelComponents() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tv_create')
            .setLabel('Buat Voice')
            .setEmoji('🎤')
            .setStyle(ButtonStyle.Success)
    );
}

module.exports = {
    buildControlEmbed,
    buildControlComponents,
    buildKickSelectMenu,
    buildTransferSelectMenu,
    buildSetupPanelEmbed,
    buildSetupPanelComponents
};
