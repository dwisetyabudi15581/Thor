/**
 * Event: messageUpdate (edit) — log before/after ke server-log channel.
 *
 * Kasus nyata di server jual-beli: penjual edit harga SETELAH deal agreed
 * ("kan tadi bilang 50rb" → bukti before/after), penipu edit bukti transfer,
 * atau member edit pesan jadi kata kasar setelah lolos baca awal.
 *
 * Catatan desain:
 *   - Executor TIDAK dicari di audit log — Discord tidak mencatat edit
 *     pesan member biasa di audit log (hanya delete oleh moderator).
 *     Author pasti pelaku edit (kecuali integrasi webhook admin).
 *   - Edit embed saja (content kosong) → skip (bot sendiri sering begini).
 *   - Guard: DM, GUILD_ID, pesan bot, partial tanpa konten lama → skip.
 */

const { Events } = require('discord.js');
const { logServerEvent, snip } = require('../../infra/serverLog');

async function onEvent(oldMessage, newMessage) {
    try {
        const msg = newMessage || oldMessage;
        if (!msg.guild?.id) return; // DM
        if (process.env.GUILD_ID && msg.guild.id !== process.env.GUILD_ID) return;
        if (msg.author?.bot) return;

        // Embed-only edit (content kosong di kedua versi) → skip.
        const oldC = oldMessage?.content || '';
        const newC = newMessage?.content || '';
        if (!oldC && !newC) return;
        // Tidak berubah (event nyala buat embed change / pin) → skip.
        if (oldC === newC) return;

        // Partial lama tanpa konten → before tidak bisa ditunjukkan.
        const before = oldC ? snip(oldC) : '_(pesan lama tidak di-cache)_';
        const after = newC ? snip(newC) : '_(dihapus / embed saja)_';

        await logServerEvent(msg.client, {
            type: 'MSG_EDIT',
            guildId: msg.guild.id,
            fields: [
                { name: '✍️ Pengirim', value: `<@${msg.author.id}> (\`${msg.author.tag}\`)`, inline: true },
                { name: '📍 Channel', value: `<#${msg.channel.id}> (\`#${msg.channel.name || '?'}\`)`, inline: true },
                { name: '🔗 Pesan', value: `[Lihat pesan](${msg.url})`, inline: true },
                { name: '📄 Sebelum', value: before },
                { name: '📄 Sesudah', value: after }
            ],
            footer: `Author ID: ${msg.author.id} | Message ID: ${msg.id}`
        });
    } catch (err) {
        console.error('MessageUpdate log error:', err.message);
    }
}

module.exports = {
    name: Events.MessageUpdate,
    execute: onEvent
};
