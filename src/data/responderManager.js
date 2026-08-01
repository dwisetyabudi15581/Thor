/**
 * Auto-Responder Manager — keyword trigger → auto reply.
 *
 * File: data/responders.json
 * {
 *   "<guildId>": [
 *     {
 *       "id": "resp_<timestamp>_<rand>",
 *       "trigger": "!sosmed",           // case-insensitive, exact match di awal pesan
 *       "reply": "Instagram: @chronos\nTikTok: @chronos",
 *       "replyType": "text",            // "text" | "embed"
 *       "createdBy": "userId",
 *       "createdByTag": "User#1234",
 *       "createdAt": 1735689600000,
 *       "useCount": 0,
 *       "lastUsedAt": null,
 *       "cooldownMs": 3000,             // anti-spam: same trigger gak reply 2x dalam 3s
 *       "lastFiredAt": null             // internal: untuk cooldown check
 *     }
 *   ]
 * }
 *
 * v3.9.13: generic community bot feature.
 */

const fs = require('fs');
const path = require('path');
const { safeWriteJSON } = require('../infra/safeWrite');

const filePath = path.join(__dirname, '..', '..', 'data', 'responders.json');

function load() {
    try {
        if (!fs.existsSync(filePath)) return {};
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn('⚠️ responders.json rusak:', err.message);
        return {};
    }
}

function save(data) {
    safeWriteJSON(filePath, data);
}

function genId() {
    return `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getGuildResponders(guildId) {
    const all = load();
    return all[guildId] || [];
}

function addResponder(guildId, data) {
    const all = load();
    if (!all[guildId]) all[guildId] = [];

    // Validate trigger: tidak boleh kosong, maks 50 char, tidak duplicate
    const trigger = data.trigger.trim();
    if (!trigger || trigger.length > 50) {
        return { ok: false, error: 'Trigger tidak valid (1-50 char).' };
    }
    if (all[guildId].some(r => r.trigger.toLowerCase() === trigger.toLowerCase())) {
        return { ok: false, error: `Trigger "${trigger}" sudah ada. Pakai /remove-responder dulu.` };
    }

    // Max 50 responders per guild
    if (all[guildId].length >= 50) {
        return { ok: false, error: 'Maksimal 50 responder per guild.' };
    }

    const entry = {
        id: genId(),
        trigger,
        reply: data.reply,
        replyType: data.replyType === 'embed' ? 'embed' : 'text',
        createdBy: data.createdBy,
        createdByTag: data.createdByTag,
        createdAt: Date.now(),
        useCount: 0,
        lastUsedAt: null,
        cooldownMs: data.cooldownMs || 3000,
        lastFiredAt: null
    };
    all[guildId].push(entry);
    save(all);
    return { ok: true, responder: entry };
}

function removeResponder(guildId, trigger) {
    const all = load();
    if (!all[guildId]) return { ok: false, error: 'Trigger tidak ditemukan.' };

    const before = all[guildId].length;
    all[guildId] = all[guildId].filter(r => r.trigger.toLowerCase() !== trigger.toLowerCase());
    if (all[guildId].length === before) {
        return { ok: false, error: `Trigger "${trigger}" tidak ditemukan.` };
    }
    save(all);
    return { ok: true };
}

/**
 * Cari responder yang match dengan message.
 * Trigger dianggap match kalau message (lowercased) dimulai dengan trigger.
 *
 * @param {string} guildId
 * @param {string} messageContent
 * @returns {Object|null} responder entry atau null kalau gak match / cooldown aktif
 */
function findMatch(guildId, messageContent) {
    const responders = getGuildResponders(guildId);
    if (responders.length === 0) return null;

    const lower = messageContent.toLowerCase();
    const now = Date.now();

    for (const r of responders) {
        const trig = r.trigger.toLowerCase();
        // Match kalau message == trigger ATAU message diikuti spasi (mis. "!sosmed" match "!sosmed halo")
        if (lower === trig || lower.startsWith(trig + ' ') || lower.startsWith(trig + '\n')) {
            // Cooldown check — anti-spam
            if (r.lastFiredAt && (now - r.lastFiredAt) < (r.cooldownMs || 3000)) {
                return null;  // cooldown aktif, skip
            }
            return r;
        }
    }
    return null;
}

/**
 * Tandai responder sudah dipakai (update useCount + lastFiredAt).
 */
function markUsed(guildId, responderId) {
    const all = load();
    if (!all[guildId]) return;
    const r = all[guildId].find(x => x.id === responderId);
    if (!r) return;
    r.useCount = (r.useCount || 0) + 1;
    r.lastUsedAt = Date.now();
    r.lastFiredAt = Date.now();
    save(all);
}

module.exports = {
    getGuildResponders,
    addResponder,
    removeResponder,
    findMatch,
    markUsed
};
