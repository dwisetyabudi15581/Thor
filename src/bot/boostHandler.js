/**
 * Boost Handler — notifikasi server booster (v3.9.49).
 *
 * Dipanggil oleh:
 *   - src/bot/events/guildMemberUpdate.js (deteksi boost add/remove live)
 *   - src/commands/stats.js (daftar /boosters — pakai builder embed yang sama)
 *
 * Logika:
 *   - Boost TAMBAH (premium_since: null → tanggal): embed perayaan pink ke
 *     channel server-booster + entri BOOST_ADD di server log.
 *   - Boost HILANG (premium_since: tanggal → null): embed abu-abu + entri
 *     BOOST_REMOVE di server log.
 *
 * Pola diagnosabilitas v3.9.48: setiap alasan skip meninggalkan log penyebab +
 * perintah solusi, dan gagal kirim menyebut channel + permission yang persis
 * harus dicek. Boost tanpa notifikasi DAN tanpa baris log tidak boleh terjadi.
 */

const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('../data/configManager');
const { logServerEvent } = require('../infra/serverLog');

const BOOST_PINK = 0xf472b6;
const BOOST_GRAY = 0x95a5a6;

/**
 * Build the boost-started embed. Pure — no side effects, no send.
 * @param {Object} member - discord.js GuildMember
 */
function buildBoostAddEmbed(member) {
    const { guild, user } = member;
    const tierText =
        guild.premiumTier && guild.premiumTier > 0
            ? `Level Server **${guild.premiumTier}** · total ${guild.premiumSubscriptionCount ?? 0} boost`
            : 'Level Server 0 (menuju Level 1!)';
    return new EmbedBuilder()
        .setTitle('🚀 BOOST SERVER BARU!')
        .setDescription(`**${user}** baru saja boost **${guild.name}**! Terima kasih sudah mendukung server 💖`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setColor(BOOST_PINK)
        .addFields(
            { name: '👤 Booster', value: `${user} (\`${user.tag}\`)`, inline: true },
            { name: '🚀 Boost sejak', value: `<t:${Math.floor((member.premiumSinceTimestamp || Date.now()) / 1000)}:R>`, inline: true },
            { name: '📊 Server', value: tierText, inline: false }
        )
        .setFooter({ text: `${guild.name} — terima kasih!`, iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp();
}

/**
 * Build the boost-ended embed. Pure — no side effects, no send.
 * @param {Object} member - the member AFTER the change (premiumSinceTimestamp
 *   already null — the handler passes the old streak via `sinceTs`)
 * @param {number|null} sinceTs - the premiumSinceTimestamp BEFORE the removal
 */
function buildBoostRemoveEmbed(member, sinceTs) {
    const { guild, user } = member;
    const since = sinceTs ? `\n\nMereka sudah boost sejak <t:${Math.floor(sinceTs / 1000)}:D>.` : '';
    return new EmbedBuilder()
        .setTitle('💔 BOOST BERAKHIR')
        .setDescription(`**${user}** sudah tidak lagi boost **${guild.name}**.${since}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setColor(BOOST_GRAY)
        .addFields({ name: '👤 Booster', value: `${user} (\`${user.tag}\`)`, inline: true })
        .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp();
}

/**
 * Send the boost notification to the server-booster channel + record it in
 * the server log. Never throws — logs every failure with the fix (v3.9.48
 * silent-failure pattern).
 *
 * @param {Object} member - discord.js GuildMember (after the change)
 * @param {'add'|'remove'} action
 * @param {number|null} [oldSinceTs] - the premiumSinceTimestamp before the change
 */
async function onBoostChange(member, action, oldSinceTs = null) {
    const { guild, user } = member;
    const config = getConfig();

    // 1. Simpan riwayat dulu (walau notifikasi gagal, data tetap ada).
    try {
        const boostManager = require('../data/boostManager');
        if (action === 'add') boostManager.recordBoostStart(guild.id, user.id, member.premiumSinceTimestamp || Date.now());
        else boostManager.recordBoostEnd(guild.id, user.id);
    } catch (err) {
        console.warn(`⚠️ Gagal mencatat boost ${action} untuk ${user.tag}:`, err.message);
    }

    // 2. Entri server log (channel terpisah — catatan historis).
    try {
        await logServerEvent(member.client, {
            type: action === 'add' ? 'BOOST_ADD' : 'BOOST_REMOVE',
            guildId: guild.id,
            fields: [
                { name: '👤 Booster', value: `<@${user.id}> (\`${user.tag}\`)`, inline: true },
                {
                    name: action === 'add' ? '🚀 Mulai' : '💔 Berakhir',
                    value:
                        action === 'add'
                            ? member.premiumSinceTimestamp
                                ? `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`
                                : 'baru saja'
                            : oldSinceTs
                              ? `sejak <t:${Math.floor(oldSinceTs / 1000)}:R>`
                              : 'awal tidak diketahui'
                }
            ],
            footer: `User ID: ${user.id}`
        });
    } catch (_) {
        // logServerEvent tidak pernah throw, tapi tetap defensif.
    }

    // 3. Channel server-booster khusus (embed perayaan).
    const channelId = config.channels['server-booster'];
    if (!channelId) {
        console.warn(
            `⚠️ ${user.tag} ${action === 'add' ? 'mulai' : 'berhenti'} boost, tapi channel server-booster BELUM di-set — notifikasi boost dilewati. ` +
                `Solusi: /set-channel server-booster #channel (server log tetap mencatatnya kalau di-set)`
        );
        return;
    }
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
        console.warn(
            `⚠️ Channel server-booster (ID: ${channelId}) tidak ditemukan — sudah dihapus, atau ID milik server lain. ` +
                `Solusi: /set-channel server-booster #channel`
        );
        return;
    }

    const embed = action === 'add' ? buildBoostAddEmbed(member) : buildBoostRemoveEmbed(member, oldSinceTs);

    try {
        const content = action === 'add' ? `<@${user.id}>` : undefined;
        await channel.send({ content, embeds: [embed] });
        console.log(`🚀 Notifikasi boost ${action} terkirim untuk ${user.tag} di #${channel.name || channel.id}`);
    } catch (err) {
        console.error(
            `❌ Gagal mengirim notifikasi boost ${action} di #${channel.name || channel.id}: ${err.message}\n` +
                `   Cek permission Kirim Pesan + Embed Links bot di channel itu.`
        );
    }
}

/**
 * Build the /boosters list embed. Pure — no side effects, no send.
 * @param {Object} guild - discord.js Guild
 * @param {Array<Object>} boosters - GuildMembers with premiumSinceTimestamp, sorted
 *   by boost date ASCENDING (earliest supporter first — caller sorts)
 * @param {Array<{userId, event, at, boostedAt}>} recentEvents - from boostManager.getRecentEvents
 */
function buildBoostersEmbed(guild, boosters, recentEvents = []) {
    const boostCount = guild.premiumSubscriptionCount ?? boosters.length;
    const tierText =
        guild.premiumTier && guild.premiumTier > 0 ? `Level ${guild.premiumTier}` : 'Level 0 (belum ada boost)';

    // Daftar booster — cap 40 baris supaya deskripsi selalu muat (limit 4096
    // dengan ~60 char/baris ≈ 2.400 + sisa; daftar booster lebih besar dari itu
    // jarang di server komunitas, tapi guard tetap ada).
    const MAX_LIST = 40;
    const lines = boosters.slice(0, MAX_LIST).map((m, i) => {
        const ts = Math.floor((m.premiumSinceTimestamp || 0) / 1000);
        return `${i + 1}. <@${m.user.id}> — sejak <t:${ts}:D> (<t:${ts}:R>)`;
    });
    const hidden = boosters.length - MAX_LIST;
    if (hidden > 0) lines.push(`… +${hidden} booster lainnya tidak ditampilkan`);

    const description =
        boosters.length === 0
            ? 'Server ini belum punya booster aktif saat ini. 🌱\nBoost server membuka keuntungan untuk semua member — tiap boost berarti!'
            : `Member berikut sedang boost **${guild.name}** sekarang 💖\n\n${lines.join('\n')}`;

    const recentLines = recentEvents
        .slice(0, 5)
        .map(e => `${e.event === 'add' ? '🚀' : '💔'} <@${e.userId}> — <t:${Math.floor((e.at || 0) / 1000)}:R>`)
        .join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`🚀 SERVER BOOSTER — ${guild.name}`)
        .setDescription(description)
        .setColor(BOOST_PINK)
        .addFields(
            { name: '📊 Level Server', value: `${tierText} (${boostCount} boost)`, inline: true },
            { name: '⭐ Booster Terdaftar', value: `${boosters.length}`, inline: true }
        )
        .setFooter({ text: 'Daftar booster = live dari Discord • riwayat boost dilacak bot' })
        .setTimestamp();

    if (recentLines) {
        embed.addFields({ name: '🕘 Aktivitas Boost Terbaru', value: recentLines.slice(0, 1000) });
    }
    const icon = typeof guild.iconURL === 'function' ? guild.iconURL() : null;
    if (icon) embed.setThumbnail(icon);
    return embed;
}

module.exports = { onBoostChange, buildBoostAddEmbed, buildBoostRemoveEmbed, buildBoostersEmbed, BOOST_PINK, BOOST_GRAY };
