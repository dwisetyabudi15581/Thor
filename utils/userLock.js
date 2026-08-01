/**
 * User-scoped in-process lock.
 *
 * Dipakai untuk mencegah TOCTOU race condition ketika user menekan tombol
 * Discord sangat cepat (double-click / spam click) yang bisa memicu
 * double-add / double-vote sebelum file JSON sempat di-flush.
 *
 * Lock di-key per (scope, userId). Scope biasanya nama fitur ('gw', 'poll').
 * Resolusi otomatis setelah timeout (defensive — kalau ada bug, lock tidak
 * nge-hang forever).
 *
 * Concurrency model: single-process Node.js, jadi Map + flag boolean cukup.
 * Tidak butuh mutex/atomic primitive.
 */

const locks = new Map(); // key: `${scope}:${userId}` -> { acquiredAt }

const DEFAULT_TIMEOUT_MS = 5000; // 5 detik — seharusnya cukup untuk semua flow

/**
 * Coba acquire lock untuk (scope, userId).
 * @returns {boolean} true kalau berhasil acquire, false kalau masih di-pegang.
 */
function acquire(scope, userId, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!scope || !userId) return true; // defensive — kalau invalid, biarkan lewat
    const key = `${scope}:${userId}`;
    const now = Date.now();
    const existing = locks.get(key);
    if (existing) {
        if (now - existing.acquiredAt < timeoutMs) {
            return false; // masih di-pegang
        }
        // expired — overtake
    }
    locks.set(key, { acquiredAt: now });
    return true;
}

/**
 * Release lock. Aman dipanggil walau lock tidak pernah di-acquire.
 */
function release(scope, userId) {
    if (!scope || !userId) return;
    locks.delete(`${scope}:${userId}`);
}

/**
 * Jalankan fn di bawah lock. Auto-release di akhir (termasuk kalau throw).
 * @returns hasil fn, atau null kalau gagal acquire.
 */
async function withLock(scope, userId, fn, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!acquire(scope, userId, timeoutMs)) return null;
    try {
        return await fn();
    } finally {
        release(scope, userId);
    }
}

// Periodic cleanup — hapus lock yang sudah expired (defensive terhadap bug
// yang lupa release). Run setiap 1 menit.
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, val] of locks) {
        if (now - val.acquiredAt > DEFAULT_TIMEOUT_MS * 2) {
            locks.delete(key);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.warn(`🧹 userLock: ${cleaned} stale lock dihapus (possible bug).`);
    }
}, 60 * 1000).unref?.();

module.exports = { acquire, release, withLock };
