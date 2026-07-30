const { PermissionFlagsBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const { getConfig, saveConfig, setField, DEFAULTS } = require('../utils/configManager');
const { Embeds } = require('../utils/embedBuilder');
const { isAdmin: checkIsAdmin } = require('../utils/permissions');
const { addKey, getActiveKeysByUserAndRole, findAllByUser, formatKeysForUser, removeAllKeysByUser } = require('../utils/keyManager');
const { scheduleRoleRemoval, removeActiveByUserAndRole, findAllByUser: findAllSchedulesByUser, removeAllByUser: removeAllSchedulesByUser, getRemainingDays } = require('../utils/roleScheduler');
const { createPanel, addRoleToPanel, removeRoleFromPanel, getPanel, getPanelsByGuild, deletePanel, setMessageId } = require('../utils/selfRoleManager');
const { buildPanelEmbed, buildPanelComponents } = require('../utils/selfRolePanelBuilder');
const { createSession, buildEmbed } = require('../utils/embedBuilderSessions');

module.exports = async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const embeds = new Embeds(interaction.client);
    const config = getConfig();

    // === PERMISSION CHECK — HANYA ADMIN/STAFF ===
    // Semua slash command di-restrict hanya untuk admin (ManageGuild permission
    // atau role Admin yang sudah di-set via /set-role admin).
    // Member biasa akan ditolak dengan pesan ephemeral.
    if (!checkIsAdmin(interaction.member)) {
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
                    '💡 `/embed-builder` cocok untuk embed kompleks (multi-field, footer, author, image)',
                    '💡 `/announce` cocok untuk pengumuman simple 1-embed'
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
        return interaction.editReply({ content: `✅ Role **${tipe}** diatur ke ${role} (\`${role.id}\`)` });
    }

    // === SET CHANNEL ===
    if (interaction.commandName === 'set-channel') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const tipe = interaction.options.getString('tipe');
        const channel = interaction.options.getChannel('channel');
        setField(`channels.${tipe}`, channel.id);
        return interaction.editReply({ content: `✅ Channel **${tipe}** diatur ke ${channel} (\`${channel.id}\`)` });
    }

    // === SET MESSAGE ===
    if (interaction.commandName === 'set-message') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const tipe = interaction.options.getString('tipe');
        const teks = interaction.options.getString('teks');
        setField(`messages.${tipe}`, teks);
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

    // === CONFIG SHOW ===
    if (interaction.commandName === 'config-show') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const fmt = (id, type) => id ? `<${type}:${id}> (\`${id}\`)` : '❌ belum di-set';
        const embed = embeds.info('⚙️ KONFIGURASI BOT', 'Berikut setting bot saat ini:')
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
                { name: '📦 Produk', value: `${config.products.length} produk terdaftar. Pakai \`/list-products\` untuk lihat detail.`, inline: false }
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
            return interaction.editReply({ content: '✅ **SEMUA pesan** berhasil direset ke default.' });
        }

        const before = config.messages[tipe];
        config.messages[tipe] = DEFAULTS.messages[tipe];
        saveConfig(config);
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

        const expireStr = keyEntry.expireAt === null ? 'permanen' : `${Math.ceil((keyEntry.expireAt - Date.now()) / 86400000)} hari`;
        return interaction.editReply({
            content: `✅ **Set Key sukses!**\n\n` +
                `👤 User: ${member}\n` +
                `📦 Produk: ${product.label}\n` +
                `🔑 Key: \`${keyValue}\`\n` +
                `🎭 Role: ${role}\n` +
                `⏰ Expire: ${expireStr}\n` +
                `${schedResult.extended ? '↳ Schedule di-extend (MAX EXTEND).' : (schedResult.permanent ? '↳ Permanen, schedule lama dihapus.' : '↳ Schedule baru dibuat.')}\n` +
                `${dmSent ? '📬 DM terkirim.' : '⚠️ DM gagal (DM ditutup).'}`
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
        const panelMsg = await interaction.channel.send({ embeds: [embed], components });

        // Update messageId
        setMessageId(panel.id, panelMsg.id);

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
};
