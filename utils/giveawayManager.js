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

const filePath = path.join(__dirname, '..', 'giveaways.json');

function load() {
    try {
        if (!fs.existsSync(filePath)) return [];
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn('⚠️ giveaways.json rusak, mulai dari array kosong:', err.message);
        return [];
    }
}

function save(list) {
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2));
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
    gw.ended = true;
    gw.winnerIds = winnerIds;
    save(list);
    return gw;
}

function reroll(id) {
    const list = load();
    const gw = list.find(g => g.id === id);
    if (!gw || !gw.ended) return null;
    if (gw.participantIds.length === 0) return { winnerId: null };
    const idx = Math.floor(Math.random() * gw.participantIds.length);
    return { winnerId: gw.participantIds[idx] };
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
 * Pick winners secara random dari participant list.
 * Returns array of userId (unique).
 */
function pickWinners(participantIds, count) {
    if (!participantIds || participantIds.length === 0) return [];
    const shuffled = [...participantIds].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
}

function formatTimeLeft(ms) {
    if (ms <= 0) return 'berakhir';
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    if (days > 0) return `${days}h ${hours}j ${mins}m`;
    if (hours > 0) return `${hours}j ${mins}m ${secs}d`;
    if (mins > 0) return `${mins}m ${secs}d`;
    return `${secs}d`;
}

module.exports = {
    create, setMessageId, get, getByMessage, getByGuild, getActive, getEnding,
    addParticipant, removeParticipant, end, reroll, remove, pickWinners, formatTimeLeft
};
