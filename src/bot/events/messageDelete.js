/**
 * Event: messageDelete — log pesan yang dihapus ke server-log channel.
 *
 * Kenapa penting: ini satu-satunya cara tahu isi pesan yang sudah dihapus
 * (bukti penipuan yang dihapus, iklan spam yang dibersihkan, pesan toxic
 * yang dihapus pelakunya sendiri). Audit log Discord native tidak menyimpan
 * isi pesan.
 *
 * Executor detection (v3.9.43): fetch audit log Action MessageDelete →
 * kalau ketemu, tampilkan siapa yang menghapus (admin). Kalau tidak ketemu
 * (permission ViewAuditLog tidak ada / entry belum ter-index / author
 * menghapus sendiri) → tampilkan "tidak diketahui / penghapus sendiri".
 *
 * Guard:
 *   - DM (bukan guild) → skip.
 *   - Single-guild: GUILD_ID mismatch → skip (pattern v3.9.26).
 *   - Pesan bot → skip (log bakal kebanjiran sama embed bot sendiri —
 *     termasuk pesan panel/announce yang memang by design).
 *   - Partial message → konten mungkin kosong: tetap log dengan catatan
 *     "(pesan tidak di-cache)".
 *   - Gagal fetch audit log (permission) → lanjut tanpa executor.
 *   - logServerEvent tidak pernah throw (kontrak serverLog.js).
 */

const { Events, AuditLogEvent } = require('discord.js');
const { logServerEvent, findAuditExecutor, snip } = require('../../infra/serverLog');
// v3.12.0: guard GUILD_ID tunggal (mode 1 server / mode publik).
const { isGuildAllowed } = require('../../infra/guild');

async function onEvent(message) {
    try {
        if (!message.guild?.id) return; // DM
        // v3.12.0: guard GUILD_ID tunggal — guild yang tidak cocok dengan
        // GUILD_ID di .env diabaikan; GUILD_ID kosong = mode publik (semua guild).
        if (!isGuildAllowed(message.guild.id)) return;
        if (message.author?.bot) return; // jangan log pesan bot (spam log sendiri)

        // Executor: siapa yang hapus? (try/catch — permission bisa absen)
        let executorLine = '❔ Tidak diketahui (bisa jadi dihapus sendiri)';
        try {
            const audit = await message.guild.fetchAuditLogs({
                type: AuditLogEvent.MessageDelete,
                limit: 5
            });
            const { executorId } = findAuditExecutor({
                entries: [...audit.entries.values()],
                targetId: message.author?.id || null,
                channelId: message.channel?.id || null,
                windowMs: 60000
            });
            if (executorId && executorId !== message.author?.id) {
                executorLine = `👮 <@${executorId}>`;
            } else if (executorId) {
                executorLine = `✍️ <@${executorId}> (pengirim sendiri)`;
            }
        } catch (_) {
            // ViewAuditLog tidak dimiliki bot — biarkan "tidak diketahui".
        }

        const content = message.content
            ? snip(message.content)
            : '_(pesan tidak di-cache / tanpa teks — embed/attachment)_';

        await logServerEvent(message.client, {
            type: 'MSG_DELETE',
            guildId: message.guild.id,
            fields: [
                { name: '✍️ Pengirim', value: message.author ? `<@${message.author.id}> (\`${message.author.tag}\`)` : '❔ unknown', inline: true },
                { name: '📍 Channel', value: `<#${message.channel.id}> (\`#${message.channel.name || '?'}\`)`, inline: true },
                { name: '🗑️ Dihapus oleh', value: executorLine, inline: true },
                { name: '📄 Isi pesan', value: content }
            ],
            footer: `Author ID: ${message.author?.id || '?'} | Channel ID: ${message.channel?.id || '?'}`
        });
    } catch (err) {
        console.error('MessageDelete log error:', err.message);
    }
}

module.exports = {
    name: Events.MessageDelete,
    execute: onEvent
};
