/**
 * Event: guildMemberUpdate — log perubahan role & nickname (v3.9.43) +
 * deteksi BOOST SERVER tambah/hilang (v3.9.49) + auto role booster (v3.9.59).
 *
 * Kenapa penting di server jual-beli:
 *   - Role berubah = perubahan status akses (verified → revoked, atau dapat
 *     role "reseller" dadakan tanpa sepengetahuan owner).
 *   - Nickname berubah = pelaku penipuan ganti identitas supaya track record
 *     di vouch/warn-list susah dicocokkan.
 *   - Boost berubah (v3.9.49) = siapa yang sedang mendukung server — Discord
 *     TIDAK punya event boost khusus, jadi tambah/hilangnya boost dideteksi
 *     di sini lewat diff premium_since (null → tanggal = boost baru,
 *     tanggal → null = boost berakhir).
 *   - Role Booster otomatis (v3.9.59) = role custom admin diberikan/dihapus
 *     mengikuti status boost — penugasan role di sini memicu event
 *     guildMemberUpdate LAGI (diff role saja, premium_since tidak berubah),
 *     jadi tidak ada rekursi: event kedua cuma meng-log ROLE_UPDATE.
 *
 * Guard:
 *   - oldMember bisa PARTIAL (belum ke-cache) → roles/nickname/premium lama
 *     tidak tersedia; skip per-bagian (roles diff butuh oldMember.roles,
 *     nickname diff butuh oldMember.nickname, boost diff butuh
 *     oldMember.premiumSinceTimestamp — partial punya semuanya undefined).
 *   - Member bot → skip (bot ganti role saat startup/tools = noise; bot juga
 *     tidak bisa boost).
 *   - Tidak ada perubahan → skip.
 *   - Patch partial (PartialTypes.GuildMember) → guildMemberUpdate v14
 *     selalu memberikan oldMember (cache) kecuali restart-kuah; aman dicek.
 */

const { Events } = require('discord.js');
const { logServerEvent, snip } = require('../../infra/serverLog');
// v3.11.0: guard allowlist multi-guild (fase 2).
const { isGuildAllowed } = require('../../infra/guild');
// v3.9.49: notifikasi boost (channel server-booster + server log + riwayat).
// v3.9.59: applyBoostRole — auto role booster (dipanggil SETELAH notifikasi
// supaya riwayat tetap tercatat walau penugasan role gagal).
const { onBoostChange, applyBoostRole } = require('../boostHandler');
// v3.9.51: channel counter server stats live (counter Boost berubah saat
// boost ditambah/dihentikan).
const { markStatsDirty } = require('../../data/serverstatsManager');

async function onEvent(oldMember, newMember) {
    try {
        if (!newMember?.guild?.id) return;
        // v3.11.0: guard allowlist — guild di luar ALLOWED_GUILD_IDS (fallback
        // GUILD_ID) diabaikan; daftar kosong = mode terbuka (semua guild diproses).
        if (!isGuildAllowed(newMember.guild.id)) return;
        if (newMember.user?.bot) return;

        const hasOldState = !!(oldMember && oldMember.roles && oldMember.roles.cache);
        const user = newMember.user;

        // === 0. Diff boost (v3.9.49) — dicek PERTAMA supaya boost yang datang
        // bersamaan dengan role change (role Server Booster bawaan Discord)
        // tidak menutupinya. oldMember partial → premiumSinceTimestamp
        // undefined → tak bisa dibandingkan → skip. ===
        if (hasOldState && oldMember.premiumSinceTimestamp !== newMember.premiumSinceTimestamp) {
            const wasBoosting = oldMember.premiumSinceTimestamp !== null && oldMember.premiumSinceTimestamp !== undefined;
            const isBoosting = newMember.premiumSinceTimestamp !== null && newMember.premiumSinceTimestamp !== undefined;
            if (!wasBoosting && isBoosting) {
                await onBoostChange(newMember, 'add', null);
                // v3.9.59: auto role booster — member yang boost dapat role-nya.
                await applyBoostRole(newMember, 'add');
            } else if (wasBoosting && !isBoosting) {
                await onBoostChange(newMember, 'remove', oldMember.premiumSinceTimestamp);
                // v3.9.59: boost berakhir → role dihapus (semantik role
                // Server Booster bawaan Discord).
                await applyBoostRole(newMember, 'remove');
            }
        }

        // === 1. Role diff (butuh state lama ter-cache) ===
        if (hasOldState) {
            const added = [...newMember.roles.cache.values()].filter(
                r => !oldMember.roles.cache.has(r.id)
            );
            const removed = [...oldMember.roles.cache.values()].filter(
                r => !newMember.roles.cache.has(r.id)
            );
            if (added.length > 0 || removed.length > 0) {
                const lines = [];
                if (added.length > 0) lines.push(`➕ ${added.map(r => `\`${r.name}\``).join(', ')}`);
                if (removed.length > 0) lines.push(`➖ ${removed.map(r => `\`${r.name}\``).join(', ')}`);
                await logServerEvent(newMember.client, {
                    type: 'ROLE_UPDATE',
                    guildId: newMember.guild.id,
                    fields: [
                        { name: '👤 Member', value: `<@${user.id}> (\`${user.tag}\`)`, inline: true },
                        { name: '🎭 Perubahan', value: snip(lines.join('\n'), 500) }
                    ],
                    footer: `User ID: ${user.id}`
                });
            }
        }

        // === 2. Nickname diff (oldMember partial → nickname undefined → skip) ===
        if (hasOldState && oldMember.nickname !== newMember.nickname) {
            const before = oldMember.nickname || user.username;
            const after = newMember.nickname || user.username;
            await logServerEvent(newMember.client, {
                type: 'NICK_UPDATE',
                guildId: newMember.guild.id,
                fields: [
                    { name: '👤 Member', value: `<@${user.id}> (\`${user.tag}\`)`, inline: true },
                    { name: '📝 Sebelum', value: snip(before, 200), inline: true },
                    { name: '📝 Sesudah', value: snip(after, 200), inline: true }
                ],
                footer: `User ID: ${user.id}`
            });
        }
    } catch (err) {
        console.error('GuildMemberUpdate log error:', err.message);
    }

    // v3.9.51: perubahan boost (atau update member apa pun yang menggeser
    // angka) menandai counter server stats dirty. Ditaruh DI LUAR try di atas
    // supaya kegagalan server-log tidak melewatkan update counter. No-op murah
    // tanpa /serverstats setup.
    try {
        markStatsDirty(newMember?.guild?.id);
    } catch (_) {}
}

module.exports = {
    name: Events.GuildMemberUpdate,
    execute: onEvent
};
