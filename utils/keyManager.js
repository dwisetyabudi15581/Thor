const fs = require('fs');
const path = require('path');

const keysPath = path.join(__dirname, '..', 'keys.json');

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
 */

function loadKeys() {
    try {
        if (!fs.existsSync(keysPath)) return [];
        return JSON.parse(fs.readFileSync(keysPath, 'utf8'));
    } catch (err) {
        console.error('Error load keys.json:', err.message);
        return [];
    }
}

function saveKeys(list) {
    fs.writeFileSync(keysPath, JSON.stringify(list, null, 2));
}

function genId() {
    return `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Tambah key baru.
 *
 * @param {Object} data - { key, userId, username, roleId, productName, days }
 *   - days: 0 = permanen, >0 = durasi hari
 *   - expireAt akan dihitung otomatis (now + days * 86400000) atau null kalau permanen
 * @returns {Object} entry yang baru disimpan
 */
function addKey(data) {
    const list = loadKeys();
    const now = Date.now();
    const days = Number(data.days) || 0;
    const expireAt = days > 0 ? now + days * 24 * 60 * 60 * 1000 : null;

    const entry = {
        id: genId(),
        key: data.key,
        userId: data.userId,
        username: data.username || '',
        roleId: data.roleId,
        productName: data.productName || 'Unknown',
        days,
        expireAt,
        createdAt: now
    };
    list.push(entry);
    saveKeys(list);
    return entry;
}

/**
 * Ambil SEMUA key milik user tertentu (tanpa filter expired).
 */
function findAllByUser(userId) {
    const list = loadKeys();
    return list.filter(k => k.userId === userId);
}

/**
 * Ambil key aktif (belum expired) milik user + role tertentu.
 * Key permanen (expireAt = null) selalu dihitung aktif.
 *
 * @param {string} userId
 * @param {string} roleId
 * @param {number} now - timestamp ms (default Date.now())
 * @returns {Array} daftar key aktif
 */
function getActiveKeysByUserAndRole(userId, roleId, now = Date.now()) {
    const list = loadKeys();
    return list.filter(k =>
        k.userId === userId &&
        k.roleId === roleId &&
        (k.expireAt === null || k.expireAt > now)
    );
}

/**
 * Apakah user punya key PERMANEN untuk role tertentu?
 */
function hasPermanentKey(userId, roleId) {
    const list = loadKeys();
    return list.some(k =>
        k.userId === userId &&
        k.roleId === roleId &&
        k.expireAt === null
    );
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
    return Math.max(...actives.map(k => k.expireAt));
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
 * Returns: { total, active, expired, permanent }
 *  - total: semua key di file
 *  - active: expireAt > now ATAU permanen
 *  - expired: expireAt <= now (akan dibersihkan scheduler)
 *  - permanent: days=0 atau expireAt=null
 */
function getStats(now = Date.now()) {
    const list = loadKeys();
    let active = 0, expired = 0, permanent = 0;
    for (const k of list) {
        if (k.expireAt === null || k.days === 0) {
            permanent++;
            active++; // permanent selalu active
        } else if (k.expireAt > now) {
            active++;
        } else {
            expired++;
        }
    }
    return { total: list.length, active, expired, permanent };
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
 * @returns {number} jumlah key yang dihapus
 */
function removeAllKeysByUser(userId) {
    const list = loadKeys();
    const filtered = list.filter(k => k.userId !== userId);
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
    return keys.map((k, i) => {
        const remaining = formatRemaining(k, now);
        return `\`${i + 1}.\` \`${k.key}\` — ${k.productName} — ${remaining}`;
    }).join('\n');
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
    removeExpiredKeys,
    removeAllKeysByUser,
    removeAllKeysByUserAndRole,
    getRemainingDays,
    formatRemaining,
    formatKeysForUser
};
