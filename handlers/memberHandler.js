const { EmbedBuilder } = require('discord.js');
const { getConfig, fillTemplate } = require('../utils/configManager');

/**
 * Member join:
 * 1. Beri role Unverified otomatis
 * 2. Kirim embed welcome ke channel welcome (pakai template pesan)
 */
async function onMemberAdd(member) {
    const { guild, user } = member;
    const config = getConfig();

    // Track join untuk stats
    try {
        const { recordJoin } = require('../utils/statsManager');
        recordJoin(user.id);
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
 */
async function onMemberRemove(member) {
    const { guild, user } = member;
    const config = getConfig();

    if (!config.channels.goodbye) return;
    const goodbyeChannel = guild.channels.cache.get(config.channels.goodbye);
    if (!goodbyeChannel) {
        console.warn(`⚠️ Channel goodbye (ID: ${config.channels.goodbye}) tidak ditemukan.`);
        return;
    }

    // Cek audit log - apakah di-kick atau di-ban?
    // P2-7 FIX: sebelumnya cuma fetch 1 entry + cek kick (type 20) saja.
    // Sekarang: fetch 10 entry terbaru, cek kick (20) + ban (22),
    // dan cocokkan by target.id (lebih akurat kalau ada multiple leave).
    let action = 'keluar';
    const AUDIT_WINDOW_MS = 5 * 1000;
    try {
        const audits = await guild.fetchAuditLogs({ limit: 10, type: 20 }); // MEMBER_KICK
        const kickEntry = audits.entries.find(e =>
            e.target?.id === user.id &&
            (Date.now() - e.createdTimestamp) < AUDIT_WINDOW_MS
        );
        if (kickEntry) {
            action = 'dikeluarkan (kick)';
        } else {
            // Cek juga ban (type 22)
            const banAudits = await guild.fetchAuditLogs({ limit: 10, type: 22 }).catch(() => null);
            const banEntry = banAudits?.entries?.find(e =>
                e.target?.id === user.id &&
                (Date.now() - e.createdTimestamp) < AUDIT_WINDOW_MS
            );
            if (banEntry) {
                action = 'di-ban';
            }
        }
    } catch (_) { /* abaikan — mungkin tidak punya ViewAuditLog permission */ }

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
