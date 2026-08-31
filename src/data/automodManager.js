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
 *     "blockWords": [],             // LEGACY (v3.9.22) — auto-migrate ke wordRules saat load
 *     "wordRules": [               // v3.9.23: kata yang di-block + action per kata
 *       { "word": "kata", "action": "mute_10m"|null, "addedBy": "userId", "addedAt": 123 }
 *     ],
 *     "exemptWords": [],            // v3.9.23: kata yang di-exempt (anti false-positive)
 *     "wordMatchMode": "whole_word", // v3.9.23: "whole_word" | "substring"
 *     "wordAction": "delete_only", // fallback action untuk kata tanpa action khusus
 *     "maxMentions": 5,             // maks mention per message
 *     "mentionAction": "warn",      // "delete_only" | "warn" | "mute_10m"
 *     "enabled": true,
 *     "createdAt": ...,
 *     "updatedAt": ...
 *   }
 * }
 *
 * v3.9.23 WORD FLEX:
 *   - /add-word → tambah kata SATU PER SATU (append, tidak replace daftar lama)
 *   - /remove-word → hapus kata spesifik
 *   - /list-words → lihat semua kata + action-nya
 *   - Matching whole-word (default): "asu" TIDAK match di "asus" (anti false-positive)
 *   - Exempt words: kata aman yang membatalkan match kata blocklist
 *     (mis. block "asu" + exempt "asus" → pesan berisi "asus" tidak di-flag)
 *   - Action per kata: kata ringan cukup delete, kata berat langsung mute/kick
 *
 * In-memory spam tracker: Map<userId, number[]> (timestamps of recent messages)
 */

const fs = require('fs');
const path = require('path');
const { safeWriteJSON, quarantineCorruptFile } = require('../infra/safeWrite');

const filePath = path.join(__dirname, '..', '..', 'data', 'automod.json');

// v3.9.23: action valid untuk per-word rule (sama dengan yang dipakai spam/word hook).
const WORD_ACTIONS = ['delete_only', 'warn', 'mute_10m', 'mute_1h', 'kick'];

// In-memory spam tracker: { guildId: { userId: [ts1, ts2, ...] } }
const spamTracker = new Map();

// v3.9.26: read-through cache (pola panelManager). getGuildConfig dibaca di
// messageCreate PER PESAN — sebelumnya 1 readFileSync sync per pesan walau
// automod mati. Cache 15s TTL + update-on-save; invalidasi manual via
// invalidateCache() (restore backup / test cleanup).
// Catatan: getGuildConfig memutasi objek hasil load (normalizeWordConfig lazy
// migration) — karena cache mengembalikan referensi objek yang sama,
// normalisasi itu idempotent & deterministic, tidak ada risiko divergensi disk.
const CACHE_TTL_MS = 15 * 1000;
let _cache = null; // { data, at }

function load() {
    try {
        if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.data;
        if (!fs.existsSync(filePath)) {
            _cache = { data: {}, at: Date.now() };
            return _cache.data;
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        _cache = { data, at: Date.now() };
        return data;
    } catch (err) {
        // v3.9.26: karantina file korup SEBELUM fallback (lihat safeWrite.js).
        quarantineCorruptFile(filePath);
        _cache = { data: {}, at: Date.now() };
        return _cache.data;
    }
}

function save(data) {
    safeWriteJSON(filePath, data);
    // v3.9.26: update cache supaya read berikutnya konsisten dengan yang baru di-write
    _cache = { data, at: Date.now() };
}

/** v3.9.26: paksa read fresh berikutnya (restore backup / test). */
function invalidateCache() {
    _cache = null;
}

function getGuildConfig(guildId) {
    const all = load();
    const cfg = all[guildId];
    if (!cfg) return null;
    // Backward compat: config lama mungkin punya value 'delete' (bukan 'delete_only').
    // Sekarang semua pakai 'delete_only' biar konsisten.
    if (cfg.wordAction === 'delete') cfg.wordAction = 'delete_only';
    if (cfg.mentionAction === 'delete') cfg.mentionAction = 'delete_only';
    // v3.9.23: normalisasi word config (migrate legacy blockWords → wordRules, dst).
    normalizeWordConfig(cfg);
    return cfg;
}

/**
 * v3.9.23: Normalisasi word config ke struktur baru.
 * Idempotent — aman dipanggil berkali-kali:
 *   1. Pastikan wordRules/exemptWords/wordMatchMode ada (default).
 *   2. Migrate legacy flat blockWords (array string) → wordRules (array object).
 *      Entry lama jadi rule tanpa action (fallback ke wordAction global).
 *      blockWords dikosongkan setelah dipindah supaya tidak double-count.
 *      Persist ke disk terjadi pada save() berikutnya (lazy migration).
 */
function normalizeWordConfig(cfg) {
    if (!cfg) return;
    if (!Array.isArray(cfg.wordRules)) cfg.wordRules = [];
    if (!Array.isArray(cfg.exemptWords)) cfg.exemptWords = [];
    if (cfg.wordMatchMode !== 'whole_word' && cfg.wordMatchMode !== 'substring') {
        cfg.wordMatchMode = 'whole_word';
    }
    // Migrate legacy blockWords → wordRules (sekali; dedupe by word).
    if (Array.isArray(cfg.blockWords) && cfg.blockWords.length > 0) {
        for (const w of cfg.blockWords) {
            if (!w) continue;
            const word = String(w).trim().toLowerCase();
            if (!word) continue;
            if (!cfg.wordRules.some(r => r && r.word === word)) {
                cfg.wordRules.push({ word, action: null, addedBy: 'migrated', addedAt: Date.now() });
            }
        }
        cfg.blockWords = [];
    }
}

function getDefaultConfig() {
    return {
        spamThreshold: 5,
        spamWindowMs: 10000,
        spamAction: 'mute_10m',
        blockLinks: false,
        linkAllowedChannels: [],
        linkAllowedRoles: [],
        blockWords: [], // LEGACY — dikosongkan oleh normalisasi setelah migrate
        wordRules: [],
        exemptWords: [],
        wordMatchMode: 'whole_word',
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
    normalizeWordConfig(current); // migrate legacy sebelum merge
    all[guildId] = {
        ...current,
        ...updates,
        updatedAt: Date.now()
    };
    normalizeWordConfig(all[guildId]); // re-normalize hasil merge (mis. updates masih pakai field lama)
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
 *
 * LEGACY (v3.9.22): substring matching dengan array flat string.
 * Dipertahankan untuk backward compat (dipakai unit test lama).
 * Production hook (messageCreate) sekarang pakai `findViolatedWord` —
 * yang support whole-word, exempt list, dan action per kata.
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

// ============================================================
// v3.9.23: WORD FLEX — matching, CRUD, exempt, per-word action
// ============================================================

/**
 * Escape karakter special regex supaya kata user aman dipakai di RegExp.
 */
function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * v3.9.23: Cek match kata dengan mode.
 *   - 'whole_word' (default): kata harus berdiri sendiri (dipisah spasi/tanda
 *     baca/batas string). "asu" TIDAK match di "asus" — anti false-positive.
 *   - 'substring': match di mana saja (behavior lama v3.9.22).
 *
 * Boundary pakai [^a-z0-9_] eksplisit (bukan \b) supaya konsisten untuk
 * karakter non-ASCII (mis. kata Jepang/Korea yang tidak punya \b boundary).
 */
function matchWord(content, word, mode) {
    if (!content || !word) return false;
    const lower = String(content).toLowerCase();
    const w = String(word).trim().toLowerCase();
    if (!w) return false;
    if (mode === 'substring') return lower.includes(w);
    const re = new RegExp(`(^|[^a-z0-9_])${escapeRegExp(w)}([^a-z0-9_]|$)`);
    return re.test(lower);
}

/**
 * v3.9.23: Cari kata terlarang yang violated di content.
 *
 * Return { word, action } | null:
 *   - word  = kata yang match
 *   - action = action per-kata (bisa null → caller fallback ke config.wordAction)
 *
 * Exempt logic: kalau content mengandung exempt word, DAN kata blocklist yang
 * match adalah substring dari exempt word itu → violation dianggap false-positive
 * dan di-skip. Contoh: block "asu" + exempt "asus" → pesan "asus bagus" tidak
 * di-flag (mode substring), tapi "asu banget" tetap di-flag.
 */
function findViolatedWord(content, config) {
    if (!content || !config) return null;
    const rules = Array.isArray(config.wordRules) ? config.wordRules : [];
    if (rules.length === 0) return null;
    const mode = config.wordMatchMode === 'substring' ? 'substring' : 'whole_word';

    const exempt = Array.isArray(config.exemptWords)
        ? config.exemptWords.map(w => String(w).trim().toLowerCase()).filter(Boolean)
        : [];

    for (const rule of rules) {
        if (!rule || !rule.word) continue;
        if (!matchWord(content, rule.word, mode)) continue;
        // Cek exempt: kata blocklist yang menempel di exempt word → skip.
        if (exempt.length > 0) {
            const covered = exempt.some(ex => ex.includes(rule.word.toLowerCase()) && matchWord(content, ex, mode));
            if (covered) continue;
        }
        return { word: rule.word, action: rule.action || null };
    }
    return null;
}

/**
 * Parse input "kata1, kata2, kata3" → array kata bersih (lowercase, dedupe input).
 */
function parseWordList(words) {
    const list = Array.isArray(words) ? words : String(words).split(',');
    const seen = new Set();
    const result = [];
    for (const raw of list) {
        const word = String(raw).trim().toLowerCase();
        if (!word || seen.has(word)) continue;
        seen.add(word);
        result.push(word);
    }
    return result;
}

/**
 * v3.9.23: Tambah kata ke blocklist (APPEND — tidak replace daftar lama).
 *
 * @param {string} guildId
 * @param {string|string[]} words - "kata1,kata2" atau array
 * @param {string|null} action - action per-kata (null = fallback ke wordAction global)
 * @param {string|null} addedBy - userId yang nambah (buat audit)
 * @returns {{ added: string[], skipped: string[], error?: string }}
 */
function addWords(guildId, words, action, addedBy) {
    if (action && !WORD_ACTIONS.includes(action)) {
        return { added: [], skipped: [], error: `action tidak valid: ${action}` };
    }
    const all = load();
    const current = all[guildId] || getDefaultConfig();
    normalizeWordConfig(current);

    const added = [];
    const skipped = [];
    for (const word of parseWordList(words)) {
        if (current.wordRules.some(r => r.word === word)) {
            skipped.push(word); // sudah ada — jangan duplicate
            continue;
        }
        current.wordRules.push({
            word,
            action: action || null,
            addedBy: addedBy || null,
            addedAt: Date.now()
        });
        added.push(word);
    }
    all[guildId] = { ...current, updatedAt: Date.now() };
    save(all);
    return { added, skipped };
}

/**
 * v3.9.23: Hapus SATU kata dari blocklist.
 * @returns {{ ok: boolean, removed: string|null, error?: string }}
 */
function removeWord(guildId, word) {
    const target = String(word || '')
        .trim()
        .toLowerCase();
    if (!target) return { ok: false, removed: null, error: 'kata kosong' };
    const all = load();
    const current = all[guildId] || getDefaultConfig();
    normalizeWordConfig(current);
    const before = current.wordRules.length;
    current.wordRules = current.wordRules.filter(r => r.word !== target);
    const removed = current.wordRules.length < before ? target : null;
    all[guildId] = { ...current, updatedAt: Date.now() };
    save(all);
    return { ok: removed !== null, removed };
}

/**
 * v3.9.23: Tambah kata ke exempt list (APPEND).
 * Kata yang sama tidak boleh double-register di blocklist sekaligus exempt.
 * @returns {{ added: string[], skipped: string[], error?: string }}
 */
function addExemptWords(guildId, words) {
    const all = load();
    const current = all[guildId] || getDefaultConfig();
    normalizeWordConfig(current);

    const added = [];
    const skipped = [];
    for (const word of parseWordList(words)) {
        if (current.exemptWords.includes(word)) {
            skipped.push(word);
            continue;
        }
        current.exemptWords.push(word);
        added.push(word);
    }
    all[guildId] = { ...current, updatedAt: Date.now() };
    save(all);
    return { added, skipped };
}

/**
 * v3.9.23: Hapus SATU kata dari exempt list.
 * @returns {{ ok: boolean, removed: string|null, error?: string }}
 */
function removeExemptWord(guildId, word) {
    const target = String(word || '')
        .trim()
        .toLowerCase();
    if (!target) return { ok: false, removed: null, error: 'kata kosong' };
    const all = load();
    const current = all[guildId] || getDefaultConfig();
    normalizeWordConfig(current);
    const before = current.exemptWords.length;
    current.exemptWords = current.exemptWords.filter(w => w !== target);
    const removed = current.exemptWords.length < before ? target : null;
    all[guildId] = { ...current, updatedAt: Date.now() };
    save(all);
    return { ok: removed !== null, removed };
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
    isUserWhitelisted,
    // v3.9.23: word flex
    WORD_ACTIONS,
    matchWord,
    findViolatedWord,
    addWords,
    removeWord,
    addExemptWords,
    removeExemptWord,
    // v3.9.26
    invalidateCache
};
