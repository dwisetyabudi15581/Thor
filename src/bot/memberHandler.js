/**
 * Member Handler — welcome/goodbye + auto-role unverified.
 *
 * Dipanggil oleh:
 *   - src/bot/events/guildMemberAdd.js
 *   - src/bot/events/guildMemberRemove.js
 *   - src/commands/config.js (/test-welcome preview, v3.9.48)
 *
 * Logic:
 *   - onMemberAdd: beri role Unverified + kirim welcome embed ke channel welcome.
 *   - onMemberRemove: cek audit log (kick/ban vs leave sukarela) + kirim goodbye embed.
 *
 * v3.9.0 FIX: skip bot account.
 * v3.9.8 FIX: AuditLogEvent enum (bukan magic number 20/22), 10s window (was 5s),
 *   separate fetchAuditLogs for kick & ban (more accurate, less data).
 * v3.9.48 FIX (laporan user: "welcome tidak muncul"): builder embed diekstrak
 *   (buildWelcomeEmbed / buildGoodbyeEmbed) supaya preview /test-welcome identik
 *   dengan event asli — dan setiap silent failure kini meninggalkan log yang
 *   bisa ditindaklanjuti. Sebelumnya, saat channels.welcome belum di-set, member
 *   join TANPA welcome dan TANPA baris log sama sekali — admin tidak punya petunjuk.
 */

const { EmbedBuilder, AuditLogEvent } = require('discord.js');
const { getConfig, fillTemplate } = require('../data/configManager');

/**
 * Variabel template welcome/goodbye (v3.9.48 — dipakai bersama oleh event
 * asli DAN preview /test-welcome supaya keduanya selalu identik).
 */
function memberVars(member, action = 'keluar') {
    const { guild, user } = member;
    return {
        user: `<@${user.id}>`,
        username: user.tag,
        server: guild.name,
        count: guild.memberCount,
        action
    };
}

/**
 * Bangun embed welcome (v3.9.48). Murni — tanpa efek samping, tanpa kirim.
 * Dipakai onMemberAdd (asli) dan /test-welcome (preview).
 */
function buildWelcomeEmbed(member, config) {
    const { guild, user } = member;
    const vars = memberVars(member);
    return new EmbedBuilder()
        .setTitle(fillTemplate(config.messages.welcomeTitle, vars))
        .setDescription(fillTemplate(config.messages.welcomeBody, vars))
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setColor(0x2ecc71)
        .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp();
}

/**
 * Bangun embed goodbye (v3.9.48). Murni — tanpa efek samping, tanpa kirim.
 * `action` = 'keluar' | 'dikeluarkan (kick)' | 'di-ban' (event asli mendeteksi
 * via audit log; preview /test-welcome memakai 'keluar').
 */
function buildGoodbyeEmbed(member, config, action = 'keluar') {
    const { guild, user } = member;
    const vars = memberVars(member, action);
    return new EmbedBuilder()
        .setTitle(fillTemplate(config.messages.goodbyeTitle, vars))
        .setDescription(fillTemplate(config.messages.goodbyeBody, vars))
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setColor(0xe74c3c)
        .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp();
}

async function onMemberAdd(member) {
    const { guild, user } = member;

    if (user.bot) return;

    const config = getConfig(guild.id);

    try {
        const { recordJoin } = require('../data/statsManager');
        recordJoin(guild.id, user.id);
    } catch (_) {}

    if (config.roles.unverified) {
        const unverifiedRole = guild.roles.cache.get(config.roles.unverified);
        if (unverifiedRole) {
            try {
                await member.roles.add(unverifiedRole);
                console.log(`✅ Role Unverified diberikan ke ${user.tag}`);
            } catch (err) {
                console.error(`❌ Gagal tambah role unverified untuk ${user.tag}:`, err.message);
            }
        } else {
            console.warn(`⚠️ Role unverified (ID: ${config.roles.unverified}) tidak ditemukan.`);
        }
    }

    // v3.9.48: fix silent failure — "welcome tidak muncul" TANPA baris log adalah
    // laporan support #1 yang mustahil dijelaskan. Setiap alasan skip kini
    // menyebut penyebab + perintah perbaikannya. (Path error kirim sudah log.)
    const welcomeId = config.channels.welcome;
    if (!welcomeId) {
        console.warn(
            `⚠️ ${user.tag} join, tapi channel welcome BELUM di-set — pesan welcome dilewati diam-diam. ` +
                `Solusi: /set-channel welcome #channel`
        );
        return;
    }
    const welcomeChannel = guild.channels.cache.get(welcomeId);
    if (!welcomeChannel) {
        console.warn(
            `⚠️ Channel welcome (ID: ${welcomeId}) tidak ditemukan — sudah dihapus, atau ID milik server lain. ` +
                `Solusi: /set-channel welcome #channel`
        );
        return;
    }

    const embed = buildWelcomeEmbed(member, config);

    try {
        await welcomeChannel.send({ content: `<@${user.id}>`, embeds: [embed] });
        console.log(`👋 Welcome terkirim untuk ${user.tag} di #${welcomeChannel.name || welcomeChannel.id}`);
    } catch (err) {
        console.error(
            `❌ Gagal kirim welcome message di #${welcomeChannel.name || welcomeChannel.id}: ${err.message}\n` +
                `   Cek permission Send Messages + Embed Links bot di channel tsb. `
        );
    }
}

async function onMemberRemove(member) {
    const { guild, user } = member;

    if (user.bot) return;

    const config = getConfig(guild.id);

    // v3.9.48: fix silent failure (pola sama dengan welcome di atas) — member
    // keluar tanpa goodbye DAN tanpa log membuat admin menebak-nebak.
    if (!config.channels.goodbye) {
        console.warn(
            `⚠️ ${user.tag} keluar, tapi channel goodbye BELUM di-set — pesan goodbye dilewati diam-diam. ` +
                `Solusi: /set-channel goodbye #channel`
        );
        return;
    }
    const goodbyeChannel = guild.channels.cache.get(config.channels.goodbye);
    if (!goodbyeChannel) {
        console.warn(
            `⚠️ Channel goodbye (ID: ${config.channels.goodbye}) tidak ditemukan — sudah dihapus, atau ID milik server lain. ` +
                `Solusi: /set-channel goodbye #channel`
        );
        return;
    }

    let action = 'keluar';
    const AUDIT_WINDOW_MS = 10 * 1000;
    try {
        const audits = await guild.fetchAuditLogs({
            type: AuditLogEvent.MemberKick,
            limit: 5
        });
        const kickEntry = audits.entries.find(
            e => e.target?.id === user.id && Date.now() - e.createdTimestamp < AUDIT_WINDOW_MS
        );
        if (kickEntry) {
            action = 'dikeluarkan (kick)';
        } else {
            const banAudits = await guild.fetchAuditLogs({
                type: AuditLogEvent.MemberBanAdd,
                limit: 5
            });
            const banEntry = banAudits.entries.find(
                e => e.target?.id === user.id && Date.now() - e.createdTimestamp < AUDIT_WINDOW_MS
            );
            if (banEntry) {
                action = 'di-ban';
            }
        }
    } catch (err) {
        console.warn(
            `⚠️ Tidak bisa akses audit log untuk goodbye <@${user.id}>: ${err.message?.slice(0, 80)}. ` +
                `Pastikan bot punya permission View Audit Log.`
        );
    }

    const embed = buildGoodbyeEmbed(member, config, action);

    try {
        await goodbyeChannel.send({ embeds: [embed] });
        console.log(`👋 Goodbye terkirim untuk ${user.tag} di #${goodbyeChannel.name || goodbyeChannel.id}`);
    } catch (err) {
        console.error(
            `❌ Gagal kirim goodbye message di #${goodbyeChannel.name || goodbyeChannel.id}: ${err.message}\n` +
                `   Cek permission Send Messages + Embed Links bot di channel tsb. `
        );
    }
}

module.exports = { onMemberAdd, onMemberRemove, buildWelcomeEmbed, buildGoodbyeEmbed };
