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
const { safeWriteJSON } = require('./safeWrite');

const filePath = path.join(__dirname, '..', 'scheduledAnnouncements.json');

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
 * @returns {number|null} timestamp ms, atau null kalau invalid
 */
function parseTime(input) {
    if (!input) return null;
    const trimmed = input.trim().toLowerCase();

    // Relative: 30m, 2h, 1d, 1h30m
    const relMatch = trimmed.match(/^(\d+)([mhd])$/);
    if (relMatch) {
        const num = parseInt(relMatch[1]);
        const unit = relMatch[2];
        const now = Date.now();
        if (unit === 'm') return now + num * 60000;
        if (unit === 'h') return now + num * 3600000;
        if (unit === 'd') return now + num * 86400000;
    }

    // ISO-like: "2026-01-15 20:00" atau "2026-01-15T20:00"
    const isoMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (isoMatch) {
        const [, y, mo, d, h, mi, s] = isoMatch;
        const dt = new Date(y, parseInt(mo) - 1, d, h, mi, s || 0);
        if (!isNaN(dt.getTime())) return dt.getTime();
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
