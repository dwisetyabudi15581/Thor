const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeWriteJSON, quarantineCorruptFile } = require('../infra/safeWrite');

const keysPath = path.join(__dirname, '..', '..', 'data', 'keys.json');

/**
 * File structure: keys.json
 * [
 *   {
 *     "id": "key_<timestamp>_<rand>",
 *     "key": "XXXXX-XXXXX-XXXXX",
 *     "userId": "123456",
 *     "username": "User#1234",
 *     "roleId": "789012",
 *     "productName": "30 Days",
 *     "days": 30,           // 0 = permanen
 *     "expireAt": 1735689600000,  // timestamp ms. null = permanen
 *     "createdAt": 1735000000000
 *   }
 * ]
 *
 * === MODEL KEY-DRIVEN ===
 * Setiap pembelian = 1 key baru dengan expireAt INDEPENDEN (tidak ditumpuk).
 * Role VIP mengikuti key dengan sisa waktu TERBANYAK (max dari semua key aktif).
 * Key yang sudah expired akan dihapus otomatis dari keys.json.
 *
 * === v3.13.0: STOK KEY + PENUKARAN MANDIRI (PREMIUM SAAS) ===
 * Mode publik ala Dyno (v3.12.0) melengkapi sisi monetisasinya:
 *   1. /gen-key  — bot yang mengarang key (random crypto-secure),
 *                   bukan admin lagi mengarang manual lewat /set-key.
 *   2. Key stok  — entry dengan status 'available' + userId null.
 *                   Durasi baru mulai jalan SAAT DITUKAR, bukan saat dibuat
 *                   (expireAt dihitung redeemKey, bukan createStockKey).
 *   3. /redeem   — member menukar key SENDIRI (self-service): role +
 *                   jadwal expire otomatis — admin tidak perlu online.
 *   4. Key stok guild-scoped: key server A tidak bisa ditukar di server B
 *      (penting di mode publik multi-server).
 * Key stok ditandai field `status: 'available'`; key legacy (pre-v3.13)
 * tidak punya field status → dianggap sudah diklaim (sudah punya userId).
 */

function loadKeys() {
    try {
        if (!fs.existsSync(keysPath)) return [];
        return JSON.parse(fs.readFileSync(keysPath, 'utf8'));
    } catch (err) {
        console.error('Error load keys.json:', err.message);
        // v3.9.26: karantina file korup SEBELUM return [] — tanpa ini save()
        // berikutnya menimpa file korup dengan state kosong → SEMUA VIP key
        // hilang permanen. (keys.json = data paling kritis di bot ini.)
        quarantineCorruptFile(keysPath);
        return [];
    }
}

/**
 * v3.9.0 FIX: pakai safeWriteJSON (atomic tmp+rename) supaya crash mid-write
 * tidak corrupt keys.json (yang bisa wipe semua VIP key).
 */
function saveKeys(list) {
    safeWriteJSON(keysPath, list);
}

function genId() {
    return `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// === v3.13.0: STOK KEY + PENUKARAN MANDIRI (PREMIUM SAAS) ===
// ============================================================

// Alphabet tanpa karakter ambigu (I, L, O, 0, 1 dibuang) supaya key
// mudah dibaca & disalin manual oleh pembeli (HP-friendly).
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const KEY_GROUPS = 3; // format: XXXXX-XXXXX-XXXXX
const KEY_GROUP_LEN = 5;

// Anti brute-force /redeem: max kegagalan per user sebelum cooldown.
const REDEEM_MAX_FAILURES = 5;
const REDEEM_WINDOW_MS = 10 * 60 * 1000; // window 10 menit (sliding)
const redeemFailures = new Map(); // userId → { count, firstAt }

/**
 * v3.13.0: Apakah entry ini key STOK (belum ditukar)?
 * Marker: status === 'available' — hanya createStockKey yang men-set-nya.
 * Key legacy (pre-v3.13) tidak punya field status → bukan stok.
 */
function isStockKey(k) {
    return Boolean(k) && k.status === 'available';
}

/**
 * v3.13.0: Karang key acak format XXXXX-XXXXX-XXXXX.
 * Crypto-secure (crypto.randomBytes, BUKAN Math.random — Math.random
 * tidak untuk nilai yang bernilai uang). 15 char dari alphabet 31 char
 * = ~74 bit entropy — jauh di luar jangkauan brute force, apalagi
 * ditambah rate limiter /redeem. (bytes[i] % 31 punya bias kecil
 * ~3% per char — diabaikan: margin entropy terlalu besar.)
 * Collision dengan key yang sudah ada → retry (maks 10x, lalu throw).
 *
 * @param {Array} [existingList] - daftar key saat ini (dup-check)
 * @returns {string} key baru, mis. "K7M2P-QXN4R-TVW8Y"
 */
function generateKeyString(existingList = []) {
    const existing = new Set((existingList || []).map(k => k && k.key));
    for (let attempt = 0; attempt < 10; attempt++) {
        const bytes = crypto.randomBytes(KEY_GROUPS * KEY_GROUP_LEN);
        let key = '';
        for (let i = 0; i < KEY_GROUPS * KEY_GROUP_LEN; i++) {
            if (i > 0 && i % KEY_GROUP_LEN === 0) key += '-';
            key += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
        }
        if (!existing.has(key)) return key;
    }
    // Praktis mustahil (74 bit entropy), tapi fail-fast lebih aman
    // daripada diam-diam return key duplikat (yang akan ditolak addKey
    // / createStockKey berikutnya dan bikin bingung).
    throw new Error('Gagal generate key unik (coba lagi)');
}

/**
 * v3.13.0: Buat key STOK (available, belum milik siapa pun) — dipakai
 * /gen-key. Key ini lalu disebarkan ke pembeli (DM / marketplace /
 * top.gg / toko eksternal) dan ditukar sendiri lewat /redeem.
 *
 * @param {Object} data - { productName, roleId, days, guildId, note, createdBy }
 *   - days: 0 = permanen, >0 = durasi hari SEJAK DITUKAR (bukan sejak dibuat)
 *   - roleId wajib: role yang diberikan saat key ditukar (produk harus
 *     sudah di-set-product-role sebelum gen-key — divalidasi caller juga)
 * @returns {Object} entry stok yang baru disimpan
 */
function createStockKey(data) {
    const list = loadKeys();
    const now = Date.now();
    const days = Number(data.days) || 0;

    // Fail-fast: tanpa productName/roleId, key tidak bisa ditukar dengan
    // benar nantinya (redeem butuh roleId untuk memberi role).
    if (!data.productName) throw new Error('Nama produk wajib diisi');
    if (!data.roleId) throw new Error('roleId wajib diisi (role yang diberikan saat key ditukar)');

    const key = generateKeyString(list);
    const entry = {
        id: genId(),
        key,
        userId: null, // belum ditukar — diisi redeemKey
        username: null,
        roleId: data.roleId,
        productName: data.productName,
        days,
        expireAt: null, // dihitung SAAT DITUKAR (redeemKey) — durasi belum jalan
        status: 'available', // 'available' → 'redeemed'
        note: (typeof data.note === 'string' ? data.note.trim() : '').slice(0, 100),
        createdBy: data.createdBy || null,
        guildId: data.guildId || null,
        createdAt: now
    };
    list.push(entry);
    saveKeys(list);
    return entry;
}

/**
 * v3.13.0: Cari key persis (untuk pre-validasi handler / list stok / test).
 * @returns {Object|null} entry, atau null kalau tidak ada / input kosong
 */
function findKeyByString(key) {
    const trimmed = typeof key === 'string' ? key.trim() : '';
    if (!trimmed) return null;
    return loadKeys().find(k => k.key === trimmed) || null;
}

/**
 * v3.13.0: Tukar key stok ke user (dipakai /redeem — self-service).
 * Atomic dalam satu proses Node (load → validasi → mutate → save tanpa
 * await di tengah): dua redeem bersamaan → hanya satu yang sukses.
 *
 * Validasi — SEMUA kegagalan throw pesan GENERIK yang sama supaya key
 * tidak bisa di-enumerasi (tidak bocor mana key yang valid tapi belum
 * dipakai):
 *   - key tidak ditemukan → generik
 *   - key bukan stok / sudah ditukar → generik
 *   - key milik guild lain → generik (guild-scoped, penting mode publik)
 *
 * Sukses: status 'redeemed', userId/username/redeemedAt terisi, dan
 * expireAt dihitung dari SEKARANG (durasi mulai saat ditukar).
 *
 * @param {string} keyString - key yang diketik user (di-trim)
 * @param {Object} who - { userId, username, guildId }
 * @returns {Object} entry yang sudah ditukar
 */
function redeemKey(keyString, { userId, username, guildId }) {
    const trimmed = typeof keyString === 'string' ? keyString.trim() : '';
    if (!trimmed) throw new Error('Key tidak valid atau sudah dipakai');
    if (!userId) throw new Error('userId wajib diisi');

    const list = loadKeys();
    const entry = list.find(k => k.key === trimmed);
    const GENERIC = 'Key tidak valid atau sudah dipakai';
    if (!entry) throw new Error(GENERIC);
    if (!isStockKey(entry)) throw new Error(GENERIC);
    if (entry.guildId && entry.guildId !== guildId) throw new Error(GENERIC);

    const now = Date.now();
    const days = Number(entry.days) || 0;
    entry.userId = userId;
    entry.username = username || '';
    entry.redeemedAt = now;
    entry.status = 'redeemed';
    // Durasi SEJAK DITUKAR — key stok tidak punya expireAt sebelum ini.
    entry.expireAt = days > 0 ? now + days * 24 * 60 * 60 * 1000 : null;
    saveKeys(list);
    return entry;
}

/**
 * v3.13.0: Semua key stok (available) milik guild ini (untuk /list-stock).
 * Key stok selalu punya guildId eksplisit (createStockKey), tapi guard
 * legacy null tetap dipertahankan untuk robustness.
 * @returns {Array} entry stok
 */
function listStockKeys(guildId) {
    const list = loadKeys();
    return list.filter(k => isStockKey(k) && (!guildId || !k.guildId || k.guildId === guildId));
}

/**
 * v3.13.0: Batalkan key stok (belum ditukar) — dipakai /revoke-key untuk
 * key yang bocor / salah buat. Key yang SUDAH ditukar bukan wewenang
 * revoke (pemakaiannya sudah sah — untuk itu pakai /clear-schedule
 * user clear_keys:true). Guild-scope: admin guild lain tidak bisa
 * mencabut stok guild ini.
 * @returns {Object|null} entry yang dihapus, atau null kalau tidak sah
 */
function revokeStockKey(keyString, guildId) {
    const trimmed = typeof keyString === 'string' ? keyString.trim() : '';
    if (!trimmed) return null;
    const list = loadKeys();
    const idx = list.findIndex(k => k.key === trimmed);
    if (idx === -1) return null;
    const entry = list[idx];
    if (!isStockKey(entry)) return null; // sudah ditukar → bukan revoke-able
    if (guildId && entry.guildId && entry.guildId !== guildId) return null; // stok guild lain
    list.splice(idx, 1);
    saveKeys(list);
    return entry;
}

/**
 * v3.13.0: Apakah user sedang diblok /redeem (terlalu banyak kegagalan)?
 * Window 10 menit sliding: hitungan reset sendiri kalau kegagalan
 * pertama sudah lebih tua dari window.
 */
function isRedeemRateLimited(userId, now = Date.now()) {
    const rec = redeemFailures.get(userId);
    if (!rec) return false;
    if (now - rec.firstAt >= REDEEM_WINDOW_MS) {
        redeemFailures.delete(userId); // window lewat — reset
        return false;
    }
    return rec.count >= REDEEM_MAX_FAILURES;
}

/**
 * v3.13.0: Catat 1 kegagalan /redeem (dipanggil handler setiap redeemKey
 * throw). @returns {number} jumlah kegagalan berjalan
 */
function noteRedeemFailure(userId, now = Date.now()) {
    const rec = redeemFailures.get(userId);
    if (!rec || now - rec.firstAt >= REDEEM_WINDOW_MS) {
        redeemFailures.set(userId, { count: 1, firstAt: now });
        return 1;
    }
    rec.count += 1;
    return rec.count;
}

/**
 * v3.13.0: Reset hitungan kegagalan user (dipanggil handler saat redeem
 * sukses — user yang berhasil jelas bukan penyerang).
 */
function noteRedeemSuccess(userId) {
    redeemFailures.delete(userId);
}

/** v3.13.0: reset limiter untuk test (tidak untuk produksi). */
function _resetRedeemRateLimitForTest() {
    redeemFailures.clear();
}

/**
 * Tambah key baru.
 *
 * @param {Object} data - { key, userId, username, roleId, productName, days, guildId }
 *   - days: 0 = permanen, >0 = durasi hari
 *   - expireAt akan dihitung otomatis (now + days * 86400000) atau null kalau permanen
 *   - guildId: ID guild tempat key ini diberikan (v3.9.3 — sebelumnya tidak disimpan,
 *     yang bikin removeAllKeysByUser(userId, guildId) broken karena filter tidak pernah match)
 * @returns {Object} entry yang baru disimpan
 */
function addKey(data) {
    const list = loadKeys();
    const now = Date.now();
    const days = Number(data.days) || 0;
    const expireAt = days > 0 ? now + days * 24 * 60 * 60 * 1000 : null;

    // v3.9.38 FIX (FIX 5c): harden data layer — key kosong/whitespace DITOLAK.
    // Sebelumnya hanya truthy-check `data.key &&` di dup-check → "   " lolos
    // tersimpan sebagai key blank (buyers tidak bisa redeem apa-apa). Key
    // di-trim dulu, dan versi ter-trim yang disimpan supaya dup-check akurat.
    const key = typeof data.key === 'string' ? data.key.trim() : '';
    if (!key) {
        throw new Error('Key tidak boleh kosong');
    }

    // v3.9.8 FIX: cek uniqueness key. Sebelumnya tidak ada cek → admin typo
    // / copy-paste bisa bikin 2 entry dengan key sama, dan getActiveKeysByUserAndRole
    // double-count (meski max() idempotent, tetap UX confusion + bisa bikin
    // member redeem 2x kalau redemption logic pakai find-by-key).
    // v3.9.38 FIX (FIX 6c): pesan error TIDAK lagi menyertakan nilai key —
    // error ini mengalir ke console log handler (ticket.js/keys.js) → raw key
    // bocor ke log. Admin sudah tahu key yang barusan dia ketik.
    if (list.some(k => k.key === key)) {
        throw new Error('Key sudah ada di database (duplicate).');
    }

    const entry = {
        id: genId(),
        key,
        userId: data.userId,
        username: data.username || '',
        roleId: data.roleId,
        productName: data.productName || 'Unknown',
        days,
        expireAt,
        guildId: data.guildId || null, // v3.9.3: simpan guildId supaya cross-guild wipe bisa akurat
        createdAt: now
    };
    list.push(entry);
    saveKeys(list);
    return entry;
}

/**
 * Ambil SEMUA key milik user tertentu (tanpa filter expired).
 * v3.9.8: tambah optional guildId filter supaya /list-keys tidak bocor cross-guild.
 */
function findAllByUser(userId, guildId) {
    const list = loadKeys();
    if (guildId) {
        // Filter key milik user ini di guild ini.
        // Key tanpa guildId (schema lama, pre-v3.9.3) juga diikutsertakan (backward compat).
        return list.filter(k => k.userId === userId && (k.guildId === guildId || !k.guildId));
    }
    return list.filter(k => k.userId === userId);
}

/**
 * Ambil key aktif (belum expired) milik user + role tertentu.
 * Key permanen (expireAt = null) selalu dihitung aktif.
 *
 * @param {string} userId
 * @param {string} roleId
 * @param {number} [now=Date.now()] - timestamp ms
 * @param {string|null} [guildId=null] - v3.9.31: optional guild filter (konsistensi
 *        pola dengan findAllByUser). Key legacy tanpa guildId tetap dihitung
 *        (backward compat). roleId sebenarnya unik per guild (snowflake), jadi
 *        ini murni konsistensi, bukan fix kebocoran nyata.
 * @returns {Array} daftar key aktif
 */
function getActiveKeysByUserAndRole(userId, roleId, now = Date.now(), guildId = null) {
    const list = loadKeys();
    return list.filter(
        k =>
            k.userId === userId &&
            k.roleId === roleId &&
            (k.expireAt === null || k.expireAt > now) &&
            (!guildId || !k.guildId || k.guildId === guildId)
    );
}

/**
 * Apakah user punya key PERMANEN untuk role tertentu?
 */
function hasPermanentKey(userId, roleId) {
    const list = loadKeys();
    return list.some(k => k.userId === userId && k.roleId === roleId && k.expireAt === null);
}

/**
 * Ambil expireAt TERBESAR dari semua key aktif milik user+role.
 * - Kalau ada key permanen → return null (permanen)
 * - Kalau ada key aktif → return max(expireAt)
 * - Kalau tidak ada key aktif → return null (tapi panggilan harus cek dulu)
 *
 * @returns {number|null} timestamp ms, atau null kalau permanen / tidak ada
 */
function getMaxExpireAtByUserAndRole(userId, roleId, now = Date.now()) {
    const actives = getActiveKeysByUserAndRole(userId, roleId, now);
    if (actives.length === 0) return null;
    if (actives.some(k => k.expireAt === null)) return null; // ada permanen
    // v3.9.1 FIX: pakai reduce, bukan Math.max(...spread). Kalau user punya
    // ratusan key aktif (kasus ekstrim), spread bisa kena call stack limit
    // dan throw RangeError "Maximum call stack size exceeded".
    let max = -Infinity;
    for (const k of actives) {
        if (k.expireAt > max) max = k.expireAt;
    }
    return max === -Infinity ? null : max;
}

/**
 * Ambil semua key yang SUDAH expired (expireAt !== null && expireAt <= now).
 * Key permanen TIDAK akan pernah masuk sini.
 */
function getExpiredKeys(now = Date.now()) {
    const list = loadKeys();
    return list.filter(k => k.expireAt !== null && k.expireAt <= now);
}

/**
 * Ambil SEMUA key di keys.json (untuk keperluan stats/debug).
 */
function getAllKeys() {
    return loadKeys();
}

/**
 * Hitung statistik key buat /config-show.
 * Returns: { total, active, expired, permanent, available }
 *  - total: semua key di file
 *  - active: expireAt > now ATAU permanen
 *  - expired: expireAt <= now (akan dibersihkan scheduler)
 *  - permanent: days=0 atau expireAt=null (yang sudah DIKONSUMSI)
 *  - available: v3.13.0 — key stok yang belum ditukar (belum memberi
 *    apa pun ke siapa pun → TIDAK dihitung aktif/permanen)
 */
function getStats(now = Date.now()) {
    const list = loadKeys();
    let active = 0,
        expired = 0,
        permanent = 0,
        available = 0;
    for (const k of list) {
        // v3.13.0: key stok dihitung terpisah — expireAt-nya null (belum
        // jalan), tanpa guard ini bakal salah dihitung permanent+active.
        if (isStockKey(k)) {
            available++;
            continue;
        }
        if (k.expireAt === null || k.days === 0) {
            permanent++;
            active++; // permanent selalu active
        } else if (k.expireAt > now) {
            active++;
        } else {
            expired++;
        }
    }
    return { total: list.length, active, expired, permanent, available };
}

/**
 * v3.9.4: Guild-scoped variant of getStats.
 * Hanya hitung key milik guild ini (atau key legacy tanpa guildId, yang dianggap milik guild pemanggil).
 *
 * @param {string} guildId
 * @param {number} now
 * @returns {{total, active, expired, permanent, available}}
 */
function getStatsByGuild(guildId, now = Date.now()) {
    if (!guildId) return getStats(now);
    const list = loadKeys().filter(k => !k.guildId || k.guildId === guildId);
    let active = 0,
        expired = 0,
        permanent = 0,
        available = 0;
    for (const k of list) {
        // v3.13.0: key stok guild lain sudah terfilter di atas; stok guild
        // ini dihitung terpisah (belum dikonsumsi siapa pun).
        if (isStockKey(k)) {
            available++;
            continue;
        }
        if (k.expireAt === null || k.days === 0) {
            permanent++;
            active++;
        } else if (k.expireAt > now) {
            active++;
        } else {
            expired++;
        }
    }
    return { total: list.length, active, expired, permanent, available };
}

/**
 * Hapus SEMUA key yang sudah expired dari keys.json.
 * @returns {number} jumlah key yang dihapus
 */
function removeExpiredKeys(now = Date.now()) {
    const list = loadKeys();
    const filtered = list.filter(k => k.expireAt === null || k.expireAt > now);
    const removed = list.length - filtered.length;
    if (removed > 0) saveKeys(filtered);
    return removed;
}

/**
 * Hapus SEMUA key milik user tertentu (dipakai /clear-schedule --clear_keys).
 * v3.9.0 FIX: tambah parameter guildId supaya cross-guild wipe tidak terjadi.
 *   - Kalau guildId diberikan: hanya hapus key yang match userId DAN guildId.
 *   - Kalau guildId undefined/null: behavior lama (hapus semua key user — backward compat).
 *
 * v3.9.3 FIX: sebelumnya, kalau guildId di-pass tapi key tidak punya field guildId
 *   (schema lama, sebelum v3.9.3), filter `k.guildId === guildId` TIDAK PERNAH match
 *   karena k.guildId = undefined. Akibatnya, /clear-schedule clear_keys:true
 *   silently menghapus 0 key padahal admin mengira VIP sudah di-reset.
 *   Sekarang: key tanpa guildId (schema lama) dianggap milik guild yang memanggil
 *   (asumsi: bot sebelumnya single-guild). Key baru (v3.9.3+) punya guildId eksplisit.
 *
 * @param {string} userId
 * @param {string} [guildId] - opsional, filter by guild kalau diberikan
 * @returns {number} jumlah key yang dihapus
 */
function removeAllKeysByUser(userId, guildId) {
    const list = loadKeys();
    let filtered;
    if (guildId) {
        // Hapus key milik user ini di guild ini.
        // Key tanpa guildId (schema lama, pre-v3.9.3) juga dihapus karena
        // diasumsikan milik guild pertama yang memanggil (backward compat).
        filtered = list.filter(
            k => !(k.userId === userId && (k.guildId === guildId || k.guildId === undefined || k.guildId === null))
        );
    } else {
        // Behavior lama: hapus semua key user (backward compat untuk single-guild).
        filtered = list.filter(k => k.userId !== userId);
    }
    const removed = list.length - filtered.length;
    if (removed > 0) saveKeys(filtered);
    return removed;
}

/**
 * Hapus SEMUA key milik user + role tertentu.
 * @returns {number} jumlah key yang dihapus
 */
function removeAllKeysByUserAndRole(userId, roleId) {
    const list = loadKeys();
    const filtered = list.filter(k => !(k.userId === userId && k.roleId === roleId));
    const removed = list.length - filtered.length;
    if (removed > 0) saveKeys(filtered);
    return removed;
}

/**
 * Hitung sisa hari dari sebuah key (bisa negatif kalau expired, Infinity kalau permanen).
 */
function getRemainingDays(key, now = Date.now()) {
    if (key.expireAt === null) return Infinity;
    return (key.expireAt - now) / (24 * 60 * 60 * 1000);
}

/**
 * Format tampilan sisa waktu untuk 1 key.
 */
function formatRemaining(key, now = Date.now()) {
    if (key.expireAt === null) return 'Permanen';
    const days = getRemainingDays(key, now);
    if (days <= 0) return 'Expired';
    if (days < 1) {
        const hours = Math.ceil(days * 24);
        return `${hours} jam lagi`;
    }
    return `${Math.ceil(days)} hari lagi`;
}

/**
 * Format daftar key untuk ditampilkan ke user/admin.
 * Hanya tampilkan key aktif.
 */
function formatKeysForUser(keys, now = Date.now()) {
    if (keys.length === 0) return '(tidak ada key)';
    return keys
        .map((k, i) => {
            const remaining = formatRemaining(k, now);
            return `\`${i + 1}.\` \`${k.key}\` — ${k.productName} — ${remaining}`;
        })
        .join('\n');
}

module.exports = {
    addKey,
    findAllByUser,
    getActiveKeysByUserAndRole,
    hasPermanentKey,
    getMaxExpireAtByUserAndRole,
    getExpiredKeys,
    getAllKeys,
    getStats,
    getStatsByGuild,
    removeExpiredKeys,
    removeAllKeysByUser,
    removeAllKeysByUserAndRole,
    getRemainingDays,
    formatRemaining,
    formatKeysForUser,
    // v3.13.0: stok key + penukaran mandiri (premium SaaS)
    generateKeyString,
    createStockKey,
    findKeyByString,
    redeemKey,
    listStockKeys,
    revokeStockKey,
    isRedeemRateLimited,
    noteRedeemFailure,
    noteRedeemSuccess,
    _resetRedeemRateLimitForTest
};
