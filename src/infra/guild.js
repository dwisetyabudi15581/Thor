/**
 * Guild helpers — v3.10.0 multi-guild, v3.12.0 SATU GUILD ID.
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
 * v3.12.0 — SATU GUILD ID (permintaan admin: anti bingung):
 *   HANYA ada satu variabel di .env: GUILD_ID. Allowlist multi-server
 *   era v3.11.0 DIHAPUS total — daftar ID justru bikin bingung saat
 *   ganti server. Dua mode, satu tempat ganti:
 *
 *   1. GUILD_ID TERISI → MODE 1 SERVER (privat):
 *      - Slash command didaftarkan per-guild → INSTAN (detik, bukan jam).
 *      - Semua event (pesan/command/join/boost/tiket/dll.) dari server
 *        lain DIABAIKAN — asuransi kalau bot tak sengaja ter-invite.
 *      - Config.json legacy hanya boleh diklaim guild ini.
 *      Inilah mode yang dipakai deployment biasa: ganti server = ganti
 *      SATU baris GUILD_ID di .env, selesai.
 *
 *   2. GUILD_ID KOSONG → MODE PUBLIK (ala Dyno):
 *      - Slash command didaftarkan GLOBAL: muncul otomatis di SEMUA
 *        server yang meng-invite bot (propagasi ~1 jam — perilaku yang
 *        sama dengan bot publik besar seperti Dyno/MEE6; mereka tidak
 *        pernah memasukkan guild id manual).
 *      - Semua event diproses; config terisolasi per-server otomatis
 *        (data/config/<guildId>.json — arsitektur v3.10.0).
 *
 *   getPrimaryGuildId(): GUILD_ID di .env (trim) atau null (mode publik).
 *   isGuildAllowed(guildId): guard SEMUA event handler — true kalau mode
 *     publik, atau guildId === GUILD_ID.
 *
 * Dibaca langsung dari process.env (tanpa cache) — env statik selama
 * proses hidup, dan unit test bebas memutar nilai env antar-kasus.
 * Operasinya cuma satu perbandingan string — murah bahkan di event
 * high-frequency seperti messageCreate.
 */
function resolveGuildId(interaction) {
    if (!interaction) return null;
    return interaction.guildId || (interaction.guild && interaction.guild.id) || null;
}

/**
 * SATU-SATUNYA guild yang diproses bot (lihat dua mode di header).
 * @returns {string|null} — GUILD_ID yang sudah di-trim, atau null
 *   (= mode publik: semua guild diproses).
 */
function getPrimaryGuildId() {
    const single = (process.env.GUILD_ID || '').trim();
    return single || null;
}

/**
 * Guard guild: guild ini boleh diproses?
 * - guildId null/undefined → false (DM / tanpa konteks — caller men-guard sendiri).
 * - GUILD_ID kosong (mode publik) → selalu true.
 * - GUILD_ID terisi (mode 1 server) → true hanya untuk guild yang cocok.
 * @param {string|null} guildId
 * @returns {boolean}
 */
function isGuildAllowed(guildId) {
    if (!guildId) return false;
    const primary = getPrimaryGuildId();
    if (!primary) return true; // mode publik — semua server diizinkan
    return String(guildId) === primary;
}

module.exports = { resolveGuildId, getPrimaryGuildId, isGuildAllowed };
