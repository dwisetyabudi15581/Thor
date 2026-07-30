/**
 * Temp Voice Control Panel (Member-facing)
 * =========================================
 * Builder untuk panel kontrol yang dilihat member di text channel.
 *
 * Member pakai panel ini untuk kelola room voice-nya TANPA slash command:
 *   - 🏷️ Rename    → modal (nama baru)
 *   - 👥 Limit     → modal (0-99)
 *   - 🔒 Lock      → deny Connect untuk @everyone
 *   - 🔓 Unlock    → allow Connect untuk @everyone
 *   - 👑 Transfer  → UserSelectMenu (pilih member di room)
 *   - 🦵 Kick      → UserSelectMenu (pilih member di room)
 *   - ✋ Claim     → ambil ownership kalau owner sudah leave
 *   - ℹ️ Info      → lihat info room saat ini
 *
 * Custom ID contract (semua handler di interactionHandler.js):
 *   Buttons:
 *     tvm_rename, tvm_limit, tvm_lock, tvm_unlock,
 *     tvm_transfer, tvm_kick, tvm_claim, tvm_info
 *
 *   User Selects (ephemeral, muncul setelah klik Transfer/Kick):
 *     tvm_sel_transfer
 *     tvm_sel_kick
 *
 *   Modals:
 *     tvm_modal_rename
 *     tvm_modal_limit
 *
 * Config (config.json → "tempVoice"):
 *   {
 *     hubChannelId, categoryId, defaultName, defaultLimit, enabled,
 *     panelChannelId:  "...",   // text channel temp panel ini dideploy
 *     panelMessageId:  "..."    // ID pesan panel (untuk re-deploy / edit)
 *   }
 */

const {
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    UserSelectMenuBuilder
} = require('discord.js');

/**
 * Bangun embed + components untuk member control panel.
 *
 * @param {Object} tvConfig - config.tempVoice (untuk ambil hubChannelId)
 * @param {Object} [client] - Discord client (untuk avatar bot di footer)
 * @returns {{ embed: EmbedBuilder, components: ActionRowBuilder[] }}
 */
function buildControlPanel(tvConfig, client) {
    const hubLine = tvConfig?.hubChannelId
        ? `Join voice channel <#${tvConfig.hubChannelId}> untuk mendapatkan room voice pribadi.`
        : '⚠️ Hub channel belum di-set. Minta admin setup dulu via `/tempvoice-panel`.';

    const embed = new EmbedBuilder()
        .setTitle('🎤 Temp Voice — Control Panel')
        .setDescription(
            `**Cara pakai:**\n` +
            `1. ${hubLine}\n` +
            `2. Bot akan otomatis membuat voice room baru untukmu (kamu jadi owner).\n` +
            `3. Gunakan tombol di bawah untuk kelola room kamu.\n\n` +
            `💡 **Tips:** Room otomatis dihapus ketika kosong. Kalau kamu leave tapi masih ada member, room tetap aktif dan member lain bisa klaim ownership.`
        )
        .setColor(0x57F287)
        .addFields(
            {
                name: '🏷️ Owner Controls',
                value: [
                    '• **Rename** — ganti nama room',
                    '• **Limit** — set maksimal user (0 = tanpa limit)',
                    '• **Lock / Unlock** — kunci / buka room',
                    '• **Transfer** — pindah ownership ke member lain di room',
                    '• **Kick** — keluarkan member dari room'
                ].join('\n'),
                inline: false
            },
            {
                name: '👥 Public Controls',
                value: [
                    '• **Claim** — ambil ownership kalau owner sudah leave',
                    '• **Info** — lihat info room temp voice kamu saat ini'
                ].join('\n'),
                inline: false
            },
            {
                name: '⚠️ Syarat',
                value: 'Kamu harus berada di **temp voice room** milikmu untuk pakai tombol owner. Untuk Claim & Info, kamu cukup berada di temp voice room manapun.',
                inline: false
            }
        )
        .setFooter({
            text: `${client?.user?.username || 'Bot'} • Temp Voice Control Panel`,
            iconURL: client?.user?.displayAvatarURL?.({ dynamic: true })
        })
        .setTimestamp();

    // Row 1: Rename, Limit, Lock, Unlock, Info
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tvm_rename')
            .setLabel('Rename')
            .setEmoji('🏷️')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('tvm_limit')
            .setLabel('Limit')
            .setEmoji('👥')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('tvm_lock')
            .setLabel('Lock')
            .setEmoji('🔒')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('tvm_unlock')
            .setLabel('Unlock')
            .setEmoji('🔓')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('tvm_info')
            .setLabel('Info')
            .setEmoji('ℹ️')
            .setStyle(ButtonStyle.Secondary)
    );

    // Row 2: Transfer, Kick, Claim
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tvm_transfer')
            .setLabel('Transfer')
            .setEmoji('👑')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('tvm_kick')
            .setLabel('Kick')
            .setEmoji('🦵')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('tvm_claim')
            .setLabel('Claim')
            .setEmoji('✋')
            .setStyle(ButtonStyle.Success)
    );

    return { embed, components: [row1, row2] };
}

/**
 * Bangun UserSelectMenu untuk Transfer / Kick.
 * Member akan pilih user dari daftar member yang ada di voice channel.
 * @param {'transfer'|'kick'} action
 */
function buildUserSelectRow(action) {
    const customId = action === 'transfer' ? 'tvm_sel_transfer' : 'tvm_sel_kick';
    return new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(action === 'transfer' ? 'Pilih member baru sebagai owner...' : 'Pilih member yang akan di-kick...')
            .setMinValues(1)
            .setMaxValues(1)
    );
}

module.exports = { buildControlPanel, buildUserSelectRow };
