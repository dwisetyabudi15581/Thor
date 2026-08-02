/**
 * Anti-Spam & Auto-Mod Manager.
 *
 * File: data/automod.json
 * {
 *   "<guildId>": {
 *     "spamThreshold": 5,           // jumlah pesan dalam window = spam
 *     "spamWindowMs": 10000,        // window 10 detik
 *     "spamAction": "mute_10m",     // "warn" | "mute_10m" | "mute_1h" | "kick" | "delete_only"
 *     "blockLinks": false,          // hapus message yang mengandung URL
 *     "linkAllowedChannels": [],    // channel ID yang boleh link
 *     "linkAllowedRoles": [],       // role ID yang boleh post link
 *     "blockWords": [],             // kata yang di-block (case-insensitive)
 *     "wordAction": "delete_only", // "delete_only" | "warn" | "mute_10m"
 *     "maxMentions": 5,             // maks mention per message
 *     "mentionAction": "warn",      // "delete_only" | "warn" | "mute_10m"
 *     "enabled": true,
 *     "createdAt": ...,
 *     "updatedAt": ...
 *   }
 * }
 *
 * In-memory spam tracker: Map<userId, number[]> (timestamps of recent messages)
 */

const fs = require('fs');
const path = require('path');
const { safeWriteJSON } = require('../infra/safeWrite');

const filePath = path.join(__dirname, '..', '..', 'data', 'automod.json');

// In-memory spam tracker: { guildId: { userId: [ts1, ts2, ...] } }
const spamTracker = new Map();

function load() {
    try {
        if (!fs.existsSync(filePath)) return {};
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn('⚠️ automod.json rusak:', err.message);
        return {};
    }
}

function save(data) {
    safeWriteJSON(filePath, data);
}

function getGuildConfig(guildId) {
    const all = load();
    const cfg = all[guildId];
    if (!cfg) return null;
    // Backward compat: config lama mungkin punya value 'delete' (bukan 'delete_only').
    // Sekarang semua pakai 'delete_only' biar konsisten.
    if (cfg.wordAction === 'delete') cfg.wordAction = 'delete_only';
    if (cfg.mentionAction === 'delete') cfg.mentionAction = 'delete_only';
    return cfg;
}

function getDefaultConfig() {
    return {
        spamThreshold: 5,
        spamWindowMs: 10000,
        spamAction: 'mute_10m',
        blockLinks: false,
        linkAllowedChannels: [],
        linkAllowedRoles: [],
        blockWords: [],
        wordAction: 'delete_only',
        maxMentions: 5,
        mentionAction: 'warn',
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

function setGuildConfig(guildId, updates) {
    const all = load();
    const current = all[guildId] || getDefaultConfig();
    all[guildId] = {
        ...current,
        ...updates,
        updatedAt: Date.now()
    };
    save(all);
    return all[guildId];
}

function enableAutoMod(guildId, enabled) {
    return setGuildConfig(guildId, { enabled: !!enabled });
}

/**
 * Cek apakah user spam (terlalu banyak pesan dalam window).
 * Update tracker internal. Return true kalau dianggap spam.
 */
function checkSpam(guildId, userId, config) {
    if (!config || !config.enabled || !config.spamThreshold) return false;

    if (!spamTracker.has(guildId)) spamTracker.set(guildId, new Map());
    const guildMap = spamTracker.get(guildId);
    const now = Date.now();
    const window = config.spamWindowMs || 10000;
    const threshold = config.spamThreshold || 5;

    if (!guildMap.has(userId)) guildMap.set(userId, []);
    let timestamps = guildMap.get(userId);

    // Hapus timestamp yang sudah lewat window
    timestamps = timestamps.filter(ts => now - ts < window);
    timestamps.push(now);
    guildMap.set(userId, timestamps);

    return timestamps.length > threshold;
}

/**
 * Reset spam tracker untuk user (dipanggil setelah mute/warn).
 */
function resetSpamTracker(guildId, userId) {
    if (spamTracker.has(guildId)) {
        spamTracker.get(guildId).delete(userId);
    }
}

/**
 * Periodic cleanup — hapus entry lama dari spam tracker supaya memory gak bocor.
 * Pakai 5 menit supaya aman buat server yang set spamWindowMs > 60s.
 */
function cleanupSpamTracker() {
    const now = Date.now();
    const MAX_AGE_MS = 5 * 60 * 1000; // 5 menit — cukup buat mayoritas spamWindowMs config
    for (const [guildId, guildMap] of spamTracker) {
        for (const [userId, timestamps] of guildMap) {
            const filtered = timestamps.filter(ts => now - ts < MAX_AGE_MS);
            if (filtered.length === 0) {
                guildMap.delete(userId);
            } else {
                guildMap.set(userId, filtered);
            }
        }
        if (guildMap.size === 0) spamTracker.delete(guildId);
    }
}

// Run cleanup tiap 1 menit
setInterval(cleanupSpamTracker, 60 * 1000).unref?.();

/**
 * Cek apakah message mengandung link.
 * Pattern: http://, https://, www., atau domain TLD umum.
 */
function containsLink(content) {
    if (!content) return false;
    return /https?:\/\/|www\./i.test(content);
}

/**
 * Cek apakah message mengandung kata yang di-block.
 */
function containsBlockedWord(content, blockWords) {
    if (!content || !blockWords || blockWords.length === 0) return null;
    const lower = content.toLowerCase();
    for (const word of blockWords) {
        if (word && lower.includes(word.toLowerCase())) {
            return word;
        }
    }
    return null;
}

/**
 * Hitung jumlah mention dalam message.
 */
function countMentions(message) {
    if (!message) return 0;
    let count = 0;
    if (message.mentions?.users) count += message.mentions.users.size;
    if (message.mentions?.roles) count += message.mentions.roles.size;
    if (message.mentions?.everyone) count += 1;
    return count;
}

/**
 * Cek apakah user dibebaskan dari auto-mod (punya role whitelist atau admin).
 */
function isUserWhitelisted(member, config) {
    if (!member || !config) return false;
    // Admin (ManageGuild) selalu whitelist
    const { PermissionFlagsBits } = require('discord.js');
    if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
    // Role whitelist
    if (config.linkAllowedRoles && config.linkAllowedRoles.length > 0) {
        for (const rid of config.linkAllowedRoles) {
            if (member.roles?.cache?.has(rid)) return true;
        }
    }
    return false;
}

module.exports = {
    getGuildConfig,
    setGuildConfig,
    enableAutoMod,
    getDefaultConfig,
    checkSpam,
    resetSpamTracker,
    containsLink,
    containsBlockedWord,
    countMentions,
    isUserWhitelisted
};
