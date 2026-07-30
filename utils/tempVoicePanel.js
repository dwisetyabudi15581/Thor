/**
 * Temp Voice Panel Builder
 * =========================
 * Bangun embed + components untuk panel setup Temp Voice.
 *
 * Custom ID contract (semua handler ada di interactionHandler.js):
 *   Buttons:
 *     tvp_btn_hub          → trigger ChannelSelectMenu (voice only)
 *     tvp_btn_category     → trigger ChannelSelectMenu (category only)
 *     tvp_btn_name         → trigger Modal (default name template)
 *     tvp_btn_limit        → trigger Modal (default user limit)
 *     tvp_btn_toggle       → enable / disable system
 *     tvp_btn_test         → buat test room untuk admin
 *     tvp_btn_reset        → tampilkan konfirmasi reset
 *     tvp_btn_reset_yes    → reset config tempVoice
 *     tvp_btn_reset_no     → batal reset (re-render panel)
 *     tvp_btn_close        → hapus message panel
 *
 *   Channel Selects:
 *     tvp_sel_hub          → set hubChannelId
 *     tvp_sel_category     → set categoryId
 *
 *   Modals:
 *     tvp_modal_name       → set defaultName
 *     tvp_modal_limit      → set defaultLimit
 *
 * Config schema (config.json → "tempVoice"):
 *   {
 *     hubChannelId: "...",
 *     categoryId: "..." | null,
 *     defaultName: "{username}'s Room",
 *     defaultLimit: 0,
 *     enabled: true | false   // ← baru
 *   }
 */

const {
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ChannelSelectMenuBuilder,
    ChannelType
} = require('discord.js');

/**
 * Bangun embed + components panel.
 *
 * @param {Object} config        - Output getConfig()
 * @param {Object} [tvStats]     - { activeRooms: number }
 * @param {Object} [client]      - Discord client (untuk avatar bot di footer)
 * @returns {{ embed: EmbedBuilder, components: ActionRowBuilder[] }}
 */
function buildTempVoicePanel(config, tvStats = {}, client) {
    const tv = config.tempVoice || {};
    const isSetup = !!tv.hubChannelId;
    // enabled default true kalau sudah di-setup, false kalau belum
    const enabled = isSetup ? (tv.enabled !== false) : false;

    // ----- Status line -----
    let statusLine;
    if (!isSetup) {
        statusLine = '⚪ **Belum di-setup** — klik 🎙️ **Set Hub** untuk mulai.';
    } else if (enabled) {
        statusLine = '🟢 **Aktif** — member join hub channel akan otomatis dibuatkan voice room sendiri.';
    } else {
        statusLine = '🔴 **Disabled** — sistem dimatikan sementara. Klik 🔼 **Enable** untuk mengaktifkan kembali.';
    }

    // ----- Field values -----
    const hubLine = tv.hubChannelId
        ? `<#${tv.hubChannelId}> \`${tv.hubChannelId}\``
        : '_(belum diset)_';
    const catLine = tv.categoryId
        ? `<#${tv.categoryId}> \`${tv.categoryId}\``
        : '_(default — same as hub)_';
    const nameLine = `\`${tv.defaultName || "{username}'s Room"}\``;
    const limitLine = (typeof tv.defaultLimit === 'number' && tv.defaultLimit > 0)
        ? `${tv.defaultLimit} user`
        : '_(tanpa limit)_';
    const panelLine = tv.panelChannelId && tv.panelMessageId
        ? `<#${tv.panelChannelId}> ([pesan](https://discord.com/channels/${config?.guildId || '0'}/${tv.panelChannelId}/${tv.panelMessageId}))`
        : '_(belum dideploy — klik 📱 Deploy Panel)_';

    // ----- Embed -----
    const embed = new EmbedBuilder()
        .setTitle('🎤 Temp Voice — Setup Panel')
        .setDescription(
            `Panel ini untuk mengatur **Temporary Voice Channels**.\n\n` +
            `Saat member join ke **Hub Channel**, bot otomatis membuat voice room baru milik member tersebut ` +
            `(dia jadi owner). Room akan dihapus otomatis ketika kosong.\n\n` +
            `${statusLine}`
        )
        .setColor(enabled ? 0x57F287 : (isSetup ? 0xED4245 : 0x95A5A6))
        .addFields(
            { name: '🎙️ Hub Channel', value: hubLine, inline: true },
            { name: '📁 Category', value: catLine, inline: true },
            { name: '🏷️ Default Name', value: nameLine, inline: true },
            { name: '👥 Default Limit', value: limitLine, inline: true },
            { name: '📊 Active Rooms', value: `${tvStats.activeRooms || 0} room`, inline: true },
            { name: '⚙️ Status', value: enabled ? '🟢 Enabled' : (isSetup ? '🔴 Disabled' : '⚪ Not Setup'), inline: true },
            { name: '📱 Member Panel', value: panelLine, inline: false }
        )
        .addFields({
            name: '💡 Placeholder Default Name',
            value: '• `{username}` — username member (tanpa discriminator)\n• `{tag}` — tag lengkap (User#1234)\n• Maks 100 karakter',
            inline: false
        })
        .setFooter({
            text: `${client?.user?.username || 'Bot'} • Temp Voice Panel`,
            iconURL: client?.user?.displayAvatarURL?.({ dynamic: true })
        })
        .setTimestamp();

    // ----- Row 1: Konfigurasi -----
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tvp_btn_hub')
            .setLabel('Set Hub')
            .setEmoji('🎙️')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('tvp_btn_category')
            .setLabel('Set Category')
            .setEmoji('📁')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('tvp_btn_name')
            .setLabel('Set Name')
            .setEmoji('🏷️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('tvp_btn_limit')
            .setLabel('Set Limit')
            .setEmoji('👥')
            .setStyle(ButtonStyle.Secondary)
    );

    // ----- Row 2: Aksi -----
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tvp_btn_toggle')
            .setLabel(enabled ? 'Disable' : 'Enable')
            .setEmoji(enabled ? '🔽' : '🔼')
            .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success)
            .setDisabled(!isSetup),
        new ButtonBuilder()
            .setCustomId('tvp_btn_test')
            .setLabel('Test Create')
            .setEmoji('🧪')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!isSetup || !enabled),
        new ButtonBuilder()
            .setCustomId('tvp_btn_deploy')
            .setLabel('Deploy Panel')
            .setEmoji('📱')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!isSetup),
        new ButtonBuilder()
            .setCustomId('tvp_btn_reset')
            .setLabel('Reset')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!isSetup)
    );

    // ----- Row 3: Close -----
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tvp_btn_close')
            .setLabel('Close Panel')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Secondary)
    );

    return { embed, components: [row1, row2, row3] };
}

/**
 * Bangun embed + components untuk konfirmasi reset.
 */
function buildResetConfirmPanel(client) {
    const embed = new EmbedBuilder()
        .setTitle('🗑️ Reset Temp Voice Config?')
        .setDescription(
            '⚠️ **Peringatan!** Tindakan ini akan:\n\n' +
            '• Hapus **Hub Channel** dari config\n' +
            '• Hapus **Category** dari config\n' +
            '• Reset **Default Name** ke `{username}\'s Room`\n' +
            '• Reset **Default Limit** ke 0 (tanpa limit)\n' +
            '• Set status ke **Disabled**\n\n' +
            '**Room temp voice yang sudah aktif TIDAK akan dihapus** — mereka akan tetap ada sampai kosong, ' +
            'tapi tidak bisa dikontrol lewat panel sampai setup ulang.\n\n' +
            'Lanjutkan?'
        )
        .setColor(0xED4245)
        .setFooter({
            text: `${client?.user?.username || 'Bot'} • Temp Voice Panel`,
            iconURL: client?.user?.displayAvatarURL?.({ dynamic: true })
        })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tvp_btn_reset_yes')
            .setLabel('Ya, Reset')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('tvp_btn_reset_no')
            .setLabel('Batal')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Secondary)
    );

    return { embed, components: [row] };
}

/**
 * Bangun ChannelSelectMenu untuk pilih hub channel.
 * Hanya menampilkan voice channels (GuildVoice).
 * @param {string} panelMessageId - ID pesan panel (untuk update balik setelah pilih)
 */
function buildHubChannelSelectRow(panelMessageId) {
    const row = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId(`tvp_sel_hub:${panelMessageId}`)
            .setPlaceholder('Pilih voice channel yang jadi "trigger"...')
            .setChannelTypes([ChannelType.GuildVoice])
            .setMinValues(1)
            .setMaxValues(1)
    );
    return row;
}

/**
 * Bangun ChannelSelectMenu untuk pilih category.
 * Hanya menampilkan category channels (GuildCategory).
 * @param {string} panelMessageId - ID pesan panel (untuk update balik setelah pilih)
 */
function buildCategorySelectRow(panelMessageId) {
    const row = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId(`tvp_sel_category:${panelMessageId}`)
            .setPlaceholder('Pilih category tempat room baru akan dibuat...')
            .setChannelTypes([ChannelType.GuildCategory])
            .setMinValues(1)
            .setMaxValues(1)
    );
    return row;
}

/**
 * Bangun ChannelSelectMenu untuk pilih text channel tujuan deploy member panel.
 * Hanya menampilkan text channels (GuildText).
 * @param {string} panelMessageId - ID pesan admin panel (untuk update balik setelah pilih)
 */
function buildDeployChannelSelectRow(panelMessageId) {
    const row = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId(`tvp_sel_deploy:${panelMessageId}`)
            .setPlaceholder('Pilih text channel tempat member panel akan dideploy...')
            .setChannelTypes([ChannelType.GuildText])
            .setMinValues(1)
            .setMaxValues(1)
    );
    return row;
}

module.exports = {
    buildTempVoicePanel,
    buildResetConfirmPanel,
    buildHubChannelSelectRow,
    buildCategorySelectRow,
    buildDeployChannelSelectRow
};
