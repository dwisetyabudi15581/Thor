/**
 * Event: guildBanRemove — log pencabutan ban (v3.9.43).
 *
 * Menangkap unban dari /unban bot MAUPUN unban manual lewat Server Settings
 * → Bans. Penting buat audit: "siapa yang kasih penipu ini kesempatan kedua?"
 */

const { Events, AuditLogEvent } = require('discord.js');
const { logServerEvent, findAuditExecutor, snip } = require('../../infra/serverLog');
// v3.12.0: guard GUILD_ID tunggal (mode 1 server / mode publik).
const { isGuildAllowed } = require('../../infra/guild');

async function onEvent(ban) {
    try {
        const { guild, user } = ban;
        if (!guild?.id) return;
        // v3.12.0: guard GUILD_ID tunggal — guild yang tidak cocok dengan
        // GUILD_ID di .env diabaikan; GUILD_ID kosong = mode publik (semua guild).
        if (!isGuildAllowed(guild.id)) return;

        let executorLine = '❔ Tidak diketahui';
        let reason = null;
        try {
            const audit = await guild.fetchAuditLogs({ type: AuditLogEvent.Unban, limit: 5 });
            const { entry } = findAuditExecutor({
                entries: [...audit.entries.values()],
                targetId: user.id,
                windowMs: 60000
            });
            if (entry) {
                if (entry.executorId) executorLine = `👮 <@${entry.executorId}>`;
                if (entry.reason) reason = entry.reason;
            }
        } catch (_) {
            // tanpa ViewAuditLog — biarkan default.
        }

        await logServerEvent(guild.client, {
            type: 'BAN_REMOVE',
            guildId: guild.id,
            fields: [
                { name: '👤 User', value: `<@${user.id}> (\`${user.tag}\`)`, inline: true },
                { name: '♻️ Oleh', value: executorLine, inline: true },
                { name: '📝 Alasan', value: reason ? snip(reason, 500) : '_(tanpa alasan)_', inline: true }
            ],
            footer: `User ID: ${user.id}`
        });
    } catch (err) {
        console.error('GuildBanRemove log error:', err.message);
    }
}

module.exports = {
    name: Events.GuildBanRemove,
    execute: onEvent
};
