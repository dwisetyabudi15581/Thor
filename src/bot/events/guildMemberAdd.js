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

async function onEvent(member) {
    try {
        // v3.9.26 (single-guild hardening): abaikan member dari guild lain.
        // v3.9.48: skip ini kini KELIHATAN (dulu return diam-diam — member join di
        // guild lain & admin tidak tahu kenapa welcome tidak muncul).
        if (process.env.GUILD_ID && member.guild?.id && member.guild.id !== process.env.GUILD_ID) {
            console.warn(
                `⚠️ Join member dari guild lain (ID: ${member.guild.id}) diabaikan — GUILD_ID di-set ke server yang berbeda. Welcome hanya jalan di guild GUILD_ID.`
            );
            return;
        }
        await onMemberAdd(member);

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
