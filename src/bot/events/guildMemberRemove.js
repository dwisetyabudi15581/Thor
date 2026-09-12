/**
 * GuildMemberRemove handler — delegate ke handlers/memberHandler.js (legacy)
 * + server log leave (v3.9.43).
 *
 * GuildMemberRemove nyala untuk leave biasa MAUPUN kick (kick = remove event).
 * Executor kick bisa dideteksi via audit log — kalau ketemu, label-nya "kick",
 * bukan "leave". Ini melengkapi /kick bot: kick manual dari UI Discord pun
 * kelihatan.
 */

const { Events, AuditLogEvent } = require('discord.js');
const { onMemberRemove } = require('../memberHandler');
const { logServerEvent, findAuditExecutor } = require('../../infra/serverLog');
// v3.12.0: guard GUILD_ID tunggal (mode 1 server / mode publik).
const { isGuildAllowed } = require('../../infra/guild');
// v3.9.51: channel counter server stats live.
const { markStatsDirty } = require('../../data/serverstatsManager');

async function onEvent(member) {
    try {
        // v3.9.26 → v3.12.0 (GUILD_ID tunggal): abaikan member dari guild
        // selain GUILD_ID di .env (GUILD_ID kosong = semua guild — mode publik).
        // v3.9.48: skip ini KELIHATAN (dulu return diam-diam).
        if (member.guild?.id && !isGuildAllowed(member.guild.id)) {
            console.warn(
                `⚠️ Leave member dari guild lain (ID: ${member.guild.id}) diabaikan — ID ini tidak sama dengan GUILD_ID di .env (mode 1 server). Goodbye hanya jalan di server itu.`
            );
            return;
        }
        await onMemberRemove(member);

        // v3.9.51: counter member/bot berubah — jalan SEBELUM return bot
        // (memberCount termasuk bot). No-op murah tanpa /serverstats setup.
        markStatsDirty(member.guild.id);

        // v3.9.43: server log leave/kick (best effort).
        if (member.user?.bot) return;

        // Kick detection: audit log MemberKick dengan target = user ini.
        let leaveKind = '📤 Leave (keluar sendiri)';
        try {
            const audit = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 5 });
            const { executorId, entry } = findAuditExecutor({
                entries: [...audit.entries.values()],
                targetId: member.user.id,
                windowMs: 60000
            });
            if (executorId) {
                leaveKind = `👢 Kick oleh <@${executorId}>${entry?.reason ? ` — alasan: ${entry.reason}` : ''}`;
            }
        } catch (_) {
            // tanpa ViewAuditLog — anggap leave biasa.
        }

        await logServerEvent(member.client, {
            type: 'MEMBER_LEAVE',
            guildId: member.guild.id,
            fields: [
                { name: '👤 Member', value: `<@${member.user.id}> (\`${member.user.tag}\`)`, inline: true },
                { name: '🚪 Status', value: leaveKind, inline: true },
                { name: '👥 Total member', value: `**${member.guild.memberCount}**`, inline: true }
            ],
            footer: `User ID: ${member.user.id}`
        });
    } catch (err) {
        console.error('GuildMemberRemove Error:', err);
    }
}

module.exports = {
    name: Events.GuildMemberRemove,
    execute: onEvent
};
