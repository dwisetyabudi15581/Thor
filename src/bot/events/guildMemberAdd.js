/**
 * GuildMemberAdd handler — delegate ke handlers/memberHandler.js (legacy)
 * + server log join (v3.9.43).
 *
 * Server log join = record audit (siapa masuk, kapan, umur akun) — tujuannya
 * beda dengan welcome embed (sapaan publik). Welcome channel bisa sama-sama
 * keisi; kalau mau terpisah, set channel server-log beda dari welcome.
 */

const { Events } = require('discord.js');
const { onMemberAdd } = require('../memberHandler');
const { logServerEvent } = require('../../infra/serverLog');
// v3.12.0: guard GUILD_ID tunggal (mode 1 server / mode publik).
const { isGuildAllowed } = require('../../infra/guild');
// v3.9.51: channel counter server stats live.
const { markStatsDirty } = require('../../data/serverstatsManager');

async function onEvent(member) {
    try {
        // v3.9.26 → v3.12.0 (GUILD_ID tunggal): abaikan member dari guild
        // selain GUILD_ID di .env (GUILD_ID kosong = semua guild — mode publik).
        // v3.9.48: skip ini KELIHATAN (dulu return diam-diam — member join di
        // guild lain & admin tidak tahu kenapa welcome tidak muncul).
        if (member.guild?.id && !isGuildAllowed(member.guild.id)) {
            console.warn(
                `⚠️ Join member dari guild lain (ID: ${member.guild.id}) diabaikan — ID ini tidak sama dengan GUILD_ID di .env (mode 1 server). Welcome hanya jalan di server itu.`
            );
            return;
        }
        await onMemberAdd(member);

        // v3.9.51: counter member berubah (memberCount termasuk bot, jadi ini
        // harus jalan SEBELUM return bot di bawah). No-op murah saat counter
        // /serverstats belum di-setup.
        markStatsDirty(member.guild.id);

        // v3.9.43: server log join (best effort — tidak boleh gagalkan welcome).
        if (member.user?.bot) return; // bot join = invite integration, bukan member
        const accountAgeSec = Math.floor((Date.now() - member.user.createdTimestamp) / 1000);
        await logServerEvent(member.client, {
            type: 'MEMBER_JOIN',
            guildId: member.guild.id,
            fields: [
                { name: '👤 Member', value: `<@${member.user.id}> (\`${member.user.tag}\`)`, inline: true },
                { name: '🎉 Akun dibuat', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R> (<t:${Math.floor(member.user.createdTimestamp / 1000)}:d>)`, inline: true },
                { name: '👥 Total member', value: `**${member.guild.memberCount}**`, inline: true }
            ],
            footer: `User ID: ${member.user.id} | Umur akun: ${accountAgeSec >= 86400 ? `${Math.floor(accountAgeSec / 86400)} hari` : 'baru'}`
        });
    } catch (err) {
        console.error('GuildMemberAdd Error:', err);
    }
}

module.exports = {
    name: Events.GuildMemberAdd,
    execute: onEvent
};
