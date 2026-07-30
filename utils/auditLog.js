/**
 * Audit Log — catat semua admin action ke channel khusus.
 *
 * Cara pakai:
 *   const { logAudit } = require('../utils/auditLog');
 *   await logAudit(client, {
 *     action: 'ADD_PRODUCT',
 *     actorId: interaction.user.id,
 *     actorTag: interaction.user.tag,
 *     details: `Tambah produk: ${label} (${value}) — ${price}`,
 *     guildId: interaction.guild.id
 *   });
 *
 * Channel tujuan diambil dari config.channels['audit-log'].
 * Kalau belum di-set, log di-skip (silent fail).
 *
 * Tidak ada file JSON — log dikirim langsung ke channel Discord.
 */

const { EmbedBuilder } = require('discord.js');

const ACTION_LABELS = {
    // Products
    ADD_PRODUCT: '➕ Tambah Produk',
    REMOVE_PRODUCT: '❌ Hapus Produk',
    EDIT_PRODUCT: '✏️ Edit Produk',
    // Roles & Channels
    SET_ROLE: '🎭 Set Role',
    REMOVE_ROLE: '🚫 Hapus Role dari Config',
    SET_CHANNEL: '📢 Set Channel',
    REMOVE_CHANNEL: '🚫 Hapus Channel dari Config',
    // Messages
    SET_MESSAGE: '✏️ Set Pesan',
    RESET_MESSAGE: '🔄 Reset Pesan ke Default',
    // Self-Role
    SETUP_SELFROLE: '🎭 Buat Panel Self-Role',
    SELFROLE_ADD: '➕ Tambah Role ke Panel',
    SELFROLE_REMOVE: '❌ Hapus Role dari Panel',
    SELFROLE_DELETE: '🗑️ Hapus Panel Self-Role',
    // Embed Builder & Announce
    ANNOUNCE_SEND: '📢 Kirim Announce',
    EMBED_BUILDER_SEND: '📤 Kirim Embed (Builder)',
    // VIP / Keys
    SET_KEY: '🔑 Set Key (Ticket)',
    CLEAR_SCHEDULE: '🧹 Clear Schedule',
    // Config
    RESET_CONFIG: '⚠️ RESET CONFIG TOTAL',
    // Backup
    BACKUP_NOW: '💾 Backup Manual',
    RESTORE_BACKUP: '♻️ Restore Backup',
    // Giveaway
    GIVEAWAY_CREATE: '🎉 Buat Giveaway',
    GIVEAWAY_END: '🛑 End Giveaway',
    GIVEAWAY_REROLL: '🎲 Reroll Giveaway',
    // Scheduled Announce
    ANNOUNCE_SCHEDULE: '⏰ Schedule Announce',
    ANNOUNCE_CANCEL: '❌ Cancel Scheduled Announce',
    // Warn
    WARN_ADD: '⚠️ Warn Member',
    WARN_REMOVE: '✅ Hapus Warn',
    // Poll
    POLL_CREATE: '📊 Buat Poll',
    POLL_CLOSE: '🔒 Tutup Poll'
};

/**
 * Kirim entry audit log ke channel yang sudah di-set.
 * @param {Client} client - Discord client
 * @param {Object} data - { action, actorId, actorTag, details, guildId }
 * @returns {Promise<boolean>} true kalau berhasil terkirim, false kalau gagal/skip
 */
async function logAudit(client, data) {
    try {
        const { getConfig } = require('./configManager');
        const config = getConfig();
        const auditChannelId = config.channels['audit-log'];
        if (!auditChannelId) return false; // belum di-set, silent skip

        const channel = client.channels.cache.get(auditChannelId);
        if (!channel) return false;

        const label = ACTION_LABELS[data.action] || data.action;
        const embed = new EmbedBuilder()
            .setTitle(`🔧 AUDIT: ${label}`)
            .setColor(0x2C2F33)
            .addFields(
                { name: '👤 Admin', value: `<@${data.actorId}> (\`${data.actorTag || data.actorId}\`)`, inline: true },
                { name: '🕐 Waktu', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                { name: '📋 Detail', value: data.details || '_(tidak ada detail)_' }
            )
            .setFooter({ text: `Action: ${data.action}` })
            .setTimestamp();

        if (data.guildId) embed.addFields({ name: '🏠 Guild', value: `\`${data.guildId}\``, inline: true });

        await channel.send({ embeds: [embed] });
        return true;
    } catch (err) {
        console.warn('⚠️ Gagal kirim audit log:', err.message);
        return false;
    }
}

module.exports = { logAudit, ACTION_LABELS };
