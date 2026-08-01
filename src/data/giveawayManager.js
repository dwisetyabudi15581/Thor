/**
 * Giveaway Manager — store & manage giveaways.
 *
 * File: giveaways.json
 * [
 *   {
 *     id: "gw_<timestamp>_<rand>",
 *     guildId: "...",
 *     channelId: "...",
 *     messageId: "...",
 *     prize: "VIP 30 Hari",
 *     winnersCount: 1,
 *     endsAt: 1735689600000,
 *     ended: false,
 *     winnerIds: [],
 *     participantIds: [],
 *     hostId: "...",
 *     hostTag: "Admin#1234",
 *     requiredRoleId: null,  // optional
 *     createdAt: ...
 *   }
 * ]
 */

const fs = require('fs');
const path = require('path');
const { safeWriteJSON } = require('../infra/safeWrite');

const filePath = path.join(__dirname, '..', '..', 'data', 'giveaways.json');

function load() {
    try {
        if (!fs.existsSync(filePath)) return [];
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn('⚠️ giveaways.json rusak, mulai dari array kosong:', err.message);
        return [];
    }
}

// v3.9.0 FIX: atomic write via safeWriteJSON (tmp+rename) to prevent corruption on crash
function save(list) {
    safeWriteJSON(filePath, list);
}

function genId() {
    return `gw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function create(data) {
    const list = load();
    const gw = {
        id: genId(),
        guildId: data.guildId,
        channelId: data.channelId,
        messageId: null,
        prize: data.prize,
        winnersCount: Math.max(1, parseInt(data.winnersCount) || 1),
        endsAt: data.endsAt,
        ended: false,
        winnerIds: [],
        participantIds: [],
        hostId: data.hostId,
        hostTag: data.hostTag,
        requiredRoleId: data.requiredRoleId || null,
        createdAt: Date.now()
    };
    list.push(gw);
    save(list);
    return gw;
}

function setMessageId(id, messageId) {
    const list = load();
    const gw = list.find(g => g.id === id);
    if (gw) {
        gw.messageId = messageId;
        save(list);
    }
    return gw;
}

function get(id) {
    return load().find(g => g.id === id);
}

function getByMessage(messageId) {
    return load().find(g => g.messageId === messageId);
}

function getByGuild(guildId) {
    return load().filter(g => g.guildId === guildId);
}

function getActive() {
    return load().filter(g => !g.ended);
}

function getEnding(now = Date.now()) {
    return load().filter(g => !g.ended && g.endsAt <= now);
}

function addParticipant(id, userId) {
    const list = load();
    const gw = list.find(g => g.id === id);
    if (!gw) return null;
    if (!gw.participantIds.includes(userId)) {
        gw.participantIds.push(userId);
        save(list);
    }
    return gw;
}

function removeParticipant(id, userId) {
    const list = load();
    const gw = list.find(g => g.id === id);
    if (!gw) return null;
    gw.participantIds = gw.participantIds.filter(u => u !== userId);
    save(list);
    return gw;
}

function end(id, winnerIds = []) {
    const list = load();
    const gw = list.find(g => g.id === id);
    if (!gw) return null;
    // v3.9.8 FIX: jadi idempotent. Sebelumnya, kalau end() dipanggil 2x (mis.
    // manual /giveaway end setelah scheduler sudah end), winnerIds ditimpa dengan
    // default [] → semua winner sebelumnya ter-wipe.
    if (gw.ended && gw.winnerIds && gw.winnerIds.length > 0 && (!winnerIds || winnerIds.length === 0)) {
        // Sudah ended dengan winner — jangan overwrite dengan empty.
        return gw;
    }
    gw.ended = true;
    gw.winnerIds = winnerIds;
    save(list);
    return gw;
}

/**
 * Reroll — pilih 1 winner baru dari participant (exclude winner yang sudah ada).
 * Persist winner baru ke gw.winnerIds. Return { winnerId, gw } atau null kalau gagal.
 *
 * P0-4 FIX: sebelumnya cuma return winnerId tanpa persist & tanpa dedup.
 */
function reroll(id) {
    const list = load();
    const gw = list.find(g => g.id === id);
    if (!gw || !gw.ended) return null;

    // Exclude participant yang sudah pernah menang
    const existingWinners = new Set(gw.winnerIds || []);
    const pool = gw.participantIds.filter(uid => !existingWinners.has(uid));

    if (pool.length === 0) {
        // Kalau semua participant sudah pernah menang, fallback: pick dari semua participant
        if (gw.participantIds.length === 0) return { winnerId: null, gw };
        const fallbackIdx = Math.floor(Math.random() * gw.participantIds.length);
        const winnerId = gw.participantIds[fallbackIdx];
        // v3.9.8 FIX: persist reused winner juga supaya /stats tidak double-count
        // kalau admin reroll berkali-kali (sebelumnya reused winner gak masuk
        // winnerIds → next reroll bisa pick orang yang sama lagi).
        if (!gw.winnerIds) gw.winnerIds = [];
        if (!gw.winnerIds.includes(winnerId)) {
            gw.winnerIds.push(winnerId);
            save(list);
        }
        return { winnerId, gw, reused: true };
    }

    const idx = Math.floor(Math.random() * pool.length);
    const winnerId = pool[idx];

    // Persist ke gw.winnerIds
    if (!gw.winnerIds) gw.winnerIds = [];
    gw.winnerIds.push(winnerId);
    save(list);

    return { winnerId, gw, reused: false };
}

function remove(id) {
    const list = load();
    const filtered = list.filter(g => g.id !== id);
    if (filtered.length !== list.length) {
        save(filtered);
        return true;
    }
    return false;
}

/**
 * Fisher-Yates shuffle — distribusi uniform, TIDAK biased seperti sort(random).
 * P1-9 FIX: sebelumnya pakai `[...arr].sort(() => Math.random() - 0.5)`
 * yang distribusinya TIDAK uniform di engine V8 modern.
 */
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * Pick winners secara random dari participant list.
 * Returns array of userId (unique).
 */
function pickWinners(participantIds, count) {
    if (!participantIds || participantIds.length === 0) return [];
    const shuffled = shuffle(participantIds);
    return shuffled.slice(0, Math.min(count, shuffled.length));
}

function formatTimeLeft(ms) {
    if (ms <= 0) return 'berakhir';
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    // v3.9.8 FIX: pakai singkatan yang tidak ambigu (sebelumnya campur ID/EN:
    // "1h 2j 3m" → h=hari=day vs h=hour=jam, confusing buat maintainer & user).
    // Sekarang: d=day(hari), j=jam(hour), m=menit(minute), d=detik(second) →
    // d dan d bentrok! Pakai: hr=hour, min=minute, d=day, dtk=second.
    if (days > 0) return `${days}hr ${hours}j ${mins}m`;
    if (hours > 0) return `${hours}j ${mins}m ${secs}dtk`;
    if (mins > 0) return `${mins}m ${secs}dtk`;
    return `${secs}dtk`;
}

module.exports = {
    create, setMessageId, get, getByMessage, getByGuild, getActive, getEnding,
    addParticipant, removeParticipant, end, reroll, remove, pickWinners, shuffle
};
