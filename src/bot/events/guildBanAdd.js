/**
 * Event: guildBanAdd — log SEMUA ban yang terjadi di server (v3.9.43).
 *
 * Nilai tambah vs /ban bot: ini juga menangkap ban manual lewat UI Discord
 * (klik kanan user → Ban) — tanpa event ini, ban manual tidak kelihatan
 * di log bot sama sekali. Executor + reason diambil dari audit log entry.
 */

const { Events, AuditLogEvent } = require('discord.js');
const { logServerEvent, findAuditExecutor, snip } = require('../../infra/serverLog');
// v3.11.0: guard allowlist multi-guild (fase 2).
const { isGuildAllowed } = require('../../infra/guild');

async function onEvent(ban) {
    try {
        const { guild, user, reason } = ban;
        if (!guild?.id) return;
        // v3.11.0: guard allowlist — guild di luar ALLOWED_GUILD_IDS (fallback
        // GUILD_ID) diabaikan; daftar kosong = mode terbuka (semua guild diproses).
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
