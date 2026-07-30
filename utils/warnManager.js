/**
 * Warn Manager — track warning member + auto-action berdasarkan threshold.
 *
 * File: warns.json
 * {
 *   "userId1": [
 *     {
 *       id: "warn_<timestamp>_<rand>",
 *       reason: "Spam di #general",
 *       warnedBy: "adminId",
 *       warnedByTag: "Admin#1234",
 *       guildId: "...",
 *       createdAt: 1735689600000,
 *       actionTaken: null | "mute_1h" | "mute_1d" | "kick"
 *     }
 *   ]
 * }
 *
 * Threshold default:
 *   3 warn → mute 1 jam
 *   5 warn → mute 1 hari
 *   7 warn → kick
 * (Bisa di-override per guild via config.warnThresholds)
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'warns.json');

const DEFAULT_THRESHOLDS = {
    mute1h: 3,    // 3 warnings → mute 1 jam
    mute1d: 5,    // 5 warnings → mute 1 hari
    kick: 7       // 7 warnings → kick
};

function load() {
    try {
        if (!fs.existsSync(filePath)) return {};
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn('⚠️ warns.json rusak:', err.message);
        return {};
    }
}

function save(data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function genId() {
    return `warn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Tambah warn ke user.
 * @returns {Object} { warnEntry, count, actionToTake }
 *   actionToTake: null | 'mute_1h' | 'mute_1d' | 'kick'
 */
function addWarn(userId, data) {
    const all = load();
    if (!all[userId]) all[userId] = [];
    const entry = {
        id: genId(),
        reason: data.reason,
        warnedBy: data.warnedBy,
        warnedByTag: data.warnedByTag,
        guildId: data.guildId,
        createdAt: Date.now(),
        actionTaken: null
    };
    all[userId].push(entry);
    save(all);

    const count = all[userId].length;
    let actionToTake = null;
    if (count >= DEFAULT_THRESHOLDS.kick) actionToTake = 'kick';
    else if (count >= DEFAULT_THRESHOLDS.mute1d) actionToTake = 'mute_1d';
    else if (count >= DEFAULT_THRESHOLDS.mute1h) actionToTake = 'mute_1h';

    return { warnEntry: entry, count, actionToTake };
}

function getWarns(userId) {
    const all = load();
    return all[userId] || [];
}

function getWarnCount(userId) {
    return getWarns(userId).length;
}

function removeWarn(userId, warnId) {
    const all = load();
    if (!all[userId]) return false;
    const before = all[userId].length;
    all[userId] = all[userId].filter(w => w.id !== warnId);
    if (all[userId].length === 0) delete all[userId];
    else if (all[userId].length === before) return false;
    save(all);
    return true;
}

function clearWarns(userId) {
    const all = load();
    if (!all[userId]) return 0;
    const count = all[userId].length;
    delete all[userId];
    save(all);
    return count;
}

/**
 * Tandai warn tertentu sudah menyebabkan action tertentu.
 */
function markActionTaken(userId, warnId, action) {
    const all = load();
    if (!all[userId]) return;
    const w = all[userId].find(x => x.id === warnId);
    if (w) {
        w.actionTaken = action;
        save(all);
    }
}

module.exports = {
    addWarn, getWarns, getWarnCount, removeWarn, clearWarns, markActionTaken,
    DEFAULT_THRESHOLDS
};
