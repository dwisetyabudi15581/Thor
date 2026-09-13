/**
 * Event: guildBanAdd — log SEMUA ban yang terjadi di server (v3.9.43).
 *
 * Nilai tambah vs /ban bot: ini juga menangkap ban manual lewat UI Discord
 * (klik kanan user → Ban) — tanpa event ini, ban manual tidak kelihatan
 * di log bot sama sekali. Executor + reason diambil dari audit log entry.
 */

const { Events, AuditLogEvent } = require('discord.js');
const { logServerEvent, findAuditExecutor, snip } = require('../../infra/serverLog');
// v3.12.0: guard GUILD_ID tunggal (mode 1 server / mode publik).
const { isGuildAllowed } = require('../../infra/guild');

async function onEvent(ban) {
    try {
        const { guild, user, reason } = ban;
        if (!guild?.id) return;
        // v3.12.0: guard GUILD_ID tunggal — guild yang tidak cocok dengan
        // GUILD_ID di .env diabaikan; GUILD_ID kosong = mode publik (semua guild).
        if (!isGuildAllowed(guild.id)) return;

        // Executor + reason resmi dari audit log (reason param event sering null
        // kalau ban manual dari UI — audit log lebih lengkap).
        let executorLine = '❔ Tidak diketahui';
        let auditReason = reason || null;
        try {
            const audit = await guild.fetchAuditLogs({ type: AuditLogEvent.Ban, limit: 5 });
            const { entry } = findAuditExecutor({
                entries: [...audit.entries.values()],
                targetId: user.id,
                windowMs: 60000
            });
            if (entry) {
                if (entry.executorId) executorLine = `👮 <@${entry.executorId}>`;
                if (entry.reason) auditReason = entry.reason;
            }
        } catch (_) {
            // tanpa ViewAuditLog — biarkan default.
        }

        await logServerEvent(guild.client, {
            type: 'BAN_ADD',
            guildId: guild.id,
            fields: [
                { name: '👤 User', value: `<@${user.id}> (\`${user.tag}\`)`, inline: true },
                { name: '🔨 Oleh', value: executorLine, inline: true },
                { name: '📝 Alasan', value: auditReason ? snip(auditReason, 500) : '_(tanpa alasan)_' }
            ],
            footer: `User ID: ${user.id}`
        });
    } catch (err) {
        console.error('GuildBanAdd log error:', err.message);
    }
}

module.exports = {
    name: Events.GuildBanAdd,
    execute: onEvent
};
