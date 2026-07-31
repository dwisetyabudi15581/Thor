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
 * Build embed untuk panel setup (yang dipasang admin di channel teks).
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

// ====================================================
// === v3.8.1: GLOBAL CONTROL PANEL — single persistent message ===
// ====================================================

/**
 * Build embed + components untuk panel kontrol GLOBAL.
 *
 * Panel ini dipasang sekali oleh admin di control channel (channel teks).
 * Saat ada owner voice aktif → embed menampilkan info owner + button kontrol.
 * Saat tidak ada voice aktif → embed balik ke "tidak ada voice aktif" + hanya tombol Buat.
 *
 * @param {Object} options - { activeOwners: [{channelId, channelInfo, voiceChannel}], guildName }
 * @returns {Object} { embed, components }
 */
function buildGlobalControlPanel(options = {}) {
    const { activeOwners = [], guildName = 'Server' } = options;

    if (activeOwners.length === 0) {
        // Tidak ada voice aktif — tampilan idle
        const embed = new EmbedBuilder()
            .setTitle('🎛️ TEMP VOICE CONTROL PANEL')
            .setDescription(
                '**Status:** Tidak ada voice channel aktif.\n\n' +
                `👇 **Klik tombol "🎤 Buat Voice" di bawah** untuk membuat voice channel pribadi.\n\n` +
                `💡 Setelah kamu jadi owner, panel ini akan otomatis menampilkan kontrol untuk channel kamu (rename, kick, limit, lock, dll).`
            )
            .setColor(0x95A5A6)
            .setFooter({ text: `${guildName} • Temp Voice System` })
            .setTimestamp();

        const components = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('tv_create')
                .setLabel('Buat Voice')
                .setEmoji('🎤')
                .setStyle(ButtonStyle.Success)
        );

        return { embed, components: [components] };
    }

    // v3.8.1: sort activeOwners by createdAt desc (paling baru pertama)
    // supaya panel menampilkan owner terbaru.
    const sorted = [...activeOwners].sort((a, b) =>
        (b.channelInfo.createdAt || 0) - (a.channelInfo.createdAt || 0)
    );

    // v3.8.2: kalau ada multiple owners, owner lain bisa pilih channel mereka
    // via select menu. Panel tetap tampilkan owner terbaru sebagai default.
    const owner = sorted[0]; // Ambil owner pertama (yang paling baru)
    const { channelInfo, voiceChannel } = owner;
    const memberCount = voiceChannel?.members?.size || 0;
    const limitStr = channelInfo.limit === 0 ? '♾️ Tanpa batas' : `${channelInfo.limit} member`;
    const lockStr = channelInfo.locked ? '🔒 Terkunci' : '🔓 Terbuka';

    let description =
        `**🎙️ Channel Aktif Milik:** <@${channelInfo.ownerId}>\n` +
        `🔊 **Nama:** ${channelInfo.name}\n` +
        `👥 **Member:** ${memberCount}${channelInfo.limit > 0 ? ` / ${channelInfo.limit}` : ''}\n` +
        `📊 **Limit:** ${limitStr}\n` +
        `${channelInfo.locked ? '🔒' : '🔓'} **Status:** ${lockStr}\n\n`;

    if (sorted.length > 1) {
        description += `ℹ️ Ada **${sorted.length}** voice aktif di server ini.\n`;
        description += `Kalau kamu owner salah satunya, pakai **dropdown "Switch Channel"** di bawah untuk pilih channel kamu.\n\n`;
    }

    description +=
        `**🎮 Kontrol (klik untuk pakai):**\n` +
        `• ✏️ Rename • 🚫 Kick • 👥 Limit • ${channelInfo.locked ? '🔓 Unlock' : '🔒 Lock'} • 🔄 Transfer • 🗑️ Delete\n\n` +
        `💡 Hanya owner (<@${channelInfo.ownerId}>) yang bisa pakai kontrol di bawah.`;

    const embed = new EmbedBuilder()
        .setTitle('🎛️ TEMP VOICE CONTROL PANEL')
        .setDescription(description)
        .setColor(channelInfo.locked ? 0xE67E22 : 0x57F287)
        .setFooter({ text: `${guildName} • Owner: ${channelInfo.ownerTag}` })
        .setTimestamp();

    // Row 1: rename, kick, limit, lock/unlock
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

    // Row 2: transfer, delete, + buat voice baru
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
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('tv_create')
            .setLabel('Buat Voice Baru')
            .setEmoji('🎤')
            .setStyle(ButtonStyle.Success)
    );

    const components = [row1, row2];

    // v3.8.2: kalau ada multiple owners, tambah select menu "Switch Channel"
    // supaya owner lain bisa pilih channel mereka untuk kontrol.
    if (sorted.length > 1) {
        const switchOptions = sorted.map(o => ({
            label: `${o.channelInfo.name}`.slice(0, 100),
            value: o.channelId,
            description: `Owner: ${o.channelInfo.ownerTag}`.slice(0, 100)
        }));
        const switchRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('tv_switch_select')
                .setPlaceholder('🔄 Switch ke channel lain (untuk owner lain)...')
                .addOptions(switchOptions.slice(0, 25))
                .setMinValues(1)
                .setMaxValues(1)
        );
        components.push(switchRow);
    }

    return { embed, components };
}

/**
 * v3.8.2: Build panel khusus untuk channel yang dipilih via switch select.
 * Sama seperti active state, tapi owner = channel yang dipilih (bukan default terbaru).
 */
function buildGlobalControlPanelForChannel(options = {}) {
    const { channelInfo, voiceChannel, guildName = 'Server', totalActiveCount = 1 } = options;

    const memberCount = voiceChannel?.members?.size || 0;
    const limitStr = channelInfo.limit === 0 ? '♾️ Tanpa batas' : `${channelInfo.limit} member`;
    const lockStr = channelInfo.locked ? '🔒 Terkunci' : '🔓 Terbuka';

    let description =
        `**🎙️ Channel Aktif Milik:** <@${channelInfo.ownerId}>\n` +
        `🔊 **Nama:** ${channelInfo.name}\n` +
        `👥 **Member:** ${memberCount}${channelInfo.limit > 0 ? ` / ${channelInfo.limit}` : ''}\n` +
        `📊 **Limit:** ${limitStr}\n` +
        `${channelInfo.locked ? '🔒' : '🔓'} **Status:** ${lockStr}\n\n`;

    if (totalActiveCount > 1) {
        description += `ℹ️ Ada **${totalActiveCount}** voice aktif. Kamu sedang melihat channel ini (via switch).\n\n`;
    }

    description +=
        `**🎮 Kontrol (klik untuk pakai):**\n` +
        `• ✏️ Rename • 🚫 Kick • 👥 Limit • ${channelInfo.locked ? '🔓 Unlock' : '🔒 Lock'} • 🔄 Transfer • 🗑️ Delete\n\n` +
        `💡 Hanya owner (<@${channelInfo.ownerId}>) yang bisa pakai kontrol di bawah.`;

    const embed = new EmbedBuilder()
        .setTitle('🎛️ TEMP VOICE CONTROL PANEL')
        .setDescription(description)
        .setColor(channelInfo.locked ? 0xE67E22 : 0x57F287)
        .setFooter({ text: `${guildName} • Owner: ${channelInfo.ownerTag}` })
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tv_rename').setLabel('Rename').setEmoji('✏️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tv_kick').setLabel('Kick').setEmoji('🚫').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('tv_limit').setLabel('Limit').setEmoji('👥').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(channelInfo.locked ? 'tv_unlock' : 'tv_lock')
            .setLabel(channelInfo.locked ? 'Unlock' : 'Lock')
            .setEmoji(channelInfo.locked ? '🔓' : '🔒')
            .setStyle(channelInfo.locked ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tv_transfer').setLabel('Transfer Owner').setEmoji('🔄').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tv_delete').setLabel('Delete Channel').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('tv_create').setLabel('Buat Voice Baru').setEmoji('🎤').setStyle(ButtonStyle.Success)
    );

    return { embed, components: [row1, row2] };
}

module.exports = {
    buildControlEmbed,
    buildControlComponents,
    buildKickSelectMenu,
    buildTransferSelectMenu,
    buildSetupPanelEmbed,
    buildSetupPanelComponents,
    buildGlobalControlPanel,
    buildGlobalControlPanelForChannel
};
