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
 * v3.9.49 (laporan user: "member tracked & member live — kalau fungsinya sama
 * bikin satu aja"): field member DOBEL dihapus — SATU field "Member" (jumlah
 * live langsung dari Discord). "Rata-rata Pesan/Member" kini dibagi jumlah
 * member LIVE juga, jadi angkanya konsisten dengan yang embed tampilkan.
 * v3.9.49 juga membenahi KENAPA "total revenue gak ke update": suffix harga
 * Indonesia ("25rb"/"2jt") salah parse jadi jumlah nyaris nol, dan harga
 * produk tak terparse dulu diterima senyap (lihat products.js +
 * statsManager.parsePrice).
 *
 * v3.9.51 (permintaan user: "fitur total revenue di hapus saja, saya ga
 * terlalu memakai fitur itu"): field "Total Revenue" DIHAPUS dari /stats.
 * Angka revenue agregat bikin kebingungan berulang (v3.9.47/49/50 semuanya
 * soal angkanya yang tidak cocok) dan user tidak memakainya — /stats kini
 * menampilkan data live server + aktivitas terlacak TANPA baris revenue.
 * Statistik belanja pribadi tetap ada di tempat yang per-user dan tidak
 * ambigu: /my-stats "Total Belanja" dan /leaderboard "Top Spender".
 *
 * v3.9.54 (permintaan user: "bot akan dipakai orang di luar Indonesia juga"):
 * jumlah belanja kini tampil TANPA prefiks "Rp" yang di-hardcode — bot
 * currency-AGNOSTIC, mencatat nominal angka dalam mata uang apapun yang
 * dipakai admin server terkait untuk harga produknya (lihat
 * statsManager.parsePrice). Pakai SATU mata uang yang konsisten per server.
 *
 * Catatan: permission check untuk /leaderboard & /my-stats (public command)
 *          ada di router (src/commands/index.js). Domain file ini tidak perlu
 *          repeat check tersebut.
 */

const {
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    getUserStats,
    getTopUsersStats,
    getServerStatsAll,
    getConfig,
    resolveGuildId,
    safeEditReply
} = require('./_shared');

// v3.9.47: penghitung "tiket terbuka" live untuk overview /stats.
const { getActiveTicketCount } = require('../data/ticketManager');

// v3.9.49: /boosters — daftar booster live + riwayat terlacak. Embed dibangun
// di boostHandler (satu sumber kebenaran — builder yang sama dengan event live).
// v3.9.58: /test-booster mem-preview builder add/remove yang SAMA (mustahil beda).
const { buildBoostersEmbed, buildBoostAddEmbed, buildBoostRemoveEmbed } = require('../bot/boostHandler');
const { getRecentEvents: getRecentBoostEvents } = require('../data/boostManager');

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
                { name: '👥 Member', value: `${liveMembers}`, inline: true },
                { name: '🎫 Tiket Terbuka', value: `${activeTickets}`, inline: true },
                { name: '🚀 Boost Server', value: boostText, inline: true },
                // Baris 2 — aktivitas terlacak (dari stats.json, sejak v3.2)
                { name: '💬 Total Pesan Terlacak', value: `${stats.totalMessages.toLocaleString('id-ID')}`, inline: true },
                {
                    name: '📈 Rata-rata Pesan/Member',
                    value: liveMembers > 0 ? `${Math.round(stats.totalMessages / liveMembers)}` : '0',
                    inline: true
                },
                { name: '🎁 Total Giveaway Won', value: `${stats.totalGiveawaysWon}`, inline: true },
                // Baris 3 — transaksi terlacak (order tiket + deal rekber).
                // v3.9.51: Total Revenue DIHAPUS (permintaan user — tidak dipakai).
                { name: '🛒 Total Transaksi', value: `${stats.totalPurchases}`, inline: true }
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
    // === /boosters (v3.9.49) ===
    // ====================================================
    if (interaction.commandName === 'boosters') {
        await interaction.deferReply();
        const guild = interaction.guild;

        // Fetch daftar member lengkap supaya premiumSinceTimestamp akurat untuk
        // SEMUA member (cache hanya menyimpan member yang bot lihat sejak restart
        // terakhir). Intent GuildMembers wajib — bot yang online membuktikan
        // intent itu nyala. Fallback: cache (dengan warning di console).
        try {
            await guild.members.fetch();
        } catch (err) {
            console.warn(
                `⚠️ /boosters: gagal fetch daftar member lengkap (${err.message}) — memakai cache memori sebagai gantinya.`
            );
        }

        const boosters = [...guild.members.cache.values()]
            .filter(m => !m.user?.bot && m.premiumSinceTimestamp)
            .sort((a, b) => (a.premiumSinceTimestamp || 0) - (b.premiumSinceTimestamp || 0));

        const recent = getRecentBoostEvents(guild.id, 5);
        const embed = buildBoostersEmbed(guild, boosters, recent);
        return safeEditReply(interaction, { embeds: [embed] });
    }

    // ====================================================
    // === /test-booster (v3.9.58) ===
    // ====================================================
    // Versi /test-welcome milik fitur boost: admin TIDAK BISA mensimulasikan
    // boost asli (bayar uang sungguhan), jadi command ini membuktikan seluruh
    // rantainya bekerja — config → channel ada → izin bot — dan mengirim
    // PREVIEW LIVE dari embed yang persis dikirim boost asli (builder
    // buildBoostAddEmbed / buildBoostRemoveEmbed yang SAMA dengan event live —
    // mustahil beda). SIMULASI MURNI: tidak ada yang dicatat — riwayat boost
    // (/boosters), server log dan counter live tetap bersih, jadi aman
    // dijalankan kapan saja. Opsi `live:true` SEKALIAN mengirim preview ke
    // channel server-booster ASLI (tes pengiriman end-to-end penuh).
    if (interaction.commandName === 'test-booster') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const tipe = interaction.options.getString('tipe'); // 'add' | 'remove'
        const live = interaction.options.getBoolean('live') === true;
        const guild = interaction.guild;
        // v3.10.0 multi-guild: channel boost dibaca dari config guild ini.
        const config = getConfig(resolveGuildId(interaction));
        const configuredId = config.channels['server-booster'];
        const me = guild.members.me;

        // --- diagnosis setiap mata rantai (pola v3.9.48) ---
        const lines = [];
        let channel = null;
        if (!configuredId) {
            lines.push(`❌ **channel server-booster: belum di-set** → perbaiki dengan \`/set-channel server-booster #channel\``);
        } else {
            channel = guild.channels.cache.get(configuredId);
            if (!channel) {
                lines.push(
                    `❌ **channel server-booster: tidak ditemukan** (ID \`${configuredId}\`) — terhapus, atau ID-nya milik server lain → set ulang dengan \`/set-channel server-booster #channel\``
                );
            } else {
                lines.push(`✅ **channel server-booster:** ${channel} (\`${channel.id}\`)`);
                if (me) {
                    const perms = channel.permissionsFor(me);
                    const canSend = perms?.has?.(PermissionFlagsBits.SendMessages) ?? false;
                    const canEmbed = perms?.has?.(PermissionFlagsBits.EmbedLinks) ?? false;
                    const canView = perms?.has?.(PermissionFlagsBits.ViewChannel) ?? true;
                    lines.push(
                        `${canView ? '✅' : '❌'} View Channel · ${canSend ? '✅' : '❌'} Send Messages · ${canEmbed ? '✅' : '❌'} Embed Links (izin bot di channel itu)`
                    );
                    if (!canSend || !canEmbed) {
                        lines.push('→ perbaiki: Server Settings → channel itu → tambahkan bot → aktifkan **Send Messages** + **Embed Links**');
                    }
                }
            }
        }
        // Deteksi boost = diff premium_since guildMemberUpdate (Discord tidak
        // punya event boost khusus) — bot yang online membuktikan intent
        // GuildMembers menyala (intent privileged mati = login crash, tidak
        // pernah jalan diam-diam).
        lines.push('ℹ️ Deteksi boost: ✅ aktif (diff premium_since guildMemberUpdate — bot online = intent GuildMembers menyala)');
        // State boost live sekarang — inilah yang berubah kalau boost ASLI masuk.
        const boostCount = guild.premiumSubscriptionCount ?? 0;
        lines.push(`ℹ️ Server sekarang: Level ${guild.premiumTier ?? 0} · ${boostCount} boost`);

        // --- v3.9.59: diagnosis mata rantai AUTO ROLE BOOSTER (opsional — tapi
        // kalau di-set harus benar-benar bisa di-assign). Murni diagnosis:
        // role TIDAK pernah diutak-atik di sini (simulasi tetap murni). ---
        const boosterRoleId = config.roles && config.roles.booster;
        if (!boosterRoleId) {
            lines.push('ℹ️ Role booster: belum di-set (opsional) → `/set-role booster @role` supaya member yang boost otomatis dapat role');
        } else {
            const boosterRole = guild.roles.cache.get(boosterRoleId);
            if (!boosterRole) {
                lines.push(
                    `❌ **role booster: tidak ditemukan** (ID \`${boosterRoleId}\`) — terhapus, atau ID-nya milik server lain → set ulang dengan \`/set-role booster @role\``
                );
            } else {
                lines.push(`✅ **role booster:** ${boosterRole} — otomatis diberikan saat member boost, dihapus saat boost berakhir`);
                if (me) {
                    const botPos = me.roles?.highest?.position;
                    if (typeof botPos === 'number' && (boosterRole.position ?? 0) >= botPos) {
                        lines.push(
                            '❌ posisi role booster DI ATAS role bot tertinggi — bot tidak bisa assign → pindahkan role booster ke BAWAH role bot (Server Settings → Roles)'
                        );
                    }
                    const canManageRoles =
                        typeof me.permissions?.has === 'function' ? me.permissions.has(PermissionFlagsBits.ManageRoles) : null;
                    if (canManageRoles === false) {
                        lines.push('❌ bot tidak punya permission **Manage Roles** → aktifkan di Server Settings → Roles → bot');
                    }
                }
            }
        }

        // --- preview live: embed yang PERSIS dikirim boost asli ---
        // interaction.member berperan sebagai "booster-nya". Untuk preview
        // remove, awal streak = tanggal boost asli admin kalau sedang boost,
        // selain itu disimulasikan masuk akal (3 hari lalu).
        const simulatedSince = interaction.member?.premiumSinceTimestamp || Date.now() - 3 * 86400000;
        const embed =
            tipe === 'add'
                ? buildBoostAddEmbed(interaction.member)
                : buildBoostRemoveEmbed(interaction.member, simulatedSince);
        let previewNote;
        try {
            await interaction.channel.send({
                content: tipe === 'add' ? `<@${interaction.user.id}>` : undefined,
                embeds: [embed]
            });
            previewNote = `🧪 Preview terkirim ke **channel ini** — ${tipe === 'add' ? 'notifikasi boost' : 'pemberitahuan boost selesai'} yang asli masuk ke ${channel ? channel : 'channel server-booster yang kamu set'}. Data kamu dipakai sebagai "booster-nya".`;
        } catch (sendErr) {
            previewNote = `⚠️ Preview GAGAL terkirim ke channel ini: ${sendErr.message}\nCek izin Send Messages + Embed Links bot DI SINI juga — kemungkinan channel server-booster punya masalah yang sama.`;
        }

        // --- opsional kirim asli: channel ASLI, tetap simulasi ---
        if (live) {
            if (channel) {
                try {
                    await channel.send({
                        content: tipe === 'add' ? `<@${interaction.user.id}>` : undefined,
                        embeds: [embed]
                    });
                    lines.push(`🧪 Kirim asli: ✅ juga terkirim ke channel server-booster ASLI — seluruh rantai bekerja end-to-end.`);
                } catch (err) {
                    lines.push(`🧪 Kirim asli: ❌ gagal di channel server-booster: ${err.message} — cek izin Send Messages + Embed Links bot di sana.`);
                }
            } else {
                lines.push('🧪 Kirim asli: dilewati — channel server-booster belum di-set (atau terhapus). Perbaiki dulu yang di atas.');
            }
        }

        return safeEditReply(interaction, {
            content: `${lines.join('\n')}\n\n${previewNote}\n\n🧪 **Simulasi saja** — tidak ada yang dicatat: riwayat boost (\`/boosters\`), server log dan counter live tetap bersih, role booster tidak diutak-atik.`
        });
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
            // v3.9.54: angka polos — currency-agnostic (tanpa prefiks "Rp").
            totalSpent: v => v.toLocaleString('id-ID'),
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
                // v3.9.54: angka polos — currency-agnostic (tanpa prefiks "Rp").
                { name: '💰 Total Belanja', value: stats.totalSpent.toLocaleString('id-ID'), inline: true },
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
