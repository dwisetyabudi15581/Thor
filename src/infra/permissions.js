const { PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('../data/configManager');

/**
 * Cek apakah seorang member adalah admin/staff bot.
 * Member dianggap admin kalau:
 *   1. Punya role Admin (yang sudah di-set via /set-role admin), ATAU
 *   2. Punya Discord permission ManageGuild, ATAU
 *   3. Punya Discord permission Administrator (super admin Discord)
 *
 * v3.9.2 OPTIMIZATION: cache admin role ID dari config selama 30 detik.
 * Sebelumnya, setiap interaction masuk manggil getConfig() yang baca
 * config.json dari disk secara sync. Untuk server aktif dengan banyak
 * slash command, ini bisa 50-100 disk read/detik yang sebenarnya tidak
 * perlu (config jarang berubah).
 *
 * Cache di-invalidate otomatis setelah 30 detik, jadi kalau admin baru
 * set role admin, maks 30 detik sudah terbaca.
 *
 * v3.10.0 MULTI-GUILD: cache sekarang PER-GUILD (Map<guildId, entry>).
 * Sebelumnya satu variabel global — admin role server A terbaca oleh
 * server B (kalau bot dipakai 2+ server). Entry per guild kecil (2 field),
 * jumlah guild yang realistis (< ribuan) tidak membebani memori; entry
 * basi ditimpa saat TTL habis, bukan menumpuk.
 *
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */

const CACHE_TTL_MS = 30 * 1000; // 30 detik
// v3.10.0: Map guildId -> { roleId, expiresAt }. undefined/null roleId =
// "sudah dicek, tidak di-set" (beda dari "belum dicek" = tidak ada entry).
const adminRoleCache = new Map();

function getAdminRoleId(guildId) {
    // Tanpa konteks guild (mis. mock test tanpa guild, DM) → tidak ada
    // role admin yang bisa dicek; caller tetap bisa lolos via permission
    // Discord (ManageGuild/Administrator) di bawah.
    if (!guildId) return null;

    const now = Date.now();
    const hit = adminRoleCache.get(guildId);
    if (hit && now < hit.expiresAt) {
        return hit.roleId;
    }
    // Cache expired — baca ulang dari config guild ini
    let roleId = null;
    try {
        const config = getConfig(guildId);
        roleId = config.roles?.admin || null;
    } catch (_err) {
        // Defensive: kalau getConfig throw (mis. config rusak), anggap tidak ada admin role
        roleId = null;
    }
    adminRoleCache.set(guildId, { roleId, expiresAt: now + CACHE_TTL_MS });
    return roleId;
}

/**
 * Invalidate cache manual. Dipanggil saat admin role di-set/unset via /set-role
 * supaya perubahan langsung efektif tanpa nunggu TTL.
 * v3.10.0: bersihkan SEMUA guild (invalidateAdminRoleCache() tanpa argumen,
 * konsisten dengan pemanggilan dari configManager.setField dan
 * backupManager pasca-restore — keduanya tidak tahu guild mana yang berubah).
 */
function invalidateAdminRoleCache() {
    adminRoleCache.clear();
}

function isAdmin(member) {
    if (!member) return false;

    // Cek Discord permission langsung (paling andal, tidak butuh cache)
    if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
    if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;

    // Cek role admin dari config guild member (cached per-guild)
    const adminRoleId = member.guild?.id ? getAdminRoleId(member.guild.id) : null;
    if (adminRoleId && member.roles?.cache?.has(adminRoleId)) return true;

    return false;
}

module.exports = { isAdmin, invalidateAdminRoleCache };
