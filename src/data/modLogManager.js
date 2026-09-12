/**
 * Mod Log Manager — riwayat tindakan moderasi per user (v3.9.43).
 *
 * File: data/modlogs.json
 * {
 *   "<guildId>:<userId>": [
 *     {
 *       id: "mod_<timestamp>_<rand>",
 *       type: "timeout" | "untimeout" | "kick" | "ban" | "unban",
 *       reason: "Spam iklan",
 *       durationMs: 3600000 | null,          // khusus timeout
 *       moderatorId: "...",
 *       moderatorTag: "Admin#1234",
 *       guildId: "...",
 *       userId: "...",
 *       createdAt: 1735689600000
 *     }
 *   ]
 * }
 *
 * Kenapa TIDAK digabung ke warns.json:
 *   1. Entry warn dihitung untuk threshold auto-action (3=mute 1h, dst).
 *      Kalau /timeout tercatat sebagai warn, 3x timeout → auto-mute 1 jam
 *      EKSTRAK di atas timeout manual — sanksi ganda yang membingungkan.
 *   2. Semantik beda: warn = pelanggaran; modlog = tindakan. Digabung,
 *      /warn-remove jadi ambigu (hapus pelanggaran atau hapus catatan
 *      tindakan admin?).
 *   Integrasi tetap ada: /warn-list menampilkan modlog sebagai seksi
 *   "Catatan Moderasi" — satu view, dua data source, tanpa efek samping
 *   threshold.
 *
 * Pattern: sama seperti warnManager — composite key `${guildId}:${userId}`,
 * safeWriteJSON + karantina file korup, scoped per guild.
 */

const fs = require('fs');
const path = require('path');
const { safeWriteJSON, quarantineCorruptFile } = require('../infra/safeWrite');

const filePath = path.join(__dirname, '..', '..', 'data', 'modlogs.json');

/** @type {Object<string, Array<Object>>} cache in-memory */
let store = null;

function keyFor(guildId, userId) {
    return `${guildId}:${userId}`;
}

function load() {
    if (store) return store;
    try {
        if (!fs.existsSync(filePath)) {
            store = {};
            return store;
        }
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        store = raw && typeof raw === 'object' ? raw : {};
    } catch (err) {
        console.warn('⚠️ modlogs.json rusak:', err.message);
        // v3.9.26 pattern: karantina file korup sebelum fallback empty.
        quarantineCorruptFile(filePath);
        store = {};
    }
    return store;
}

function save() {
    try {
        safeWriteJSON(filePath, store);
    } catch (err) {
        console.error('❌ Gagal simpan modlogs.json:', err.message);
    }
}

/**
 * Catat tindakan moderasi.
 * @param {string} guildId
 * @param {string} userId
 * @param {{type: string, reason?: string, durationMs?: number|null, moderatorId: string, moderatorTag: string}} entry
 * @returns {Object} entry yang baru dibuat (dengan id & createdAt)
 */
function addModLog(guildId, userId, entry) {
    const store = load();
    const key = keyFor(guildId, userId);
    if (!Array.isArray(store[key])) store[key] = [];

    const record = {
        id: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: entry.type,
        reason: entry.reason || '(tanpa alasan)',
        durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : null,
        moderatorId: entry.moderatorId,
        moderatorTag: entry.moderatorTag || entry.moderatorId,
        guildId,
        userId,
        createdAt: Date.now()
    };
    store[key].push(record);
    save();
    return record;
}

/**
 * Ambil riwayat moderasi user (scoped per guild).
 * @returns {Array<Object>}
 */
function getModLogs(guildId, userId) {
    const store = load();
    return store[keyFor(guildId, userId)] || [];
}

/**
 * Jumlah riwayat moderasi user (tanpa load array ke caller).
 */
function getModLogCount(guildId, userId) {
    return getModLogs(guildId, userId).length;
}

/**
 * Label tipe tindakan (dipakai /warn-list & DM).
 */
function modLogTypeLabel(type) {
    switch (type) {
        case 'timeout':
            return '🔇 Timeout';
        case 'untimeout':
            return '🔊 Timeout Dihapus';
        case 'kick':
            return '👢 Kick';
        case 'ban':
            return '🔨 Ban';
        case 'unban':
            return '♻️ Unban';
        default:
            return type;
    }
}

/**
 * v3.9.60: reset cache in-memory supaya bacaan berikutnya reload dari disk.
 * Dipanggil backupManager setelah /restore-backup — modlogs.json ikut
 * di-restore (v3.9.60) dan cache `store` permanen yang masih menyimpan state
 * SEBELUM-restore bakal ditulis balik ke file hasil restore oleh addModLog()
 * berikutnya → riwayat moderasi hasil restore hilang senyap (kelas bug yang
 * sama yang sudah diperbaiki untuk stats/serverstats/boosts).
 * @returns {Object} store yang baru dimuat
 */
function reload() {
    store = null;
    return load();
}

module.exports = {
    addModLog,
    getModLogs,
    getModLogCount,
    modLogTypeLabel,
    reload,
    _filePath: filePath,
    _resetForTests() {
        store = null;
    }
};
