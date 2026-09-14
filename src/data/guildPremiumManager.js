/**
 * Guild Premium Manager — langganan Thor Premium per-server (model ala Dyno).
 * v3.15.0.
 *
 * Konsep (lihat juga src/infra/premiumGate.js):
 *   - Server berlangganan = SEMUA fitur bot terbuka untuk seluruh member.
 *   - Server tanpa langganan = tier FREE (moderasi inti + komunitas dasar).
 *   - Aktivasi lewat key: /premium activate <key> oleh admin server
 *     (ManageGuild), atau langsung oleh pemilik bot via /premium gen + keys.
 *
 * File: data/guildPremium.json
 * {
 *   "subscriptions": [
 *     {
 *       "id": "sub_<ts>_<rand>",
 *       "guildId": "123456",
 *       "guildName": "Server Jualan",
 *       "keyCode": "ABCDE-FGHJK-LMNPQ",   // dimasking saat ditampilkan
 *       "plan": "premium30",               // premium30 | premium90 | lifetime
 *       "days": 30,                        // 0 = lifetime
 *       "expireAt": 1735689600000,         // null = lifetime (tidak pernah habis)
 *       "activatedAt": 1735000000000,
 *       "activatedBy": "987654",           // Discord user id pengaktivasi
 *       "activatedByName": "owner#0001",
 *       "source": "local"                  // local | remote
 *     }
 *   ],
 *   "keys": [ // pool key lokal — dibuat pemilik bot via /premium gen
 *     {
 *       "code": "ABCDE-FGHJK-LMNPQ",
 *       "plan": "premium30",
 *       "days": 30,
 *       "note": "Bundling 5 server",
 *       "status": "available",             // available | redeemed | revoked
 *       "redeemedAt": null,
 *       "createdAt": 1735000000000
 *     }
 *   ]
 * }
 *
 * MODEL KEY-DRIVEN (konsisten dengan keyManager.js): setiap aktivasi = entry
 * BARU dengan expireAt independen. Guild premium = ADA minimal satu entry
 * aktif (expireAt null [lifetime] atau > now). Tampilan status memakai sisa
 * waktu TERPANJANG (semangat MAX EXTEND — paket baru tidak pernah memotong
 * sisa paket lama). Entry expired dihapus sweep scheduler (auto tiap tick,
 * murah karena load di-cache).
 *
 * Format key SAMA dengan website dashboard (XXXXX-XXXXX-XXXXX, alphabet 31
 * char tanpa I/L/O/0/1) supaya key dari web (provider remote) dan key lokal
 * (provider local) tidak bisa dibedakan pembeli — dua-duanya 75-bit entropy.
 */

const fs = require('fs');
const path = require('path');
const { safeWriteJSON, quarantineCorruptFile } = require('../infra/safeWrite');

const filePath = path.join(__dirname, '..', '..', 'data', 'guildPremium.json');

// Alphabet & format key — identik dengan src/lib/keycode.ts di dashboard web.
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 char, tanpa I L O 0 1

// Paket langganan yang dikenal (sinkron dengan PLANS di dashboard web).
const PLANS = {
    premium30: { days: 30, label: 'Premium 30 Hari' },
    premium90: { days: 90, label: 'Premium 90 Hari' },
    lifetime: { days: 0, label: 'Premium Lifetime' }
};

function load() {
    try {
        if (!fs.existsSync(filePath)) return { subscriptions: [], keys: [] };
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        // Defensive: struktur lama/half-written jangan sampai crash bot.
        return {
            subscriptions: Array.isArray(raw.subscriptions) ? raw.subscriptions : [],
            keys: Array.isArray(raw.keys) ? raw.keys : []
        };
    } catch (err) {
        console.error('Error load guildPremium.json:', err.message);
        // Sama seperti keyManager: karantina SEBELUM return default, supaya
        // save() berikutnya tidak menimpa file korup dengan state kosong.
        quarantineCorruptFile(filePath);
        return { subscriptions: [], keys: [] };
    }
}

function save(data) {
    // safeWriteJSON (atomic tmp+rename) — crash mid-write tidak korup data.
    safeWriteJSON(filePath, data);
}

function genId() {
    return `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate kode key baru (format & alphabet sama dengan dashboard web).
 * Sumber acak: crypto.randomBytes — bukan Math.random.
 */
function generateCode() {
    const crypto = require('crypto');
    const blocks = [];
    for (let b = 0; b < 3; b++) {
        let block = '';
        for (let i = 0; i < 5; i++) {
            block += KEY_ALPHABET[crypto.randomBytes(1)[0] % KEY_ALPHABET.length];
        }
        blocks.push(block);
    }
    return blocks.join('-');
}

/**
 * Buat key baru di pool lokal (dipakai pemilik bot via /premium gen).
 * @param {Object} opts - { plan, note }
 * @returns {string} kode key yang baru dibuat
 * @throws kalau plan tidak dikenal
 */
function generatePremiumKey({ plan, note } = {}) {
    const meta = PLANS[plan];
    if (!meta) throw new Error(`Plan tidak dikenal: ${plan}`);

    const data = load();
    // Dup-check (tabrakan 75-bit nyaris mustahil, tapi murah dicek).
    for (;;) {
        const code = generateCode();
        if (data.keys.some(k => k.code === code)) continue;
        data.keys.push({
            code,
            plan,
            days: meta.days,
            note: typeof note === 'string' ? note.trim().slice(0, 60) : '',
            status: 'available',
            redeemedAt: null,
            createdAt: Date.now()
        });
        save(data);
        return code;
    }
}

/** Cari key di pool lokal yang masih available (case-insensitive, di-trim). */
function findAvailableLocalKey(code) {
    if (typeof code !== 'string') return null;
    const cleaned = code.trim().toUpperCase();
    if (!cleaned) return null;
    const data = load();
    return data.keys.find(k => k.code === cleaned && k.status === 'available') || null;
}

/** Tandai key pool lokal sebagai redeemed. Return true kalau berhasil. */
function consumeLocalKey(code) {
    if (typeof code !== 'string') return false;
    const cleaned = code.trim().toUpperCase();
    const data = load();
    const entry = data.keys.find(k => k.code === cleaned && k.status === 'available');
    if (!entry) return false;
    entry.status = 'redeemed';
    entry.redeemedAt = Date.now();
    save(data);
    return true;
}

/** Cabut key pool lokal yang masih available (salah generate / kebocoran). */
function revokeLocalKey(code) {
    if (typeof code !== 'string') return false;
    const cleaned = code.trim().toUpperCase();
    const data = load();
    const entry = data.keys.find(k => k.code === cleaned && k.status === 'available');
    if (!entry) return false;
    entry.status = 'revoked';
    save(data);
    return true;
}

/**
 * Hitung expireAt aktivasi baru (semangat MAX EXTEND):
 *   - lifetime → null (terkunci selamanya)
 *   - paket hari → base = max(now, sisa terpanjang guild) + days
 *     → paket baru ditaruh SETELAH sisa paket lama, tidak menimpa.
 */
function computeExpireAt(guildId, days) {
    if (days === 0) return null; // lifetime
    const now = Date.now();
    const data = load();
    const currentMax = data.subscriptions
        .filter(s => s.guildId === guildId && s.expireAt !== null && s.expireAt > now)
        .reduce((max, s) => Math.max(max, s.expireAt), 0);
    const base = Math.max(now, currentMax);
    return base + days * 24 * 60 * 60 * 1000;
}

/**
 * Aktifkan langganan guild — dipanggil SETELAH key tervalidasi (lokal atau
 * remote). Tidak validasi key di sini (separation of concerns: validasi ada
 * di command handler / provider).
 *
 * @param {Object} input - { guildId, guildName, keyCode, plan, days, activatedBy, activatedByName, source }
 * @returns {Object} entry subscription baru
 * @throws kalau plan tidak dikenal atau guildId kosong
 */
function activateGuildKey(input) {
    const { guildId, keyCode, plan, activatedBy, activatedByName, source } = input;
    const meta = PLANS[plan];
    if (!meta) throw new Error(`Plan tidak dikenal: ${plan}`);
    if (!guildId || typeof guildId !== 'string') throw new Error('guildId wajib diisi');

    const days = meta.days;
    const expireAt = computeExpireAt(guildId, days);
    const data = load();
    const entry = {
        id: genId(),
        guildId: String(guildId),
        guildName: typeof input.guildName === 'string' ? input.guildName.slice(0, 100) : '',
        keyCode: typeof keyCode === 'string' ? keyCode.trim().toUpperCase() : '',
        plan,
        days,
        expireAt,
        activatedAt: Date.now(),
        activatedBy: activatedBy ? String(activatedBy) : '',
        activatedByName: typeof activatedByName === 'string' ? activatedByName.slice(0, 100) : '',
        source: source === 'remote' ? 'remote' : 'local'
    };
    data.subscriptions.push(entry);
    save(data);
    invalidateStatusCache(guildId);
    return entry;
}

/**
 * Apakah guild punya langganan aktif?
 * Dipakai premiumGate di setiap interaction — hasilnya di-cache 15 detik
 * (pola sama dengan adminRoleCache di infra/permissions.js).
 */
const STATUS_CACHE_TTL_MS = 15 * 1000;
const statusCache = new Map(); // guildId -> { active, checkedAt }

function isGuildPremium(guildId) {
    if (!guildId) return false;
    const now = Date.now();
    const hit = statusCache.get(guildId);
    if (hit && now - hit.checkedAt < STATUS_CACHE_TTL_MS) return hit.active;

    const active = computeGuildStatusRaw(guildId).tier !== null;
    statusCache.set(guildId, { active, checkedAt: now });
    return active;
}

/** Status gabungan guild (tanpa cache) — dipakai /premium status & sweep. */
function computeGuildStatusRaw(guildId) {
    if (!guildId) return { tier: null };
    const now = Date.now();
    const data = load();
    const subs = data.subscriptions.filter(s => s.guildId === String(guildId));
    const lifetime = subs.find(s => s.expireAt === null);
    if (lifetime) {
        return {
            tier: 'lifetime',
            plan: lifetime.plan,
            expireAt: null,
            activatedAt: lifetime.activatedAt,
            entries: subs.length
        };
    }
    const active = subs.filter(s => typeof s.expireAt === 'number' && s.expireAt > now);
    if (active.length === 0) return { tier: null, entries: subs.length };
    const best = active.reduce((a, b) => (b.expireAt > a.expireAt ? b : a));
    return {
        tier: 'premium',
        plan: best.plan,
        expireAt: best.expireAt,
        activatedAt: best.activatedAt,
        entries: subs.length
    };
}

/** Status guild untuk ditampilkan (dengan cache invalidated bila perlu). */
function getGuildStatus(guildId) {
    invalidateStatusCache(guildId); // tampilan harus segar (baru saja aktivasi)
    return computeGuildStatusRaw(guildId);
}

/**
 * Sweep entry subscription yang sudah expired — dipanggil scheduler tick
 * (murah: load sekali, hanya tulis kalau memang ada yang dihapus).
 * @returns {Array} entry yang dihapus (untuk notifikasi downgrade).
 */
function sweepExpiredSubscriptions() {
    const now = Date.now();
    const data = load();
    const before = data.subscriptions.length;
    const expired = data.subscriptions.filter(
        s => s.expireAt !== null && s.expireAt <= now
    );
    if (expired.length === 0) return [];
    data.subscriptions = data.subscriptions.filter(
        s => !(s.expireAt !== null && s.expireAt <= now)
    );
    save(data);
    // Cache semua guild yang barusan kehilangan langganan harus invalid.
    for (const e of expired) invalidateStatusCache(e.guildId);
    console.log(
        `🧹 Guild premium: ${expired.length} langganan expired dihapus (${before} → ${data.subscriptions.length} entry).`
    );
    return expired;
}

/**
 * Cabut SEMUA langganan sebuah guild (kasus refund/chargeback, dipanggil
 * pemilik bot via /premium revoke).
 * @returns {number} jumlah entry yang dihapus.
 */
function revokeGuildSubscription(guildId) {
    if (!guildId) return 0;
    const data = load();
    const before = data.subscriptions.length;
    data.subscriptions = data.subscriptions.filter(s => s.guildId !== String(guildId));
    const removed = before - data.subscriptions.length;
    if (removed > 0) save(data);
    invalidateStatusCache(guildId);
    return removed;
}

/** Daftar langganan aktif semua guild (untuk /premium keys — pemilik bot). */
function listActiveSubscriptions() {
    const now = Date.now();
    const data = load();
    const byGuild = new Map();
    for (const s of data.subscriptions) {
        const isLifetime = s.expireAt === null;
        const isActive = isLifetime || s.expireAt > now;
        if (!isActive) continue;
        const cur = byGuild.get(s.guildId);
        // Lifetime selalu menang; selain itu ambil expireAt terpanjang.
        if (!cur || (isLifetime && cur.expireAt !== null) ||
            (!isLifetime && cur.expireAt !== null && s.expireAt > cur.expireAt)) {
            byGuild.set(s.guildId, s);
        }
    }
    return [...byGuild.values()];
}

/** Daftar key pool lokal (status apapun, terbaru dulu — max 50). */
function listLocalKeys() {
    const data = load();
    return [...data.keys]
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 50);
}

/** Invalidate cache status guild (dipanggil setelah aktivasi/revoke/sweep). */
function invalidateStatusCache(guildId) {
    if (guildId) statusCache.delete(String(guildId));
}

/** Invalidate SEMUA cache status (dipanggil pasca-restore backup). */
function invalidateStatusCacheAll() {
    statusCache.clear();
}

/** Reload dari disk + bersihkan cache (pasca-restore backup). */
function reload() {
    invalidateStatusCacheAll();
    // load() otomatis dipanggil operasi berikutnya — cukup invalidasi cache.
    return true;
}

/**
 * Format sisa waktu langganan untuk ditampilkan ke user.
 * @param {number|null} expireAt - null = lifetime
 * @returns {string}
 */
function formatRemaining(expireAt) {
    if (expireAt === null || expireAt === undefined) return 'Seumur hidup (lifetime)';
    const msLeft = expireAt - Date.now();
    if (msLeft <= 0) return 'Kedaluwarsa';
    const days = Math.floor(msLeft / 86400000);
    if (days >= 1) return `${days} hari lagi`;
    const hours = Math.floor(msLeft / 3600000);
    if (hours >= 1) return `${hours} jam lagi`;
    return `${Math.max(1, Math.floor(msLeft / 60000))} menit lagi`;
}

/** Masking key untuk tampilan list (anti bocor nilai penuh — kebijakan sama
 *  dengan audit log keyManager: key tidak pernah tampil utuh setelah dibuat). */
function maskKey(code) {
    if (typeof code !== 'string' || code.length < 6) return '•••••';
    return `${code.slice(0, 5)}•••••-•••••`;
}

module.exports = {
    PLANS,
    generatePremiumKey,
    findAvailableLocalKey,
    consumeLocalKey,
    revokeLocalKey,
    activateGuildKey,
    isGuildPremium,
    getGuildStatus,
    computeGuildStatusRaw,
    sweepExpiredSubscriptions,
    revokeGuildSubscription,
    listActiveSubscriptions,
    listLocalKeys,
    invalidateStatusCache,
    invalidateStatusCacheAll,
    reload,
    formatRemaining,
    maskKey,
    // Ekspor untuk unit test internal (jangan dipakai handler).
    _generateCode: generateCode,
    _filePath: filePath
};
