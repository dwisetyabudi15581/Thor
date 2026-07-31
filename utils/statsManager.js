/**
 * Stats Manager — track aktivitas user untuk leaderboard & stats.
 *
 * File: stats.json
 * {
 *   "userId1": {
 *     "messages": 123,
 *     "lastMessageAt": 1735689600000,
 *     "vipPurchases": 2,
 *     "totalSpent": 80000,
 *     "joinedAt": 1735000000000,
 *     "giveawaysWon": 0
 *   }
 * }
 *
 * Tracking:
 *   - messages: count pesan user (updated by messageCreate event)
 *   - vipPurchases: count pembelian VIP (updated by set-key flow)
 *   - totalSpent: total uang dihabiskan (extracted dari price produk)
 *   - giveawaysWon: count menang giveaway
 *
 * === P0-1 FIX: In-memory cache + periodic flush ===
 * Sebelumnya: tiap `incrementMessages` load+save file JSON synchronously
 * → memblock event loop pada setiap pesan → bot lag di server aktif.
 * Sekarang: pakai in-memory cache, flush ke disk tiap 30 detik atau
 * kalau ada perubahan non-message (purchase/win/join).
 */

const fs = require('fs');
const path = require('path');
const { safeWriteJSON } = require('./safeWrite');

const filePath = path.join(__dirname, '..', 'stats.json');
const FLUSH_INTERVAL_MS = 30 * 1000; // 30 detik

// === In-memory cache ===
let cache = null;       // null = belum di-load
let dirty = false;      // apakah cache ada perubahan yang belum di-flush?
let flushTimer = null;  // timer periodic flush

function defaultUserStats() {
    return {
        messages: 0,
        lastMessageAt: null,
        vipPurchases: 0,
        totalSpent: 0,
        joinedAt: null,
        giveawaysWon: 0
    };
}

function load() {
    if (cache !== null) return cache;
    try {
        if (!fs.existsSync(filePath)) {
            cache = {};
        } else {
            cache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (err) {
        console.warn('⚠️ stats.json rusak:', err.message);
        cache = {};
    }
    return cache;
}

/**
 * Flush cache ke disk kalau dirty. Tidak throw — log error saja.
 */
// v3.9.0 FIX: atomic write via safeWriteJSON (tmp+rename) to prevent corruption on crash
function flush() {
    if (!dirty || cache === null) return;
    try {
        safeWriteJSON(filePath, cache);
        dirty = false;
    } catch (err) {
        console.error('⚠️ Gagal flush stats.json:', err.message);
    }
}

/**
 * Mulai periodic flush timer. Dipanggil sekali saat bot start (di index.js ready).
 */
function startAutoFlush() {
    if (flushTimer) return; // sudah start
    flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
    // Jangan block process exit
    if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

/**
 * Force flush + stop timer. Dipanggil saat graceful shutdown.
 */
function shutdown() {
    flush();
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
    }
}

/**
 * v3.9.1: Invalidate cache + reload dari disk. Dipanggil setelah restoreBackup
 * supaya in-memory cache (yang mungkin berisi data lama) tidak menimpa
 * data hasil restore saat flush berikutnya.
 *
 * Skenario sebelum fix:
 *   1. Bot jalan, cache stats.json berisi { userA: 5 messages }
 *   2. Admin restore backup lama (stats.json berisi { userA: 3 messages })
 *   3. User kirim pesan → incrementMessages update cache jadi { userA: 6 }
 *      (seharusnya 4, karena data restore punya 3)
 *   4. Periodic flush tulis { userA: 6 } ke stats.json → data restore hilang
 *
 * Fix: set cache = null supaya load() baca ulang dari disk.
 */
function reload() {
    // Jangan flush cache lama — itu justru data basi yang mau kita buang.
    dirty = false;
    cache = null;
    load();
}

// === Legacy save() untuk backward compat (langsung write cache) ===
function save() {
    if (cache === null) return; // tidak ada yang di-load, tidak ada yang di-save
    dirty = true;
    flush();
}

function getStats(userId) {
    const all = load();
    return all[userId] || defaultUserStats();
}

/**
 * Increment message count — P0-1 fix: pakai cache, TIDAK sync file I/O.
 */
function incrementMessages(userId) {
    const all = load();
    if (!all[userId]) all[userId] = defaultUserStats();
    all[userId].messages = (all[userId].messages || 0) + 1;
    all[userId].lastMessageAt = Date.now();
    dirty = true;
    // Tidak langsung flush — flush periodik tiap 30 detik.
}

function recordPurchase(userId, priceNum) {
    const all = load();
    if (!all[userId]) all[userId] = defaultUserStats();
    all[userId].vipPurchases = (all[userId].vipPurchases || 0) + 1;
    all[userId].totalSpent = (all[userId].totalSpent || 0) + (priceNum || 0);
    dirty = true;
    flush(); // penting, jangan sampai transaksi hilang kalau bot crash
}

function recordGiveawayWin(userId) {
    const all = load();
    if (!all[userId]) all[userId] = defaultUserStats();
    all[userId].giveawaysWon = (all[userId].giveawaysWon || 0) + 1;
    dirty = true;
    flush();
}

function recordJoin(userId) {
    const all = load();
    if (!all[userId]) all[userId] = defaultUserStats();
    if (!all[userId].joinedAt) all[userId].joinedAt = Date.now();
    dirty = true;
    flush();
}

/**
 * Get top N users berdasarkan metric.
 * @param {string} metric - 'messages' | 'vipPurchases' | 'totalSpent' | 'giveawaysWon'
 * @param {number} limit
 * @returns {Array} [{ userId, value, ...otherStats }]
 */
function getTopUsers(metric, limit = 10) {
    const all = load();
    return Object.entries(all)
        .map(([userId, stats]) => ({ userId, ...stats, value: stats[metric] || 0 }))
        .filter(e => e.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
}

/**
 * Get agregat stats seluruh server.
 */
function getServerStats() {
    const all = load();
    const users = Object.keys(all);
    return {
        totalUsers: users.length,
        totalMessages: users.reduce((sum, id) => sum + (all[id].messages || 0), 0),
        totalPurchases: users.reduce((sum, id) => sum + (all[id].vipPurchases || 0), 0),
        totalRevenue: users.reduce((sum, id) => sum + (all[id].totalSpent || 0), 0),
        totalGiveawaysWon: users.reduce((sum, id) => sum + (all[id].giveawaysWon || 0), 0)
    };
}

/**
 * Parse price string ke number. Handle "Rp 25.000", "25000", "25.000", "25k", "2.5M"
 *
 * P2-13 FIX: sebelumnya `.replace(/\./g, '').replace(/,/g, '.')` ambigu:
 *   - "25,000" (US thousand) → "25.000" → parseFloat → 25 (SALAH, harusnya 25000)
 *   - "Rp. 50.000" (ID thousand) → "50000" → OK
 *   - "2,5M" (ID decimal) → "2.5M" → 2.5 × 1000000 = OK
 * Sekarang: deteksi format berdasarkan keberadaan dot & comma bersamaan.
 */
function parsePrice(priceStr) {
    if (typeof priceStr === 'number') return priceStr;
    if (!priceStr) return 0;
    let s = String(priceStr).toLowerCase().replace(/rp\.?/g, '').replace(/\s/g, '');
    let multiplier = 1;
    if (s.endsWith('k')) { multiplier = 1000; s = s.slice(0, -1); }
    else if (s.endsWith('m')) { multiplier = 1000000; s = s.slice(0, -1); }

    const hasDot = s.includes('.');
    const hasComma = s.includes(',');

    if (hasDot && hasComma) {
        // Ada keduanya → pakai posisi terakhir untuk tentukan decimal.
        // Mis. "1,234.56" (US) → comma=thousand, dot=decimal
        // Mis. "1.234,56" (EU/ID) → dot=thousand, comma=decimal
        if (s.lastIndexOf('.') > s.lastIndexOf(',')) {
            // US: dot=decimal, comma=thousand → hapus comma, biarkan dot
            s = s.replace(/,/g, '');
        } else {
            // EU/ID: dot=thousand, comma=decimal → hapus dot, ganti comma jadi dot
            s = s.replace(/\./g, '').replace(/,/g, '.');
        }
    } else if (hasComma) {
        // Hanya comma. Asumsi: thousand separator (lebih umum di ID).
        // Mis. "25,000" → 25000
        // Tapi "2,5" → ambiguous, treat as decimal (2.5).
        const parts = s.split(',');
        if (parts.length === 2 && parts[1].length <= 2) {
            // Comma sebagai decimal (mis. "2,5")
            s = s.replace(/,/g, '.');
        } else {
            // Comma sebagai thousand separator
            s = s.replace(/,/g, '');
        }
    } else if (hasDot) {
        // Hanya dot. Asumsi: thousand separator (format ID).
        // Mis. "50.000" → 50000
        // Tapi "2.5" → ambiguous, treat as decimal (2.5).
        const parts = s.split('.');
        if (parts.length === 2 && parts[1].length <= 2) {
            // Dot sebagai decimal (mis. "2.5")
            // biarkan
        } else {
            // Dot sebagai thousand separator
            s = s.replace(/\./g, '');
        }
    }

    const n = parseFloat(s);
    return isNaN(n) ? 0 : Math.round(n * multiplier);
}

module.exports = {
    getStats, incrementMessages, recordPurchase, recordGiveawayWin, recordJoin,
    getTopUsers, getServerStats, parsePrice,
    startAutoFlush, shutdown, flush, reload
};
