/**
 * In-memory session manager untuk Embed Builder interactive.
 *
 * Sessions hilang kalau bot restart (acceptable untuk UX builder).
 * Kalau user klik tombol draft lama setelah restart → reply "session expired".
 *
 * Session structure:
 * {
 *   id: 'emb_<timestamp>_<rand>',
 *   ownerId: '<discord user id>',
 *   channelId: '<channel where draft message lives>',
 *   messageId: '<draft message id>',
 *   data: {
 *     title, description, color (number), image {url}, thumbnail {url},
 *     footer {text, iconURL?}, author {name, iconURL?},
 *     fields: [{name, value, inline}], timestamp (boolean)
 *   },
 *   createdAt: timestamp
 * }
 */

const sessions = new Map();

function genId() {
    return `emb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function createDefaultData() {
    return {
        title: null,
        description: null,
        color: 0x5865F2, // default blurple
        image: null,
        thumbnail: null,
        footer: null,
        author: null,
        fields: [],
        timestamp: true
    };
}

function createSession(ownerId, channelId) {
    const id = genId();
    const session = {
        id,
        ownerId,
        channelId,
        messageId: null,
        data: createDefaultData(),
        createdAt: Date.now()
    };
    sessions.set(id, session);
    return session;
}

function getSession(id) {
    return sessions.get(id) || null;
}

function getSessionByMessage(messageId) {
    for (const s of sessions.values()) {
        if (s.messageId === messageId) return s;
    }
    return null;
}

function deleteSession(id) {
    return sessions.delete(id);
}

/**
 * Parse hex color string ke number.
 * Accept: "#FF0000", "FF0000", "0xFF0000", "#f00" (3-digit expanded)
 * Returns: number atau null kalau invalid.
 */
function parseColor(input) {
    if (!input) return null;
    let hex = input.trim().replace(/^#/, '').replace(/^0x/i, '');
    if (hex.length === 3) {
        // Expand 3-digit: "f00" → "ff0000"
        hex = hex.split('').map(c => c + c).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return parseInt(hex, 16);
}

/**
 * Build Discord EmbedBuilder dari session data.
 *
 * Catatan: Discord API mewajibkan embed punya minimal salah satu dari:
 * title, description, fields, image, thumbnail, author, footer.
 * Kalau session dalam state kosong (baru dibuat), kita pakai placeholder
 * description supaya tidak kena error BASE_TYPE_REQUIRED.
 */
function buildEmbed(session) {
    // Lazy require supaya file ini bisa di-load tanpa discord.js (untuk testing)
    const { EmbedBuilder } = require('discord.js');
    const d = session.data;
    const embed = new EmbedBuilder();

    // Deteksi state kosong: tidak ada title, description, fields, image,
    // thumbnail, author, footer. Kalau kosong, pakai placeholder.
    const hasContent = d.title
        || d.description
        || (d.fields && d.fields.length > 0)
        || d.image
        || d.thumbnail
        || (d.footer && d.footer.text)
        || (d.author && d.author.name);

    if (!hasContent) {
        embed.setDescription('*(Belum ada konten — pakai dropdown di bawah untuk mulai mengedit embed.)*');
    } else {
        if (d.title) embed.setTitle(d.title);
        if (d.description) embed.setDescription(d.description);
        if (d.image) embed.setImage(d.image.url);
        if (d.thumbnail) embed.setThumbnail(d.thumbnail.url);
        if (d.footer && d.footer.text) {
            const f = { text: d.footer.text };
            if (d.footer.iconURL) f.iconURL = d.footer.iconURL;
            embed.setFooter(f);
        }
        if (d.author && d.author.name) {
            const a = { name: d.author.name };
            if (d.author.iconURL) a.iconURL = d.author.iconURL;
            embed.setAuthor(a);
        }
        if (d.fields && d.fields.length > 0) embed.addFields(d.fields);
    }

    if (d.color !== null && d.color !== undefined) embed.setColor(d.color);
    if (d.timestamp) embed.setTimestamp();
    return embed;
}

/**
 * Build status text untuk ditampilkan di control panel (opsional).
 * Berguna untuk debugging atau info cepat.
 */
function getStatusText(session) {
    const d = session.data;
    const lines = [];
    lines.push(`Title: ${d.title ? '✅' : '❌'}`);
    lines.push(`Description: ${d.description ? '✅' : '❌'}`);
    lines.push(`Color: ${d.color !== null ? '✅ #' + d.color.toString(16).padStart(6, '0') : 'default'}`);
    lines.push(`Image: ${d.image ? '✅' : '❌'}`);
    lines.push(`Thumbnail: ${d.thumbnail ? '✅' : '❌'}`);
    lines.push(`Footer: ${d.footer ? '✅' : '❌'}`);
    lines.push(`Author: ${d.author ? '✅' : '❌'}`);
    lines.push(`Fields: ${d.fields.length}/25`);
    lines.push(`Timestamp: ${d.timestamp ? '✅' : '❌'}`);
    return lines.join('\n');
}

/**
 * List semua session milik user tertentu (diurutkan dari terbaru).
 * Dipakai oleh /embed-list command.
 */
function getSessionsByUser(userId) {
    const result = [];
    for (const s of sessions.values()) {
        if (s.ownerId === userId) result.push(s);
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Hapus session milik user berdasarkan ID.
 * Dipakai oleh /embed-cancel command (untuk session yang draft-nya sudah kehapus).
 * Returns: session yang dihapus, atau null kalau tidak ada / bukan milik user.
 */
function deleteSessionByOwner(sessionId, userId) {
    const s = sessions.get(sessionId);
    if (!s || s.ownerId !== userId) return null;
    sessions.delete(sessionId);
    return s;
}

module.exports = {
    createSession,
    getSession,
    getSessionByMessage,
    getSessionsByUser,
    deleteSession,
    deleteSessionByOwner,
    buildEmbed,
    parseColor,
    getStatusText
};
