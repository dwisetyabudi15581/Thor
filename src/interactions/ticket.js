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
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
    MessageFlags, StringSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const {
    getConfig, safeEditReply, logAudit, checkIsAdmin
} = require('../commands/_shared');
const { createTicket, closeTicket, sendInvoice, getTicketMeta } = require('../data/ticketManager');
const {
    addKey, getActiveKeysByUserAndRole, formatRemaining
} = require('../data/keyManager');
const { scheduleRoleRemoval } = require('../data/roleScheduler');

module.exports = async function (interaction) {
    const config = getConfig();

    // ====================================================
    // === TIKET: TOMBOL TRANSAKSI → DROPDOWN PRODUK ===
    // ====================================================
    if (interaction.isButton() && interaction.customId === 'ticket_trade') {
        if (!config.roles.verified || !interaction.member.roles.cache.has(config.roles.verified)) {
            return interaction.reply({ content: '❌ Verifikasi dulu!', flags: MessageFlags.Ephemeral });
        }
        if (!config.products || config.products.length === 0) {
            return interaction.reply({ content: '❌ Belum ada produk.', flags: MessageFlags.Ephemeral });
        }
        const selectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select_product')
                .setPlaceholder('Pilih durasi key yang ingin dibeli...')
                .addOptions(config.products.map(p => ({
                    label: p.label,
                    description: p.price,
                    value: p.value,
                    emoji: '🔑'
                })))
        );
        return interaction.reply({ content: 'Silakan pilih paket key di bawah ini:', components: [selectMenu], flags: MessageFlags.Ephemeral });
    }

    // ====================================================
    // === TIKET: PILIH PRODUK / HELP / REPORT → BUAT TIKET ===
    // ====================================================
    if ((interaction.isStringSelectMenu() && interaction.customId === 'select_product') ||
        (interaction.isButton() && (interaction.customId === 'ticket_help' || interaction.customId === 'ticket_report'))) {
        if (!config.roles.verified || !interaction.member.roles.cache.has(config.roles.verified)) {
            return interaction.reply({ content: '❌ Verifikasi dulu!', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let product;
        if (interaction.customId === 'select_product') {
            const selectedValue = interaction.values[0];
            product = config.products.find(p => p.value === selectedValue);
            if (!product) return safeEditReply(interaction,{ content: '❌ Produk tidak ditemukan.' });
        } else {
            product = { label: 'Bantuan/Lapor', duration: '-', price: '-' };
        }
        return createTicket(interaction, product);
    }

    // ====================================================
    // === TIKET: TUTUP TIKET (ADMIN) ===
    // ====================================================
    if (interaction.isButton() && interaction.customId === 'ticket_close') {
        const isAdmin = checkIsAdmin(interaction.member);
        if (!isAdmin) {
            return interaction.reply({ content: '❌ Hanya Admin/Staff yang dapat menutup tiket ini!', flags: MessageFlags.Ephemeral });
        }

        // v3.9.4 FIX: pakai getTicketMeta (sumber utama tickets.json) bukan parse topic langsung.
        // Sebelumnya, kalau admin edit channel topic / topic ke-truncate, productName salah.
        const meta = getTicketMeta(interaction.channel.id, interaction.channel?.topic || '');
        const productName = meta?.productName || 'Unknown';
        const isTransaction = productName !== 'Bantuan/Lapor';

        // Untuk tiket transaksi: tombol "Tidak Jadi Beli" (close tanpa role) + "Batal Tutup"
        // Untuk tiket help/report: tombol "Selesai" (close sukses) + "Tutup Tanpa Selesai" + "Batal Tutup"
        const confirmRow = new ActionRowBuilder();
        if (isTransaction) {
            confirmRow.addComponents(
                new ButtonBuilder().setCustomId('ticket_close_cancel_trans').setLabel('❌ Tidak Jadi Beli').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('ticket_close_abort').setLabel('⏏️ Batal Tutup').setStyle(ButtonStyle.Secondary)
            );
        } else {
            confirmRow.addComponents(
                new ButtonBuilder().setCustomId('ticket_close_success').setLabel('✅ Selesai').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('ticket_close_abort').setLabel('❌ Tutup Tanpa Selesai').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('ticket_close_abort2').setLabel('⏏️ Batal Tutup').setStyle(ButtonStyle.Secondary)
            );
        }
        const msg = isTransaction
            ? '⚠️ Tutup tiket tanpa memberi key? Klik **❌ Tidak Jadi Beli**.'
            : '⚠️ Selesaikan tiket ini?';
        return interaction.reply({ content: msg, components: [confirmRow], flags: MessageFlags.Ephemeral });
    }

    if (interaction.isButton() && (interaction.customId === 'ticket_close_abort' || interaction.customId === 'ticket_close_abort2')) {
        return interaction.update({ content: '❌ Penutupan tiket dibatalkan.', embeds: [], components: [] });
    }

    if (interaction.isButton() && interaction.customId === 'ticket_close_success') {
        // Hanya untuk tiket help/report (selesai)
        await interaction.deferUpdate();
        await closeTicket(interaction.channel, interaction.user, true);
        return;
    }

    if (interaction.isButton() && interaction.customId === 'ticket_close_cancel_trans') {
        // Tutup tiket transaksi tanpa memberi key (batal beli)
        await interaction.deferUpdate();
        await closeTicket(interaction.channel, interaction.user, false);
        return;
    }

    // ====================================================
    // === TIKET: TOMBOL SET KEY (ADMIN) → MODAL ===
    // ====================================================
    if (interaction.isButton() && interaction.customId === 'ticket_set_key') {
        const isAdmin = checkIsAdmin(interaction.member);
        if (!isAdmin) {
            return interaction.reply({ content: '❌ Hanya Admin/Staff yang bisa set key!', flags: MessageFlags.Ephemeral });
        }

        // v3.9.4 FIX: pakai getTicketMeta (sumber utama tickets.json) bukan parse topic langsung.
        const meta = getTicketMeta(interaction.channel.id, interaction.channel?.topic || '');
        const productName = meta?.productName || null;
        if (!productName || productName === 'Bantuan/Lapor') {
            return interaction.reply({ content: '❌ Tombol Set Key hanya untuk tiket transaksi.', flags: MessageFlags.Ephemeral });
        }

        const product = config.products.find(p => p.label === productName);
        if (!product) {
            return interaction.reply({ content: `❌ Produk "${productName}" tidak ditemukan di config. Cek /list-products.`, flags: MessageFlags.Ephemeral });
        }
        if (!product.roleId) {
            return interaction.reply({ content: `❌ Produk **${product.label}** belum punya auto-role. Pakai \`/set-product-role\` dulu.`, flags: MessageFlags.Ephemeral });
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
            return safeEditReply(interaction,{ content: '❌ Channel tiket sudah tidak ada (mungkin sudah ditutup admin lain).' }).catch(()=>{});
        }

        // v3.9.1: baca metadata tiket dari tickets.json (sumber kebenaran).
        // Fallback ke topic parsing untuk tiket lama yang dibuat sebelum v3.9.1.
        const topic = interaction.channel.topic || '';
        const meta = getTicketMeta(interaction.channel.id, topic);
        const userId = meta?.userId || null;
        const productName = meta?.productName || 'Unknown';
        const price = meta?.price || 'Unknown';

        if (!userId) {
            return safeEditReply(interaction,{ content: '❌ Gagal ambil metadata tiket (channel ini mungkin bukan tiket valid).' });
        }

        const product = config.products.find(p => p.value === productValue);
        if (!product) {
            return safeEditReply(interaction,{ content: `❌ Produk value \`${productValue}\` tidak ditemukan.` });
        }
        if (!product.roleId) {
            return safeEditReply(interaction,{ content: `❌ Produk **${product.label}** belum punya auto-role.` });
        }

        const guild = interaction.guild;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            return safeEditReply(interaction,{ content: `❌ Member <@${userId}> sudah tidak ada di server.` });
        }
        const role = guild.roles.cache.get(product.roleId);
        if (!role) {
            return safeEditReply(interaction,{ content: `❌ Role ID \`${product.roleId}\` tidak ditemukan di guild.` });
        }

        // === 1. Simpan key baru (independent expireAt) ===
        const keyEntry = addKey({
            key: keyValue,
            userId: member.id,
            username: member.user.tag,
            roleId: role.id,
            productName: product.label,
            days: product.days || 0,
            guildId: interaction.guild.id  // v3.9.3: simpan guildId supaya cross-guild wipe akurat
        });

        // === 2. Berikan role ke member ===
        try {
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role);
            }
        } catch (err) {
            console.error('Gagal add role saat set key:', err.message);
            return safeEditReply(interaction,{ content: `❌ Gagal memberikan role ${role}. Pastikan role bot ada di ATAS role tersebut.\n\nKey tetap disimpan di keys.json.` });
        }

        // === 3. Schedule role removal (MAX EXTEND) ===
        const scheduleResult = scheduleRoleRemoval({
            userId: member.id,
            roleId: role.id,
            guildId: guild.id,
            days: product.days || 0,
            expireAt: keyEntry.expireAt,
            productName: product.label
        });

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
            const keyList = activeKeys.map((k, i) => {
                const rem = formatRemaining(k);
                return `\`${i + 1}.\` \`${k.key}\` — ${k.productName} — ${rem}`;
            }).join('\n');

            await member.send({
                content: `🎁 **Transaksi Sukses!**\n\n` +
                    `Terima kasih sudah membeli **${product.label}** di **${guild.name}**.\n\n` +
                    `🔑 **Key kamu:**\n\`\`\`\n${keyValue}\n\`\`\`\n` +
                    `🎭 Role: ${role}\n⏰ ${expireInfo}\n\n` +
                    `📋 **Semua key aktif kamu untuk role ini:**\n${keyList}\n\n` +
                    `💡 Simpan key ini baik-baik. Kalau role tiba-tiba hilang padahal masih ada key aktif, hubungi admin.`
            });
            dmSent = true;
        } catch (dmErr) {
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
        await interaction.channel.delete().catch(()=>{});

        // === 7. Log sukses (feedback ephemeral sudah dikirim di atas) ===
        console.log(`✅ Set Key sukses: ${member.user.tag} | produk=${product.label} | role=${role.name} | extend=${scheduleResult.extended} | permanen=${scheduleResult.permanent} | dm=${dmSent}`);
        return;
    }
};
