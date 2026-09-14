/**
 * Custom Command Sync — daftarkan/hapus custom command ke Discord (v3.20.0).
 *
 * Dipanggil dari dua tempat:
 *   1. ready.js  — sinkronisasi startup (anti drift: file data bisa berubah
 *      saat bot mati / direstore dari backup).
 *   2. dashServer — setiap create/update/delete dari WEB → langsung sinkron
 *      supaya command muncul/hilang di Discord dalam hitungan detik.
 *
 * Aturan registrasi (mengikuti mode v3.12.0 di infra/guild.js):
 *   - MODE 1 SERVER (GUILD_ID terisi): command bawaan terdaftar di level
 *     guild utama. `guild.commands.set()` MENGGANTI seluruh daftar level
 *     guild → custom command harus digabung: [...bawaan, ...custom].
 *   - MODE PUBLIK (GUILD_ID kosong): bawaan terdaftar GLOBAL; custom command
 *     tetap per-server → didaftarkan di level guild berisi custom saja
 *     (guild.commands.set(customs) TIDAK menyentuh daftar global).
 *
 * Guild selain guild utama di mode 1 server dilewati (event-nya memang
 * di-guard isGuildAllowed — sinkron di sana hanya buang-buang rate limit).
 */

const customCommandManager = require('../data/customCommandManager');
const { getPrimaryGuildId, isGuildAllowed } = require('../infra/guild');
const { getCommands } = require('../commands/registry');

/**
 * Sinkronkan SATU guild: samakan daftar command level-guild dengan data.
 * @returns {Promise<{ok: boolean, count?: number, error?: string}>}
 */
async function syncGuildCustomCommands(client, guildId) {
    const guild = client?.guilds?.cache?.get(guildId);
    if (!guild) return { ok: false, error: 'Bot tidak ada di server ini' };
    if (!isGuildAllowed(guildId)) return { ok: false, error: 'Server ini tidak diproses bot (mode 1 server)' };

    const customs = customCommandManager.toApplicationCommands(guildId);
    const primary = getPrimaryGuildId();

    try {
        if (primary && String(guildId) === primary) {
            // Mode 1 server di guild utama: gabung bawaan + custom (set()
            // mengganti seluruh daftar — bawaan harus ikut dikirim lagi).
            await guild.commands.set([...getCommands(), ...customs]);
        } else {
            // Mode publik: bawaan sudah GLOBAL; level guild = custom saja.
            await guild.commands.set(customs);
        }
        return { ok: true, count: customs.length };
    } catch (err) {
        return { ok: false, error: `Gagal sinkron ke Discord: ${err.message}` };
    }
}

/**
 * Sinkronkan SEMUA guild yang punya custom command (dipakai saat startup).
 * Best-effort: guild yang gagal dicatat warning, tidak menghentikan lainnya.
 */
async function syncAllGuilds(client, log = () => {}) {
    if (!client?.guilds?.cache) return { synced: 0, failed: 0 };
    let synced = 0;
    let failed = 0;
    for (const guild of client.guilds.cache.values()) {
        // Lewati guild tanpa custom command — tidak ada yang perlu disinkron
        // (dan mencegah set([]) sia-sia yang bisa menghapus guild commands
        // lama milik bot versi sebelumnya di guild yang tidak relevan).
        if (customCommandManager.getGuildCommands(guild.id).length === 0) continue;
        const res = await syncGuildCustomCommands(client, guild.id);
        if (res.ok) {
            synced++;
            log(`✅ Custom command sinkron: ${guild.name} (${res.count} command).`);
        } else {
            failed++;
            log(`⚠️ Custom command gagal sinkron di ${guild.name}: ${res.error}`);
        }
    }
    return { synced, failed };
}

module.exports = { syncGuildCustomCommands, syncAllGuilds };
