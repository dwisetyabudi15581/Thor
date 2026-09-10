/**
 * Server Stats Manager — channel counter live (v3.9.51).
 *
 * Permintaan user: "saya mau fitur stats server secara live yang mirip seperti
 * bot server stats" — channel yang NAMANYA adalah counter live (mis.
 * "👥 Member: 123") dan ter-update otomatis, seperti bot counter populer.
 *
 * Cara kerja:
 *   /serverstats setup membuat kategori "📊 STATISTIK SERVER" + 5 channel
 *   voice (Member, Bot, Boost, Role, Channel). @everyone di-deny Connect
 *   supaya channelnya display-only. ID channel dipersisten di
 *   data/serverstats.json.
 *
 *   Update-nya EVENT-DRIVEN + PERIODIK:
 *     - guildMemberAdd/Remove/Update (member, bot, boost),
 *       channelCreate/Delete (channel), guildRoleCreate/Delete (role)
 *       menandai stats "dirty" → tick scheduler 60 detik me-refresh.
 *     - Setiap tick ke-5 scheduler (~5 menit) adalah refresh catch-up
 *       walau tanpa event, jadi event yang terlewat self-heal.
 *     - ready.js melakukan satu refresh paksa saat startup.
 *
 *   RATE LIMIT RENAME (bagian paling kritis): Discord hanya mengizinkan
 *   2x ganti nama channel per channel per 10 menit — counter yang rename
 *   di SETIAP join akan kena 429 dan bot bisa di-banned sementara dari
 *   API. Tiga guard:
 *     1. CHANGE DETECTION — setName hanya dipanggil saat nama benar-benar
 *        beda (nol panggilan API untuk counter yang tidak berubah).
 *     2. COOLDOWN PER-CHANNEL — minimal COOLDOWN_MS (5 menit) antara edit
 *        nyata per channel → maksimal 2 per 10 menit, pas sesuai limit.
 *     3. DIRTY-DRIVEN — burst join = 1 refresh, bukan 1 rename per join.
 *   Rename yang tertunda cooldown akan dicoba ulang di tick berikutnya
 *   (nilainya masih beda, jadi change detection tetap menganggapnya pending).
 *
 *   CHANNEL HILANG: kalau admin menghapus channel counter, refresh
 *   mencetak warning (beserta perintah solusi) dan melewatkannya. Kalau
 *   SEMUA counter hilang, fitur auto-disable (config dihapus) supaya
 *   scheduler berhenti memanggilnya — jalankan ulang /serverstats setup
 *   untuk membuat semuanya lagi.
 *
 * File: data/serverstats.json
 * {
 *   "guildId": "...",
 *   "categoryId": "...",
 *   "counters": {
 *     "members": "channelId",
 *     "bots": "channelId",
 *     "boosts": "channelId",
 *     "roles": "channelId",
 *     "channels": "channelId"
 *   },
 *   "enabled": true,
 *   "updatedAt": 1735689600000
 * }
 *
 * Catatan: TIDAK ada counter "member online" — sengaja — karena butuh
 * intent privileged GuildPresences (TIDAK diaktifkan: mengaktifkannya tanpa
 * toggle di portal bikin login crash). Tanpa presences angka online akan
 * bohong, jadi lebih tidak ditawarkan sama sekali.
 */

const fs = require('fs');
const path = require('path');
const { safeWriteJSON, quarantineCorruptFile } = require('../infra/safeWrite');

const filePath = path.join(__dirname, '..', '..', 'data', 'serverstats.json');

// === Konstanta rate-limit ===
// Discord: 2x ganti nama channel / channel / 10 menit. Jarak 5 menit = tepat 2x.
const COOLDOWN_MS = 5 * 60 * 1000;
// Refresh setiap N tick scheduler (tick = 60 detik) walau tanpa event.
const REFRESH_EVERY_TICKS = 5;

// === State in-memory ===
let cache = null; // null = belum dimuat
const lastRenameAt = {}; // tipeCounter → timestamp rename nyata terakhir
const warnedMissing = new Set(); // tipe counter yang sudah di-warn (anti spam log)
let dirty = false; // ada event yang bilang angkanya bisa berubah
let schedulerTicks = 0; // tick 60 detik sejak startup (mendorong catch-up 5 menit)

/**
 * Definisi counter — urutan = urutan tampil di kategori (atas → bawah).
 * Emoji + label inilah yang ditampilkan di NAMA channel.
 */
const COUNTER_DEFS = [
    { type: 'members', emoji: '👥', label: 'Member' },
    { type: 'bots', emoji: '🤖', label: 'Bot' },
    { type: 'boosts', emoji: '🚀', label: 'Boost' },
    { type: 'roles', emoji: '🎭', label: 'Role' },
    { type: 'channels', emoji: '📺', label: 'Channel' }
];

/**
 * Murni: bangun nama channel counter. Nama channel voice mempertahankan
 * spasi, huruf besar & emoji — persis yang dilihat member di sidebar.
 * @param {string} type - tipe counter (COUNTER_DEFS)
 * @param {number} value - angka live
 * @returns {string} mis. "👥 Member: 123"
 */
function buildCounterName(type, value) {
    const def = COUNTER_DEFS.find(d => d.type === type);
    if (!def) return `${value}`;
    return `${def.emoji} ${def.label}: ${value}`;
}

/**
 * Murni: baca nilai live counter langsung dari objek guild.
 *   - members: guild.memberCount (eksak, termasuk bot — sama seperti yang
 *     Discord hitung sebagai "member"; counter Bot menampilkan bagiannya)
 *   - bots: cache member difilter user.bot — best-effort. Roster di-fetch
 *     saat startup (rekonsiliasi booster) jadi praktis akurat; tepat setelah
 *     cold start dengan fetch gagal bisa tertinggal beberapa bot.
 *   - boosts: guild.premiumSubscriptionCount (null → 0)
 *   - roles: roles.cache.size (termasuk @everyone — sama seperti hitungan UI Discord)
 *   - channels: channels.cache.size (termasuk kategori)
 *
 * @param {Object} guild - discord.js Guild (atau stub dengan cache yang sama)
 * @param {string} type
 * @returns {number}
 */
function computeCounterValue(guild, type) {
    if (!guild) return 0;
    switch (type) {
        case 'members':
            return guild.memberCount || 0;
        case 'bots': {
            const members = guild.members?.cache;
            if (!members || typeof members.values !== 'function') return 0;
            let bots = 0;
            for (const m of members.values()) {
                if (m.user?.bot) bots++;
            }
            return bots;
        }
        case 'boosts':
            return guild.premiumSubscriptionCount || 0;
        case 'roles':
            return guild.roles?.cache?.size || 0;
        case 'channels':
            return guild.channels?.cache?.size || 0;
        default:
            return 0;
    }
}

// === Persistensi ===

function load() {
    if (cache !== null) return cache;
    try {
        if (!fs.existsSync(filePath)) {
            cache = null;
            return null;
        }
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!parsed || typeof parsed !== 'object') return null;
        cache = parsed;
        return cache;
    } catch (err) {
        console.warn('⚠️ serverstats.json rusak:', err.message);
        quarantineCorruptFile(filePath);
        cache = null;
        return null;
    }
}

function getConfig() {
    return load();
}

function isEnabled() {
    const cfg = load();
    return !!(cfg && cfg.enabled && cfg.counters && Object.keys(cfg.counters).length > 0);
}

/**
 * Simpan config (dipakai /serverstats setup). Tulis atomik dan refresh
 * cache in-memory.
 */
function saveConfig(cfg) {
    cache = cfg;
    safeWriteJSON(filePath, cfg);
    // Config baru → state cooldown/warning milik config lama.
    for (const k of Object.keys(lastRenameAt)) delete lastRenameAt[k];
    warnedMissing.clear();
}

/**
 * Hapus config (dipakai /serverstats remove + auto-disable).
 */
function clearConfig() {
    cache = null;
    dirty = false;
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
        console.warn('⚠️ Gagal menghapus serverstats.json:', err.message);
    }
}

/**
 * v3.9.51: invalidasi cache + baca ulang dari disk (setelah /restore-backup —
 * skenario basi yang sama dengan statsManager.reload: cache in-memory akan
 * menimpa file hasil restore saat save berikutnya).
 */
function reload() {
    cache = null;
    dirty = false;
    for (const k of Object.keys(lastRenameAt)) delete lastRenameAt[k];
    warnedMissing.clear();
    return load();
}

// === Refresh live ===

/**
 * Refresh semua channel counter guild (rename hanya saat nilai benar-benar
 * berubah + cooldown mengizinkan).
 *
 * @param {Object} guild - discord.js Guild (atau stub dengan channels.cache)
 * @param {Object} [opts]
 * @param {boolean} [opts.force] - lewati cooldown per-channel (admin
 *        /serverstats refresh + sinkronisasi startup — keduanya jarang, keduanya aman).
 * @returns {Promise<{updated:number,deferred:number,missing:number,errors:number,skipped?:boolean}>}
 */
async function refreshServerStats(guild, opts = {}) {
    const { force = false } = opts;
    const cfg = load();
    if (!cfg || !cfg.enabled || !cfg.counters) {
        return { updated: 0, deferred: 0, missing: 0, errors: 0, skipped: true };
    }

    let updated = 0;
    let deferred = 0;
    let missing = 0;
    let errors = 0;
    let found = 0;

    for (const def of COUNTER_DEFS) {
        const channelId = cfg.counters[def.type];
        if (!channelId) continue;

        const channel = guild?.channels?.cache?.get?.(channelId);
        if (!channel || typeof channel.setName !== 'function') {
            missing++;
            if (!warnedMissing.has(def.type)) {
                warnedMissing.add(def.type);
                console.warn(
                    `⚠️ Counter server stats "${def.label}" (ID channel ${channelId}) tidak ditemukan di "${guild?.name || 'guild'}" — dihapus admin? Buat ulang dengan /serverstats setup (setelah /serverstats remove).`
                );
            }
            continue;
        }
        found++;

        const newName = buildCounterName(def.type, computeCounterValue(guild, def.type));

        // Guard 1 — change detection: nama sama = nol panggilan API.
        if (channel.name === newName) continue;

        // Guard 2 — cooldown per-channel (Discord: 2 rename / 10 menit).
        const last = lastRenameAt[def.type] || 0;
        if (!force && Date.now() - last < COOLDOWN_MS) {
            deferred++;
            continue;
        }

        try {
            await channel.setName(newName, 'Counter server stats');
            lastRenameAt[def.type] = Date.now();
            updated++;
        } catch (err) {
            errors++;
            console.warn(
                `⚠️ Server stats: gagal rename counter "${def.label}": ${err.message}${String(err.message).includes('rate limit') ? ' — kena limit rename, tick scheduler berikutnya akan mencoba lagi.' : ''}`
            );
        }
    }

    // SEMUA counter hilang → auto-disable (berhenti membakar tick scheduler
    // untuk fitur mati; warning di atas sudah menyebut solusinya).
    if (cfg.counters && Object.values(cfg.counters).length > 0 && found === 0 && missing > 0) {
        console.warn(
            '⚠️ Semua channel counter server stats sudah hilang — fitur counter live dinonaktifkan. Buat ulang dengan /serverstats setup.'
        );
        clearConfig();
        return { updated, deferred, missing, errors, disabled: true };
    }

    if (updated > 0) {
        cfg.updatedAt = Date.now();
        dirty = false;
        try {
            safeWriteJSON(filePath, cfg);
        } catch (_) {} // rename sudah terjadi; persistensi best-effort
    }

    return { updated, deferred, missing, errors };
}

// === Wiring event → scheduler ===

/**
 * Ada event yang bisa mengubah angka (member join/leave, perubahan boost,
 * buat/hapus role/channel). Cukup murah untuk dipanggil dari setiap event
 * handler — no-op saat fitur tidak di-setup.
 * @param {string} guildId
 */
function markStatsDirty(guildId) {
    const cfg = load();
    if (!cfg || !cfg.enabled || !cfg.counters) return;
    if (guildId && cfg.guildId && guildId !== cfg.guildId) return;
    dirty = true;
}

/**
 * Apakah ada refresh pending untuk guild ini? (dipakai test + diagnostik)
 */
function isDirty() {
    return dirty;
}

/**
 * Dipanggil dari loop scheduler 60 detik (lewat
 * schedulerTasks.processServerStatsTick): refresh saat ada event yang
 * menandai stats dirty ATAU setiap REFRESH_EVERY_TICKS tick sebagai
 * catch-up (event terlewat self-heal).
 *
 * @param {Object} client - discord.js Client
 * @returns {Promise<Object>} hasil refreshServerStats (atau {skipped})
 */
async function processSchedulerTick(client) {
    const cfg = load();
    if (!cfg || !cfg.enabled || !cfg.counters) return { skipped: true };

    schedulerTicks++;
    const due = dirty || schedulerTicks % REFRESH_EVERY_TICKS === 0;
    if (!due) return { skipped: true };

    const guild = client?.guilds?.cache?.get?.(cfg.guildId);
    if (!guild) return { noGuild: true };

    return refreshServerStats(guild);
}

/**
 * Helper test — reset semua state in-memory (cooldown, warning, flag dirty,
 * penghitung tick) supaya test saling independen.
 */
function _resetForTests() {
    cache = null;
    dirty = false;
    schedulerTicks = 0;
    for (const k of Object.keys(lastRenameAt)) delete lastRenameAt[k];
    warnedMissing.clear();
}

module.exports = {
    COUNTER_DEFS,
    buildCounterName,
    computeCounterValue,
    getConfig,
    isEnabled,
    saveConfig,
    clearConfig,
    reload,
    refreshServerStats,
    markStatsDirty,
    isDirty,
    processSchedulerTick,
    COOLDOWN_MS,
    REFRESH_EVERY_TICKS,
    _resetForTests
};
