/**
 * Temp Voice Control Panel Builder — render embed + button untuk panel kontrol GLOBAL.
 *
 * v3.8.5: Panel GLOBAL — tidak lagi fokus ke 1 owner (personal).
 *   - Idle: tampilkan tombol Buat Voice saja
 *   - Active: tampilkan daftar semua voice aktif + button kontrol
 *   - Button "Info Room" untuk lihat detail voice room (ephemeral)
 *   - Control buttons (Rename, Kick, Limit, Lock, Transfer, Delete) bekerja via auto-detect owner
 *
 * Dipakai oleh refreshGlobalControlPanel() di index.js.
 */

const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

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
 * v3.8.5: Build embed + components untuk panel kontrol GLOBAL.
 *
 * Panel ini murni global — menampilkan daftar semua voice aktif tanpa fokus ke owner tertentu.
 * Control buttons (Rename, Kick, Limit, dll) bekerja via auto-detect owner
 * (bot otomatis deteksi channel mana yang user owner-inya dan sedang user tinggali).
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
                `💡 **Join ke channel "🔊 Buat Voice"** untuk membuat voice channel pribadi.\n` +
                `Setelah kamu jadi owner, panel ini akan otomatis menampilkan voice kamu di daftar aktif.`
            )
            .setColor(0x95A5A6)
            .setFooter({ text: `${guildName} • Temp Voice System` })
            .setTimestamp();

        return { embed, components: [] };
    }

    // v3.8.5: Sort activeOwners by createdAt desc (paling baru pertama)
    const sorted = [...activeOwners].sort((a, b) =>
        (b.channelInfo.createdAt || 0) - (a.channelInfo.createdAt || 0)
    );

    // Build description — daftar semua voice aktif (GLOBAL, bukan personal)
    let description = `📋 **Voice Channel Aktif (${sorted.length}):**\n\n`;

    for (let i = 0; i < Math.min(sorted.length, 15); i++) {
        const o = sorted[i];
        const mc = o.voiceChannel?.members?.size || 0;
        const limitPart = o.channelInfo.limit > 0 ? `/${o.channelInfo.limit}` : '';
        const lockIcon = o.channelInfo.locked ? ' 🔒' : '';
        description += `• **${o.channelInfo.name}** — <@${o.channelInfo.ownerId}> (${mc}${limitPart} member${lockIcon})\n`;
    }
    if (sorted.length > 15) {
        description += `• ... dan ${sorted.length - 15} lainnya\n`;
    }

    description += `\n**🎮 Kontrol (klik untuk pakai):**\n`;
    description += `• ✏️ Rename • 🚫 Kick • 👥 Limit • 🔒 Lock • 🔄 Transfer • 🗑️ Delete • ℹ️ Info Room\n\n`;
    description += `💡 Bot otomatis deteksi channel kamu saat klik tombol kontrol. Kamu harus berada di voice channel milikmu.\n`;
    description += `💡 Klik **ℹ️ Info Room** untuk melihat detail voice room kamu.\n`;
    description += `💡 **Buat voice baru:** Join ke channel "🔊 Buat Voice".`;

    const embed = new EmbedBuilder()
        .setTitle('🎛️ TEMP VOICE CONTROL PANEL')
        .setDescription(description)
        .setColor(0x5865F2)
        .setFooter({ text: `${guildName} • Temp Voice System • ${sorted.length} voice aktif` })
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
            .setCustomId('tv_lock')
            .setLabel('Lock')
            .setEmoji('🔒')
            .setStyle(ButtonStyle.Secondary)
    );

    // Row 2: transfer, delete, info room
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tv_transfer')
            .setLabel('Transfer')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('tv_delete')
            .setLabel('Delete')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('tv_info')
            .setLabel('Info Room')
            .setEmoji('ℹ️')
            .setStyle(ButtonStyle.Secondary)
    );

    const components = [row1, row2];

    // v3.8.5: kalau ada multiple active voices, tambah select menu "Info Room"
    // supaya user bisa pilih channel mana yang ingin dilihat infonya
    if (sorted.length > 1) {
        const switchOptions = sorted.map(o => ({
            label: `${o.channelInfo.name}`.slice(0, 100),
            value: o.channelId,
            description: `Owner: ${o.channelInfo.ownerTag} (${o.voiceChannel?.members?.size || 0} member)`.slice(0, 100)
        }));
        const switchRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('tv_switch_select')
                .setPlaceholder('ℹ️ Pilih channel untuk lihat info...')
                .addOptions(switchOptions.slice(0, 25))
                .setMinValues(1)
                .setMaxValues(1)
        );
        components.push(switchRow);
    }

    return { embed, components };
}

/**
 * v3.8.5: Build ephemeral embed info room untuk voice channel tertentu.
 * Dipanggil saat user klik "Info Room" atau pilih channel dari switch select.
 *
 * @param {Object} channelInfo - info dari tempVoiceManager
 * @param {VoiceChannel} voiceChannel - Discord voice channel object
 * @param {string} guildName
 * @returns {Object} { embed }
 */
function buildInfoRoomEmbed(channelInfo, voiceChannel, guildName = 'Server') {
    const memberCount = voiceChannel?.members?.size || 0;
    const limitStr = channelInfo.limit === 0 ? '♾️ Tanpa batas' : `${channelInfo.limit} member`;
    const lockStr = channelInfo.locked ? '🔒 Terkunci' : '🔓 Terbuka';
    const createdDate = channelInfo.createdAt
        ? `<t:${Math.floor(channelInfo.createdAt / 1000)}:R>`
        : 'Tidak diketahui';

    // List members in voice
    let memberList = '';
    if (voiceChannel?.members && voiceChannel.members.size > 0) {
        const members = [...voiceChannel.members.values()];
        for (const m of members) {
            const isOwner = m.id === channelInfo.ownerId;
            memberList += `${isOwner ? '👑' : '•'} <@${m.id}>${isOwner ? ' **(Owner)**' : ''}\n`;
        }
    } else {
        memberList = 'Tidak ada member saat ini.';
    }

    const embed = new EmbedBuilder()
        .setTitle(`ℹ️ INFO ROOM — ${channelInfo.name}`)
        .setDescription(
            `🔊 **Nama:** ${channelInfo.name}\n` +
            `👑 **Owner:** <@${channelInfo.ownerId}> (${channelInfo.ownerTag})\n` +
            `👥 **Member:** ${memberCount}${channelInfo.limit > 0 ? ` / ${channelInfo.limit}` : ''}\n` +
            `📊 **Limit:** ${limitStr}\n` +
            `${channelInfo.locked ? '🔒' : '🔓'} **Status:** ${lockStr}\n` +
            `🕐 **Dibuat:** ${createdDate}\n\n` +
            `**Member di voice:**\n${memberList}`
        )
        .setColor(channelInfo.locked ? 0xE67E22 : 0x57F287)
        .setFooter({ text: `${guildName} • Temp Voice System` })
        .setTimestamp();

    return { embed };
}

module.exports = {
    buildKickSelectMenu,
    buildTransferSelectMenu,
    buildGlobalControlPanel,
    buildInfoRoomEmbed
};
