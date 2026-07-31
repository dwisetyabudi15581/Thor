const { PermissionFlagsBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags, StringSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getConfig, saveConfig, setField, DEFAULTS } = require('../utils/configManager');
const { Embeds } = require('../utils/embedBuilder');
const { isAdmin: checkIsAdmin } = require('../utils/permissions');
const { addKey, getActiveKeysByUserAndRole, findAllByUser, formatKeysForUser, removeAllKeysByUser, getStats: getKeyStats } = require('../utils/keyManager');
const { scheduleRoleRemoval, removeActiveByUserAndRole, findAllByUser: findAllSchedulesByUser, removeAllByUser: removeAllSchedulesByUser, getRemainingDays, getAllActive: getAllScheduledActive } = require('../utils/roleScheduler');
const { createPanel, addRoleToPanel, removeRoleFromPanel, getPanel, getPanelsByGuild, deletePanel, setMessageId, deletePanel: deleteSelfRolePanel } = require('../utils/selfRoleManager');
const { buildPanelEmbed, buildPanelComponents } = require('../utils/selfRolePanelBuilder');
const { createSession, buildEmbed, getSessionsByUser, deleteSessionByOwner } = require('../utils/embedBuilderSessions');
const { logAudit } = require('../utils/auditLog');
const { createBackup, listBackups, restoreBackup, formatSize: formatBackupSize } = require('../utils/backupManager');
const { create: createGiveaway, setMessageId: setGiveawayMessageId, getByGuild: getGiveawaysByGuild, get: getGiveaway, end: endGiveaway, reroll: rerollGiveaway, pickWinners, remove: removeGiveaway } = require('../utils/giveawayManager');
const { create: createScheduledAnn, getByGuild: getScheduledAnnsByGuild, get: getScheduledAnn, markSent: markScheduledAnnSent, remove: removeScheduledAnn, parseTime: parseAnnTime } = require('../utils/scheduledAnnouncements');
const { addWarn, getWarns, getWarnCount, removeWarn, clearWarns, markActionTaken, DEFAULT_THRESHOLDS: WARN_THRESHOLDS } = require('../utils/warnManager');
const { getStats: getUserStats, getTopUsers: getTopUsersStats, getServerStats: getServerStatsAll, parsePrice: parsePriceNum, recordPurchase: trackPurchase } = require('../utils/statsManager');
const { create: createPoll, setMessageId: setPollMessageId, get: getPoll, getByGuild: getPollsByGuild, close: closePoll, getTotalVotes: getPollTotalVotes } = require('../utils/pollManager');

module.exports = async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const embeds = new Embeds(interaction.client);
    const config = getConfig();

    // === PERMISSION CHECK — HANYA ADMIN/STAFF ===
    // Semua slash command di-restrict hanya untuk admin (ManageGuild permission
    // atau role Admin yang sudah di-set via /set-role admin).
    // Member biasa akan ditolak dengan pesan ephemeral.
    //
    // EXCEPTION: command berikut boleh dipakai member biasa:
    //   - /leaderboard, /my-stats (fitur engagement, bukan admin tool)
    const PUBLIC_COMMANDS = ['leaderboard', 'my-stats'];
    if (!checkIsAdmin(interaction.member) && !PUBLIC_COMMANDS.includes(interaction.commandName)) {
        return interaction.reply({
            content: '🚫 **Akses Ditolak.**\n\nSlash command hanya bisa dipakai oleh **Admin/Staff**.\n\nKalau kamu merasa ini salah, hubungi server admin.',
            flags: MessageFlags.Ephemeral
        });
    }

    // === HELP ===
    if (interaction.commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('🤖 MLBB COMMUNITY BOT — HELP')
            .setDescription(
                `Halo ${interaction.user}! Anda terverifikasi sebagai **Admin/Staff**. Berikut daftar command yang tersedia.`
            )
            .setColor(0x5865F2)
            .addFields(
                { name: '📋 Informasi', value: [
                    '• `/help` — tampilkan pesan bantuan ini',
                    '• `/list-products` — lihat semua produk',
                    '• `/list-messages` — lihat semua teks pesan embed',
                    '• `/config-show` — lihat semua konfigurasi'
                ].join('\n'), inline: false },
                { name: '🏗️ Panel Setup', value: [
                    '• `/setup-verify` — pasang panel verifikasi',
                    '• `/setup-ticket` — pasang panel tiket & price list'
                ].join('\n'), inline: false },
                { name: '🎭 Atur Role (set & hapus)', value: [
                    '• `/set-role verified @role` — set role',
                    '• `/set-role unverified @role`',
                    '• `/set-role admin @role`',
                    '• `/remove-role verified` — **hapus role dari config**'
                ].join('\n'), inline: false },
                { name: '📢 Atur Channel (set & hapus)', value: [
                    '• `/set-channel welcome #channel`',
                    '• `/set-channel goodbye #channel`',
                    '• `/set-channel invoice #channel`',
                    '• `/remove-channel welcome` — **hapus channel dari config**'
                ].join('\n'), inline: false },
                { name: '✏️ Atur Pesan Embed (set & reset)', value: [
                    '• `/set-message welcomeBody teks...`',
                    '• `/set-message goodbyeBody teks...`',
                    '• `/set-message verifyBody teks...`',
                    '• `/set-message ticketBody teks...`',
                    '• `/reset-message welcomeBody` — **reset ke default**',
                    '• `/reset-message ALL` — **reset semua pesan**'
                ].join('\n'), inline: false },
                { name: '📦 Manajemen Produk (tambah & hapus)', value: [
                    '• `/add-product label value price [duration]`',
                    '   ↳ `duration` **opsional** — kalau kosong, TIDAK ADA duration',
                    '• `/remove-product value` — **hapus produk**',
                    '• `/list-products`'
                ].join('\n'), inline: false },
                { name: '🎁 Auto-Role Produk (VIP role + auto-expire)', value: [
                    '• `/set-product-role value:@role days:30` — set role + durasi',
                    '   ↳ `days:0` = role permanen (tidak auto-hapus)',
                    '• `/remove-product-role value:` — **hapus auto-role**',
                    '• `/list-product-roles` — lihat semua mapping',
                    '💡 Role & key diberikan saat admin klik **🔑 Set Key** di tiket'
                ].join('\n'), inline: false },
                { name: '🔑 Key Manager (model key-driven)', value: [
                    '• `/set-key user:@user value:30d key:ABCDE-...` — beri key + role + extend schedule',
                    '• `/list-keys user:@user` — lihat semua key aktif user',
                    '• `/clear-schedule user:@user clear_keys:true` — hapus schedule + key (reset VIP)'
                ].join('\n'), inline: false },
                { name: '🎭 Self-Role Fleksibel (member ambil sendiri)', value: [
                    '• `/setup-selfrole title:... type:button exclusive:false` — bikin panel',
                    '• `/selfrole-add panel_id:@role label:Notif emoji:🔔 description:...`',
                    '• `/selfrole-remove panel_id:@role`',
                    '• `/selfrole-list` — lihat semua panel',
                    '• `/selfrole-delete panel_id:` — hapus panel'
                ].join('\n'), inline: false },
                { name: '📢 Announce & Embed Builder', value: [
                    '• `/announce channel:#ch title:... description:... color? image? thumbnail? mention?` — quick announce',
                    '• `/embed-builder` — interactive builder (live preview, edit bagian per bagian)',
                    '• `/embed-list` — lihat semua session embed builder aktif + link ke draft',
                    '• `/embed-cancel session_id:emb_xxx` — batalkan session tertentu (kalau draft kehapus)',
                    '💡 `/embed-builder` cocok untuk embed kompleks (multi-field, footer, author, image)',
                    '💡 `/announce` cocok untuk pengumuman simple 1-embed',
                    '💡 Bisa bikin banyak embed builder sekaligus — tiap draft independen, pakai `/embed-list` untuk kelola'
                ].join('\n'), inline: false },
                { name: '💾 Backup System (auto + manual)', value: [
                    '• `/backup-now` — buat backup manual sekarang',
                    '• `/backup-list` — lihat semua backup tersimpan',
                    '• `/restore-backup name:YYYY-MM-DD_HH-mm-ss` — restore (auto safety backup)',
                    '💡 Auto-backup saat bot start + tiap 24 jam. Maks 7 backup terbaru disimpan.'
                ].join('\n'), inline: false },
                { name: '🎉 Giveaway System', value: [
                    '• `/giveaway create channel:#ch prize:VIP 30 Hari winners:1 duration:60 required_role?:@VIP`',
                    '• `/giveaway list` — lihat semua giveaway',
                    '• `/giveaway end id:gw_xxx` — akhiri lebih awal + pick winner',
                    '• `/giveaway reroll id:gw_xxx` — reroll winner',
                    '💡 Member klik tombol 🎉 Join / 🚪 Leave di message giveaway'
                ].join('\n'), inline: false },
                { name: '⏰ Scheduled Announcements', value: [
                    '• `/announce-schedule channel:#ch title:... description:... at:30m recurring?:daily`',
                    '• `/announce-list` — lihat semua pending',
                    '• `/announce-cancel id:sa_xxx` — batalkan',
                    '💡 Format `at`: "30m", "2h", "1d", atau "2026-01-15 20:00"',
                    '💡 Recurring: daily / weekly / monthly (auto-bikin cycle baru)'
                ].join('\n'), inline: false },
                { name: '⚠️ Warn System (auto-action)', value: [
                    '• `/warn user:@user reason:Spam` — beri warning',
                    '• `/warn-list user:@user` — lihat history warning',
                    '• `/warn-remove user:@user warn_id:warn_xxx` — hapus 1 warn',
                    '• `/warn-clear user:@user` — hapus SEMUA warn',
                    '💡 Threshold: 3 warn=mute 1h, 5 warn=mute 1d, 7 warn=kick'
                ].join('\n'), inline: false },
                { name: '📊 Stats & Leaderboard', value: [
                    '• `/stats` — statistik agregat server (admin)',
                    '• `/leaderboard metric:messages|vipPurchases|totalSpent|giveawaysWon` — top 10 (public)',
                    '• `/my-stats` — statistik pribadi (public)',
                    '💡 Tracking: pesan, pembelian VIP, total belanja, menang giveaway'
                ].join('\n'), inline: false },
                { name: '📊 Poll System', value: [
                    '• `/poll create channel:#ch question:Event weekend ini? multiple?:false`',
                    '• `/poll list` — lihat semua poll',
                    '• `/poll close id:poll_xxx` — tutup poll + tampilkan hasil akhir',
                    '💡 Member klik tombol option untuk vote (toggle). Live bar chart otomatis.'
                ].join('\n'), inline: false },
                { name: '🔧 Audit Log (otomatis)', value: [
                    '• Set `/set-channel audit-log #channel` dulu',
                    '💡 Bot otomatis catat: add/remove produk, set role/channel, set-key, giveaway, dll'
                ].join('\n'), inline: false },
                { name: '🧨 Reset Total', value: [
                    '• `/reset-config` — ⚠️ **hapus SEMUA setting** (tidak bisa di-undo!)'
                ].join('\n'), inline: false },
                { name: '📝 Variabel Pesan', value: '`{user}` `{username}` `{server}` `{count}` `{action}` — bisa dipakai di teks welcome/goodbye', inline: false }
            )
            .setFooter({ text: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        return interaction.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral });
    }

    // === SETUP VERIFY ===
    if (interaction.commandName === 'setup-verify') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Kalau role verified belum di-set, minta admin set dulu
        if (!config.roles.verified) {
            return interaction.editReply({ content: '❌ Role Verified belum di-set. Pakai `/set-role verified @role` dulu.' });
        }

        const embed = new EmbedBuilder()
            .setTitle(config.messages.verifyTitle)
            .setDescription(
                config.messages.verifyBody.replace(/\{server\}/g, interaction.guild.name)
            )
            .setColor(0x2ECC71)
            .setFooter({ text: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_verify')
                .setLabel('Verifikasi Saya')
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success)
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        return interaction.editReply({ content: '✅ Panel verifikasi dipasang!' });
    }

    // === SETUP TICKET ===
    if (interaction.commandName === 'setup-ticket') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!config.products || config.products.length === 0) {
            return interaction.editReply({ content: '❌ Belum ada produk. Pakai `/add-product` dulu.' });
        }

        const priceList = config.products.map(p => `• **${p.label}** — ${p.price}`).join('\n');

        const embed = new EmbedBuilder()
            .setTitle(config.messages.ticketTitle)
            .setDescription(
                config.messages.ticketBody + '\n\n' +
                '**💰 PRICE LIST KEY 💰**\n' +
                priceList
            )
            .setColor(0xE67E22)
            .setFooter({ text: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_trade').setLabel('Beli Key / Transaksi').setEmoji('🛒').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('ticket_help').setLabel('Bantuan Staff').setEmoji('📞').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('ticket_report').setLabel('Laporkan Member').setEmoji('⚠️').setStyle(ButtonStyle.Danger)
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        return interaction.editReply({ content: '✅ Panel tiket dipasang!' });
    }

    // === SET ROLE ===
    if (interaction.commandName === 'set-role') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const tipe = interaction.options.getString('tipe');
        const role = interaction.options.getRole('role');
        setField(`roles.${tipe}`, role.id);
        await logAudit(interaction.client, { action: 'SET_ROLE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Role **${tipe}** diatur ke ${role.name} (\`${role.id}\`)`, guildId: interaction.guild.id });
        return interaction.editReply({ content: `✅ Role **${tipe}** diatur ke ${role} (\`${role.id}\`)` });
    }

    // === SET CHANNEL ===
    if (interaction.commandName === 'set-channel') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const tipe = interaction.options.getString('tipe');
        const channel = interaction.options.getChannel('channel');
        setField(`channels.${tipe}`, channel.id);
        await logAudit(interaction.client, { action: 'SET_CHANNEL', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Channel **${tipe}** diatur ke #${channel.name} (\`${channel.id}\`)`, guildId: interaction.guild.id });
        return interaction.editReply({ content: `✅ Channel **${tipe}** diatur ke ${channel} (\`${channel.id}\`)` });
    }

    // === SET MESSAGE ===
    if (interaction.commandName === 'set-message') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const tipe = interaction.options.getString('tipe');
        const teks = interaction.options.getString('teks');

        // P2-10 FIX: validasi panjang sesuai Discord embed limits.
        // Sebelumnya: admin bisa set teks sepanjang apapun → saat embed dikirim,
        // `setTitle` / `setDescription` throw error → silent failure.
        const { EMBED_LIMITS } = require('../utils/constants');
        const isTitle = tipe.endsWith('Title');
        const limit = isTitle ? EMBED_LIMITS.TITLE : EMBED_LIMITS.DESCRIPTION;
        const limitLabel = isTitle ? 'title (max 256)' : 'body (max 4096)';
        if (teks.length > limit) {
            return interaction.editReply({
                content: `❌ Teks terlalu panjang untuk **${tipe}**.\n\n📏 Panjang: **${teks.length}** char\n🎯 Limit: **${limit}** char (${limitLabel})\n💡 Potong ${teks.length - limit} char lagi.`
            });
        }
        setField(`messages.${tipe}`, teks);
        await logAudit(interaction.client, { action: 'SET_MESSAGE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Set pesan **${tipe}** (${teks.length} char)`, guildId: interaction.guild.id });
        return interaction.editReply({
            content: `✅ Pesan **${tipe}** diperbarui.\n\nPreview:\n\`\`\`\n${teks}\n\`\`\`\nVariabel tersedia: \`{user}\` \`{username}\` \`{server}\` \`{count}\` \`{action}\``
        });
    }

    // === ADD PRODUCT ===
    if (interaction.commandName === 'add-product') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const label = interaction.options.getString('label');
        const value = interaction.options.getString('value');
        const price = interaction.options.getString('price');
        // duration opsional - kalau tidak diisi, TIDAK disimpan sama sekali
        const duration = interaction.options.getString('duration');

        if (config.products.some(p => p.value === value)) {
            return interaction.editReply({ content: `❌ Produk dengan value \`${value}\` sudah ada.` });
        }
        if (config.products.length >= 25) {
            return interaction.editReply({ content: '❌ Maksimal 25 produk (batas dropdown Discord).' });
        }

        // Hanya simpan duration kalau diisi
        const newProduct = { label, value, price };
        if (duration) newProduct.duration = duration;

        config.products.push(newProduct);
        saveConfig(config);

        const durationInfo = duration ? ` (durasi: ${duration})` : ' (tanpa duration)';
        await logAudit(interaction.client, { action: 'ADD_PRODUCT', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Tambah produk: **${label}** (\`${value}\`) — ${price}${durationInfo}`, guildId: interaction.guild.id });
        return interaction.editReply({ content: `✅ Produk ditambahkan: **${label}** — ${price}${durationInfo}` });
    }

    // === REMOVE PRODUCT ===
    if (interaction.commandName === 'remove-product') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const value = interaction.options.getString('value');
        const idx = config.products.findIndex(p => p.value === value);
        if (idx === -1) return interaction.editReply({ content: `❌ Produk \`${value}\` tidak ditemukan.` });
        const [removed] = config.products.splice(idx, 1);
        saveConfig(config);
        await logAudit(interaction.client, { action: 'REMOVE_PRODUCT', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Hapus produk: **${removed.label}** (\`${removed.value}\`) — ${removed.price}`, guildId: interaction.guild.id });
        return interaction.editReply({ content: `✅ Produk dihapus: **${removed.label}**` });
    }

    // === LIST PRODUCTS ===
    if (interaction.commandName === 'list-products') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (config.products.length === 0) {
            return interaction.editReply({ content: '📭 Belum ada produk.' });
        }
        const list = config.products.map((p, i) => {
            let line = `\`${i + 1}.\` **${p.label}** — ${p.price}\n   └ value: \`${p.value}\``;
            if (p.duration) line += ` | durasi: ${p.duration}`;
            return line;
        }).join('\n');
        const embed = embeds.info('📋 DAFTAR PRODUK', list);
        return interaction.editReply({ embeds: [embed] });
    }

    // === CONFIG SHOW (v3.1 — comprehensive view) ===
    if (interaction.commandName === 'config-show') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const fmt = (id, type) => id ? `<${type}:${id}> (\`${id}\`)` : '❌ belum di-set';

        // --- Stats: VIP Keys ---
        const keyStats = getKeyStats();
        const keyLines = [
            `• Total key tersimpan: **${keyStats.total}**`,
            `• Aktif: **${keyStats.active}**${keyStats.permanent > 0 ? ` (termasuk ${keyStats.permanent} permanen)` : ''}`,
            keyStats.expired > 0
                ? `• ⚠️ Expired (menunggu scheduler bersihkan): **${keyStats.expired}**`
                : `• Expired: **0** ✅`
        ];

        // --- Stats: Scheduled Role Removals ---
        const scheduled = getAllScheduledActive();
        let nextDueStr = '—';
        if (scheduled.length > 0) {
            const next = scheduled.reduce((a, b) => (a.expireAt < b.expireAt ? a : b));
            const msLeft = next.expireAt - Date.now();
            if (msLeft > 0) {
                const days = Math.floor(msLeft / 86400000);
                const hours = Math.floor((msLeft % 86400000) / 3600000);
                nextDueStr = days > 0 ? `${days}h ${hours}j lagi` : `${hours}j lagi`;
            } else {
                nextDueStr = 'akan dieksekusi loop berikutnya';
            }
        }
        const schedLines = [
            `• Total jadwal aktif: **${scheduled.length}**`,
            `• Eksekusi berikutnya: **${nextDueStr}**`,
            `• Loop scheduler: setiap 60 detik`
        ];

        // --- Stats: Self-Role Panels (guild ini) ---
        const panels = getPanelsByGuild(interaction.guild.id);
        const panelLines = panels.length > 0
            ? panels.map(p => `  • **${p.title}** — ${p.type === 'button' ? '🔘 Button' : '📋 Select'} | ${p.exclusive ? '🔒 Eksklusif' : '✅ Multi'} | ${p.roles.length} role`).join('\n')
            : '_(belum ada panel — pakai `/setup-selfrole`)_';
        const panelSummary = `${panels.length} panel terdaftar di guild ini:\n${panelLines}`;

        // --- Stats: Embed Builder Sessions (milik user ini) ---
        const mySessions = getSessionsByUser(interaction.user.id);
        const sessionLine = mySessions.length > 0
            ? `**${mySessions.length} session aktif** (milik kamu) — pakai \`/embed-list\` untuk lihat detail`
            : '_(tidak ada session aktif — pakai `/embed-builder` untuk mulai)_';

        // --- Products detail (dengan role + days mapping) ---
        const productLines = config.products.length > 0
            ? config.products.map(p => {
                const roleStr = p.roleId ? `<@&${p.roleId}>` : '❌ belum di-map';
                const daysStr = p.days === 0 || !p.days ? '♾️ permanen' : `${p.days} hari`;
                return `• **${p.label}** (\`${p.value}\`) — ${p.price}\n  → Role: ${roleStr} | Durasi: ${daysStr}`;
            }).join('\n')
            : '_(belum ada produk — pakai `/add-product`)_';

        const embed = embeds.info('⚙️ KONFIGURASI BOT', 'Berikut setting bot saat ini (v3.1 — key-driven VIP + self-role + embed builder):')
            .addFields(
                { name: '🎭 Roles', value: [
                    `• Verified: ${fmt(config.roles.verified, '@&')}`,
                    `• Unverified: ${fmt(config.roles.unverified, '@&')}`,
                    `• Admin: ${fmt(config.roles.admin, '@&')}`
                ].join('\n'), inline: false },
                { name: '📢 Channels', value: [
                    `• Welcome: ${fmt(config.channels.welcome, '#')}`,
                    `• Goodbye: ${fmt(config.channels.goodbye, '#')}`,
                    `• Invoice: ${fmt(config.channels.invoice, '#')}`
                ].join('\n'), inline: false },
                { name: `📦 Produk (${config.products.length})`, value: productLines, inline: false },
                { name: '🔑 VIP Keys (Key-Driven Model)', value: keyLines.join('\n'), inline: false },
                { name: '⏰ Scheduled Role Removals', value: schedLines.join('\n'), inline: false },
                { name: `🎭 Self-Role Panels (${panels.length})`, value: panelSummary, inline: false },
                { name: '🛠️ Embed Builder Sessions', value: sessionLine, inline: false }
            );
        return interaction.editReply({ embeds: [embed] });
    }

    // === REMOVE ROLE ===
    if (interaction.commandName === 'remove-role') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const tipe = interaction.options.getString('tipe');
        const current = config.roles[tipe];
        if (!current) {
            return interaction.editReply({ content: `ℹ️ Role **${tipe}** memang belum di-set, tidak ada yang perlu dihapus.` });
        }
        delete config.roles[tipe];
        saveConfig(config);
        await logAudit(interaction.client, { action: 'REMOVE_ROLE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Hapus role **${tipe}** dari config (sebelumnya: <@&${current}>)`, guildId: interaction.guild.id });
        return interaction.editReply({ content: `✅ Role **${tipe}** berhasil dihapus dari config.\n\n💡 Untuk set ulang, pakai: \`/set-role ${tipe} @role\`` });
    }

    // === REMOVE CHANNEL ===
    if (interaction.commandName === 'remove-channel') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const tipe = interaction.options.getString('tipe');
        const current = config.channels[tipe];
        if (!current) {
            return interaction.editReply({ content: `ℹ️ Channel **${tipe}** memang belum di-set, tidak ada yang perlu dihapus.` });
        }
        delete config.channels[tipe];
        saveConfig(config);
        await logAudit(interaction.client, { action: 'REMOVE_CHANNEL', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Hapus channel **${tipe}** dari config (sebelumnya: <#${current}>)`, guildId: interaction.guild.id });
        return interaction.editReply({ content: `✅ Channel **${tipe}** berhasil dihapus dari config.\n\n💡 Untuk set ulang, pakai: \`/set-channel ${tipe} #channel\`` });
    }

    // === LIST MESSAGES ===
    if (interaction.commandName === 'list-messages') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const fields = [];
        const labels = {
            welcomeTitle: '👋 Welcome Title',
            welcomeBody: '👋 Welcome Body',
            goodbyeTitle: '👋 Goodbye Title',
            goodbyeBody: '👋 Goodbye Body',
            verifyTitle: '✅ Verify Title',
            verifyBody: '✅ Verify Body',
            ticketTitle: '🎫 Ticket Title',
            ticketBody: '🎫 Ticket Body'
        };
        for (const [key, label] of Object.entries(labels)) {
            const val = config.messages[key] || '(kosong)';
            // Potong teks panjang supaya muat di field Discord (1024 char)
            const truncated = val.length > 500 ? val.slice(0, 500) + '...' : val;
            fields.push({ name: label, value: '```\n' + truncated + '\n```', inline: false });
        }
        const embed = embeds.info('📝 DAFTAR PESAN EMBED', 'Berikut semua teks pesan saat ini. Pakai `/set-message` untuk ubah, `/reset-message` untuk kembalikan ke default.')
            .addFields(fields);
        return interaction.editReply({ embeds: [embed] });
    }

    // === RESET MESSAGE ===
    if (interaction.commandName === 'reset-message') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const tipe = interaction.options.getString('tipe');

        if (tipe === 'ALL') {
            config.messages = { ...DEFAULTS.messages };
            saveConfig(config);
            await logAudit(interaction.client, { action: 'RESET_MESSAGE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Reset SEMUA pesan ke default`, guildId: interaction.guild.id });
            return interaction.editReply({ content: '✅ **SEMUA pesan** berhasil direset ke default.' });
        }

        const before = config.messages[tipe];
        config.messages[tipe] = DEFAULTS.messages[tipe];
        saveConfig(config);
        await logAudit(interaction.client, { action: 'RESET_MESSAGE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Reset pesan **${tipe}** ke default`, guildId: interaction.guild.id });
        return interaction.editReply({
            content: `✅ Pesan **${tipe}** berhasil direset ke default.\n\n**Sebelumnya:**\n\`\`\`\n${before}\n\`\`\`\n**Sekarang:**\n\`\`\`\n${config.messages[tipe]}\n\`\`\``
        });
    }

    // === RESET CONFIG (hapus semua) ===
    if (interaction.commandName === 'reset-config') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const fresh = {
            roles: {},
            channels: {},
            messages: { ...DEFAULTS.messages },
            colors: { ...DEFAULTS.colors },
            products: []
        };
        saveConfig(fresh);
        await logAudit(interaction.client, { action: 'RESET_CONFIG', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `⚠️ RESET CONFIG TOTAL — semua setting dihapus`, guildId: interaction.guild.id });
        return interaction.editReply({
            content: '⚠️ **SEMUA konfigurasi berhasil direset.**\n\nSekarang config.json kosong. Silakan set ulang:\n• `/set-role verified @role`\n• `/set-role unverified @role`\n• `/set-role admin @role`\n• `/set-channel welcome #channel`\n• `/set-channel goodbye #channel`\n• `/set-channel invoice #channel`\n• `/add-product label value price duration`'
        });
    }

    // === SET PRODUCT ROLE (auto-role + auto-expire) ===
    if (interaction.commandName === 'set-product-role') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const value = interaction.options.getString('value');
        const role = interaction.options.getRole('role');
        const days = interaction.options.getInteger('days');

        const product = config.products.find(p => p.value === value);
        if (!product) {
            return interaction.editReply({ content: `❌ Produk dengan value \`${value}\` tidak ditemukan. Pakai \`/list-products\` untuk lihat daftar.` });
        }

        product.roleId = role.id;
        product.days = days;
        saveConfig(config);
        await logAudit(interaction.client, { action: 'EDIT_PRODUCT', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Set auto-role produk **${product.label}** → ${role.name} (${days > 0 ? days + ' hari' : 'permanen'})`, guildId: interaction.guild.id });

        const expireInfo = days > 0
            ? `akan otomatis dihapus setelah **${days} hari**`
            : '**permanen** (tidak akan otomatis dihapus)';
        return interaction.editReply({
            content: `✅ Auto-role untuk produk **${product.label}** diatur!\n\n🎁 Role: ${role}\n⏰ Expire: ${expireInfo}\n\n💡 Saat admin klik "Transaksi Sukses" di tiket, role akan otomatis diberikan ke pembeli.`
        });
    }

    // === REMOVE PRODUCT ROLE ===
    if (interaction.commandName === 'remove-product-role') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const value = interaction.options.getString('value');

        const product = config.products.find(p => p.value === value);
        if (!product) {
            return interaction.editReply({ content: `❌ Produk dengan value \`${value}\` tidak ditemukan.` });
        }
        if (!product.roleId) {
            return interaction.editReply({ content: `ℹ️ Produk **${product.label}** memang belum punya auto-role.` });
        }

        delete product.roleId;
        delete product.days;
        saveConfig(config);
        await logAudit(interaction.client, { action: 'EDIT_PRODUCT', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Hapus auto-role produk **${product.label}**`, guildId: interaction.guild.id });
        return interaction.editReply({ content: `✅ Auto-role untuk produk **${product.label}** berhasil dihapus.` });
    }

    // === LIST PRODUCT ROLES ===
    if (interaction.commandName === 'list-product-roles') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const withRoles = config.products.filter(p => p.roleId);
        if (withRoles.length === 0) {
            return interaction.editReply({ content: '📭 Belum ada produk yang punya auto-role. Pakai `/set-product-role` untuk setup.' });
        }
        const list = withRoles.map(p => {
            const roleMention = `<@&${p.roleId}>`;
            const expire = p.days > 0 ? `${p.days} hari` : 'permanen';
            return `• **${p.label}** (\`${p.value}\`) → ${roleMention} — expire: ${expire}`;
        }).join('\n');
        const embed = embeds.info('🎁 AUTO-ROLE PER PRODUK', list);
        return interaction.editReply({ embeds: [embed] });
    }

    // ====================================================
    // === /set-key — BERI KEY + ROLE + EXTEND SCHEDULE ===
    // ====================================================
    if (interaction.commandName === 'set-key') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user');
        const value = interaction.options.getString('value');
        const keyValue = interaction.options.getString('key');

        const product = config.products.find(p => p.value === value);
        if (!product) {
            return interaction.editReply({ content: `❌ Produk value \`${value}\` tidak ditemukan. Pakai \`/list-products\` untuk lihat daftar.` });
        }
        if (!product.roleId) {
            return interaction.editReply({ content: `❌ Produk **${product.label}** belum punya auto-role. Pakai \`/set-product-role\` dulu.` });
        }

        const guild = interaction.guild;
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) {
            return interaction.editReply({ content: `❌ User <@${user.id}> tidak ada di server.` });
        }
        const role = guild.roles.cache.get(product.roleId);
        if (!role) {
            return interaction.editReply({ content: `❌ Role ID \`${product.roleId}\` tidak ditemukan di guild.` });
        }

        // 1. Simpan key
        const keyEntry = addKey({
            key: keyValue,
            userId: member.id,
            username: member.user.tag,
            roleId: role.id,
            productName: product.label,
            days: product.days || 0
        });

        // 2. Beri role
        try {
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role);
            }
        } catch (err) {
            return interaction.editReply({ content: `❌ Gagal add role ${role}. Pastikan role bot ada di ATAS role tersebut.\nKey tetap disimpan.` });
        }

        // 3. Schedule (MAX EXTEND)
        const schedResult = scheduleRoleRemoval({
            userId: member.id,
            roleId: role.id,
            guildId: guild.id,
            days: product.days || 0,
            expireAt: keyEntry.expireAt,
            productName: product.label
        });

        // 4. DM member
        let dmSent = false;
        try {
            let expireInfo;
            if (keyEntry.expireAt === null) {
                expireInfo = 'Role bersifat **permanen**.';
            } else {
                const days = Math.ceil((keyEntry.expireAt - Date.now()) / 86400000);
                expireInfo = `Role akan otomatis dihapus setelah **${days} hari** (mengikuti sisa key terbanyak).`;
            }
            await member.send({
                content: `🎁 **Key Baru!**\n\n` +
                    `Admin memberimu key untuk produk **${product.label}** di **${guild.name}**.\n\n` +
                    `🔑 **Key:**\n\`\`\`\n${keyValue}\n\`\`\`\n` +
                    `🎭 Role: ${role}\n⏰ ${expireInfo}`
            });
            dmSent = true;
        } catch (_) {}

        // 5. P2-1 FIX: kirim invoice juga (sebelumnya hanya modal set key yang kirim invoice,
        //    /set-key slash command skip — inkonsistensi jejak transaksi).
        let invoiceSent = false;
        try {
            const { sendInvoice } = require('../utils/ticketManager');
            // Buat pseudo-channel dari guild untuk akses invoiceChannel.
            // sendInvoice mengambil channel dari channel.guild.channels.cache,
            // jadi kita oper interaction.channel (channel command dijalankan).
            if (interaction.channel && interaction.channel.guild) {
                invoiceSent = await sendInvoice(interaction.channel, member.id, product.label, product.price, interaction.user);
            }
        } catch (err) {
            console.warn('Gagal kirim invoice dari /set-key:', err.message);
        }

        // 6. Track purchase untuk stats
        try { trackPurchase(member.id, parsePriceNum(product.price)); } catch (_) {}

        // 7. Audit log (P1-10 FIX: sebelumnya tidak ada logAudit untuk SET_KEY)
        await logAudit(interaction.client, {
            action: 'SET_KEY',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Set key untuk <@${member.id}> — produk: **${product.label}**, role: ${role.name}, key: \`${keyValue.slice(0, 8)}...\``,
            guildId: interaction.guild.id
        });

        const expireStr = keyEntry.expireAt === null ? 'permanen' : `${Math.ceil((keyEntry.expireAt - Date.now()) / 86400000)} hari`;
        return interaction.editReply({
            content: `✅ **Set Key sukses!**\n\n` +
                `👤 User: ${member}\n` +
                `📦 Produk: ${product.label}\n` +
                `🔑 Key: \`${keyValue}\`\n` +
                `🎭 Role: ${role}\n` +
                `⏰ Expire: ${expireStr}\n` +
                `${schedResult.extended ? '↳ Schedule di-extend (MAX EXTEND).' : (schedResult.permanent ? '↳ Permanen, schedule lama dihapus.' : '↳ Schedule baru dibuat.')}\n` +
                `${dmSent ? '📬 DM terkirim.' : '⚠️ DM gagal (DM ditutup).'}\n` +
                `${invoiceSent ? '🧾 Invoice terkirim.' : '⚠️ Invoice tidak terkirim (channel invoice belum di-set).'}`
        });
    }

    // ====================================================
    // === /list-keys — LIHAT SEMUA KEY USER ===
    // ====================================================
    if (interaction.commandName === 'list-keys') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user');

        const allKeys = findAllByUser(user.id);
        if (allKeys.length === 0) {
            return interaction.editReply({ content: `📭 <@${user.id}> tidak punya key apa pun.` });
        }

        // Pisahkan jadi aktif & expired
        const now = Date.now();
        const active = allKeys.filter(k => k.expireAt === null || k.expireAt > now);
        const expired = allKeys.filter(k => k.expireAt !== null && k.expireAt <= now);

        const fields = [];
        if (active.length > 0) {
            fields.push({
                name: `✅ Key Aktif (${active.length})`,
                value: formatKeysForUser(active, now).slice(0, 1024),
                inline: false
            });
        }
        if (expired.length > 0) {
            fields.push({
                name: `⏰ Key Expired (${expired.length}) — akan dihapus otomatis`,
                value: formatKeysForUser(expired, now).slice(0, 1024),
                inline: false
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(`🔑 Daftar Key — ${user.tag}`)
            .setDescription(`Total: **${allKeys.length}** key (${active.length} aktif, ${expired.length} expired)`)
            .setColor(0x5865F2)
            .addFields(fields)
            .setFooter({ text: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }

    // ====================================================
    // === /clear-schedule — HAPUS SCHEDULE (+ KEY) ===
    // ====================================================
    if (interaction.commandName === 'clear-schedule') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user');
        const clearKeys = interaction.options.getBoolean('clear_keys') || false;

        // Hapus semua schedule milik user
        const removedSched = removeAllSchedulesByUser(user.id);

        // Hapus key kalau diminta
        let removedKeys = 0;
        if (clearKeys) {
            removedKeys = removeAllKeysByUser(user.id);
        }

        // Opsional: lepas semua role yang terkait schedule?
        // Untuk safety, tidak otomatis lepas role di sini. Admin bisa lepas manual.
        // Tapi kalau clear_keys=true, berarti full reset VIP → lepas role yang ada di config produk
        let rolesRemoved = [];
        if (clearKeys) {
            const guild = interaction.guild;
            const member = await guild.members.fetch(user.id).catch(() => null);
            if (member) {
                const productRoleIds = new Set(
                    config.products.filter(p => p.roleId).map(p => p.roleId)
                );
                for (const rid of productRoleIds) {
                    if (member.roles.cache.has(rid)) {
                        try {
                            await member.roles.remove(rid);
                            const r = guild.roles.cache.get(rid);
                            rolesRemoved.push(r ? r.name : rid);
                        } catch (_) {}
                    }
                }
            }
        }

        const msg = `🧹 **Clear selesai!**\n\n` +
            `👤 User: <@${user.id}>\n` +
            `📋 Schedule dihapus: **${removedSched}**\n` +
            (clearKeys
                ? `🔑 Key dihapus: **${removedKeys}**\n` +
                  (rolesRemoved.length > 0 ? `🎭 Role dilepas: ${rolesRemoved.map(n => `\`${n}\``).join(', ')}\n` : '')
                : `ℹ️ Key TIDAK dihapus (clear_keys=false). Pakai \`clear_keys:true\` untuk reset total VIP.\n`);

        await logAudit(interaction.client, { action: 'CLEAR_SCHEDULE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Clear schedule <@${user.id}>: ${removedSched} schedule${clearKeys ? ` + ${removedKeys} key${rolesRemoved.length > 0 ? ` + ${rolesRemoved.length} role` : ''}` : ' (tanpa key)'}`, guildId: interaction.guild.id });

        return interaction.editReply({ content: msg });
    }

    // ====================================================
    // === SELF-ROLE: /setup-selfrole ===
    // ====================================================
    if (interaction.commandName === 'setup-selfrole') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const type = interaction.options.getString('type') || 'button';
        const exclusive = interaction.options.getBoolean('exclusive') || false;

        // Buat panel (tanpa messageId dulu, akan diupdate setelah message dikirim)
        const panel = createPanel({
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            title,
            description,
            type,
            exclusive
        });

        // Render embed + komponen awal (komponen kosong karena belum ada role)
        const embed = buildPanelEmbed(panel, interaction.client);
        const components = buildPanelComponents(panel);

        // Kirim panel message
        // P0-5 FIX: rollback panel entry kalau gagal kirim message (sebelumnya zombie entry).
        let panelMsg;
        try {
            panelMsg = await interaction.channel.send({ embeds: [embed], components });
        } catch (err) {
            console.error('Gagal kirim self-role panel:', err.message);
            try { deleteSelfRolePanel(panel.id); } catch (_) {}
            return interaction.editReply({ content: `❌ Gagal kirim panel ke ${interaction.channel}. Cek permission bot. Entry di-rollback.` });
        }
        if (!panelMsg) {
            try { deleteSelfRolePanel(panel.id); } catch (_) {}
            return interaction.editReply({ content: `❌ Gagal kirim panel (channel tidak ada). Entry di-rollback.` });
        }

        // Update messageId
        setMessageId(panel.id, panelMsg.id);
        await logAudit(interaction.client, { action: 'SETUP_SELFROLE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Buat panel self-role **${title}** (\`${panel.id}\`) di ${interaction.channel} — tipe: ${panel.type}, exclusive: ${panel.exclusive}`, guildId: interaction.guild.id });

        return interaction.editReply({
            content: `✅ **Panel self-role dibuat!**\n\n` +
                `🆔 Panel ID: \`${panel.id}\`\n` +
                `📍 Channel: ${interaction.channel}\n` +
                `🎨 Tipe: **${panel.type}**\n` +
                `🔒 Mode: **${panel.exclusive ? 'Eksklusif (1 role)' : 'Multi (boleh banyak)'}**\n\n` +
                `💡 Sekarang tambah role ke panel pakai:\n\`\`\`\n/selfrole-add panel_id:${panel.id} role:@role label:Notif emoji:🔔\n\`\`\``
        });
    }

    // ====================================================
    // === SELF-ROLE: /selfrole-add ===
    // ====================================================
    if (interaction.commandName === 'selfrole-add') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const panelId = interaction.options.getString('panel_id');
        const role = interaction.options.getRole('role');
        const label = interaction.options.getString('label');
        const emoji = interaction.options.getString('emoji') || '';
        const description = interaction.options.getString('description') || '';

        const panel = getPanel(panelId);
        if (!panel) {
            return interaction.editReply({ content: `❌ Panel ID \`${panelId}\` tidak ditemukan. Pakai \`/selfrole-list\` untuk lihat daftar.` });
        }
        if (panel.guildId !== interaction.guild.id) {
            return interaction.editReply({ content: `❌ Panel ini bukan dari guild ini.` });
        }

        const result = addRoleToPanel(panelId, {
            roleId: role.id,
            label,
            emoji,
            description
        });
        if (!result.ok) {
            return interaction.editReply({ content: `❌ ${result.error}` });
        }

        // Update panel message
        const updatedPanel = result.panel;
        try {
            const channel = interaction.guild.channels.cache.get(updatedPanel.channelId);
            if (channel) {
                const msg = await channel.messages.fetch(updatedPanel.messageId).catch(() => null);
                if (msg) {
                    const embed = buildPanelEmbed(updatedPanel, interaction.client);
                    const components = buildPanelComponents(updatedPanel);
                    await msg.edit({ embeds: [embed], components });
                }
            }
        } catch (err) {
            console.warn('Gagal update panel message:', err.message);
        }

        await logAudit(interaction.client, { action: 'SELFROLE_ADD', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Tambah role ${role.name} ke panel \`${panelId}\` (label: ${label})`, guildId: interaction.guild.id });
        return interaction.editReply({
            content: `✅ Role ${role} ditambahkan ke panel \`${panelId}\`.\nLabel: **${label}**${emoji ? ` | Emoji: ${emoji}` : ''}${description ? ` | Desc: ${description}` : ''}`
        });
    }

    // ====================================================
    // === SELF-ROLE: /selfrole-remove ===
    // ====================================================
    if (interaction.commandName === 'selfrole-remove') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const panelId = interaction.options.getString('panel_id');
        const role = interaction.options.getRole('role');

        const result = removeRoleFromPanel(panelId, role.id);
        if (!result.ok) {
            return interaction.editReply({ content: `❌ ${result.error}` });
        }

        // Update panel message
        const updatedPanel = result.panel;
        try {
            const channel = interaction.guild.channels.cache.get(updatedPanel.channelId);
            if (channel) {
                const msg = await channel.messages.fetch(updatedPanel.messageId).catch(() => null);
                if (msg) {
                    const embed = buildPanelEmbed(updatedPanel, interaction.client);
                    const components = buildPanelComponents(updatedPanel);
                    await msg.edit({ embeds: [embed], components });
                }
            }
        } catch (err) {
            console.warn('Gagal update panel message:', err.message);
        }

        await logAudit(interaction.client, { action: 'SELFROLE_REMOVE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Hapus role ${role.name} dari panel \`${panelId}\``, guildId: interaction.guild.id });
        return interaction.editReply({
            content: `✅ Role ${role} dihapus dari panel \`${panelId}\`.`
        });
    }

    // ====================================================
    // === SELF-ROLE: /selfrole-list ===
    // ====================================================
    if (interaction.commandName === 'selfrole-list') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const panels = getPanelsByGuild(interaction.guild.id);
        if (panels.length === 0) {
            return interaction.editReply({ content: '📭 Belum ada panel self-role di guild ini. Pakai `/setup-selfrole` untuk membuat.' });
        }

        const lines = panels.map(p => {
            const typeStr = p.type === 'select' ? '📋 Select' : '🔘 Button';
            const modeStr = p.exclusive ? '🔒 Eksklusif' : '✅ Multi';
            const rolesStr = p.roles.length === 0
                ? '_kosong_'
                : p.roles.map(r => `${r.emoji ? r.emoji + ' ' : ''}<@&${r.roleId}>`).join(', ');
            return `• **${p.title}**\n  🆔 \`${p.id}\` | ${typeStr} | ${modeStr} | ${p.roles.length} role\n  📍 <#${p.channelId}> | [pesan](https://discord.com/channels/${p.guildId}/${p.channelId}/${p.messageId})\n  Role: ${rolesStr}`;
        }).join('\n\n');

        const embed = new EmbedBuilder()
            .setTitle('🎭 DAFTAR PANEL SELF-ROLE')
            .setDescription(lines)
            .setColor(0x9B59B6)
            .setFooter({ text: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }

    // ====================================================
    // === SELF-ROLE: /selfrole-delete ===
    // ====================================================
    if (interaction.commandName === 'selfrole-delete') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const panelId = interaction.options.getString('panel_id');
        const panel = getPanel(panelId);
        if (!panel) {
            return interaction.editReply({ content: `❌ Panel ID \`${panelId}\` tidak ditemukan.` });
        }

        // Hapus panel message
        try {
            const channel = interaction.guild.channels.cache.get(panel.channelId);
            if (channel) {
                const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
                if (msg) await msg.delete();
            }
        } catch (err) {
            console.warn('Gagal hapus panel message:', err.message);
        }

        deletePanel(panelId);
        await logAudit(interaction.client, { action: 'SELFROLE_DELETE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Hapus panel self-role **${panel.title}** (\`${panelId}\`)`, guildId: interaction.guild.id });
        return interaction.editReply({ content: `✅ Panel \`${panelId}\` (${panel.title}) berhasil dihapus.` });
    }

    // ====================================================
    // === /announce — QUICK ANNOUNCE (1 command, 1 embed) ===
    // ====================================================
    if (interaction.commandName === 'announce') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const channel = interaction.options.getChannel('channel');
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const colorStr = interaction.options.getString('color');
        const image = interaction.options.getString('image');
        const thumbnail = interaction.options.getString('thumbnail');
        const mention = interaction.options.getString('mention');

        // Parse color
        let color = 0x5865F2; // default blurple
        if (colorStr) {
            const { parseColor } = require('../utils/embedBuilderSessions');
            const parsed = parseColor(colorStr);
            if (parsed === null) {
                return interaction.editReply({ content: `❌ Color tidak valid: \`${colorStr}\`. Pakai format hex 6 digit, mis. \`#FF0000\` atau \`FF0000\`.` });
            }
            color = parsed;
        }

        // Validate URLs
        if (image && !/^https?:\/\//i.test(image)) {
            return interaction.editReply({ content: '❌ Image URL harus mulai dengan `http://` atau `https://`' });
        }
        if (thumbnail && !/^https?:\/\//i.test(thumbnail)) {
            return interaction.editReply({ content: '❌ Thumbnail URL harus mulai dengan `http://` atau `https://`' });
        }

        // Build embed
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setFooter({
                text: `Diumumkan oleh ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp();
        if (image) embed.setImage(image);
        if (thumbnail) embed.setThumbnail(thumbnail);

        // Resolve target channel
        const targetChannel = interaction.guild.channels.cache.get(channel.id);
        if (!targetChannel) {
            return interaction.editReply({ content: '❌ Channel tidak ditemukan.' });
        }

        // Build content (mention)
        let content = undefined;
        if (mention) {
            const m = mention.trim().toLowerCase();
            if (m === 'everyone' || m === '@everyone') {
                content = '@everyone';
            } else if (m === 'here' || m === '@here') {
                content = '@here';
            } else {
                // mention bisa berupa <@&role_id> atau <@user_id> atau text biasa
                content = mention;
            }
        }

        try {
            await targetChannel.send({ content, embeds: [embed] });
            await logAudit(interaction.client, { action: 'ANNOUNCE_SEND', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Kirim announce ke ${targetChannel}: **${title}**${mention ? ` | mention: ${mention}` : ''}`, guildId: interaction.guild.id });
            return interaction.editReply({
                content: `✅ Announce terkirim ke ${targetChannel}!\n\n📋 **Preview:**`,
                embeds: [embed]
            });
        } catch (err) {
            return interaction.editReply({ content: `❌ Gagal kirim ke ${targetChannel}: ${err.message}` });
        }
    }

    // ====================================================
    // === /embed-builder — INTERACTIVE BUILDER ===
    // ====================================================
    if (interaction.commandName === 'embed-builder') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Buat session baru
        const session = createSession(interaction.user.id, interaction.channel.id);

        // Build initial embed (default state)
        const previewEmbed = buildEmbed(session);

        // Komponen: 1 select menu + 1 row dengan 3 buttons
        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`emb_edit:${session.id}`)
                .setPlaceholder('✏️ Pilih bagian embed yang ingin diedit...')
                .addOptions([
                    { label: 'Title',                 value: 'title',             emoji: '✏️', description: 'Judul embed (maks 256 char)' },
                    { label: 'Description',           value: 'description',       emoji: '📝', description: 'Isi utama embed (maks 4000 char)' },
                    { label: 'Color',                 value: 'color',             emoji: '🎨', description: 'Warna hex (mis. #FF0000)' },
                    { label: 'Image',                 value: 'image',             emoji: '🖼️', description: 'URL gambar besar' },
                    { label: 'Thumbnail',             value: 'thumbnail',         emoji: '🖼️', description: 'URL gambar kecil (pojok kanan atas)' },
                    { label: 'Footer',                value: 'footer',            emoji: '👣', description: 'Teks & icon di bawah embed' },
                    { label: 'Author',                value: 'author',            emoji: '👤', description: 'Teks & icon di atas embed' },
                    { label: 'Add Field (normal)',    value: 'add_field',         emoji: '➕', description: 'Tambah field (full width)' },
                    { label: 'Add Field (inline)',    value: 'add_field_inline',  emoji: '➕', description: 'Tambah field (sejajar samping)' },
                    { label: 'Remove Last Field',     value: 'remove_field',      emoji: '❌', description: 'Hapus field terakhir' },
                    { label: 'Clear All Fields',      value: 'clear_fields',      emoji: '🧹', description: 'Hapus SEMUA field' },
                    { label: 'Toggle Timestamp',      value: 'toggle_timestamp',  emoji: '🕒', description: 'Show/hide timestamp' }
                ])
        );

        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`emb_preview:${session.id}`).setLabel('Preview').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`emb_send:${session.id}`).setLabel('Send').setEmoji('📤').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`emb_cancel:${session.id}`).setLabel('Cancel').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
        );

        // Kirim draft message
        const draftMsg = await interaction.channel.send({
            content: `🛠️ **Embed Builder Draft** — dimulai oleh <@${interaction.user.id}>\n` +
                `Preview real-time di bawah. Klik dropdown untuk edit bagian, atau tombol untuk preview/send/cancel.\n` +
                `🆔 Session: \`${session.id}\``,
            embeds: [previewEmbed],
            components: [selectRow, actionRow]
        });

        // Simpan messageId ke session
        session.messageId = draftMsg.id;

        return interaction.editReply({
            content: `✅ Embed builder dimulai!\n📍 Draft: ${draftMsg}\n\n💡 Klik dropdown di draft untuk edit bagian embed. Setelah selesai, klik **📤 Send** untuk kirim ke channel target.`
        });
    }

    // ====================================================
    // === /embed-list — LIST ACTIVE EMBED BUILDER SESSIONS ===
    // ====================================================
    if (interaction.commandName === 'embed-list') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const userSessions = getSessionsByUser(interaction.user.id);
        if (userSessions.length === 0) {
            return interaction.editReply({
                content: '📭 **Tidak ada session embed builder aktif untuk kamu.**\n\nPakai `/embed-builder` untuk membuat draft baru.'
            });
        }

        const lines = userSessions.map(s => {
            const d = s.data;
            const summary = [];
            if (d.title) summary.push('title');
            if (d.description) summary.push('desc');
            if (d.fields && d.fields.length > 0) summary.push(`${d.fields.length} field${d.fields.length > 1 ? 's' : ''}`);
            if (d.image) summary.push('image');
            if (d.thumbnail) summary.push('thumb');
            if (d.footer && d.footer.text) summary.push('footer');
            if (d.author && d.author.name) summary.push('author');
            const summaryStr = summary.length > 0 ? summary.join(', ') : '*(kosong)*';

            const ageMs = Date.now() - s.createdAt;
            const ageMin = Math.floor(ageMs / 60000);
            const ageStr = ageMin < 1 ? 'baru saja' : ageMin < 60 ? `${ageMin}m lalu` : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m lalu`;

            const link = s.messageId
                ? `[🔗 buka draft](https://discord.com/channels/${interaction.guild.id}/${s.channelId}/${s.messageId})`
                : '*(draft belum dibuat)*';
            const channelStr = s.channelId ? `<#${s.channelId}>` : '???';

            return `• 🆔 \`${s.id}\`\n  📍 ${channelStr} | ${link}\n  ⏰ Dibuat: ${ageStr} | 📝 ${summaryStr}`;
        }).join('\n\n');

        const embed = new EmbedBuilder()
            .setTitle('🛠️ SESSION EMBED BUILDER AKTIF')
            .setDescription(
                `Kamu punya **${userSessions.length}** session aktif.\n\n` +
                lines +
                `\n\n💡 **Cara pakai:** Klik link **buka draft** untuk lompat ke pesan draft-nya, lalu pakai dropdown di situ untuk edit. Setiap draft independen — gak akan saling ganggu.`
            )
            .setColor(0x5865F2)
            .setFooter({ text: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }

    // ====================================================
    // === /embed-cancel — CANCEL EMBED BUILDER SESSION BY ID ===
    // ====================================================
    if (interaction.commandName === 'embed-cancel') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const sessionId = interaction.options.getString('session_id');
        const session = deleteSessionByOwner(sessionId, interaction.user.id);

        if (!session) {
            return interaction.editReply({
                content: `❌ Session \`${sessionId}\` tidak ditemukan atau bukan milik kamu.\n\nPakai \`/embed-list\` untuk lihat session aktif.`
            });
        }

        // Coba hapus draft message-nya juga kalau masih ada
        let draftDeleted = false;
        try {
            const channel = interaction.guild.channels.cache.get(session.channelId);
            if (channel && session.messageId) {
                const msg = await channel.messages.fetch(session.messageId).catch(() => null);
                if (msg) {
                    await msg.delete();
                    draftDeleted = true;
                }
            }
        } catch (_) {}

        return interaction.editReply({
            content: `🗑️ Session \`${sessionId}\` dibatalkan.` + (draftDeleted ? ' Pesan draft juga dihapus.' : ' (Pesan draft sudah tidak ditemukan.)')
        });
    }

    // ====================================================
    // === BACKUP — /backup-now, /backup-list, /restore-backup ===
    // ====================================================
    if (interaction.commandName === 'backup-now') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = createBackup();
        await logAudit(interaction.client, { action: 'BACKUP_NOW', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Backup manual: \`${result.backupName}\` (${result.filesCopied} files, ${formatBackupSize(result.totalSize)})`, guildId: interaction.guild.id });
        return interaction.editReply({
            content: `💾 **Backup berhasil dibuat!**\n\n` +
                `📁 Nama: \`${result.backupName}\`\n` +
                `📦 File disalin: **${result.filesCopied}**\n` +
                `📊 Ukuran total: **${formatBackupSize(result.totalSize)}**\n` +
                (result.errors.length > 0 ? `⚠️ Error: \`\`\`\n${result.errors.join('\n')}\n\`\`\`` : '') +
                `\n💡 Auto-backup berjalan tiap 24 jam + saat bot start. Maks 7 backup terbaru disimpan.`
        });
    }

    if (interaction.commandName === 'backup-list') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const backups = listBackups();
        if (backups.length === 0) {
            return interaction.editReply({ content: '📭 Belum ada backup. Backup otomatis dibuat saat bot start.' });
        }
        const lines = backups.map((b, i) => {
            const ageMs = Date.now() - b.mtime.getTime();
            const ageMin = Math.floor(ageMs / 60000);
            const ageStr = ageMin < 60 ? `${ageMin}m lalu` : ageMin < 1440 ? `${Math.floor(ageMin / 60)}h lalu` : `${Math.floor(ageMin / 1440)}h lalu`;
            return `\`${i + 1}.\` 📁 \`${b.name}\`\n   📦 ${b.fileCount} file | 📊 ${formatBackupSize(b.size)} | ⏰ ${ageStr}`;
        }).join('\n\n');
        const embed = new EmbedBuilder()
            .setTitle('💾 DAFTAR BACKUP')
            .setDescription(`Total **${backups.length}** backup tersimpan (maks 7, auto-clean yang lama).\n\n${lines}\n\n💡 Restore pakai: \`/restore-backup name:<nama-folder>\``)
            .setColor(0x57F287)
            .setFooter({ text: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'restore-backup') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const name = interaction.options.getString('name');
        const result = restoreBackup(name);
        if (!result.ok) {
            return interaction.editReply({ content: `❌ Gagal restore: ${result.errors[0]}\n\nPakai \`/backup-list\` untuk lihat daftar backup yang valid.` });
        }
        await logAudit(interaction.client, { action: 'RESTORE_BACKUP', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Restore backup \`${name}\` (${result.filesRestored} files). Pre-restore backup: \`${result.preRestoreName}\``, guildId: interaction.guild.id });
        return interaction.editReply({
            content: `♻️ **Restore berhasil!**\n\n` +
                `📁 Dari: \`${name}\`\n` +
                `📦 File dipulihkan: **${result.filesRestored}**\n` +
                `💾 Backup sebelum restore: \`${result.preRestoreName}\` (safety net)\n\n` +
                `⚠️ **RESTART bot sekarang** supaya data baru ke-load.\n\`\`\`bash\nnpm start\n\`\`\`\n` +
                (result.errors.length > 0 ? `⚠️ Error: \`\`\`\n${result.errors.join('\n')}\n\`\`\`` : '')
        });
    }

    // ====================================================
    // === GIVEAWAY — /giveaway create/list/end/reroll ===
    // ====================================================
    if (interaction.commandName === 'giveaway') {
        const sub = interaction.options.getSubcommand();

        // --- /giveaway create ---
        if (sub === 'create') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const channel = interaction.options.getChannel('channel');
            const prize = interaction.options.getString('prize');
            const winners = interaction.options.getInteger('winners') || 1;
            const durationMin = interaction.options.getInteger('duration');
            const requiredRole = interaction.options.getRole('required_role');

            if (durationMin < 1) {
                return interaction.editReply({ content: '❌ Durasi minimal 1 menit.' });
            }
            if (winners < 1 || winners > 20) {
                return interaction.editReply({ content: '❌ Jumlah pemenang harus 1-20.' });
            }

            const endsAt = Date.now() + durationMin * 60000;
            const gw = createGiveaway({
                guildId: interaction.guild.id,
                channelId: channel.id,
                prize,
                winnersCount: winners,
                endsAt,
                hostId: interaction.user.id,
                hostTag: interaction.user.tag,
                requiredRoleId: requiredRole?.id || null
            });

            // Build giveaway embed
            const embed = new EmbedBuilder()
                .setTitle('🎉 GIVEAWAY!')
                .setDescription(
                    `🎁 **Prize:** ${prize}\n\n` +
                    `👥 **Pemenang:** ${winners}\n` +
                    `⏰ **Berakhir:** <t:${Math.floor(endsAt / 1000)}:R> (<t:${Math.floor(endsAt / 1000)}:F>)\n` +
                    `🎟️ **Peserta:** 0\n` +
                    (requiredRole ? `🔐 **Syarat:** Punya role ${requiredRole}\n` : '') +
                    `\n👇 Klik tombol **🎉 Join** di bawah untuk ikut!`
                )
                .setColor(0xF1C40F)
                .setFooter({ text: `Host: ${interaction.user.tag} | ID: ${gw.id}` })
                .setTimestamp();
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`gw_join:${gw.id}`).setLabel('🎉 Join').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`gw_leave:${gw.id}`).setLabel('🚪 Leave').setStyle(ButtonStyle.Secondary)
            );
            const msg = await channel.send({ embeds: [embed], components: [row], content: '@everyone 🎉 **GIVEAWAY BARU!**' }).catch(err => null);
            if (!msg) {
                // P0-5 FIX: rollback giveaway entry yang sudah tersimpan kalau gagal kirim message.
                // Sebelumnya entry tetap ada dengan messageId=null → zombie giveaway.
                try { removeGiveaway(gw.id); } catch (_) {}
                return interaction.editReply({ content: `❌ Gagal kirim giveaway ke ${channel}. Cek permission bot. Entry di-rollback.` });
            }
            setGiveawayMessageId(gw.id, msg.id);
            await logAudit(interaction.client, { action: 'GIVEAWAY_CREATE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Buat giveaway **${prize}** (${winners} pemenang, ${durationMin}m) di ${channel}`, guildId: interaction.guild.id });
            return interaction.editReply({ content: `✅ Giveaway dibuat di ${channel}!\n🆔 \`${gw.id}\`\n⏰ Berakhir <t:${Math.floor(endsAt / 1000)}:R>` });
        }

        // --- /giveaway list ---
        if (sub === 'list') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const all = getGiveawaysByGuild(interaction.guild.id);
            if (all.length === 0) {
                return interaction.editReply({ content: '📭 Belum ada giveaway di guild ini.' });
            }
            const lines = all.map(g => {
                const status = g.ended ? '✅ Selesai' : (g.endsAt <= Date.now() ? '⏳ Proses' : '🟢 Aktif');
                const winnersStr = g.ended && g.winnerIds.length > 0 ? g.winnerIds.map(id => `<@${id}>`).join(', ') : '—';
                return `• **${g.prize}** — ${status}\n  🆔 \`${g.id}\` | 👥 ${g.participantIds.length} peserta | 🏆 ${winnersStr}\n  📍 <#${g.channelId}> | ⏰ <t:${Math.floor(g.endsAt / 1000)}:R>`;
            }).join('\n\n');
            const embed = new EmbedBuilder()
                .setTitle('🎉 DAFTAR GIVEAWAY')
                .setDescription(lines)
                .setColor(0xF1C40F)
                .setFooter({ text: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // --- /giveaway end ---
        // P0-3 FIX: sebelumnya hanya pick + persist, TIDAK update message,
        // TIDAK announce winner, TIDAK DM winner, TIDAK track stats.
        // Sekarang: panggil processGiveawayEnd (shared dengan auto-end) supaya
        // message diupdate + announce + DM + track stats.
        if (sub === 'end') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const id = interaction.options.getString('id');
            const gw = getGiveaway(id);
            if (!gw) return interaction.editReply({ content: `❌ Giveaway \`${id}\` tidak ditemukan.` });
            if (gw.ended) return interaction.editReply({ content: `❌ Giveaway sudah berakhir.` });
            if (gw.guildId !== interaction.guild.id) return interaction.editReply({ content: '❌ Giveaway ini bukan dari guild ini.' });

            // Pick winners + persist ended state
            const winnerIds = pickWinners(gw.participantIds, gw.winnersCount);
            endGiveaway(id, winnerIds);

            // Re-fetch gw yang sudah di-update (winnerIds sudah persist)
            const updatedGw = getGiveaway(id);

            // Panggil shared processGiveawayEnd dengan skipPick=true supaya tidak pick 2x
            if (typeof interaction.client.processGiveawayEnd === 'function') {
                await interaction.client.processGiveawayEnd(interaction.client, updatedGw, { skipPick: true });
            }

            await logAudit(interaction.client, { action: 'GIVEAWAY_END', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `End giveaway \`${id}\` (${gw.prize}). Winners: ${winnerIds.length > 0 ? winnerIds.map(w => `<@${w}>`).join(', ') : 'tidak ada peserta'}`, guildId: interaction.guild.id });
            return interaction.editReply({ content: `✅ Giveaway **${gw.prize}** diakhiri!\n🏆 Winners: ${winnerIds.length > 0 ? winnerIds.map(w => `<@${w}>`).join(', ') : '_(tidak ada peserta)_'}\n\n📢 Pesan giveaway sudah diupdate + winner sudah di-DM + diumumkan ke channel.` });
        }

        // --- /giveaway reroll ---
        // P0-4 FIX: sebelumnya hanya return winnerId ke admin (ephemeral).
        // Sekarang: persist winner baru ke gw.winnerIds, announce ke channel,
        // DM winner, track stats. Juga exclude winner yang sudah ada supaya
        // tidak pick orang yang sama 2x.
        if (sub === 'reroll') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const id = interaction.options.getString('id');
            const gw = getGiveaway(id);
            if (!gw) return interaction.editReply({ content: `❌ Giveaway \`${id}\` tidak ditemukan.` });
            if (!gw.ended) return interaction.editReply({ content: `❌ Giveaway belum berakhir. End dulu pakai \`/giveaway end\`.` });

            const result = rerollGiveaway(id);
            if (!result) return interaction.editReply({ content: `❌ Giveaway \`${id}\` tidak ditemukan atau belum berakhir.` });
            if (!result.winnerId) return interaction.editReply({ content: '❌ Tidak ada peserta untuk di-reroll.' });

            // Announce winner baru ke channel + DM + track stats
            if (typeof interaction.client.announceRerollWinner === 'function') {
                await interaction.client.announceRerollWinner(interaction.client, result.gw, result.winnerId);
            }

            const reuseNote = result.reused ? ' _(semua peserta sudah pernah menang, fallback pick random)_' : '';
            await logAudit(interaction.client, { action: 'GIVEAWAY_REROLL', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Reroll giveaway \`${id}\` → new winner: <@${result.winnerId}>${reuseNote}`, guildId: interaction.guild.id });
            return interaction.editReply({ content: `🎲 **Reroll!** Winner baru: <@${result.winnerId}>${reuseNote}\n\n📢 Winner sudah di-DM + diumumkan ke channel giveaway.` });
        }
    }

    // ====================================================
    // === SCHEDULED ANNOUNCEMENTS — /announce-schedule, /announce-list, /announce-cancel ===
    // ====================================================
    if (interaction.commandName === 'announce-schedule') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const channel = interaction.options.getChannel('channel');
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const at = interaction.options.getString('at');
        const color = interaction.options.getString('color');
        const image = interaction.options.getString('image');
        const thumbnail = interaction.options.getString('thumbnail');
        const mention = interaction.options.getString('mention');
        const recurring = interaction.options.getString('recurring') || null;

        // Parse time
        const sendAt = parseAnnTime(at);
        if (!sendAt) {
            return interaction.editReply({
                content: '❌ Format waktu tidak valid.\n\nFormat yang didukung:\n• Relative: `30m`, `2h`, `1d`\n• Absolute: `2026-01-15 20:00` (WITA, format YYYY-MM-DD HH:MM)'
            });
        }
        if (sendAt <= Date.now()) {
            return interaction.editReply({ content: '❌ Waktu yang dimasukkan sudah lewat. Pakai waktu di masa depan.' });
        }

        // Parse color
        let colorNum = 0x5865F2;
        if (color) {
            const { parseColor } = require('../utils/embedBuilderSessions');
            const parsed = parseColor(color);
            if (parsed === null) {
                return interaction.editReply({ content: `❌ Color tidak valid: \`${color}\`. Pakai format hex 6 digit, mis. \`#FF0000\` atau \`FF0000\`.` });
            }
            colorNum = parsed;
        }

        // Validate URLs
        if (image && !/^https?:\/\//.test(image)) {
            return interaction.editReply({ content: '❌ Image URL harus mulai dengan `http://` atau `https://`' });
        }
        if (thumbnail && !/^https?:\/\//.test(thumbnail)) {
            return interaction.editReply({ content: '❌ Thumbnail URL harus mulai dengan `http://` atau `https://`' });
        }

        const entry = createScheduledAnn({
            guildId: interaction.guild.id,
            channelId: channel.id,
            sendAt,
            title,
            description,
            color: colorNum,
            image,
            thumbnail,
            mention,
            authorId: interaction.user.id,
            authorTag: interaction.user.tag,
            recurring
        });

        await logAudit(interaction.client, { action: 'ANNOUNCE_SCHEDULE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Schedule announce ke ${channel} pada <t:${Math.floor(sendAt / 1000)}:F>${recurring ? ` (recurring: ${recurring})` : ''} — Title: "${title}"`, guildId: interaction.guild.id });

        return interaction.editReply({
            content: `✅ **Announce dijadwalkan!**\n\n` +
                `📍 Channel: ${channel}\n` +
                `⏰ Kirim pada: <t:${Math.floor(sendAt / 1000)}:F> (<t:${Math.floor(sendAt / 1000)}:R>)\n` +
                (recurring ? `🔄 Recurring: **${recurring}**\n` : '') +
                `📝 Title: ${title}\n` +
                `🆔 ID: \`${entry.id}\`\n\n` +
                `💡 Cek dengan \`/announce-list\`, batalkan dengan \`/announce-cancel id:${entry.id}\``
        });
    }

    if (interaction.commandName === 'announce-list') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const entries = getScheduledAnnsByGuild(interaction.guild.id);
        const pending = entries.filter(e => !e.sent);
        if (pending.length === 0) {
            return interaction.editReply({ content: '📭 Tidak ada announce terjadwal yang pending. Pakai `/announce-schedule` untuk bikin.' });
        }
        const lines = pending.map(e => {
            const timeLeft = e.sendAt - Date.now();
            return `• 📝 **${e.data.title}**\n  🆔 \`${e.id}\`\n  📍 <#${e.channelId}> | ⏰ <t:${Math.floor(e.sendAt / 1000)}:F> (<t:${Math.floor(e.sendAt / 1000)}:R>)\n  ${e.recurring ? `🔄 Recurring: ${e.recurring}\n  ` : ''}👤 Oleh: ${e.data.authorTag}`;
        }).join('\n\n');
        const embed = new EmbedBuilder()
            .setTitle('⏰ ANNOUNCE TERJADWAL')
            .setDescription(`Total **${pending.length}** announce pending.\n\n${lines}`)
            .setColor(0x5865F2)
            .setFooter({ text: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'announce-cancel') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const id = interaction.options.getString('id');
        const entry = getScheduledAnn(id);
        if (!entry) return interaction.editReply({ content: `❌ Announce ID \`${id}\` tidak ditemukan.` });
        if (entry.sent) return interaction.editReply({ content: `❌ Announce sudah terkirim, tidak bisa dibatalkan.` });
        if (entry.guildId !== interaction.guild.id) return interaction.editReply({ content: '❌ Announce ini bukan dari guild ini.' });
        removeScheduledAnn(id);
        await logAudit(interaction.client, { action: 'ANNOUNCE_CANCEL', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Cancel scheduled announce \`${id}\` (Title: "${entry.data.title}")`, guildId: interaction.guild.id });
        return interaction.editReply({ content: `✅ Announce \`${id}\` (${entry.data.title}) dibatalkan.` });
    }

    // ====================================================
    // === WARN SYSTEM — /warn, /warn-list, /warn-remove, /warn-clear ===
    // ====================================================
    if (interaction.commandName === 'warn') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');

        if (user.id === interaction.user.id) {
            return interaction.editReply({ content: '❌ Tidak bisa warn diri sendiri.' });
        }
        if (user.bot) {
            return interaction.editReply({ content: '❌ Tidak bisa warn bot.' });
        }

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) {
            return interaction.editReply({ content: `❌ User <@${user.id}> tidak ada di server.` });
        }

        // Cek hierarki: admin harus lebih tinggi dari target
        if (member.roles.highest.position >= interaction.member.roles.highest.position) {
            return interaction.editReply({ content: '❌ Kamu tidak bisa warn member dengan role setingkat/lebih tinggi dari kamu.' });
        }

        const result = addWarn(user.id, {
            reason,
            warnedBy: interaction.user.id,
            warnedByTag: interaction.user.tag,
            guildId: interaction.guild.id
        });

        await logAudit(interaction.client, { action: 'WARN_ADD', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Warn <@${user.id}> (${user.tag}) — Reason: "${reason}" — Total: ${result.count} warn`, guildId: interaction.guild.id });

        // Eksekusi auto-action kalau perlu
        // P1-7 FIX: kalau actionAlreadyTaken=true, tidak re-apply timeout lagi
        // (user sudah pernah kena mute yang sama, jangan reset timer).
        let actionMsg = '';
        if (result.actionAlreadyTaken) {
            actionMsg = `\nℹ️ Auto-action tidak diulang (user sudah pernah kena action yang sama sebelumnya).`;
        } else if (result.actionToTake) {
            try {
                if (result.actionToTake === 'mute_1h' || result.actionToTake === 'mute_1d') {
                    const durationMin = result.actionToTake === 'mute_1h' ? 60 : 1440;
                    // Cari role mute (atau bikin timeout)
                    await member.timeout(durationMin * 60 * 1000, `Auto-action: ${result.count} warnings`).catch(()=>{});
                    actionMsg = `\n🔇 **Auto-action:** Timeout ${durationMin === 60 ? '1 jam' : '1 hari'} (${result.count} warnings)`;
                    markActionTaken(user.id, result.warnEntry.id, result.actionToTake);
                } else if (result.actionToTake === 'kick') {
                    await member.kick(`Auto-action: ${result.count} warnings`).catch(()=>{});
                    actionMsg = `\n👢 **Auto-action:** Kicked (${result.count} warnings)`;
                    markActionTaken(user.id, result.warnEntry.id, result.actionToTake);
                }
            } catch (err) {
                actionMsg = `\n⚠️ Auto-action gagal: ${err.message}`;
            }
        }

        // DM user
        try {
            await user.send(`⚠️ **Kamu mendapat warning di ${interaction.guild.name}**\n\nReason: ${reason}\nTotal warnings: ${result.count}\n${result.actionToTake ? `Action: ${result.actionToTake}` : 'Belum ada auto-action (threshold: 3=mute 1h, 5=mute 1d, 7=kick)'}`);
        } catch (_) {}

        return interaction.editReply({
            content: `⚠️ **<@${user.id}> telah diwarn.**\n\n` +
                `📝 Reason: ${reason}\n` +
                `📊 Total warnings: **${result.count}**\n` +
                `👤 Oleh: ${interaction.user.tag}${actionMsg}`
        });
    }

    if (interaction.commandName === 'warn-list') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user');
        const warns = getWarns(user.id);
        if (warns.length === 0) {
            return interaction.editReply({ content: `✅ <@${user.id}> tidak punya warning.` });
        }
        const lines = warns.map((w, i) => {
            const date = new Date(w.createdAt);
            return `\`${i + 1}.\` 🆔 \`${w.id}\`\n   📝 ${w.reason}\n   👤 Oleh: ${w.warnedByTag} | ⏰ <t:${Math.floor(w.createdAt / 1000)}:R>${w.actionTaken ? ` | ⚡ ${w.actionTaken}` : ''}`;
        }).join('\n\n');
        const embed = new EmbedBuilder()
            .setTitle(`⚠️ WARN HISTORY — ${user.tag}`)
            .setDescription(`Total **${warns.length}** warning.\n\n${lines}\n\n**Threshold:**\n• ${WARN_THRESHOLDS.mute1h} warn → mute 1 jam\n• ${WARN_THRESHOLDS.mute1d} warn → mute 1 hari\n• ${WARN_THRESHOLDS.kick} warn → kick`)
            .setColor(warns.length >= WARN_THRESHOLDS.kick ? 0xED4245 : warns.length >= WARN_THRESHOLDS.mute1h ? 0xE67E22 : 0xFEE75C)
            .setFooter({ text: `User ID: ${user.id}` })
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'warn-remove') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user');
        const warnId = interaction.options.getString('warn_id');
        const ok = removeWarn(user.id, warnId);
        if (!ok) {
            return interaction.editReply({ content: `❌ Warn ID \`${warnId}\` tidak ditemukan untuk user <@${user.id}>.` });
        }
        await logAudit(interaction.client, { action: 'WARN_REMOVE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Hapus warn \`${warnId}\` dari <@${user.id}>. Sisa: ${getWarnCount(user.id)} warn`, guildId: interaction.guild.id });
        return interaction.editReply({ content: `✅ Warn \`${warnId}\` dihapus dari <@${user.id}>.\n📊 Sisa warnings: **${getWarnCount(user.id)}**` });
    }

    if (interaction.commandName === 'warn-clear') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user');
        const count = clearWarns(user.id);
        if (count === 0) {
            return interaction.editReply({ content: `ℹ️ <@${user.id}> memang tidak punya warning.` });
        }
        await logAudit(interaction.client, { action: 'WARN_REMOVE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Clear ALL warns (${count}) dari <@${user.id}>`, guildId: interaction.guild.id });
        return interaction.editReply({ content: `✅ **${count}** warning dihapus dari <@${user.id}>.` });
    }

    // ====================================================
    // === STATS & LEADERBOARD — /stats, /leaderboard, /my-stats ===
    // ====================================================
    if (interaction.commandName === 'stats') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const stats = getServerStatsAll();
        const embed = new EmbedBuilder()
            .setTitle('📊 STATISTIK SERVER')
            .setDescription('Statistik agregat seluruh aktivitas member.')
            .setColor(0x5865F2)
            .addFields(
                { name: '👥 Total Member Tracked', value: `${stats.totalUsers}`, inline: true },
                { name: '💬 Total Pesan', value: `${stats.totalMessages.toLocaleString('id-ID')}`, inline: true },
                { name: '🛒 Total Pembelian VIP', value: `${stats.totalPurchases}`, inline: true },
                { name: '💰 Total Revenue', value: `Rp ${stats.totalRevenue.toLocaleString('id-ID')}`, inline: true },
                { name: '🎉 Total Giveaway Won', value: `${stats.totalGiveawaysWon}`, inline: true },
                { name: '📈 Avg Messages/User', value: stats.totalUsers > 0 ? `${Math.round(stats.totalMessages / stats.totalUsers)}` : '0', inline: true }
            )
            .setFooter({ text: 'Data dari stats.json — tracking dimulai sejak bot v3.2' })
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'leaderboard') {
        await interaction.deferReply();
        const metric = interaction.options.getString('metric') || 'messages';
        const top = getTopUsersStats(metric, 10);
        if (top.length === 0) {
            return interaction.editReply({ content: '📭 Belum ada data leaderboard untuk metric ini.' });
        }

        const metricLabels = {
            messages: '💬 Pesan Terbanyak',
            vipPurchases: '🛒 Top Buyer (jumlah transaksi)',
            totalSpent: '💰 Top Spender (total belanja)',
            giveawaysWon: '🎉 Top Winner (giveaway)'
        };
        const metricFormat = {
            messages: (v) => `${v.toLocaleString('id-ID')} pesan`,
            vipPurchases: (v) => `${v} transaksi`,
            totalSpent: (v) => `Rp ${v.toLocaleString('id-ID')}`,
            giveawaysWon: (v) => `${v} menang`
        };

        const medals = ['🥇', '🥈', '🥉'];
        const lines = top.map((u, i) => {
            const medal = medals[i] || `**${i + 1}.**`;
            return `${medal} <@${u.userId}> — ${metricFormat[metric](u.value)}`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`🏆 LEADERBOARD — ${metricLabels[metric]}`)
            .setDescription(`Top ${top.length} member berdasarkan **${metricLabels[metric]}**.\n\n${lines}`)
            .setColor(0xF1C40F)
            .setFooter({ text: 'Tracking sejak bot v3.2 | Update tiap aktivitas' })
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'my-stats') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const stats = getUserStats(interaction.user.id);
        const embed = new EmbedBuilder()
            .setTitle(`📊 STATS — ${interaction.user.tag}`)
            .setDescription('Statistik aktivitas kamu di server ini.')
            .setColor(0x57F287)
            .addFields(
                { name: '💬 Pesan', value: `${stats.messages.toLocaleString('id-ID')}`, inline: true },
                { name: '🛒 Pembelian VIP', value: `${stats.vipPurchases}`, inline: true },
                { name: '💰 Total Belanja', value: `Rp ${stats.totalSpent.toLocaleString('id-ID')}`, inline: true },
                { name: '🎉 Giveaway Won', value: `${stats.giveawaysWon}`, inline: true },
                { name: '📅 Joined Tracking', value: stats.joinedAt ? `<t:${Math.floor(stats.joinedAt / 1000)}:R>` : 'belum tercatat', inline: true },
                { name: '🕐 Pesan Terakhir', value: stats.lastMessageAt ? `<t:${Math.floor(stats.lastMessageAt / 1000)}:R>` : 'belum pernah', inline: true }
            )
            .setFooter({ text: 'Cek posisi di leaderboard pakai /leaderboard' })
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }

    // ====================================================
    // === POLL SYSTEM — /poll create/list/close ===
    // ====================================================
    if (interaction.commandName === 'poll') {
        const sub = interaction.options.getSubcommand();

        // --- /poll create ---
        if (sub === 'create') {
            const channel = interaction.options.getChannel('channel');
            const question = interaction.options.getString('question');
            const multiple = interaction.options.getBoolean('multiple') || false;

            // Open modal untuk input options (satu field, dipisah newline)
            const modal = new ModalBuilder()
                .setCustomId(`poll_modal_create:${channel.id}:${multiple ? '1' : '0'}:${encodeURIComponent(question)}`)
                .setTitle('Buat Poll — Input Options');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('options')
                        .setLabel('Options (1 per baris, min 2, maks 10)')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setPlaceholder('Rank Push\nCustom Room\nTurnamen\nOff')
                        .setMaxLength(500)
                )
            );
            return interaction.showModal(modal);
        }

        // --- /poll list ---
        if (sub === 'list') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const polls = getPollsByGuild(interaction.guild.id);
            if (polls.length === 0) {
                return interaction.editReply({ content: '📭 Belum ada poll di guild ini.' });
            }
            const lines = polls.map(p => {
                const status = p.closed ? '🔒 Closed' : '🟢 Active';
                const total = getPollTotalVotes(p);
                return `• ❓ **${p.question}** — ${status}\n  🆔 \`${p.id}\` | 👥 ${p.options.length} options | 🗳️ ${total} votes\n  📍 <#${p.channelId}> | ⏰ <t:${Math.floor(p.createdAt / 1000)}:R>`;
            }).join('\n\n');
            const embed = new EmbedBuilder()
                .setTitle('📊 DAFTAR POLL')
                .setDescription(`Total **${polls.length}** poll.\n\n${lines}`)
                .setColor(0x5865F2)
                .setFooter({ text: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // --- /poll close ---
        if (sub === 'close') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const id = interaction.options.getString('id');
            const poll = getPoll(id);
            if (!poll) return interaction.editReply({ content: `❌ Poll \`${id}\` tidak ditemukan.` });
            if (poll.guildId !== interaction.guild.id) return interaction.editReply({ content: '❌ Poll ini bukan dari guild ini.' });
            if (poll.closed) return interaction.editReply({ content: `❌ Poll sudah closed.` });
            const updated = closePoll(id);
            await updatePollMessage(interaction, updated);
            await logAudit(interaction.client, { action: 'POLL_CLOSE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Close poll \`${id}\` ("${poll.question}")`, guildId: interaction.guild.id });
            return interaction.editReply({ content: `✅ Poll **${poll.question}** ditutup! Lihat hasil di channel.` });
        }
    }

    // ====================================================
    // === TEMP VOICE — /setup-tempvoice, /tempvoice-remove ===
    // ====================================================
    if (interaction.commandName === 'setup-tempvoice') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const { ChannelType } = require('discord.js');
        const tempVoiceManager = require('../utils/tempVoiceManager');
        const { buildSetupPanelEmbed, buildSetupPanelComponents } = require('../utils/tempVoiceControlPanel');

        const guild = interaction.guild;

        // Cek apakah sudah ada setup sebelumnya
        const existingConfig = tempVoiceManager.getGuildConfig(guild.id);
        let creatorChannel = existingConfig?.creatorChannelId
            ? guild.channels.cache.get(existingConfig.creatorChannelId)
            : null;

        // Kalau belum ada, bikin kategori + trigger channel
        if (!creatorChannel) {
            try {
                // Bikin kategori "🎤 TEMP VOICE"
                let category = guild.channels.cache.find(c => c.name === '🎤 TEMP VOICE' && c.type === ChannelType.GuildCategory);
                if (!category) {
                    category = await guild.channels.create({
                        name: '🎤 TEMP VOICE',
                        type: ChannelType.GuildCategory
                    });
                }

                // Bikin trigger channel "🔊 Buat Voice"
                creatorChannel = await guild.channels.create({
                    name: '🔊 Buat Voice',
                    type: ChannelType.GuildVoice,
                    parent: category.id,
                    bitrate: 64000
                });

                // Simpan config
                tempVoiceManager.setupGuild(guild.id, creatorChannel.id, category.id);
            } catch (err) {
                console.error('Error setup temp voice:', err);
                return interaction.editReply({ content: `❌ Gagal setup temp voice: ${err.message}\n\nPastikan bot punya permission **Manage Channels** dan **Manage Roles**.` });
            }
        }

        // Kirim panel ke channel tempat command dijalankan
        const embed = buildSetupPanelEmbed();
        const components = buildSetupPanelComponents();
        let panelMsg;
        try {
            panelMsg = await interaction.channel.send({ embeds: [embed], components });
        } catch (err) {
            console.error('Gagal kirim panel temp voice:', err.message);
            return interaction.editReply({ content: `❌ Gagal kirim panel ke channel ini. Cek permission bot.` });
        }

        await logAudit(interaction.client, {
            action: 'SETUP_SELFROLE',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Setup Temp Voice — trigger channel: ${creatorChannel} (\`${creatorChannel.id}\`), panel di ${interaction.channel}`,
            guildId: guild.id
        });

        return interaction.editReply({
            content: `✅ **Temp Voice siap!**\n\n` +
                `🎤 Trigger channel: ${creatorChannel} (member join sini untuk bikin voice baru)\n` +
                `📋 Panel pendaftaran: ${panelMsg.url}\n\n` +
                `💡 Member tinggal klik tombol **🎤 Buat Voice** di panel, atau join langsung ke trigger channel. Bot otomatis bikin voice baru + jadiin mereka owner.`
        });
    }

    if (interaction.commandName === 'tempvoice-remove') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const tempVoiceManager = require('../utils/tempVoiceManager');
        const config = tempVoiceManager.getGuildConfig(interaction.guild.id);
        if (!config) {
            return interaction.editReply({ content: 'ℹ️ Temp voice belum di-setup di guild ini.' });
        }

        // Hapus trigger channel + kategori (opsional, tapi bersih)
        try {
            if (config.creatorChannelId) {
                const trigger = interaction.guild.channels.cache.get(config.creatorChannelId);
                if (trigger) await trigger.delete('Temp voice setup dihapus').catch(()=>{});
            }
            // Hapus semua channel temp voice yang masih aktif
            if (config.channels) {
                for (const channelId of Object.keys(config.channels)) {
                    const ch = interaction.guild.channels.cache.get(channelId);
                    if (ch) await ch.delete('Temp voice setup dihapus').catch(()=>{});
                }
            }
            // Hapus kategori kalau kosong
            if (config.categoryId) {
                const cat = interaction.guild.channels.cache.get(config.categoryId);
                if (cat && cat.children.size === 0) {
                    await cat.delete('Temp voice kategori kosong').catch(()=>{});
                }
            }
        } catch (_) {}

        tempVoiceManager.removeGuild(interaction.guild.id);
        await logAudit(interaction.client, {
            action: 'SELFROLE_DELETE',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Hapus setup Temp Voice dari guild`,
            guildId: interaction.guild.id
        });

        return interaction.editReply({ content: '✅ Setup Temp Voice berhasil dihapus. Trigger channel + semua channel temp voice aktif juga dihapus.' });
    }
};

// ====================================================
// === HELPER: UPDATE POLL MESSAGE (untuk close) ===
// ====================================================
async function updatePollMessage(interaction, poll) {
    try {
        const channel = interaction.guild.channels.cache.get(poll.channelId);
        if (!channel) return;
        const msg = await channel.messages.fetch(poll.messageId).catch(() => null);
        if (!msg) return;

        const total = getPollTotalVotes(poll);
        const lines = poll.options.map((opt, i) => {
            const pct = total > 0 ? Math.round((opt.votes.length / total) * 100) : 0;
            const bar = '█'.repeat(Math.floor(pct / 10)).padEnd(10, '░');
            return `${opt.emoji} **${opt.label}** — ${opt.votes.length} votes (${pct}%)\n\`${bar}\``;
        }).join('\n\n');

        const embed = new EmbedBuilder()
            .setTitle(`📊 ${poll.question}`)
            .setDescription(
                `${lines}\n\n` +
                `🗳️ Total votes: **${total}**\n` +
                `🔒 Status: **Closed** <t:${Math.floor(poll.closedAt / 1000)}:R>`
            )
            .setColor(0x95A5A6)
            .setFooter({ text: `Poll by ${poll.creatorTag} | Closed` })
            .setTimestamp();

        // Disable all buttons
        const disabledRows = msg.components.map(row => {
            const newRow = new ActionRowBuilder();
            for (const comp of row.components) {
                newRow.addComponents(ButtonBuilder.from(comp).setDisabled(true));
            }
            return newRow;
        });

        await msg.edit({ embeds: [embed], components: disabledRows });
    } catch (err) {
        console.warn('Gagal update poll message:', err.message);
    }
}
