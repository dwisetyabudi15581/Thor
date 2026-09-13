/**
 * Server Log — catat event server (pesan dihapus/diedit, join/leave, ban,
 * perubahan role) ke channel khusus (v3.9.43).
 *
 * Perbedaan dengan auditLog.js:
 *   - auditLog  = action ADMIN lewat bot (SET_PRODUCT, WARN_ADD, dst) —
 *                 channel config.channels['audit-log'].
 *   - serverLog = aktivitas SERVER termasuk yang terjadi DI LUAR bot
 *                 (admin hapus pesan via Discord native, user edit pesan,
 *                 ban manual dari UI Discord, dst) — channel terpisah
 *                 config.channels['server-log'] supaya admin bisa atur
 *                 channel berbeda (log event itu high-volume).
 *
 * Dipakai oleh event handler di src/bot/events/:
 *   messageDelete, messageUpdate, messageBulkDelete, guildBanAdd,
 *   guildBanRemove, guildMemberUpdate + logging join/leave dari
 *   guildMemberAdd/guildMemberRemove.
 *
 * Kontrak (di-unit-test serverLog.test.js):
 *   - Channel belum di-set → return false (silent skip, sama seperti audit).
 *   - Field value di-truncate ≤ 1024 (limit Discord) + collapse newline.
 *   - Gagal kirim (permission/rate-limit) → return false, TANPA throw —
 *     event handler tidak boleh crash cuma karena log gagal.
 *   - Tanpa retry: server log itu high-volume; retry numpuk backlog.
 *     (audit log low-volume jadi di-retry — beda kebijakan, disengaja.)
 */

const { EmbedBuilder } = require('discord.js');
const { EMBED_LIMITS } = require('./constants');

// Warna konsisten per event (mudah di-scan visual di channel log).
const SERVER_LOG_EVENTS = {
    MSG_DELETE: { color: 0xed4245, title: '🗑️ Pesan Dihapus' },
    MSG_EDIT: { color: 0x5865f2, title: '✏️ Pesan Diedit' },
    MSG_BULK: { color: 0xe67e22, title: '🧹 Pesan Dihapus Massal' },
    MEMBER_JOIN: { color: 0x57f287, title: '📥 Member Join' },
    MEMBER_LEAVE: { color: 0xe67e22, title: '📤 Member Leave' },
    BAN_ADD: { color: 0xed4245, title: '🔨 Member Di-ban' },
    BAN_REMOVE: { color: 0x57f287, title: '♻️ Ban Dicabut' },
    ROLE_UPDATE: { color: 0xfee75c, title: '🎭 Role Member Berubah' },
    NICK_UPDATE: { color: 0x992d22, title: '📝 Nickname Berubah' },
    // v3.9.49: boost server tambah/hilang (dideteksi via diff premium_since di
    // guildMemberUpdate — tetap dicatat walau channel server-booster belum di-set).
    BOOST_ADD: { color: 0xf472b6, title: '🚀 Boost Dimulai' },
    BOOST_REMOVE: { color: 0x95a5a6, title: '💔 Boost Berakhir' }
};

/**
 * Snippet konten pesan utk field embed: collapse newline, truncate aman.
 * @param {string} text
 * @param {number} [max=1000]
 */
function snip(text, max = 1000) {
    if (text === null || text === undefined) return '';
    let t = String(text).replace(/\s*\n\s*/g, ' ').trim();
    if (t.length === 0) return '_(kosong)_';
    if (t.length > max) t = t.slice(0, max - 1) + '…';
    return t;
}

/**
 * Kirim satu entry server log.
 * @param {Client} client
 * @param {Object} data
 *   - type      : key SERVER_LOG_EVENTS (wajib)
 *   - guildId   : string (footer)
 *   - fields    : [{ name, value, inline? }] — SUDAH string (caller format)
 *   - footer    : string tambahan (optional)
 *   - content   : line mention optional di luar embed (optional, rare)
 * @returns {Promise<boolean>} sukses terkirim / tidak
 */
async function logServerEvent(client, data) {
    const conf = SERVER_LOG_EVENTS[data.type];
    if (!conf || !data.guildId) return false;

    let channelId;
    try {
        const { getConfig } = require('../data/configManager');
        // v3.10.0 multi-guild: channel server-log dibaca dari config guild
        // yang bersangkutan (data.guildId sudah bagian kontrak sejak v3.9.43).
        const config = getConfig(data.guildId);
        channelId = config.channels && config.channels['server-log'];
    } catch (_err) {
        return false; // config rusak — skip
    }
    if (!channelId) return false; // belum di-set — silent skip (kontrak auditLog)

    let channel;
    try {
        channel =
            client.channels.cache.get(channelId) ||
            (await client.channels.fetch(channelId).catch(() => null));
    } catch (_err) {
        return false;
    }
    if (!channel || typeof channel.send !== 'function') return false;

    try {
        // Guard limit: setiap field value ≤ 1024 + nama field ≤ 256.
        const fields = (Array.isArray(data.fields) ? data.fields : [])
            .filter(f => f && f.name && f.value !== undefined)
            .map(f => ({
                name: String(f.name).slice(0, EMBED_LIMITS.FIELD_NAME - 1),
                value: String(f.value).slice(0, EMBED_LIMITS.FIELD_VALUE - 1) || '_(kosong)_',
                inline: !!f.inline
            }))
            .slice(0, EMBED_LIMITS.FIELDS_COUNT);

        const embed = new EmbedBuilder()
            .setTitle(conf.title.slice(0, EMBED_LIMITS.TITLE - 1))
            .setColor(conf.color)
            .setTimestamp();

        if (fields.length > 0) embed.addFields(...fields);
        if (data.footer) embed.setFooter({ text: String(data.footer).slice(0, EMBED_LIMITS.FOOTER_TEXT - 1) });

        await channel.send({ content: data.content || undefined, embeds: [embed] });
        return true;
    } catch (err) {
        // TIDAK throw — event handler tetap aman. Log ringan sekali saja.
        console.warn(`⚠️ Server log [${data.type}] gagal terkirim: ${err.message || err}`);
        return false;
    }
}

/**
 * Cari executor dari audit log Discord (siapa yang hapus/ban).
 * Dipisah sebagai pure function supaya bisa di-unit-test tanpa API.
 *
 * @param {Object} p
 * @param {string|null} p.targetId user yang kena action (null = ambil termutakhir)
 * @param {string|null} [p.channelId] filter channel (MessageDelete punya entry.extra.channel)
 * @param {number} [p.windowMs=60000] batas umur entry audit (default 60 detik)
 * @param {number} [p.now=Date.now()]
 * @param {Array<{id: string, actionType: number, targetId?: string, executorId?: string|null, createdTimestamp?: number, extra?: {channelId?: string, channel?: {id: string}}}>} p.entries
 * @returns {{executorId: string|null, entry: Object|null}} executorId=null → tidak ketemu
 */
function findAuditExecutor({ entries, targetId, channelId, windowMs = 60000, now = Date.now() }) {
    if (!Array.isArray(entries) || entries.length === 0) return { executorId: null, entry: null };

    const candidates = entries
        .map(e => {
            const ts = typeof e.createdTimestamp === 'number' ? e.createdTimestamp : 0;
            const extraCh =
                (e.extra && (e.extra.channelId || (e.extra.channel && e.extra.channel.id))) || null;
            return {
                executorId: e.executorId || null,
                targetId: e.targetId || null,
                channelId: extraCh,
                ts,
                entry: e
            };
        })
        .filter(c => {
            if (now - c.ts > windowMs) return false; // terlalu lama — bukan action ini
            if (targetId && c.targetId && c.targetId !== targetId) return false;
            if (channelId && c.channelId && c.channelId !== channelId) return false;
            return true;
        })
        // Termutakhir dulu (audit entries biasanya sudah urut, tapi jangan andalkan).
        .sort((a, b) => b.ts - a.ts);

    const hit = candidates.find(c => c.executorId) || null;
    return hit ? { executorId: hit.executorId, entry: hit.entry } : { executorId: null, entry: null };
}

module.exports = { logServerEvent, findAuditExecutor, snip, SERVER_LOG_EVENTS };
