/**
 * Domain: stats
 * Slash commands: /stats, /leaderboard, /my-stats
 *
 * Dipisah dari handlers/commandHandler.js (v3.9.9 refactor).
 * Behavior: statistik server + leaderboard + statistik pribadi.
 *
 * v3.9.4: scoped per guild — sebelumnya tidak terfilter.
 *
 * v3.9.47 (laporan user: "stats gak sesuai"): /stats dulu hanya menampilkan
 * angka akumulasi stats.json — "Total Member Tracked" (hanya member yang
 * tercatat bot, ≠ jumlah member asli), "Total Pembelian VIP" (label bilang
 * VIP, padahal dihitung SEMUA transaksi: order tiket + deal rekber), dan gak
 * ada data live server sama sekali — jadi embed-nya jarang cocok dengan yang
 * admin lihat di Discord. Sekarang /stats memimpin dengan data LIVE langsung
 * dari Discord (jumlah member asli, tier + jumlah boost, tiket terbuka)
 * disusul aktivitas terlacak yang labelnya jelas, dan /my-stats menampilkan
 * tanggal gabung ASLI dari objek member (tracking guildMemberAdd hanya
 * mencatat join sejak v3.2 — member lama tampil "belum tercatat" padahal
 * Discord tahu tanggal gabungnya).
 *
 * Catatan: permission check untuk /leaderboard & /my-stats (public command)
 *          ada di router (src/commands/index.js). Domain file ini tidak perlu
 *          repeat check tersebut.
 */

const {
    EmbedBuilder,
    MessageFlags,
    getUserStats,
    getTopUsersStats,
    getServerStatsAll,
    safeEditReply
} = require('./_shared');

// v3.9.47: penghitung "tiket terbuka" live untuk overview /stats.
const { getActiveTicketCount } = require('../data/ticketManager');

module.exports = async function (interaction) {
    // ====================================================
    // === /stats ===
    // ====================================================
    if (interaction.commandName === 'stats') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        // v3.9.4: scoped per guild — sebelumnya getServerStats() tidak terfilter.
        const stats = getServerStatsAll(interaction.guild.id);

        // v3.9.47: data LIVE server dari objek guild (selalu mutakhir — tanpa
        // cache, tanpa celah tracking). Inilah bagian yang bisa admin verifikasi
        // langsung ke Discord: jumlah member asli, boost, tiket terbuka.
        const guild = interaction.guild;
        const liveMembers = guild.memberCount;
        const activeTickets = getActiveTicketCount(guild.id);
        const boostText =
            guild.premiumTier && guild.premiumTier > 0
                ? `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount ?? 0} boost)`
                : 'Belum ada';

        const embed = new EmbedBuilder()
            .setTitle(`📊 STATISTIK SERVER — ${guild.name}`)
            .setDescription('Data live server dari Discord + aktivitas member yang dilacak bot.')
            .setColor(0x5865f2)
            .addFields(
                // Baris 1 — data live (bisa diverifikasi ke Discord kapan saja)
                { name: '👥 Member (live)', value: `${liveMembers}`, inline: true },
                { name: '🎫 Tiket Terbuka', value: `${activeTickets}`, inline: true },
                { name: '🚀 Boost Server', value: boostText, inline: true },
                // Baris 2 — aktivitas terlacak (dari stats.json, sejak v3.2)
                { name: '💬 Total Pesan Terlacak', value: `${stats.totalMessages.toLocaleString('id-ID')}`, inline: true },
                { name: '👤 Member Terlacak', value: `${stats.totalUsers}`, inline: true },
                {
                    name: '📈 Rata-rata Pesan/Member',
                    value: stats.totalUsers > 0 ? `${Math.round(stats.totalMessages / stats.totalUsers)}` : '0',
                    inline: true
                },
                // Baris 3 — transaksi terlacak (order tiket + deal rekber)
                { name: '🛒 Total Transaksi', value: `${stats.totalPurchases}`, inline: true },
                { name: '💰 Total Revenue', value: `Rp ${stats.totalRevenue.toLocaleString('id-ID')}`, inline: true },
                { name: '🎁 Total Giveaway Won', value: `${stats.totalGiveawaysWon}`, inline: true }
            )
            .setFooter({
                text: 'Member/boost/tiket = live dari Discord • pesan & transaksi terlacak sejak v3.2'
            })
            .setTimestamp();
        // v3.9.47: ikon server kalau ada (null-safe).
        const icon = typeof guild.iconURL === 'function' ? guild.iconURL() : null;
        if (icon) embed.setThumbnail(icon);
        return safeEditReply(interaction, { embeds: [embed] });
    }

    // ====================================================
    // === /leaderboard ===
    // ====================================================
    if (interaction.commandName === 'leaderboard') {
        await interaction.deferReply();
        const metric = interaction.options.getString('metric') || 'messages';
        // v3.9.4: scoped per guild — sebelumnya getTopUsers() tidak terfilter.
        const top = getTopUsersStats(interaction.guild.id, metric, 10);
        if (top.length === 0) {
            return safeEditReply(interaction, { content: '📭 Belum ada data leaderboard untuk metric ini.' });
        }

        const metricLabels = {
            messages: '💬 Pesan Terbanyak',
            vipPurchases: '🛒 Top Buyer (jumlah transaksi)',
            totalSpent: '💰 Top Spender (total belanja)',
            giveawaysWon: '🎉 Top Winner (giveaway)'
        };
        const metricFormat = {
            messages: v => `${v.toLocaleString('id-ID')} pesan`,
            vipPurchases: v => `${v} transaksi`,
            totalSpent: v => `Rp ${v.toLocaleString('id-ID')}`,
            giveawaysWon: v => `${v} menang`
        };

        const medals = ['🥇', '🥈', '🥉'];
        const lines = top
            .map((u, i) => {
                const medal = medals[i] || `**${i + 1}.**`;
                return `${medal} <@${u.userId}> — ${metricFormat[metric](u.value)}`;
            })
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`🏆 LEADERBOARD — ${metricLabels[metric]}`)
            .setDescription(`Top ${top.length} member berdasarkan **${metricLabels[metric]}**.\n\n${lines}`)
            .setColor(0xf1c40f)
            .setFooter({ text: 'Tracking sejak bot v3.2 | Update tiap aktivitas' })
            .setTimestamp();
        return safeEditReply(interaction, { embeds: [embed] });
    }

    // ====================================================
    // === /my-stats ===
    // ====================================================
    if (interaction.commandName === 'my-stats') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        // v3.9.4: scoped per guild — sebelumnya getStats() tidak terfilter.
        const stats = getUserStats(interaction.guild.id, interaction.user.id);

        // v3.9.47: tanggal gabung ASLI dari objek member Discord (selalu akurat,
        // berlaku juga untuk member yang gabung sebelum tracking v3.2).
        // stats.joinedAt cuma fallback untuk kasus langka (mis. member partial).
        const realJoinedTs = interaction.member?.joinedTimestamp ?? stats.joinedAt;

        const embed = new EmbedBuilder()
            .setTitle(`📊 STATS — ${interaction.user.tag}`)
            .setDescription('Statistik aktivitas kamu di server ini.')
            .setColor(0x57f287)
            .addFields(
                { name: '💬 Pesan', value: `${stats.messages.toLocaleString('id-ID')}`, inline: true },
                { name: '🛒 Transaksi', value: `${stats.vipPurchases}`, inline: true },
                { name: '💰 Total Belanja', value: `Rp ${stats.totalSpent.toLocaleString('id-ID')}`, inline: true },
                { name: '🎉 Giveaway Won', value: `${stats.giveawaysWon}`, inline: true },
                {
                    name: '📅 Gabung Server Ini',
                    value: realJoinedTs ? `<t:${Math.floor(realJoinedTs / 1000)}:R>` : 'tidak diketahui',
                    inline: true
                },
                {
                    name: '🕐 Pesan Terakhir',
                    value: stats.lastMessageAt ? `<t:${Math.floor(stats.lastMessageAt / 1000)}:R>` : 'belum pernah',
                    inline: true
                }
            )
            .setFooter({ text: 'Cek posisi di leaderboard pakai /leaderboard' })
            .setTimestamp();
        return safeEditReply(interaction, { embeds: [embed] });
    }
};
