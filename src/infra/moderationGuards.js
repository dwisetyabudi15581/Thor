/**
 * Moderation Guards — aturan & helper murni untuk paket moderasi v3.9.43.
 *
 * Pure functions (tanpa I/O) supaya bisa di-unit-test menyeluruh:
 *   - validateModerationTarget : hierarki role + larangan self/bot target
 *   - validateTimeoutDuration  : limit timeout Discord (1 menit s/d 28 hari)
 *   - validatePurgeAmount      : limit bulk delete per panggilan (1–100)
 *   - filterBulkDeletable      : pesan >14 hari TIDAK boleh bulk-delete (limit API)
 *   - formatDurationMinutes    : 90 → "1 jam 30 menit" (untuk reply & DM)
 *
 * Kenapa file terpisah dari src/commands/moderation.js:
 *   1. Handler domain menerima `interaction` (hard di-mock) — guard murni
 *      bisa dites langsung tanpa Discord.
 *   2. Guard yang sama dipakai beberapa command (timeout/kick/ban) — satu
 *      sumber kebenaran, tidak ada copy-paste rule yang bisa melenceng.
 *
 * Kontrak hierarki (Discord):
 *   - Moderator HARUS punya role TERTINGGI yang lebih TINGGI dari target.
 *     (`>=` ditolak — setingkat = ditolak, konsisten dengan /warn v3.9.8)
 *   - Bot juga harus lebih tinggi dari target, kalau tidak API throw
 *     "Missing Permissions" — kita tolak lebih awal dengan pesan jelas.
 */

// === Batas Discord (hard limits API) ===
const TIMEOUT_MAX_MINUTES = 28 * 24 * 60; // 28 hari = 40.320 menit (limit API timeout)
const TIMEOUT_MIN_MINUTES = 1;
const PURGE_MIN = 1;
const PURGE_MAX = 100; // limit bulk delete per call
// Bulk delete API hanya bisa pesan berumur < 14 hari (tanpa premium perk).
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const BAN_DELETE_DAYS_MAX = 7; // limit deleteMessageSeconds: 7 hari
const USER_ID_PATTERN = /^\d{17,20}$/; // snowflake Discord

/**
 * Validasi target moderasi (timeout/kick/ban/untimeout).
 * @param {Object} p
 * @param {import('discord.js').GuildMember} p.moderatorMember member yang menjalankan command
 * @param {import('discord.js').GuildMember} p.targetMember member yang ditindak
 * @param {import('discord.js').GuildMember|null} p.botMember member bot (guild.members.me)
 * @param {boolean} [p.rejectBots=true] tolak target bot (konsisten /warn: gak bisa warn bot)
 * @returns {{ok: boolean, error?: string}} error = kode stabil utk mapping pesan
 */
function validateModerationTarget({ moderatorMember, targetMember, botMember, rejectBots = true }) {
    if (!targetMember) return { ok: false, error: 'not-in-guild' };
    if (moderatorMember.id === targetMember.id) return { ok: false, error: 'self' };
    if (botMember && targetMember.id === botMember.id) return { ok: false, error: 'bot-self' };
    if (rejectBots && targetMember.user?.bot) return { ok: false, error: 'target-bot' };

    // Hierarki moderator vs target — harus lebih TINGGI (setingkat = tolak).
    const modTop = moderatorMember.roles?.highest?.position ?? 0;
    const tgtTop = targetMember.roles?.highest?.position ?? 0;
    if (tgtTop >= modTop) return { ok: false, error: 'hierarchy' };

    // Hierarki bot vs target — kalau bot lebih rendah, API bakal throw.
    if (botMember) {
        const botTop = botMember.roles?.highest?.position ?? 0;
        if (tgtTop >= botTop) return { ok: false, error: 'bot-hierarchy' };
    }

    return { ok: true };
}

/**
 * Validasi durasi timeout (menit).
 * Tipe harus number asli — option INTEGER slash command selalu number;
 * string masuk berarti bug pemanggil (koersi Number() hanya menyembunyikannya).
 * @returns {{ok: boolean, error?: string, ms?: number}}
 */
function validateTimeoutDuration(minutes) {
    if (typeof minutes !== 'number' || !Number.isInteger(minutes)) return { ok: false, error: 'not-integer' };
    if (minutes < TIMEOUT_MIN_MINUTES) return { ok: false, error: 'too-short' };
    if (minutes > TIMEOUT_MAX_MINUTES) return { ok: false, error: 'too-long' };
    return { ok: true, ms: minutes * 60 * 1000 };
}

/**
 * Validasi jumlah purge.
 * @returns {{ok: boolean, error?: string}}
 */
function validatePurgeAmount(amount) {
    if (typeof amount !== 'number' || !Number.isInteger(amount)) return { ok: false, error: 'not-integer' };
    if (amount < PURGE_MIN) return { ok: false, error: 'too-small' };
    if (amount > PURGE_MAX) return { ok: false, error: 'too-large' };
    return { ok: true };
}

/**
 * Filter pesan yang boleh di-bulk-delete (umur ≤ 14 hari).
 * Pesan lama harus dihapus satu-satu via m.delete() — API bulk menolak.
 * @param {Array<import('discord.js').Message>} messages
 * @param {number} [now=Date.now()]
 * @returns {Array<import('discord.js').Message>}
 */
function filterBulkDeletable(messages, now = Date.now()) {
    if (!Array.isArray(messages)) return [];
    return messages.filter(m => {
        const ts = m.createdTimestamp;
        // Partial/unknown timestamp → anggap tidak boleh bulk (fail-safe).
        if (typeof ts !== 'number' || Number.isNaN(ts)) return false;
        return now - ts <= BULK_DELETE_MAX_AGE_MS;
    });
}

/**
 * Format menit → teks manusiawi (ID).
 * 90 → "1 jam 30 menit" · 2880 → "2 hari" · 45 → "45 menit"
 */
function formatDurationMinutes(totalMinutes) {
    const n = Math.max(0, Math.floor(Number(totalMinutes) || 0));
    const days = Math.floor(n / 1440);
    const hours = Math.floor((n % 1440) / 60);
    const minutes = n % 60;
    const parts = [];
    if (days > 0) parts.push(`${days} hari`);
    if (hours > 0) parts.push(`${hours} jam`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes} menit`);
    return parts.join(' ');
}

/**
 * Validasi format user ID (snowflake) — untuk /unban (user tidak di guild).
 */
function isValidUserId(id) {
    return typeof id === 'string' && USER_ID_PATTERN.test(id.trim());
}

module.exports = {
    TIMEOUT_MAX_MINUTES,
    TIMEOUT_MIN_MINUTES,
    PURGE_MIN,
    PURGE_MAX,
    BULK_DELETE_MAX_AGE_MS,
    BAN_DELETE_DAYS_MAX,
    validateModerationTarget,
    validateTimeoutDuration,
    validatePurgeAmount,
    filterBulkDeletable,
    formatDurationMinutes,
    isValidUserId
};
