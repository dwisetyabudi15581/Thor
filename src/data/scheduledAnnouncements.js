/**
 * Scheduled Announcements — kirim embed ke channel pada waktu tertentu.
 *
 * File: scheduledAnnouncements.json
 * [
 *   {
 *     id: "sa_<timestamp>_<rand>",
 *     guildId: "...",
 *     channelId: "...",
 *     sendAt: 1735689600000,    // timestamp ms
 *     sent: false,
 *     sentAt: null,
 *     data: {
 *       title, description, color, image, thumbnail, mention,
 *       authorId, authorTag
 *     },
 *     recurring: null | 'daily' | 'weekly' | 'monthly',
 *     createdAt: ...
 *   }
 * ]
 *
 * Recurring:
 *   - daily: sendAt di-update ke next day, same time
 *   - weekly: sendAt di-update ke next week, same time
 *   - monthly: sendAt di-update ke next month, same day+time
 */

const fs = require('fs');
const path = require('path');
const { safeWriteJSON } = require('../infra/safeWrite');

const filePath = path.join(__dirname, '..', '..', 'data', 'scheduledAnnouncements.json');

function load() {
    try {
        if (!fs.existsSync(filePath)) return [];
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn('⚠️ scheduledAnnouncements.json rusak:', err.message);
        return [];
    }
}

// v3.9.0 FIX: atomic write via safeWriteJSON (tmp+rename) to prevent corruption on crash
function save(list) {
    safeWriteJSON(filePath, list);
}

function genId() {
    return `sa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function create(data) {
    const list = load();
    const entry = {
        id: genId(),
        guildId: data.guildId,
        channelId: data.channelId,
        sendAt: data.sendAt,
        sent: false,
        sentAt: null,
        data: {
            title: data.title,
            description: data.description,
            color: data.color || 0x5865F2,
            image: data.image || null,
            thumbnail: data.thumbnail || null,
            mention: data.mention || null,
            authorId: data.authorId,
            authorTag: data.authorTag
        },
        recurring: data.recurring || null,
        createdAt: Date.now()
    };
    list.push(entry);
    save(list);
    return entry;
}

function get(id) {
    return load().find(e => e.id === id);
}

function getByGuild(guildId) {
    return load().filter(e => e.guildId === guildId);
}

function getPending(now = Date.now()) {
    return load().filter(e => !e.sent && e.sendAt <= now);
}

function markSent(id) {
    const list = load();
    const entry = list.find(e => e.id === id);
    if (!entry) return null;
    entry.sent = true;
    entry.sentAt = Date.now();

    // Kalau recurring, bikin entry baru untuk next cycle
    if (entry.recurring) {
        const nextSendAt = computeNextRecurring(entry.sendAt, entry.recurring);
        if (nextSendAt) {
            const newEntry = {
                ...entry,
                id: genId(),
                sendAt: nextSendAt,
                sent: false,
                sentAt: null,
                createdAt: Date.now()
            };
            list.push(newEntry);
        }
    }

    save(list);
    return entry;
}

function remove(id) {
    const list = load();
    const filtered = list.filter(e => e.id !== id);
    if (filtered.length !== list.length) {
        save(filtered);
        return true;
    }
    return false;
}

/**
 * Compute next recurring timestamp.
 * @param {number} fromTs - timestamp referensi
 * @param {string} type - 'daily' | 'weekly' | 'monthly'
 * @returns {number|null} next timestamp, atau null kalau invalid
 */
function computeNextRecurring(fromTs, type) {
    const d = new Date(fromTs);
    switch (type) {
        case 'daily':
            d.setDate(d.getDate() + 1);
            return d.getTime();
        case 'weekly':
            d.setDate(d.getDate() + 7);
            return d.getTime();
        case 'monthly':
            d.setMonth(d.getMonth() + 1);
            return d.getTime();
        default:
            return null;
    }
}

/**
 * Parse natural language time string ke timestamp.
 * Format yang didukung:
 *   - ISO: "2026-01-15 20:00" → di-asumsikan timezone lokal
 *   - Relative: "30m", "2h", "1d" → now + duration
 *
 * v3.9.1 FIX: tambah range validation supaya admin tidak schedule announce
 *   1000000 hari ke depan (yang akan bikin recurring ghost entries forever).
 *   - Relative: maks 365 hari (8760 jam)
 *   - Absolute: maks 5 tahun ke depan
 *   - Past time: null (akan di-reject oleh caller juga, tapi set di sini juga)
 *
 * @returns {number|null} timestamp ms, atau null kalau invalid
 */
function parseTime(input) {
    if (!input) return null;
    const trimmed = input.trim().toLowerCase();
    const now = Date.now();
    const MAX_RELATIVE_DAYS = 365;
    const MAX_ABSOLUTE_FUTURE_MS = 5 * 365 * 24 * 60 * 60 * 1000; // 5 tahun

    // Relative: 30m, 2h, 1d, 1h30m
    const relMatch = trimmed.match(/^(\d+)([mhd])$/);
    if (relMatch) {
        const num = parseInt(relMatch[1]);
        const unit = relMatch[2];
        // v3.9.1: range check — angka terlalu besar = invalid.
        if (num <= 0 || num > 1000000) return null;

        let deltaMs;
        if (unit === 'm') deltaMs = num * 60000;
        else if (unit === 'h') deltaMs = num * 3600000;
        else if (unit === 'd') deltaMs = num * 86400000;
        else return null;

        // Cek batas atas (maks 365 hari)
        if (deltaMs > MAX_RELATIVE_DAYS * 86400000) return null;

        return now + deltaMs;
    }

    // ISO-like: "2026-01-15 20:00" atau "2026-01-15T20:00"
    const isoMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (isoMatch) {
        const [, y, mo, d, h, mi, s] = isoMatch;
        const yearNum = parseInt(y, 10);
        const monthNum = parseInt(mo, 10);
        const dayNum = parseInt(d, 10);
        const hourNum = parseInt(h, 10);
        const minNum = parseInt(mi, 10);
        const secNum = s ? parseInt(s, 10) : 0;
        const dt = new Date(yearNum, monthNum - 1, dayNum, hourNum, minNum, secNum);
        if (isNaN(dt.getTime())) return null;

        // v3.9.8 FIX: Date constructor auto-rolls invalid components (mis. month 13
        // → January next year, day 40 → 9th of next month). Sebelumnya, "2026-13-40 99:99"
        // silently menjadi valid date di tahun 2027. Sekarang: verify components match.
        if (dt.getFullYear() !== yearNum ||
            dt.getMonth() !== monthNum - 1 ||
            dt.getDate() !== dayNum ||
            dt.getHours() !== hourNum ||
            dt.getMinutes() !== minNum) {
            return null;
        }

        const ts = dt.getTime();
        // v3.9.1: reject kalau di masa lalu ATAU lebih dari 5 tahun ke depan.
        if (ts < now) return null;
        if (ts > now + MAX_ABSOLUTE_FUTURE_MS) return null;
        return ts;
    }

    return null;
}

function formatTimeLeft(ms) {
    if (ms <= 0) return 'sekarang';
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    if (days > 0) return `${days}h ${hours}j`;
    if (hours > 0) return `${hours}j ${mins}m`;
    return `${mins}m`;
}

module.exports = {
    create, get, getByGuild, getPending, markSent, remove,
    computeNextRecurring, parseTime
};
