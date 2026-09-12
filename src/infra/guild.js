/**
 * Guild helpers — v3.10.0 multi-guild, v3.11.0 fase 2 (allowlist).
 *
 * resolveGuildId(interaction): ambil ID guild dari interaction Discord.
 * Discord asli menyediakan `interaction.guildId` (selalu ada di context
 * server); `interaction.guild?.id` tersedia kalau guild ter-cache. Dua-duanya
 * dicek supaya:
 *   - production: guildId langsung terpakai (guild.id cuma fallback),
 *   - unit test: mock interaction yang hanya punya `guild: { id }` tetap
 *     jalan tanpa harus meniru kelas interaction discord.js lengkap.
 *
 * Return null untuk DM / tanpa konteks guild — caller wajib men-guard null
 * (atau membiarkan configManager throw dengan pesan yang jelas).
 *
 * ---------------------------------------------------------------------
 * v3.11.0 FASE 2 — ALLOWED_GUILD_IDS (allowlist multi-server):
 *   getAllowedGuildIds(): daftar guild yang diizinkan memakai bot.
 *     Sumber (prioritas):
 *       1. env ALLOWED_GUILD_IDS — dipisah koma/spasi, hanya angka
 *          snowflake Discord yang valid, mis. "111...,222...,333...".
 *       2. env GUILD_ID (fallback) — mode single-guild v3.9.26; admin
 *          lama tidak perlu mengubah .env apa pun setelah upgrade.
 *       3. [] (kosong) = MODE TERBUKA: semua guild diproses (perilaku
 *          v3.10.0) — untuk bot yang memang dipakai publik.
 *   isGuildAllowed(guildId): true kalau guild ada di daftar, ATAU daftar
 *     kosong (mode terbuka). Dipakai sebagai guard SEMUA event handler.
 *
 * Dibaca langsung dari process.env (tanpa cache) — env statik selama
 * proses hidup, dan unit test bebas memutar nilai env antar-kasus.
 * Operasinya split string pendek — murah bahkan di event high-frequency
 * seperti messageCreate.
 */
function resolveGuildId(interaction) {
    if (!interaction) return null;
    return interaction.guildId || (interaction.guild && interaction.guild.id) || null;
}

/**
 * Daftar guild yang diizinkan (lihat aturan prioritas di header).
 * Token kosong dibuang; TIDAK ada validasi digit ketat supaya fallback
 * GUILD_ID tetap kompatibel dengan nilai apa pun yang admin pakai
 * (ID Discord asli memang snowflake numerik, tapi kita tidak membatasi).
 * @returns {string[]} — kosong berarti mode terbuka (semua guild).
 */
function getAllowedGuildIds() {
    const rawList = (process.env.ALLOWED_GUILD_IDS || '').trim();
    if (rawList) {
        return rawList
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    const single = (process.env.GUILD_ID || '').trim();
    if (single) return [single];
    return [];
}

/**
 * Guard allowlist: guild ini boleh diproses?
 * - guildId null/undefined → false (DM / tanpa konteks — caller men-guard sendiri).
 * - Daftar kosong (mode terbuka) → selalu true.
 * - Daftar terisi → true hanya untuk anggota daftar.
 * @param {string|null} guildId
 * @returns {boolean}
 */
function isGuildAllowed(guildId) {
    if (!guildId) return false;
    const list = getAllowedGuildIds();
    if (list.length === 0) return true;
    return list.includes(String(guildId));
}

module.exports = { resolveGuildId, getAllowedGuildIds, isGuildAllowed };
