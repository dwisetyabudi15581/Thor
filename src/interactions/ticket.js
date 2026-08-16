/**
 * Ticket domain handler — semua customId terkait tiket.
 *
 * Di-ekstrak dari handlers/interactionHandler.js (v3.9.9 refactor).
 * Behavior dipertahankan apa adanya — hanya pindah file.
 *
 * CustomId yang ditangani:
 *   - ticket_trade                (button)  → tampilkan dropdown produk
 *   - select_product              (select)  → buat tiket produk
 *   - ticket_help / ticket_report(button)  → buat tiket help/report
 *   - ticket_close                (button)  → tampilkan tombol konfirmasi
 *   - ticket_close_abort / _abort2(button) → batal tutup
 *   - ticket_close_success        (button)  → tutup tiket help/report (sukses)
 *   - ticket_close_cancel_trans   (button)  → tutup tiket transaksi tanpa key
 *   - ticket_set_key              (button)  → buka modal set key
 *   - modal_set_key:<value>       (modal)   → full flow set key
 *
 * Router (src/interactions/index.js) sudah apply:
 *   - dedup (checkAndMark)
 *   - guard `replied/deferred`
 *   - cek tipe interaction (button/select/modal)
 * Jadi domain handler fokus ke logic-nya saja.
 */

const {
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    MessageFlags,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { getConfig, safeEditReply, logAudit, checkIsAdmin } = require('../commands/_shared');
const { createTicket, closeTicket, sendInvoice, getTicketMeta } = require('../data/ticketManager');
const { addKey, getActiveKeysByUserAndRole, formatRemaining } = require('../data/keyManager');
const { scheduleRoleRemoval } = require('../data/roleScheduler');

/**
 * v3.9.17 FIX: helper untuk cek verified role — konsisten di semua handler.
 * Policy: kalau config.roles.verified belum di-set, ALLOW through (jangan
 * lockout admin yang belum setup). Kalau sudah di-set, user harus punya role itu.
 * Sebelumnya, 2 handler pakai `if (!config.roles.verified || ...)` (block kalau
 * unset), 2 handler lain pakai `if (config.roles.verified && ...)` (allow kalau
 * unset). Inkonsistensi ini bikin UX confusing.
 *
 * @returns {boolean} true kalau user LULUS check (boleh lanjut), false kalau ditolak.
 */
function passesVerifiedCheck(interaction, config) {
    // Kalau member.roles gak ada (partial member / user leave), anggap ditolak.
    if (!interaction.member?.roles?.cache) return false;
    // Kalau verified role belum di-set di config, allow through.
    if (!config.roles.verified) return true;
    // Kalau sudah di-set, user harus punya role itu.
    return interaction.member.roles.cache.has(config.roles.verified);
}

module.exports = async function (interaction) {
    const config = getConfig();

    // ====================================================
    // === v3.9.14: TIKET KATEGORI SELECT MENU (DROPDOWN PANEL) ===
    // === customId: ticket_cat_select (exact match)         ===
    // ====================================================
    // Saat panel pakai use_dropdown=true, kategori dirender sebagai select menu.
    // User pilih kategori di dropdown → handler ini jalan.
    // Behavior sama seperti button ticket_cat:<id>:
    //   - requiresKey=false (help/report/claim_giveaway/dll) → langsung create ticket
    //   - requiresKey=true (transaksi) → tampilkan dropdown produk
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_cat_select') {
        const categoryId = interaction.values && interaction.values[0];
        if (!categoryId) {
            return interaction.reply({
                content: '❌ Tidak ada kategori yang dipilih.',
                flags: MessageFlags.Ephemeral
            });
        }
        const categories = config.ticketCategories || [];
        const catConfig = categories.find(c => c.id === categoryId);

        if (!catConfig) {
            return interaction.reply({
                content: `❌ Kategori \`${categoryId}\` tidak ditemukan di config.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // v3.9.17: pakai helper passesVerifiedCheck (konsisten di semua handler).
        if (!passesVerifiedCheck(interaction, config)) {
            return interaction.reply({ content: '❌ Verifikasi dulu!', flags: MessageFlags.Ephemeral });
        }

        // v3.9.18 FIX: semua kategori dengan requiresKey=false → langsung buat tiket
        // tanpa produk. Sebelumnya HANYA help & report yang di-skip, jadi kategori
        // custom seperti claim_giveaway atau partnership dst. malah muncul error
        // "Belum ada produk" padahal jelas-jelas kategori non-transaksi.
        // Sekarang: pakai catConfig.label sebagai label produk (bukan hardcode).
        if (catConfig.requiresKey === false) {
            const product = {
                label: catConfig.label || 'Bantuan',
                duration: '-',
                price: '-',
                isHelp: true,
                category: categoryId
            };
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return createTicket(interaction, product);
        }

        // Transaksi (requiresKey=true) → tampilkan dropdown produk filtered by category
        const productsInCat = (config.products || []).filter(p => {
            const pCat = p.category || 'transaction';
            return pCat === categoryId;
        });

        if (productsInCat.length === 0) {
            return interaction.reply({
                content:
                    `❌ Belum ada produk di kategori **${catConfig.label}**.\n\n` +
                    `💡 Admin: pakai \`/add-product category:${categoryId}\` untuk tambah produk ke kategori ini.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const selectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select_product')
                .setPlaceholder(`Pilih produk — ${catConfig.label}...`)
                .addOptions(
                    productsInCat.map(p => ({
                        label: p.label,
                        description: p.price,
                        value: p.value,
                        emoji: catConfig.emoji || '🎫'
                    }))
                )
        );
        return interaction.reply({
            content: `Silakan pilih produk di kategori **${catConfig.label}** ${catConfig.emoji || ''}:`,
            components: [selectMenu],
            flags: MessageFlags.Ephemeral
        });
    }

    // ====================================================
    // === v3.9.11 Phase 2: TIKET KATEGORI BUTTON → DROPDOWN PRODUK FILTERED ===
    // === customId: ticket_cat:<categoryId>                ===
    // ====================================================
    // Saat user klik tombol kategori di panel tiket dinamis, tampilkan dropdown
    // produk yang hanya punya category == categoryId. Kalau kategori requiresKey=false
    // (bukan transaksi — mis. help, report, claim_giveaway), langsung buat tiket
    // tanpa pilih produk.
    if (interaction.isButton() && interaction.customId.startsWith('ticket_cat:')) {
        const categoryId = interaction.customId.split(':')[1];
        const categories = config.ticketCategories || [];
        const catConfig = categories.find(c => c.id === categoryId);

        if (!catConfig) {
            return interaction.reply({
                content: `❌ Kategori \`${categoryId}\` tidak ditemukan di config.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // v3.9.17: pakai helper passesVerifiedCheck (konsisten di semua handler).
        if (!passesVerifiedCheck(interaction, config)) {
            return interaction.reply({ content: '❌ Verifikasi dulu!', flags: MessageFlags.Ephemeral });
        }

        // v3.9.18 FIX: semua kategori dengan requiresKey=false → langsung buat ticket
        // tanpa produk (bukan hanya help/report). Pakai catConfig.label sebagai label.
        if (catConfig.requiresKey === false) {
            const product = {
                label: catConfig.label || 'Bantuan',
                duration: '-',
                price: '-',
                isHelp: true,
                category: categoryId
            };
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return createTicket(interaction, product);
        }

        // Kategori transaksi (requiresKey=true) → filter produk berdasarkan category
        const productsInCat = (config.products || []).filter(p => {
            const pCat = p.category || 'transaction';
            return pCat === categoryId;
        });

        if (productsInCat.length === 0) {
            return interaction.reply({
                content:
                    `❌ Belum ada produk di kategori **${catConfig.label}**.\n\n` +
                    `💡 Admin: pakai \`/add-product category:${categoryId}\` untuk tambah produk ke kategori ini.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Build dropdown menu
        const selectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select_product')
                .setPlaceholder(`Pilih produk — ${catConfig.label}...`)
                .addOptions(
                    productsInCat.map(p => ({
                        label: p.label,
                        description: p.price,
                        value: p.value,
                        emoji: catConfig.emoji || '🎫'
                    }))
                )
        );
        return interaction.reply({
            content: `Silakan pilih produk di kategori **${catConfig.label}** ${catConfig.emoji || ''}:`,
            components: [selectMenu],
            flags: MessageFlags.Ephemeral
        });
    }

    // ====================================================
    // === TIKET: TOMBOL TRANSAKSI → DROPDOWN PRODUK (LEGACY) ===
    // ====================================================
    if (interaction.isButton() && interaction.customId === 'ticket_trade') {
        // v3.9.17: pakai helper passesVerifiedCheck (konsisten di semua handler).
        if (!passesVerifiedCheck(interaction, config)) {
            return interaction.reply({ content: '❌ Verifikasi dulu!', flags: MessageFlags.Ephemeral });
        }
        if (!config.products || config.products.length === 0) {
            return interaction.reply({ content: '❌ Belum ada produk.', flags: MessageFlags.Ephemeral });
        }
        const selectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select_product')
                .setPlaceholder('Pilih durasi key yang ingin dibeli...')
                .addOptions(
                    config.products.map(p => ({
                        label: p.label,
                        description: p.price,
                        value: p.value,
                        emoji: '🔑'
                    }))
                )
        );
        return interaction.reply({
            content: 'Silakan pilih paket key di bawah ini:',
            components: [selectMenu],
            flags: MessageFlags.Ephemeral
        });
    }

    // ====================================================
    // === TIKET: PILIH PRODUK / HELP / REPORT → BUAT TIKET ===
    // ====================================================
    if (
        (interaction.isStringSelectMenu() && interaction.customId === 'select_product') ||
        (interaction.isButton() && (interaction.customId === 'ticket_help' || interaction.customId === 'ticket_report'))
    ) {
        // v3.9.17: pakai helper passesVerifiedCheck (konsisten di semua handler).
        if (!passesVerifiedCheck(interaction, config)) {
            return interaction.reply({ content: '❌ Verifikasi dulu!', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let product;
        if (interaction.customId === 'select_product') {
            const selectedValue = interaction.values[0];
            product = config.products.find(p => p.value === selectedValue);
            if (!product) return safeEditReply(interaction, { content: '❌ Produk tidak ditemukan.' });
        } else if (interaction.customId === 'ticket_help') {
            // v3.9.18: label diupdate dari "Bantuan Staff" → "Help" (sesuai default baru).
            product = { label: 'Help', duration: '-', price: '-', isHelp: true, category: 'help' };
        } else if (interaction.customId === 'ticket_report') {
            // v3.9.18: label diupdate dari "Laporkan Member" → "Report" (sesuai default baru).
            product = { label: 'Report', duration: '-', price: '-', isHelp: true, category: 'report' };
        } else {
            // v3.9.11 Phase 3: multi-panel ticket — customId `ticket_cat:<categoryId>`
            // akan di-handle di sini. Untuk sekarang, fallback ke help.
            product = { label: 'Help', duration: '-', price: '-', isHelp: true, category: 'help' };
        }
        return createTicket(interaction, product);
    }

    // ====================================================
    // === TIKET: TUTUP TIKET (ADMIN) ===
    // ====================================================
    if (interaction.isButton() && interaction.customId === 'ticket_close') {
        const isAdmin = checkIsAdmin(interaction.member);
        if (!isAdmin) {
            return interaction.reply({
                content: '❌ Hanya Admin/Staff yang dapat menutup tiket ini!',
                flags: MessageFlags.Ephemeral
            });
        }

        // v3.9.4 FIX: pakai getTicketMeta (sumber utama tickets.json) bukan parse topic langsung.
        const meta = getTicketMeta(interaction.channel.id, interaction.channel?.topic || '');
        const productName = meta?.productName || 'Unknown';
        const productCategory = meta?.category || null;
        // v3.9.18: generalize isTransaction check — pakai meta.requiresKey flag
        // (dari createTicket) sebagai sumber kebenaran, bukan magic-string productName.
        // Sebelumnya: cek 5 string literal ('help', 'report', 'Bantuan Staff',
        // 'Laporkan Member', 'Bantuan/Lapor') yang rapuh kalau label diubah.
        // Sekarang: isTransaction = meta.requiresKey === true ATAU (fallback kalau
        // meta lama gak punya requiresKey) category bukan help/report.
        const isTransaction =
            meta?.requiresKey === true ||
            (meta?.requiresKey === undefined &&
                productCategory !== 'help' &&
                productCategory !== 'report' &&
                productName !== 'Bantuan Staff' &&
                productName !== 'Laporkan Member' &&
                productName !== 'Bantuan/Lapor');
        // v3.9.16: requiresKey — kalau false, transaksi non-key butuh tombol "Pesanan Sukses"
        // supaya admin bisa catat sukses + kirim invoice/testimoni.
        const requiresKey = meta?.requiresKey !== undefined ? meta.requiresKey : isTransaction;

        // 3 skenario tombol konfirmasi close:
        // - Transaksi pakai key (requiresKey=true):
        //     • ❌ Tidak Jadi Beli (close tanpa invoice)
        //     • ⏏️ Batal Tutup
        //   (sukses ditandai via Set Key, jadi gak perlu tombol sukses di sini)
        //
        // - Transaksi non-key (requiresKey=false, isTransaction=true):
        //     • ✅ Pesanan Sukses (close + kirim invoice/testimoni)
        //     • ❌ Tidak Jadi Beli (close tanpa invoice)
        //     • ⏏️ Batal Tutup
        //
        // - Help / Report (isTransaction=false):
        //     • ✅ Selesai (close sukses)
        //     • 🚪 Tutup Tanpa Selesai (close batal)
        //     • ⏏️ Batal Tutup
        const confirmRow = new ActionRowBuilder();
        if (isTransaction && requiresKey) {
            // Transaksi pakai key — sukses via Set Key, di sini cuma batal/abort
            confirmRow.addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_close_cancel_trans')
                    .setLabel('❌ Tidak Jadi Beli')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('ticket_close_abort')
                    .setLabel('⏏️ Batal Tutup')
                    .setStyle(ButtonStyle.Secondary)
            );
        } else if (isTransaction && !requiresKey) {
            // Transaksi non-key — butuh tombol sukses buat kirim invoice
            confirmRow.addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_close_success')
                    .setLabel('✅ Pesanan Sukses')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('ticket_close_cancel_trans')
                    .setLabel('❌ Tidak Jadi Beli')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('ticket_close_abort')
                    .setLabel('⏏️ Batal Tutup')
                    .setStyle(ButtonStyle.Secondary)
            );
        } else {
            // Help / Report
            confirmRow.addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_close_success')
                    .setLabel('✅ Selesai')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('ticket_close_abort')
                    .setLabel('❌ Tutup Tanpa Selesai')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('ticket_close_abort2')
                    .setLabel('⏏️ Batal Tutup')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        const msg = isTransaction
            ? (requiresKey
                ? '⚠️ Tutup tiket tanpa memberi key? Klik **❌ Tidak Jadi Beli**.'
                : '⚠️ Tutup tiket transaksi ini?\n• **✅ Pesanan Sukses** — transaksi berhasil, kirim invoice/testimoni\n• **❌ Tidak Jadi Beli** — batal, tanpa invoice')
            : '⚠️ Selesaikan tiket ini?';
        return interaction.reply({ content: msg, components: [confirmRow], flags: MessageFlags.Ephemeral });
    }

    if (
        interaction.isButton() &&
        (interaction.customId === 'ticket_close_abort' || interaction.customId === 'ticket_close_abort2')
    ) {
        // Wrap interaction.update dalam try/catch. Kalau ephemeral sudah di-dismiss (10008)
        // atau token expired (10062), fallback ke reply ephemeral.
        try {
            return await interaction.update({ content: '❌ Penutupan tiket dibatalkan.', embeds: [], components: [] });
        } catch (err) {
            if (err.code === 10008 || err.code === 10062) {
                return interaction
                    .reply({ content: '❌ Penutupan tiket dibatalkan.', flags: MessageFlags.Ephemeral })
                    .catch(() => {});
            }
            console.warn('ticket_close_abort update error:', err.message);
            if (!interaction.replied) {
                return interaction
                    .reply({ content: '❌ Penutupan tiket dibatalkan.', flags: MessageFlags.Ephemeral })
                    .catch(() => {});
            }
        }
    }

    if (interaction.isButton() && interaction.customId === 'ticket_close_success') {
        // Untuk tiket help/report (selesai) ATAU transaksi non-key (pesanan sukses).
        // isSuccess=true → closeTicket akan kirim invoice ke channel invoice (kalau di-set).
        try {
            await interaction.deferUpdate();
        } catch (err) {
            if (err.code !== 10008 && err.code !== 10062) {
                console.warn('ticket_close_success deferUpdate error:', err.message);
            }
        }
        await closeTicket(interaction.channel, interaction.user, true);
        return;
    }

    if (interaction.isButton() && interaction.customId === 'ticket_close_cancel_trans') {
        // Tutup tiket transaksi tanpa kasih key (batal beli).
        try {
            await interaction.deferUpdate();
        } catch (err) {
            if (err.code !== 10008 && err.code !== 10062) {
                console.warn('ticket_close_cancel_trans deferUpdate error:', err.message);
            }
        }
        await closeTicket(interaction.channel, interaction.user, false);
        return;
    }

    // ====================================================
    // === TIKET: TOMBOL SET KEY (ADMIN) → MODAL ===
    // ====================================================
    if (interaction.isButton() && interaction.customId === 'ticket_set_key') {
        const isAdmin = checkIsAdmin(interaction.member);
        if (!isAdmin) {
            return interaction.reply({
                content: '❌ Hanya Admin/Staff yang bisa set key!',
                flags: MessageFlags.Ephemeral
            });
        }

        // v3.9.4 FIX: pakai getTicketMeta (sumber utama tickets.json) bukan parse topic langsung.
        const meta = getTicketMeta(interaction.channel.id, interaction.channel?.topic || '');
        const productName = meta?.productName || null;
        const productCategory = meta?.category || null;
        // v3.9.18: generalize check — pakai meta.requiresKey flag sebagai sumber kebenaran.
        // Set Key hanya untuk tiket transaksi (requiresKey=true).
        // Fallback ke cek category untuk tiket lama yang belum punya requiresKey di meta.
        const isTransactionForSetKey =
            meta?.requiresKey === true ||
            (meta?.requiresKey === undefined &&
                productCategory !== 'help' &&
                productCategory !== 'report' &&
                productName !== 'Bantuan Staff' &&
                productName !== 'Laporkan Member' &&
                productName !== 'Bantuan/Lapor');
        if (!productName || !isTransactionForSetKey) {
            return interaction.reply({
                content: '❌ Tombol Set Key hanya untuk tiket transaksi.',
                flags: MessageFlags.Ephemeral
            });
        }
        // v3.9.16: reject kalau produk non-key (requiresKey=false).
        // Tombol Set Key seharusnya tidak muncul untuk produk non-key, tapi ini defense-in-depth
        // kalau admin somehow klik via customId lama / message lama yang belum di-update.
        if (meta?.requiresKey === false) {
            return interaction.reply({
                content: '❌ Produk ini tidak memerlukan key (requiresKey=false). Tombol Set Key tidak tersedia untuk produk non-key.',
                flags: MessageFlags.Ephemeral
            });
        }

        const product = config.products.find(p => p.label === productName);
        if (!product) {
            return interaction.reply({
                content: `❌ Produk "${productName}" tidak ditemukan di config. Cek /list-products.`,
                flags: MessageFlags.Ephemeral
            });
        }
        if (!product.roleId) {
            return interaction.reply({
                content: `❌ Produk **${product.label}** belum punya auto-role. Pakai \`/set-product-role\` dulu.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Buka modal input key
        const modal = new ModalBuilder()
            .setCustomId(`modal_set_key:${product.value}`)
            .setTitle(`Set Key — ${product.label}`);

        const keyInput = new TextInputBuilder()
            .setCustomId('key_value')
            .setLabel('Key yang akan dikirim ke pembeli')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('Contoh: ABCDE-12345-FGHIJ-67890')
            .setMinLength(1)
            .setMaxLength(500);

        modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
        return interaction.showModal(modal);
    }

    // ====================================================
    // === MODAL SET KEY SUBMIT — FULL FLOW ===
    // ====================================================
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_set_key:')) {
        // v3.9.7: log deferReply failure (sama seperti embed builder modal)
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(err => {
            console.warn(`[Set Key Modal] deferReply gagal untuk ${interaction.customId}: ${err.message}`);
        });

        const productValue = interaction.customId.split(':')[1];
        const keyValue = interaction.components[0]?.components?.[0]?.value?.trim() || '';

        // P1-8 FIX: validasi interaction.channel masih ada (belum dihapus admin lain).
        // Sebelumnya: kalau channel sudah dihapus saat admin submit modal,
        // `interaction.channel.topic` throw TypeError → error generik.
        if (!interaction.channel) {
            return safeEditReply(interaction, {
                content: '❌ Channel tiket sudah tidak ada (mungkin sudah ditutup admin lain).'
            }).catch(() => {});
        }

        // v3.9.1: baca metadata tiket dari tickets.json (sumber kebenaran).
        // Fallback ke topic parsing untuk tiket lama yang dibuat sebelum v3.9.1.
        const topic = interaction.channel.topic || '';
        const meta = getTicketMeta(interaction.channel.id, topic);
        const userId = meta?.userId || null;
        const productName = meta?.productName || 'Unknown';
        const price = meta?.price || 'Unknown';

        if (!userId) {
            return safeEditReply(interaction, {
                content: '❌ Gagal ambil metadata tiket (channel ini mungkin bukan tiket valid).'
            });
        }

        const product = config.products.find(p => p.value === productValue);
        if (!product) {
            return safeEditReply(interaction, { content: `❌ Produk value \`${productValue}\` tidak ditemukan.` });
        }
        if (!product.roleId) {
            return safeEditReply(interaction, { content: `❌ Produk **${product.label}** belum punya auto-role.` });
        }

        const guild = interaction.guild;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            return safeEditReply(interaction, { content: `❌ Member <@${userId}> sudah tidak ada di server.` });
        }
        const role = guild.roles.cache.get(product.roleId);
        if (!role) {
            return safeEditReply(interaction, {
                content: `❌ Role ID \`${product.roleId}\` tidak ditemukan di guild.`
            });
        }

        // === 1. Simpan key baru (independent expireAt) ===
        // v3.9.17 FIX: wrap addKey di try/catch. Sebelumnya, kalau key duplikat,
        // addKey throw "Key sudah ada" → propagate ke global handler → admin
        // lihat error generik "Terjadi error, coba lagi" tanpa tahu penyebabnya.
        // Sekarang: catch spesifik, balas dengan pesan jelas.
        let keyEntry;
        try {
            keyEntry = addKey({
                key: keyValue,
                userId: member.id,
                username: member.user.tag,
                roleId: role.id,
                productName: product.label,
                days: product.days || 0,
                guildId: interaction.guild.id // v3.9.3: simpan guildId supaya cross-guild wipe akurat
            });
        } catch (keyErr) {
            console.warn('⚠️ Gagal simpan key (kemungkinan duplikat):', keyErr.message);
            return safeEditReply(interaction, {
                content: `❌ Gagal simpan key: ${keyErr.message}\n\n💡 Coba pakai key lain, atau hapus key lama via \`/list-keys\` dulu.`
            });
        }

        // === 2. Schedule role removal (MAX EXTEND) — v3.9.17: pindah SEBELUM addRole ===
        // v3.9.17 FIX: reorder. Sebelumnya: addKey → addRole → scheduleRoleRemoval.
        // Kalau bot crash setelah addRole tapi sebelum schedule, role menempel tanpa
        // auto-expire. Sekarang: addKey → scheduleRoleRemoval → addRole.
        // Kalau crash setelah schedule tapi sebelum addRole: schedule entry orphan
        // (roleId ter-schedule tapi user belum dapat role) — scheduler tick akan
        // detect "member tidak punya role" dan skip, lebih aman dari role permanen.
        let scheduleResult;
        try {
            scheduleResult = scheduleRoleRemoval({
                userId: member.id,
                roleId: role.id,
                guildId: guild.id,
                days: product.days || 0,
                expireAt: keyEntry.expireAt,
                productName: product.label
            });
        } catch (schedErr) {
            console.error(
                `⚠️ Gagal scheduleRoleRemoval saat set-key (key tetap tersimpan, role TIDAK diberikan): ${schedErr.message}`
            );
            // Catatan: key yang barusan di-add tersimpan tanpa auto-expire schedule.
            // Tidak ada API targeted removal untuk single key di keyManager (hanya
            // removeAllKeysByUser yang terlalu broad). Admin bisa manual remove via
            // /list-keys kalau perlu. Log warning supaya kelihatan.
            console.warn(`⚠️ Schedule gagal — key "${keyValue}" tersimpan tanpa auto-expire. Admin perlu manual remove via /list-keys jika perlu.`);
            return safeEditReply(interaction, {
                content: `❌ Gagal schedule auto-expire role: ${schedErr.message}\n\nKey sudah tersimpan tapi role BELUM diberikan. Coba Set Key lagi, atau hubungi dev.`
            });
        }

        // === 3. Berikan role ke member ===
        try {
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role);
            }
        } catch (err) {
            console.error('Gagal add role saat set key:', err.message);
            return safeEditReply(interaction, {
                content: `❌ Gagal memberikan role ${role}. Pastikan role bot ada di ATAS role tersebut.\n\nKey + schedule sudah tersimpan. Hubungi admin untuk add role manual.`
            });
        }

        // === 4. DM member ===
        let dmSent = false;
        try {
            let expireInfo;
            if (keyEntry.expireAt === null) {
                expireInfo = 'Role ini bersifat **permanen**.';
            } else {
                const days = Math.ceil((keyEntry.expireAt - Date.now()) / 86400000);
                expireInfo = `Role akan otomatis dihapus setelah **${days} hari** (mengikuti sisa key terbanyak).`;
            }

            // Cek semua key aktif untuk info tambahan
            const activeKeys = getActiveKeysByUserAndRole(member.id, role.id);
            const keyList = activeKeys
                .map((k, i) => {
                    const rem = formatRemaining(k);
                    return `\`${i + 1}.\` \`${k.key}\` — ${k.productName} — ${rem}`;
                })
                .join('\n');

            await member.send({
                content:
                    `🎁 **Transaksi Sukses!**\n\n` +
                    `Terima kasih sudah membeli **${product.label}** di **${guild.name}**.\n\n` +
                    // v3.9.17 FIX: sanitize backticks di keyValue. Sebelumnya, kalau
                    // key mengandung triple backtick (```), code block break dan sisa
                    // keyValue di-render sebagai markdown. Sekarang: escape backtick.
                    `🔑 **Key kamu:**\n\`\`\`\n${keyValue.replace(/`/g, "'")}\n\`\`\`\n` +
                    `🎭 Role: ${role}\n⏰ ${expireInfo}\n\n` +
                    `📋 **Semua key aktif kamu untuk role ini:**\n${keyList}\n\n` +
                    `💡 Simpan key ini baik-baik. Kalau role tiba-tiba hilang padahal masih ada key aktif, hubungi admin.`
            });
            dmSent = true;
        } catch (_dmErr) {
            console.log(`ℹ️ Tidak bisa kirim DM ke ${member.user.tag} (mungkin DM ditutup).`);
        }

        // === 5. Kirim invoice ke channel invoice ===
        // v3.9.8 FIX: wrap sendInvoice di try/catch. Sebelumnya, kalau sendInvoice
        // throw (channel invoice hilang / bot gak punya SendMessages), outer catch
        // menyamarkan error. Padahal key + role + schedule + DM sudah terlanjur jalan.
        // Admin lihat error → klik "Set Key" lagi → addKey jalan 2x (duplicate key).
        try {
            await sendInvoice(interaction.channel, userId, productName, price, interaction.user);
        } catch (invoiceErr) {
            console.warn(`⚠️ Gagal kirim invoice saat set-key (key tetap tersimpan): ${invoiceErr.message}`);
        }

        // === 5.5. Track purchase untuk stats/leaderboard ===
        try {
            const { recordPurchase, parsePrice } = require('../data/statsManager');
            // v3.9.4: scoped per guild
            recordPurchase(interaction.guild.id, userId, parsePrice(price));
        } catch (_) {}

        // === 5.6. P1-10 FIX: audit log untuk SET_KEY via ticket modal ===
        try {
            await logAudit(interaction.client, {
                action: 'SET_KEY',
                actorId: interaction.user.id,
                actorTag: interaction.user.tag,
                details: `Set key (ticket) untuk <@${member.id}> — produk: **${product.label}**, role: ${role.name}`,
                guildId: interaction.guild.id
            });
        } catch (_) {}

        // v3.9.8 FIX: balas ephemeral SEBELUM hapus channel. Sebelumnya, comment
        // bilang "channel sudah dihapus, jadi tidak perlu editReply" — ini SALAH.
        // Ephemeral reply terikat ke interaction token (bukan channel), jadi tetap
        // valid setelah channel dihapus. Tanpa editReply, admin lihat "Thinking..."
        // 15 menit sampai token expired.
        try {
            await safeEditReply(interaction, {
                content: `✅ Set Key sukses!\n\n👤 Member: <@${userId}>\n📦 Produk: ${product.label}\n🎭 Role: ${role.name}\n${dmSent ? '📬 DM terkirim.' : '⚠️ DM gagal.'}`
            });
        } catch (_) {}

        // === 6. Hapus channel tiket ===
        await interaction.channel.delete().catch(() => {});

        // === 7. Log sukses (feedback ephemeral sudah dikirim di atas) ===
        console.log(
            `✅ Set Key sukses: ${member.user.tag} | produk=${product.label} | role=${role.name} | extend=${scheduleResult.extended} | permanen=${scheduleResult.permanent} | dm=${dmSent}`
        );
        return;
    }
};
