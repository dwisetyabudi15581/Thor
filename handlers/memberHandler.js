const { EmbedBuilder, AuditLogEvent } = require('discord.js');
const { getConfig, fillTemplate } = require('../src/data/configManager');

/**
 * Member join:
 * 1. Beri role Unverified otomatis
 * 2. Kirim embed welcome ke channel welcome (pakai template pesan)
 *
 * v3.9.0 FIX: skip bot account (sebelumnya bot yang join juga dapat role unverified + welcome ping).
 */
async function onMemberAdd(member) {
    const { guild, user } = member;

    // v3.9.0: Skip bot account — bot tidak perlu welcome/verify
    if (user.bot) return;

    const config = getConfig();

    // Track join untuk stats
    try {
        const { recordJoin } = require('../src/data/statsManager');
        // v3.9.4: scoped per guild
        recordJoin(guild.id, user.id);
    } catch (_) {}

    // === 1. Beri role Unverified ===
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

    // === 2. Kirim Welcome Message ===
    if (config.channels.welcome) {
        const welcomeChannel = guild.channels.cache.get(config.channels.welcome);
        if (welcomeChannel) {
            const vars = {
                user: `<@${user.id}>`,
                username: user.tag,
                server: guild.name,
                count: guild.memberCount
            };

            const embed = new EmbedBuilder()
                .setTitle(fillTemplate(config.messages.welcomeTitle, vars))
                .setDescription(fillTemplate(config.messages.welcomeBody, vars))
                .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
                .setColor(0x2ECC71)
                .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) || undefined })
                .setTimestamp();

            try {
                await welcomeChannel.send({ content: `<@${user.id}>`, embeds: [embed] });
            } catch (err) {
                console.error('❌ Gagal kirim welcome message:', err.message);
            }
        } else {
            console.warn(`⚠️ Channel welcome (ID: ${config.channels.welcome}) tidak ditemukan.`);
        }
    }
}

/**
 * Member keluar:
 * - Deteksi kick vs leave sukarela via audit log
 * - Kirim embed goodbye ke channel goodbye (pakai template pesan)
 *
 * v3.9.0 FIX:
 *   1. Skip bot account.
 *   2. Single fetchAuditLogs call (sebelumnya 2x — kick + ban terpisah).
 *      Diskripsi: ambil 10 entry terbaru tanpa type filter, filter client-side.
 *      Hemat 1 API call per member leave + lebih sedikit rate limit pressure.
 *   3. Kalau fetchAuditLogs throw karena missing ViewAuditLog permission,
 *      log warning sekali (bukan silent catch) supaya admin sadar.
 */
async function onMemberRemove(member) {
    const { guild, user } = member;

    // v3.9.0: Skip bot account
    if (user.bot) return;

    const config = getConfig();

    if (!config.channels.goodbye) return;
    const goodbyeChannel = guild.channels.cache.get(config.channels.goodbye);
    if (!goodbyeChannel) {
        console.warn(`⚠️ Channel goodbye (ID: ${config.channels.goodbye}) tidak ditemukan.`);
        return;
    }

    // Cek audit log - apakah di-kick atau di-ban?
    // v3.9.0: single fetchAuditLogs call, filter client-side untuk kick (20) dan ban (22).
    // v3.9.8: pakai AuditLogEvent enum (bukan magic number 20/22) supaya lebih readable.
    let action = 'keluar';
    const AUDIT_WINDOW_MS = 10 * 1000;  // v3.9.8: naikkan dari 5s ke 10s (lebih toleran latency)
    try {
        const audits = await guild.fetchAuditLogs({
            type: AuditLogEvent.MemberKick,
            limit: 5
        });
        const kickEntry = audits.entries.find(e =>
            e.target?.id === user.id &&
            (Date.now() - e.createdTimestamp) < AUDIT_WINDOW_MS
        );
        if (kickEntry) {
            action = 'dikeluarkan (kick)';
        } else {
            // Cek ban terpisah (kalau tidak ada kick)
            const banAudits = await guild.fetchAuditLogs({
                type: AuditLogEvent.MemberBanAdd,
                limit: 5
            });
            const banEntry = banAudits.entries.find(e =>
                e.target?.id === user.id &&
                (Date.now() - e.createdTimestamp) < AUDIT_WINDOW_MS
            );
            if (banEntry) {
                action = 'di-ban';
            }
        }
    } catch (err) {
        // v3.9.0: log warning (bukan silent) supaya admin sadar kalau bot kekurangan permission.
        // Tapi jangan spam — hanya log sekali per event dengan pesan singkat.
        console.warn(`⚠️ Tidak bisa akses audit log untuk goodbye <@${user.id}>: ${err.message?.slice(0, 80)}. ` +
            `Pastikan bot punya permission View Audit Log.`);
    }

    const vars = {
        user: `<@${user.id}>`,
        username: user.tag,
        server: guild.name,
        count: guild.memberCount,
        action
    };

    const embed = new EmbedBuilder()
        .setTitle(fillTemplate(config.messages.goodbyeTitle, vars))
        .setDescription(fillTemplate(config.messages.goodbyeBody, vars))
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setColor(0xE74C3C)
        .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp();

    try {
        await goodbyeChannel.send({ embeds: [embed] });
    } catch (err) {
        console.error('❌ Gagal kirim goodbye message:', err.message);
    }
}

module.exports = { onMemberAdd, onMemberRemove };
