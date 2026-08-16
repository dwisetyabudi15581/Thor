/**
 * AFK Manager — track user yang lagi AFK + auto-reply saat di-mention.
 *
 * File: data/afk.json
 * {
 *   "<guildId>:<userId>": {
 *     "reason": "Makan dulu",
 *     "since": 1735689600000,
 *     "guildId": "...",
 *     "userId": "..."
 *   }
 * }
 *
 * Composite key supaya AFK scoped per guild (user bisa AFK di guild A tapi aktif di guild B).
 */

const fs = require('fs');
const path = require('path');
const { safeWriteJSON } = require('../infra/safeWrite');

const filePath = path.join(__dirname, '..', '..', 'data', 'afk.json');

function load() {
    try {
        if (!fs.existsSync(filePath)) return {};
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn('⚠️ afk.json rusak:', err.message);
        return {};
    }
}

function save(data) {
    safeWriteJSON(filePath, data);
}

function keyFor(guildId, userId) {
    return `${guildId}:${userId}`;
}

function setAFK(guildId, userId, reason) {
    const all = load();
    const k = keyFor(guildId, userId);
    all[k] = {
        reason: reason || 'AFK',
        since: Date.now(),
        guildId,
        userId
    };
    save(all);
    return all[k];
}

function clearAFK(guildId, userId) {
    const all = load();
    const k = keyFor(guildId, userId);
    if (!all[k]) return false;
    delete all[k];
    save(all);
    return true;
}

function getAFK(guildId, userId) {
    const all = load();
    return all[keyFor(guildId, userId)] || null;
}

function isAFK(guildId, userId) {
    return getAFK(guildId, userId) !== null;
}

/**
 * Format duration AFK (mis. "5 menit lalu", "2 jam lalu", "1 hari lalu").
 */
function formatDuration(since, now = Date.now()) {
    const diff = now - since;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} hari lalu`;
    if (hours > 0) return `${hours} jam lalu`;
    if (minutes > 0) return `${minutes} menit lalu`;
    return `${seconds} detik lalu`;
}

/**
 * List semua user AFK di guild tertentu, sorted by since (paling baru duluan).
 * v3.9.17: tambah supaya /afk-list tidak perlu baca afk.json langsung.
 *
 * @param {string} guildId
 * @returns {Array<{userId, reason, since, guildId}>}
 */
function listGuildAFK(guildId) {
    const all = load();
    const prefix = `${guildId}:`;
    return Object.values(all)
        .filter(data => data && data.guildId === guildId)
        .sort((a, b) => b.since - a.since);
}

module.exports = {
    setAFK,
    clearAFK,
    getAFK,
    isAFK,
    formatDuration,
    listGuildAFK
};
