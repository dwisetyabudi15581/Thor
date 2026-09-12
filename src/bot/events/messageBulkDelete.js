/**
 * Event: messageBulkDelete — log penghapusan massal ke server-log channel.
 *
 * Sumber event: /purge bot, bulk delete manual lewat UI Discord (klik kanan
 * channel → Delete Messages), atau action AutoMod. Audit log MOD_PURGE hanya
 * mencatat purge via bot — event ini menangkap SEMUA sumber + jumlah pastinya.
 *
 * Executor: audit log MessageBulkDelete → entry.extra punya count + channel.
 */

const { Events, AuditLogEvent } = require('discord.js');
const { logServerEvent, findAuditExecutor } = require('../../infra/serverLog');
// v3.11.0: guard allowlist multi-guild (fase 2).
const { isGuildAllowed } = require('../../infra/guild');

async function onEvent(messages) {
    try {
        // v14 bisa kirim Collection atau MessageBulkDeleteOptions ({channel, messages}).
        const coll = messages?.messages || messages;
        const channel = messages?.channel || coll?.first()?.channel;
        const guild = channel?.guild || coll?.first()?.guild;
        if (!guild?.id) return;
        // v3.11.0: guard allowlist — guild di luar ALLOWED_GUILD_IDS (fallback
        // GUILD_ID) diabaikan; daftar kosong = mode terbuka (semua guild diproses).
        if (!isGuildAllowed(guild.id)) return;

        const count = typeof coll?.size === 'number' ? coll.size : 0;
        if (count === 0) return;

        // Executor dari audit log (best effort).
        let executorLine = '❔ Tidak diketahui';
        try {
            const audit = await guild.fetchAuditLogs({
                type: AuditLogEvent.MessageBulkDelete,
                limit: 3
            });
            const { executorId } = findAuditExecutor({
                entries: [...audit.entries.values()],
                channelId: channel.id,
                windowMs: 60000
            });
            if (executorId) executorLine = `👮 <@${executorId}>`;
        } catch (_) {
            // tanpa ViewAuditLog — biarkan default.
        }

        await logServerEvent(guild.client, {
            type: 'MSG_BULK',
            guildId: guild.id,
            fields: [
                { name: '📍 Channel', value: `<#${channel.id}> (\`#${channel.name || '?'}\`)`, inline: true },
                { name: '#️⃣ Jumlah', value: `**${count}** pesan`, inline: true },
                { name: '🧹 Oleh', value: executorLine, inline: true }
            ],
            footer: `Channel ID: ${channel.id}`
        });
    } catch (err) {
        console.error('MessageBulkDelete log error:', err.message);
    }
}

module.exports = {
    name: Events.MessageBulkDelete,
    execute: onEvent
};
