/**
 * Event: guildMemberUpdate — log perubahan role & nickname (v3.9.43).
 *
 * Kenapa penting di server jual-beli:
 *   - Role berubah = perubahan status akses (verified → revoked, atau dapat
 *     role "reseller" dadakan tanpa sepengetahuan owner).
 *   - Nickname berubah = pelaku penipuan ganti identitas supaya track record
 *     di vouch/warn-list susah dicocokkan.
 *
 * Guard:
 *   - oldMember bisa PARTIAL (belum ke-cache) → roles/nickname lama tidak
 *     tersedia; skip per-bagian (roles diff butuh oldMember.roles, nickname
 *     diff butuh oldMember.nickname — partial punya keduanya undefined).
 *   - Member bot → skip (bot ganti role saat startup/tools = noise).
 *   - Tidak ada perubahan → skip.
 *   - Patch partial (PartialTypes.GuildMember) → guildMemberUpdate v14
 *     selalu memberikan oldMember (cache) kecuali restart-kuah; aman dicek.
 */

const { Events } = require('discord.js');
const { logServerEvent, snip } = require('../../infra/serverLog');

async function onEvent(oldMember, newMember) {
    try {
        if (!newMember?.guild?.id) return;
        if (process.env.GUILD_ID && newMember.guild.id !== process.env.GUILD_ID) return;
        if (newMember.user?.bot) return;

        const hasOldState = !!(oldMember && oldMember.roles && oldMember.roles.cache);
        const user = newMember.user;

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
}

module.exports = {
    name: Events.GuildMemberUpdate,
    execute: onEvent
};
