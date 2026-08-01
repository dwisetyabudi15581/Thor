const {
    EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
    MessageFlags, StringSelectMenuBuilder, PermissionFlagsBits,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { createTicket, closeTicket, sendInvoice, getTicketMeta } = require('../utils/ticketManager');
const { getConfig, setField } = require('../utils/configManager');
const { isAdmin: checkIsAdmin } = require('../utils/permissions');
const {
    addKey, getActiveKeysByUserAndRole, hasPermanentKey,
    getMaxExpireAtByUserAndRole, formatRemaining
} = require('../utils/keyManager');
const { scheduleRoleRemoval } = require('../utils/roleScheduler');
const { getPanelByMessage, getPanel } = require('../utils/selfRoleManager');
const { buildPanelEmbed, buildPanelComponents } = require('../utils/selfRolePanelBuilder');
const { getSession, deleteSession, buildEmbed: buildSessionEmbed, parseColor } = require('../utils/embedBuilderSessions');
const { get: getGiveaway, addParticipant: gwAddParticipant, removeParticipant: gwRemoveParticipant, end: endGiveaway, pickWinners } = require('../utils/giveawayManager');
const { get: getPoll, vote: votePoll, getByMessage: getPollByMessage, getTotalVotes: getPollTotalVotes, remove: removePoll, getPollSession, deletePollSession } = require('../utils/pollManager');
const { create: createPoll, setMessageId: setPollMessageId } = require('../utils/pollManager');
const { logAudit } = require('../utils/auditLog');
// v3.9.2 FIX: per-user lock untuk mencegah TOCTOU race condition
// kalau user double-click tombol Discord (giveaway join/leave, poll vote).
const { withLock: withUserLock } = require('../utils/userLock');
// v3.9.4: safeEditReply — fallback ke followUp kalau original ephemeral reply sudah di-dismiss user.
const { safeEditReply } = require('../utils/safeReply');

// P1-6 FIX: track interaction yang sudah diproses untuk hindari double-processing.
// Sebelumnya modal submit lewat guard `replied/deferred` → bisa double-reply.
const processedInteractions = new Set();
const PROCESSED_TTL_MS = 5 * 60 * 1000; // cleanup setiap 5 menit

// Periodic cleanup supaya Set tidak bengkak
setInterval(() => {
    processedInteractions.clear();
}, PROCESSED_TTL_MS).unref?.();

module.exports = async (interaction) => {
    // P1-6 FIX: cek duplikat interaction ID dulu (defense-in-depth).
    // Discord kadang fire event yang sama 2x kalau ada retry.
    if (processedInteractions.has(interaction.id)) {
        return;
    }
    processedInteractions.add(interaction.id);

    // Guard: skip kalau interaction sudah replied/deferred (kecuali modal submit yang sah).
    // Modal submit yang sudah replied = ANGGAP SUDAH DIPROSES, jangan lanjut.
    if (interaction.replied || interaction.deferred) {
        return;
    }
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

    const config = getConfig();

    try {
        // ====================================================
        // === VERIFIKASI ===
        // ====================================================
        if (interaction.isButton() && interaction.customId === 'btn_verify') {
            if (!config.roles.verified) {
                return interaction.reply({ content: '❌ Role Verified belum di-set. Minta admin jalankan `/set-role verified @role`.', flags: MessageFlags.Ephemeral });
            }
            if (interaction.member.roles.cache.has(config.roles.verified)) {
                return interaction.reply({ content: '✅ Kamu sudah terverifikasi!', flags: MessageFlags.Ephemeral });
            }
            try {
                await interaction.member.roles.add(config.roles.verified);
            } catch (err) {
                console.error('Gagal add role verified:', err.message);
                return interaction.reply({ content: '❌ Bot tidak bisa memberi role Verified. Pastikan role bot ada di ATAS role Verified.', flags: MessageFlags.Ephemeral });
            }
            if (config.roles.unverified) {
                try { await interaction.member.roles.remove(config.roles.unverified); } catch (err) { console.error('Gagal hapus role unverified:', err.message); }
            }
            return interaction.reply({ content: '✅ Verifikasi berhasil! Role Verified telah diberikan, role Unverified telah dihapus.', flags: MessageFlags.Ephemeral });
        }

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
            await sendInvoice(interaction.channel, userId, productName, price, interaction.user);

            // === 5.5. Track purchase untuk stats/leaderboard ===
            try {
                const { recordPurchase, parsePrice } = require('../utils/statsManager');
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

            // === 6. Hapus channel tiket ===
            await interaction.channel.delete().catch(()=>{});

            // === 7. Beri feedback ke admin (ephemeral — tapi channel sudah dihapus, jadi pesan ini akan hilang) ===
            // Karena channel sudah dihapus, kita tidak perlu editReply. Cukup log.
            console.log(`✅ Set Key sukses: ${member.user.tag} | produk=${product.label} | role=${role.name} | extend=${scheduleResult.extended} | permanen=${scheduleResult.permanent} | dm=${dmSent}`);
            return;
        }

        // ====================================================
        // === SELF-ROLE: BUTTON CLICK ===
        // ====================================================
        if (interaction.isButton() && interaction.customId.startsWith('sr_btn:')) {
            return handleSelfRoleButton(interaction);
        }

        // ====================================================
        // === SELF-ROLE: SELECT MENU ===
        // ====================================================
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('sr_sel:')) {
            return handleSelfRoleSelect(interaction);
        }

        // ====================================================
        // === EMBED BUILDER: SELECT MENU (pilih bagian edit) ===
        // ====================================================
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('emb_edit:')) {
            return handleEmbedBuilderEdit(interaction);
        }

        // ====================================================
        // === EMBED BUILDER: BUTTONS (preview/send/cancel) ===
        // ====================================================
        if (interaction.isButton() && interaction.customId.startsWith('emb_preview:')) {
            const sessionId = interaction.customId.split(':')[1];
            const session = getSession(sessionId);
            if (!session) {
                return interaction.reply({ content: '❌ Session builder sudah tidak ada (mungkin bot restart).', flags: MessageFlags.Ephemeral });
            }
            const embed = buildSessionEmbed(session);
            // v3.9.6: tampilkan plain text message di preview ephemeral supaya
            // admin bisa lihat bagaimana message + embed akan terlihat saat dikirim.
            // Kalau tidak ada message, behavior lama (preview embed saja).
            const previewContent = session.data.content
                ? `👁️ **Preview:**\n\n💬 **Plain text message:**\n\`\`\`\n${session.data.content}\n\`\`\`\n📋 **Embed:**`
                : '👁️ **Preview:**';
            return interaction.reply({ content: previewContent, embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (interaction.isButton() && interaction.customId.startsWith('emb_send:')) {
            const sessionId = interaction.customId.split(':')[1];
            const session = getSession(sessionId);
            if (!session) {
                return interaction.reply({ content: '❌ Session builder sudah tidak ada.', flags: MessageFlags.Ephemeral });
            }
            if (session.ownerId !== interaction.user.id) {
                return interaction.reply({ content: '❌ Hanya pembuat yang bisa kirim draft ini.', flags: MessageFlags.Ephemeral });
            }
            if (!session.data.title && !session.data.description) {
                return interaction.reply({ content: '❌ Embed minimal harus punya **Title** atau **Description** sebelum dikirim.', flags: MessageFlags.Ephemeral });
            }
            // v3.9.6: kirim bisa dengan atau tanpa plain text message.
            // Message sudah diset via opsi "Message (plain text)" di dropdown.
            // Tampilkan di modal supaya admin bisa lihat & edit cepat sebelum kirim.
            const currentMessage = session.data.content || '';
            // Buka modal untuk input channel target + optional override message
            const modal = new ModalBuilder()
                .setCustomId(`emb_modal_send:${sessionId}`)
                .setTitle('Kirim Embed ke Channel');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('channel')
                        .setLabel('Channel target (#mention atau ID)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder('#announcements atau 123456789012345678')
                        .setMaxLength(100)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('message')
                        .setLabel('Pesan di luar embed (opsional, support @)')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(false)
                        .setMaxLength(2000)
                        .setPlaceholder('Kosongkan = embed saja. Isi = teks + embed.\nSupport @everyone, @here, <@&role>, <@user>')
                        .setValue(currentMessage)
                )
            );
            return interaction.showModal(modal);
        }

        if (interaction.isButton() && interaction.customId.startsWith('emb_cancel:')) {
            const sessionId = interaction.customId.split(':')[1];
            const session = getSession(sessionId);
            if (!session) {
                return interaction.reply({ content: '❌ Session builder sudah tidak ada.', flags: MessageFlags.Ephemeral });
            }
            if (session.ownerId !== interaction.user.id) {
                return interaction.reply({ content: '❌ Hanya pembuat yang bisa cancel draft ini.', flags: MessageFlags.Ephemeral });
            }
            // Hapus draft message
            try {
                const channel = interaction.guild.channels.cache.get(session.channelId);
                if (channel) {
                    const msg = await channel.messages.fetch(session.messageId).catch(() => null);
                    if (msg) await msg.delete();
                }
            } catch (_) {}
            deleteSession(sessionId);
            return interaction.reply({ content: '🗑️ Builder dibatalkan, draft dihapus.', flags: MessageFlags.Ephemeral });
        }

        // ====================================================
        // === EMBED BUILDER: MODAL SUBMITS ===
        // ====================================================
        if (interaction.isModalSubmit() && interaction.customId.startsWith('emb_modal_')) {
            return handleEmbedBuilderModal(interaction);
        }

        // ====================================================
        // === GIVEAWAY: JOIN / LEAVE BUTTONS ===
        // ====================================================
        if (interaction.isButton() && (interaction.customId.startsWith('gw_join:') || interaction.customId.startsWith('gw_leave:'))) {
            return handleGiveawayButton(interaction);
        }

        // ====================================================
        // === POLL: VOTE BUTTONS ===
        // ====================================================
        if (interaction.isButton() && interaction.customId.startsWith('poll_vote:')) {
            return handlePollButton(interaction);
        }

        // ====================================================
        // === POLL: MODAL CREATE SUBMIT ===
        // ====================================================
        if (interaction.isModalSubmit() && interaction.customId.startsWith('poll_modal_create:')) {
            return handlePollModalCreate(interaction);
        }

        // ====================================================
        // === v3.8.5: TEMP VOICE — Button / Modal / Select handlers ===
        // Note: Buat voice hanya via join trigger channel "🔊 Buat Voice", tidak ada button
        // ====================================================
        if (interaction.isButton() && interaction.customId === 'tv_rename') {
            return handleTempVoiceRename(interaction);
        }
        if (interaction.isButton() && interaction.customId === 'tv_kick') {
            return handleTempVoiceKickMenu(interaction);
        }
        if (interaction.isStringSelectMenu() && interaction.customId === 'tv_kick_select') {
            return handleTempVoiceKickExecute(interaction);
        }
        if (interaction.isButton() && interaction.customId === 'tv_limit') {
            return handleTempVoiceLimit(interaction);
        }
        if (interaction.isButton() && (interaction.customId === 'tv_lock' || interaction.customId === 'tv_unlock')) {
            return handleTempVoiceLockToggle(interaction);
        }
        if (interaction.isButton() && interaction.customId === 'tv_transfer') {
            return handleTempVoiceTransferMenu(interaction);
        }
        if (interaction.isStringSelectMenu() && interaction.customId === 'tv_transfer_select') {
            return handleTempVoiceTransferExecute(interaction);
        }
        if (interaction.isButton() && interaction.customId === 'tv_delete') {
            return handleTempVoiceDelete(interaction);
        }
        if (interaction.isButton() && interaction.customId === 'tv_info') {
            return handleTempVoiceInfo(interaction);
        }
        if (interaction.isModalSubmit() && interaction.customId === 'tv_modal_rename') {
            return handleTempVoiceRenameSubmit(interaction);
        }
        if (interaction.isModalSubmit() && interaction.customId === 'tv_modal_limit') {
            return handleTempVoiceLimitSubmit(interaction);
        }
        if (interaction.isStringSelectMenu() && interaction.customId === 'tv_switch_select') {
            return handleTempVoiceSwitchSelect(interaction);
        }
        if (interaction.isStringSelectMenu() && interaction.customId === 'tv_channel_select') {
            return handleTempVoiceChannelSelect(interaction);
        }

        // ====================================================
        // === v3.9.0: RESET CONFIG — Confirmation button handlers ===
        // ====================================================
        if (interaction.isButton() && interaction.customId === 'reset_config_confirm') {
            return handleResetConfigConfirm(interaction);
        }
        if (interaction.isButton() && interaction.customId === 'reset_config_cancel') {
            return interaction.update({
                content: '✅ Reset config dibatalkan. Tidak ada perubahan yang dilakukan.',
                components: []
            });
        }

        // ====================================================
        // === v3.9.1: RESTORE BACKUP — Confirmation button handlers ===
        // ====================================================
        if (interaction.isButton() && interaction.customId.startsWith('restore_backup_confirm:')) {
            return handleRestoreBackupConfirm(interaction);
        }
        if (interaction.isButton() && interaction.customId.startsWith('restore_backup_cancel:')) {
            const parts = interaction.customId.split(':');
            const ownerId = parts[1];
            if (interaction.user.id !== ownerId) {
                return interaction.reply({ content: '❌ Hanya admin yang memulai konfirmasi ini yang bisa membatalkan.', flags: MessageFlags.Ephemeral });
            }
            return interaction.update({
                content: '✅ Restore backup dibatalkan. Tidak ada perubahan yang dilakukan.',
                components: []
            });
        }

    } catch (err) {
        console.error('Interaction Handler Error:', err);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Terjadi error.', flags: MessageFlags.Ephemeral }).catch(()=>{});
        } else if (interaction.deferred && !interaction.replied) {
            await safeEditReply(interaction,{ content: '❌ Terjadi error.' }).catch(()=>{});
        }
    }
};

// ====================================================
// === HELPER: SELF-ROLE BUTTON HANDLER ===
// ====================================================
async function handleSelfRoleButton(interaction) {
    const parts = interaction.customId.split(':');
    const panelId = parts[1];
    const roleId = parts[2];
    const panel = getPanel(panelId);
    if (!panel) {
        return interaction.reply({ content: '❌ Panel self-role sudah tidak ada.', flags: MessageFlags.Ephemeral });
    }
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) {
        return interaction.reply({ content: '❌ Role tidak ditemukan di server.', flags: MessageFlags.Ephemeral });
    }

    const member = interaction.member;
    const hasRole = member.roles.cache.has(roleId);

    try {
        if (panel.exclusive && !hasRole) {
            // Mode exclusive: hapus semua role panel lain dulu, lalu tambahkan yang ini
            const toRemove = panel.roles
                .map(r => r.roleId)
                .filter(rid => rid !== roleId && member.roles.cache.has(rid));
            if (toRemove.length > 0) {
                await member.roles.remove(toRemove);
            }
            await member.roles.add(roleId);
            const removedMentions = toRemove.map(rid => `<@&${rid}>`).join(', ');
            return interaction.reply({
                content: `✅ Role ${role} ditambahkan.${toRemove.length > 0 ? `\n↳ Role lain dihapus: ${removedMentions}` : ''}`,
                flags: MessageFlags.Ephemeral
            });
        } else if (panel.exclusive && hasRole) {
            // Exclusive + sudah punya → lepas
            await member.roles.remove(roleId);
            return interaction.reply({ content: `✅ Role ${role} dilepas.`, flags: MessageFlags.Ephemeral });
        } else if (!panel.exclusive && !hasRole) {
            // Multi + belum punya → tambah
            await member.roles.add(roleId);
            return interaction.reply({ content: `✅ Role ${role} ditambahkan.`, flags: MessageFlags.Ephemeral });
        } else {
            // Multi + sudah punya → lepas (toggle)
            await member.roles.remove(roleId);
            return interaction.reply({ content: `✅ Role ${role} dilepas.`, flags: MessageFlags.Ephemeral });
        }
    } catch (err) {
        console.error('Self-role button error:', err.message);
        return interaction.reply({
            content: `❌ Gagal mengubah role. Pastikan role bot ada di ATAS role ${role}.`,
            flags: MessageFlags.Ephemeral
        });
    }
}

// ====================================================
// === HELPER: SELF-ROLE SELECT MENU HANDLER ===
// ====================================================
async function handleSelfRoleSelect(interaction) {
    const parts = interaction.customId.split(':');
    const panelId = parts[1];
    const panel = getPanel(panelId);
    if (!panel) {
        return interaction.reply({ content: '❌ Panel self-role sudah tidak ada.', flags: MessageFlags.Ephemeral });
    }

    const member = interaction.member;
    const selectedIds = new Set(interaction.values); // role IDs yang dipilih user
    const panelRoleIds = panel.roles.map(r => r.roleId);

    // === v3.9.0 FIX: Implementasi mode EXCLUSIVE yang sebelumnya missing ===
    // Mode exclusive: user hanya boleh punya 1 role dari panel pada satu waktu.
    // Behavior:
    //   - Kalau user pilih 1 role (atau lebih — Discord memungkinkan multi-select):
    //     * Ambil role pertama yang dipilih sebagai "role aktif".
    //     * Remove semua role panel lain yang sudah dimiliki user.
    //     * Add role yang dipilih.
    //   - Kalau user pilih 0 role (clear selection):
    //     * Remove semua role panel yang dimiliki.
    if (panel.exclusive) {
        const targetRoleId = selectedIds.size > 0
            ? interaction.values[0]  // role pertama yang dipilih
            : null;

        const toRemoveExclusive = panelRoleIds.filter(rid =>
            rid !== targetRoleId && member.roles.cache.has(rid)
        );
        const toAddExclusive = targetRoleId && !member.roles.cache.has(targetRoleId)
            ? [targetRoleId]
            : [];

        try {
            if (toRemoveExclusive.length > 0) await member.roles.remove(toRemoveExclusive);
            if (toAddExclusive.length > 0) await member.roles.add(toAddExclusive);
        } catch (err) {
            console.error('Self-role select (exclusive) error:', err.message);
            return interaction.reply({
                content: `❌ Gagal mengubah role. Pastikan role bot ada di ATAS role yang dipilih.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const action = targetRoleId
            ? `**Ditambahkan:** <@&${targetRoleId}>${toRemoveExclusive.length > 0 ? `\n**Dilepas (karena mode exclusive):** ${toRemoveExclusive.map(rid => `<@&${rid}>`).join(', ')}` : ''}`
            : `**Dilepas:** ${toRemoveExclusive.length > 0 ? toRemoveExclusive.map(rid => `<@&${rid}>`).join(', ') : '(tidak ada)'}`;

        await interaction.reply({
            content: `✅ Role diperbarui (mode exclusive).\n${action}`,
            flags: MessageFlags.Ephemeral
        });

        // Update select menu supaya pilihan ter-sync dengan role yang sekarang dimiliki
        try {
            const newComponents = buildPanelComponents(panel);
            if (newComponents.length > 0) {
                await interaction.message.edit({ components: newComponents });
            }
        } catch (err) {
            console.warn('Gagal update select menu setelah pilih (exclusive):', err.message);
        }
        return;
    }

    // === Mode MULTI (default) — logic lama ===
    const toAdd = panelRoleIds.filter(rid => selectedIds.has(rid) && !member.roles.cache.has(rid));
    const toRemove = panelRoleIds.filter(rid => !selectedIds.has(rid) && member.roles.cache.has(rid));

    try {
        if (toRemove.length > 0) await member.roles.remove(toRemove);
        if (toAdd.length > 0) await member.roles.add(toAdd);
    } catch (err) {
        console.error('Self-role select error:', err.message);
        return interaction.reply({
            content: `❌ Gagal mengubah role. Pastikan role bot ada di ATAS role yang dipilih.`,
            flags: MessageFlags.Ephemeral
        });
    }

    const addedMentions = toAdd.map(rid => `<@&${rid}>`).join(', ') || '(tidak ada)';
    const removedMentions = toRemove.map(rid => `<@&${rid}>`).join(', ') || '(tidak ada)';

    await interaction.reply({
        content: `✅ Role diperbarui.\n**Ditambahkan:** ${addedMentions}\n**Dilepas:** ${removedMentions}`,
        flags: MessageFlags.Ephemeral
    });

    // Update select menu supaya pilihan ter-sync dengan role yang sekarang dimiliki
    try {
        const newComponents = buildPanelComponents(panel);
        if (newComponents.length > 0) {
            await interaction.message.edit({ components: newComponents });
        }
    } catch (err) {
        console.warn('Gagal update select menu setelah pilih:', err.message);
    }
}

// ====================================================
// === HELPER: EMBED BUILDER — SELECT MENU (edit bagian) ===
// ====================================================
async function handleEmbedBuilderEdit(interaction) {
    const sessionId = interaction.customId.split(':')[1];
    const session = getSession(sessionId);
    if (!session) {
        return interaction.reply({ content: '❌ Session builder sudah tidak ada (mungkin bot restart).', flags: MessageFlags.Ephemeral });
    }
    if (session.ownerId !== interaction.user.id) {
        return interaction.reply({ content: '❌ Hanya pembuat yang bisa edit draft ini.', flags: MessageFlags.Ephemeral });
    }

    const action = interaction.values[0];
    const d = session.data;

    // === TITLE ===
    if (action === 'title') {
        const modal = new ModalBuilder()
            .setCustomId(`emb_modal_title:${sessionId}`)
            .setTitle('Edit Title');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('value')
                .setLabel('Title (kosongkan untuk hapus)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(256)
                .setValue(d.title || '')
        ));
        return interaction.showModal(modal);
    }

    // === DESCRIPTION ===
    if (action === 'description') {
        const modal = new ModalBuilder()
            .setCustomId(`emb_modal_desc:${sessionId}`)
            .setTitle('Edit Description');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('value')
                .setLabel('Description (kosongkan untuk hapus)')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(4000)
                .setValue(d.description || '')
        ));
        return interaction.showModal(modal);
    }

    // === COLOR ===
    if (action === 'color') {
        const modal = new ModalBuilder()
            .setCustomId(`emb_modal_color:${sessionId}`)
            .setTitle('Set Color');
        const currentHex = d.color !== null && d.color !== undefined
            ? '#' + d.color.toString(16).padStart(6, '0').toUpperCase()
            : '';
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('value')
                .setLabel('Color hex (mis. #FF0000 atau FF0000)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(7)
                .setPlaceholder('#FF0000')
                .setValue(currentHex)
        ));
        return interaction.showModal(modal);
    }

    // === IMAGE ===
    if (action === 'image') {
        const modal = new ModalBuilder()
            .setCustomId(`emb_modal_image:${sessionId}`)
            .setTitle('Set Image');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('value')
                .setLabel('Image URL (kosongkan untuk hapus)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setValue(d.image?.url || '')
        ));
        return interaction.showModal(modal);
    }

    // === THUMBNAIL ===
    if (action === 'thumbnail') {
        const modal = new ModalBuilder()
            .setCustomId(`emb_modal_thumbnail:${sessionId}`)
            .setTitle('Set Thumbnail');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('value')
                .setLabel('Thumbnail URL (kosongkan untuk hapus)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setValue(d.thumbnail?.url || '')
        ));
        return interaction.showModal(modal);
    }

    // === FOOTER ===
    if (action === 'footer') {
        const modal = new ModalBuilder()
            .setCustomId(`emb_modal_footer:${sessionId}`)
            .setTitle('Set Footer');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('text')
                    .setLabel('Footer text (maks 2000 char)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(2000)
                    .setValue(d.footer?.text || '')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('iconurl')
                    .setLabel('Footer icon URL (opsional)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setValue(d.footer?.iconURL || '')
            )
        );
        return interaction.showModal(modal);
    }

    // === AUTHOR ===
    if (action === 'author') {
        const modal = new ModalBuilder()
            .setCustomId(`emb_modal_author:${sessionId}`)
            .setTitle('Set Author');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('name')
                    .setLabel('Author name (maks 256 char)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(256)
                    .setValue(d.author?.name || '')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('iconurl')
                    .setLabel('Author icon URL (opsional)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setValue(d.author?.iconURL || '')
            )
        );
        return interaction.showModal(modal);
    }

    // === MESSAGE (plain text di luar embed) — v3.9.6 ===
    // Teks biasa yang dikirim bersama embed (di field `content` message Discord,
    // bukan di dalam embed). Cocok untuk teks yang nggak perlu styling embed,
    // atau untuk mention @everyone / @here / role yang harus berada di content
    // (bukan di embed) supaya trigger ping.
    if (action === 'message') {
        const modal = new ModalBuilder()
            .setCustomId(`emb_modal_message:${sessionId}`)
            .setTitle('Set Message (Plain Text)');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('value')
                .setLabel('Pesan di luar embed (kosongkan untuk hapus)')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(2000)
                .setPlaceholder('Teks pengantar di luar embed.\nSupport @everyone, @here, mention')
                .setValue(d.content || '')
        ));
        return interaction.showModal(modal);
    }

    // === ADD FIELD (normal / inline) ===
    if (action === 'add_field' || action === 'add_field_inline') {
        if (d.fields.length >= 25) {
            return interaction.reply({ content: '❌ Maksimal 25 field (batas Discord). Hapus field lama dulu.', flags: MessageFlags.Ephemeral });
        }
        const inline = action === 'add_field_inline';
        const modal = new ModalBuilder()
            .setCustomId(`emb_modal_field:${sessionId}:${inline ? '1' : '0'}`)
            .setTitle(`Add Field (${inline ? 'inline' : 'normal'})`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('name')
                    .setLabel('Field name (maks 256 char)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(256)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('value')
                    .setLabel('Field value (maks 1024 char)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1024)
            )
        );
        return interaction.showModal(modal);
    }

    // === REMOVE LAST FIELD ===
    if (action === 'remove_field') {
        if (d.fields.length === 0) {
            return interaction.reply({ content: '❌ Belum ada field untuk dihapus.', flags: MessageFlags.Ephemeral });
        }
        d.fields.pop();
        await refreshEmbedDraft(interaction, session);
        return interaction.reply({ content: '✅ Field terakhir dihapus.', flags: MessageFlags.Ephemeral });
    }

    // === CLEAR ALL FIELDS ===
    if (action === 'clear_fields') {
        if (d.fields.length === 0) {
            return interaction.reply({ content: '❌ Tidak ada field untuk dihapus.', flags: MessageFlags.Ephemeral });
        }
        const count = d.fields.length;
        d.fields = [];
        await refreshEmbedDraft(interaction, session);
        return interaction.reply({ content: `✅ ${count} field dihapus.`, flags: MessageFlags.Ephemeral });
    }

    // === TOGGLE TIMESTAMP ===
    if (action === 'toggle_timestamp') {
        d.timestamp = !d.timestamp;
        await refreshEmbedDraft(interaction, session);
        return interaction.reply({ content: `✅ Timestamp ${d.timestamp ? 'DINYALAKAN' : 'DIMATIKAN'}.`, flags: MessageFlags.Ephemeral });
    }
}

// ====================================================
// === HELPER: EMBED BUILDER — MODAL SUBMIT ===
// ====================================================
async function handleEmbedBuilderModal(interaction) {
    const parts = interaction.customId.split(':');
    const modalType = parts[0];
    const sessionId = parts[1];
    const session = getSession(sessionId);

    if (!session) {
        return interaction.reply({ content: '❌ Session builder sudah tidak ada.', flags: MessageFlags.Ephemeral });
    }
    if (session.ownerId !== interaction.user.id) {
        return interaction.reply({ content: '❌ Hanya pembuat yang bisa edit draft ini.', flags: MessageFlags.Ephemeral });
    }

    // v3.9.7: log deferReply failure supaya tidak gaib. Kalau deferReply gagal
    // (mis. interaction token expired karena modal terbuka >15 menit),
    // safeEditReply akan fallback ke reply() otomatis. Tapi kita tetap log
    // supaya admin tau kenapa konfirmasi ephemeral mungkin tidak muncul.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(err => {
        console.warn(`[Embed Builder Modal] deferReply gagal untuk ${interaction.customId}: ${err.message}`);
    });

    const d = session.data;
    // Discord.js v14: ModalSubmitInteraction.components adalah array of ActionRowModalData.
    // Setiap ActionRowModalData punya .components (bukan .fields!) — array TextInputModalData.
    // Tiap TextInputModalData punya .value (string).
    // Pakai ?. di seluruh chain supaya gak throw kalau index gak ada.
    const getFieldValue = (idx) => interaction.components[idx]?.components?.[0]?.value?.trim() || '';

    // === TITLE ===
    if (modalType === 'emb_modal_title') {
        // v3.9.2: validate Discord embed title limit (256 char)
        const val = getFieldValue(0);
        if (val && val.length > 256) {
            return safeEditReply(interaction,{ content: `❌ Title terlalu panjang (${val.length} char, maks 256).` });
        }
        d.title = val || null;
    }

    // === DESCRIPTION ===
    else if (modalType === 'emb_modal_desc') {
        // v3.9.2: validate Discord embed description limit (4096 char)
        const val = getFieldValue(0);
        if (val && val.length > 4096) {
            return safeEditReply(interaction,{ content: `❌ Description terlalu panjang (${val.length} char, maks 4096).` });
        }
        d.description = val || null;
    }

    // === COLOR ===
    else if (modalType === 'emb_modal_color') {
        const val = getFieldValue(0);
        if (!val) {
            d.color = 0x5865F2; // reset ke default
        } else {
            const parsed = parseColor(val);
            if (parsed === null) {
                return safeEditReply(interaction,{ content: `❌ Color tidak valid: \`${val}\`. Pakai format hex 6 digit, mis. \`#FF0000\`.` });
            }
            d.color = parsed;
        }
    }

    // === IMAGE ===
    else if (modalType === 'emb_modal_image') {
        const val = getFieldValue(0);
        if (val && !/^https?:\/\//i.test(val)) {
            return safeEditReply(interaction,{ content: '❌ Image URL harus mulai dengan `http://` atau `https://`' });
        }
        d.image = val ? { url: val } : null;
    }

    // === THUMBNAIL ===
    else if (modalType === 'emb_modal_thumbnail') {
        const val = getFieldValue(0);
        if (val && !/^https?:\/\//i.test(val)) {
            return safeEditReply(interaction,{ content: '❌ Thumbnail URL harus mulai dengan `http://` atau `https://`' });
        }
        d.thumbnail = val ? { url: val } : null;
    }

    // === FOOTER ===
    else if (modalType === 'emb_modal_footer') {
        const text = getFieldValue(0);
        const iconURL = getFieldValue(1);
        if (!text) {
            d.footer = null;
        } else {
            d.footer = { text };
            if (iconURL && /^https?:\/\//i.test(iconURL)) {
                d.footer.iconURL = iconURL;
            }
        }
    }

    // === AUTHOR ===
    else if (modalType === 'emb_modal_author') {
        const name = getFieldValue(0);
        const iconURL = getFieldValue(1);
        if (!name) {
            d.author = null;
        } else {
            d.author = { name };
            if (iconURL && /^https?:\/\//i.test(iconURL)) {
                d.author.iconURL = iconURL;
            }
        }
    }

    // === MESSAGE (plain text di luar embed) — v3.9.6 ===
    else if (modalType === 'emb_modal_message') {
        const val = getFieldValue(0);
        // v3.9.6: validate Discord message content limit (2000 char).
        // Modal setMaxLength sudah batasi, tapi defense-in-depth tetap cek.
        if (val && val.length > 2000) {
            return safeEditReply(interaction, { content: `❌ Message terlalu panjang (${val.length} char, maks 2000).` });
        }
        d.content = val || null;
    }

    // === ADD FIELD ===
    else if (modalType === 'emb_modal_field') {
        const inline = parts[2] === '1';
        const name = getFieldValue(0);
        const value = getFieldValue(1);
        if (!name || !value) {
            return safeEditReply(interaction,{ content: '❌ Field name dan value wajib diisi.' });
        }
        if (d.fields.length >= 25) {
            return safeEditReply(interaction,{ content: '❌ Maksimal 25 field (batas Discord).' });
        }
        // v3.9.2: defense-in-depth — walau modal setMaxLength sudah membatasi,
        // validasi lagi di sini supaya embed tidak throw di buildEmbed().
        // Field name maks 256 char, value maks 1024 char (Discord API limit).
        if (name.length > 256) {
            return safeEditReply(interaction,{ content: `❌ Field name terlalu panjang (${name.length} char, maks 256).` });
        }
        if (value.length > 1024) {
            return safeEditReply(interaction,{ content: `❌ Field value terlalu panjang (${value.length} char, maks 1024).` });
        }
        d.fields.push({ name, value, inline });
    }

    // === SEND TO CHANNEL ===
    else if (modalType === 'emb_modal_send') {
        const channelInput = getFieldValue(0);
        // v3.9.6: ambil message dari modal (bisa di-edit admin sebelum kirim).
        // Kalau kosong, fallback ke session.data.content (yang sudah diset via opsi "Message").
        let messageInput = getFieldValue(1);
        const messageText = messageInput || session.data.content || '';

        let targetChannel = null;

        // Parse: <#123> or 123 or #name
        const mentionMatch = channelInput.match(/^<#(\d+)>$/);
        if (mentionMatch) {
            targetChannel = interaction.guild.channels.cache.get(mentionMatch[1]);
        } else if (/^\d+$/.test(channelInput)) {
            targetChannel = interaction.guild.channels.cache.get(channelInput);
        } else {
            const name = channelInput.replace(/^#/, '');
            targetChannel = interaction.guild.channels.cache.find(c => c.name === name);
        }

        if (!targetChannel) {
            return safeEditReply(interaction, { content: `❌ Channel tidak ditemukan: \`${channelInput}\`. Pakai #mention atau channel ID.` });
        }

        // v3.9.6: validate message length (Discord limit 2000 char)
        if (messageText.length > 2000) {
            return safeEditReply(interaction, {
                content: `❌ Message terlalu panjang (${messageText.length} char, maks 2000). Persingkat teks atau hapus mention.`
            });
        }

        // v3.9.6: detect & validate mentions di message (sama ketatnya dengan /announce & /send-message).
        // Hanya format berikut yang diperbolehkan:
        //   - @everyone / everyone
        //   - @here / here
        //   - <@&ROLE_ID>      (role mention)
        //   - <@USER_ID>       (user mention)
        //   - <@!USER_ID>      (user mention, old format)
        // Selain itu → reject. Mencegah admin nggak sengaja kirim teks dengan
        // mention format aneh yang bisa trigger ping yang tidak diinginkan.
        //
        // Strategi: scan message untuk semua token mention yang ada, validasi satu per satu.
        // Kalau ada yang tidak valid → reject dengan pesan error yang menjelaskan format valid.
        if (messageText) {
            const mentionRegex = /@everyone|@here|<@!?\d{17,20}>|<@&\d{17,20}>|@\w+/g;
            const foundMentions = messageText.match(mentionRegex) || [];
            const invalidMentions = [];
            for (const m of foundMentions) {
                const lower = m.toLowerCase();
                if (lower === '@everyone' || lower === '@here') continue;
                if (/^<@&\d{17,20}>$/.test(m)) continue;       // role mention
                if (/^<@!?\d{17,20}>$/.test(m)) continue;       // user mention
                // Kalau sampai sini, berarti `@\w+` match tapi bukan format valid
                // (mis. "@halo", "@admin", "@semua") → reject
                invalidMentions.push(m);
            }
            if (invalidMentions.length > 0) {
                return safeEditReply(interaction, {
                    content: `❌ Mention tidak valid di message: \`${invalidMentions.join('`, `')}\`\n\n` +
                        'Format mention yang didukung:\n' +
                        '• `@everyone` atau `@here`\n' +
                        '• `<@&ROLE_ID>` (mention role — ketik `@rolename` di Discord lalu copy)\n' +
                        '• `<@USER_ID>` (mention user — ketik `@username` di Discord lalu copy)\n\n' +
                        'Tip: mention seperti `@halo` atau `@admin` (tanpa ID) tidak akan trigger ping di Discord, ' +
                        'tapi kami tolak di sini supaya admin tidak salah kirim mention yang nggak sengaja.'
                });
            }
        }

        // v3.9.6: unescape \\n → \n (Discord modal otomatis escape backslash di input user)
        const finalMessage = messageText.replace(/\\n/g, '\n');

        const embed = buildSessionEmbed(session);
        try {
            // Kirim dengan content (plain text) + embeds.
            // allowedMentions parse: biarkan Discord parse mention normal
            // (everyone, roles, users) — sudah divalidasi di atas.
            await targetChannel.send({
                content: finalMessage || undefined,
                embeds: [embed],
                allowedMentions: { parse: ['everyone', 'roles', 'users'] }
            });
        } catch (err) {
            return safeEditReply(interaction, { content: `❌ Gagal kirim ke ${targetChannel}: ${err.message}` });
        }

        // P1-10 FIX: audit log untuk EMBED_BUILDER_SEND (sebelumnya missing).
        // v3.9.6: include info message (panjang + ada/tidak) di audit log.
        try {
            await logAudit(interaction.client, {
                action: 'EMBED_BUILDER_SEND',
                actorId: interaction.user.id,
                actorTag: interaction.user.tag,
                details: `Kirim embed (builder) ke ${targetChannel}: ${session.data.title ? `**${session.data.title}**` : '_(no title)_'}${finalMessage ? ` | +message (${finalMessage.length} char)` : ''}`,
                guildId: interaction.guild.id
            });
        } catch (_) {}

        // Hapus draft message
        try {
            const channel = interaction.guild.channels.cache.get(session.channelId);
            if (channel) {
                const msg = await channel.messages.fetch(session.messageId).catch(() => null);
                if (msg) await msg.delete();
            }
        } catch (_) {}
        deleteSession(sessionId);
        return safeEditReply(interaction, {
            content: `✅ ${finalMessage ? 'Message + ' : ''}Embed terkirim ke ${targetChannel}! Draft dihapus.`
        });
    }

    // Refresh draft dengan embed terbaru
    await refreshEmbedDraft(interaction, session);
    return safeEditReply(interaction,{ content: '✅ Embed diupdate.' });
}

// ====================================================
// === HELPER: REFRESH EMBED BUILDER DRAFT MESSAGE ===
// ====================================================
async function refreshEmbedDraft(interaction, session) {
    try {
        const channel = interaction.guild.channels.cache.get(session.channelId);
        if (!channel) return;
        const msg = await channel.messages.fetch(session.messageId).catch(() => null);
        if (!msg) return;
        const embed = buildSessionEmbed(session);
        await msg.edit({ embeds: [embed] });
    } catch (err) {
        console.warn('Gagal refresh embed draft:', err.message);
    }
}

// ====================================================
// === HELPER: GIVEAWAY JOIN / LEAVE BUTTON HANDLER ===
// ====================================================
async function handleGiveawayButton(interaction) {
    try {
        const [action, gwId] = interaction.customId.split(':');
        const gw = getGiveaway(gwId);
        if (!gw) {
            return interaction.reply({ content: '❌ Giveaway tidak ditemukan (mungkin sudah dihapus).', flags: MessageFlags.Ephemeral });
        }
        if (gw.ended) {
            return interaction.reply({ content: '❌ Giveaway sudah berakhir.', flags: MessageFlags.Ephemeral });
        }
        if (gw.guildId !== interaction.guild.id) {
            return interaction.reply({ content: '❌ Giveaway ini bukan dari guild ini.', flags: MessageFlags.Ephemeral });
        }

        // Cek required role
        if (gw.requiredRoleId) {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !member.roles.cache.has(gw.requiredRoleId)) {
                const role = interaction.guild.roles.cache.get(gw.requiredRoleId);
                return interaction.reply({ content: `❌ Kamu harus punya role ${role || '`' + gw.requiredRoleId + '`'} untuk ikut giveaway ini.`, flags: MessageFlags.Ephemeral });
            }
        }

        // v3.9.2 FIX: wrap join/leave dalam per-user lock untuk mencegah
        // TOCTOU race condition. Sebelumnya, 2 klik cepat (<100ms) bisa
        // lolos cek `includes()` keduanya, lalu keduanya push userId →
        // participant dobel. Lock memaksa klik kedua nunggu klik pertama
        // selesai (di mana save() sudah menulis data terbaru ke disk).
        const lockResult = await withUserLock('gw', interaction.user.id, async () => {
            // Refresh gw dari disk di dalam lock supaya baca data terbaru
            const gwFresh = getGiveaway(gwId);
            if (!gwFresh) return { type: 'notfound' };
            if (gwFresh.ended) return { type: 'ended' };

            // JOIN
            if (action === 'gw_join') {
                if (gwFresh.participantIds.includes(interaction.user.id)) {
                    return { type: 'already_joined' };
                }
                const updated = gwAddParticipant(gwId, interaction.user.id);
                await updateGiveawayMessage(interaction, updated);
                return { type: 'joined', total: updated.participantIds.length };
            }

            // LEAVE
            if (action === 'gw_leave') {
                if (!gwFresh.participantIds.includes(interaction.user.id)) {
                    return { type: 'not_joined' };
                }
                const updated = gwRemoveParticipant(gwId, interaction.user.id);
                await updateGiveawayMessage(interaction, updated);
                return { type: 'left' };
            }
            return { type: 'noop' };
        });

        if (lockResult === null) {
            // Lock gagal acquire — user klik terlalu cepat
            return interaction.reply({
                content: '⏳ Tunggu sebentar, kamu lagi klik terlalu cepat. Coba lagi dalam 1 detik.',
                flags: MessageFlags.Ephemeral
            });
        }

        switch (lockResult.type) {
            case 'notfound':
                return interaction.reply({ content: '❌ Giveaway tidak ditemukan (mungkin sudah dihapus).', flags: MessageFlags.Ephemeral });
            case 'ended':
                return interaction.reply({ content: '❌ Giveaway sudah berakhir.', flags: MessageFlags.Ephemeral });
            case 'already_joined':
                return interaction.reply({ content: 'ℹ️ Kamu sudah join giveaway ini.', flags: MessageFlags.Ephemeral });
            case 'not_joined':
                return interaction.reply({ content: 'ℹ️ Kamu belum join giveaway ini.', flags: MessageFlags.Ephemeral });
            case 'joined':
                return interaction.reply({ content: `✅ Kamu join giveaway **${gw.prize}**! 🎉\n👥 Total peserta: ${lockResult.total}`, flags: MessageFlags.Ephemeral });
            case 'left':
                return interaction.reply({ content: `🚪 Kamu keluar dari giveaway **${gw.prize}**.`, flags: MessageFlags.Ephemeral });
            default:
                return interaction.reply({ content: '❌ Tidak ada aksi yang dilakukan.', flags: MessageFlags.Ephemeral });
        }
    } catch (err) {
        console.error('Giveaway button error:', err);
        if (interaction.isRepliable() && !interaction.replied) {
            await interaction.reply({ content: '❌ Terjadi error.', flags: MessageFlags.Ephemeral }).catch(()=>{});
        }
    }
}

async function updateGiveawayMessage(interaction, gw) {
    try {
        const channel = interaction.guild.channels.cache.get(gw.channelId);
        if (!channel) return;
        const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
        if (!msg) return;

        const timeLeft = gw.endsAt - Date.now();
        const embed = new EmbedBuilder()
            .setTitle('🎉 GIVEAWAY!')
            .setDescription(
                `🎁 **Prize:** ${gw.prize}\n\n` +
                `👥 **Pemenang:** ${gw.winnersCount}\n` +
                `⏰ **Berakhir:** <t:${Math.floor(gw.endsAt / 1000)}:R> (<t:${Math.floor(gw.endsAt / 1000)}:F>)\n` +
                `🎟️ **Peserta:** ${gw.participantIds.length}\n` +
                (gw.requiredRoleId ? `🔐 **Syarat:** <@&${gw.requiredRoleId}>\n` : '') +
                `\n👇 Klik tombol **🎉 Join** di bawah untuk ikut!`
            )
            .setColor(timeLeft < 60000 ? 0xE67E22 : 0xF1C40F)
            .setFooter({ text: `Host: ${gw.hostTag} | ID: ${gw.id}` })
            .setTimestamp();
        await msg.edit({ embeds: [embed] });
    } catch (err) {
        console.warn('Gagal update giveaway message:', err.message);
    }
}

// ====================================================
// === HELPER: POLL VOTE BUTTON HANDLER ===
// ====================================================
async function handlePollButton(interaction) {
    try {
        // customId: poll_vote:<pollId>:<optionIndex>
        const parts = interaction.customId.split(':');
        const pollId = parts[1];
        const optionIndex = parseInt(parts[2]);

        // Pre-check cepat untuk feedback instan (tanpa lock)
        const pollPre = getPoll(pollId);
        if (!pollPre) {
            return interaction.reply({ content: '❌ Poll tidak ditemukan.', flags: MessageFlags.Ephemeral });
        }
        if (pollPre.closed) {
            return interaction.reply({ content: '❌ Poll sudah ditutup.', flags: MessageFlags.Ephemeral });
        }

        // v3.9.2 FIX: per-user lock untuk mencegah TOCTOU race condition.
        // Sebelumnya, 2 klik cepat di option yang sama (multiple=false)
        // bisa: klik-1 toggle ON, klik-2 toggle OFF. Hasil: vote hilang
        // padahal user merasa sudah vote. Lock memaksa klik-2 baca data
        // terbaru setelah klik-1 selesai.
        const result = await withUserLock('poll', interaction.user.id, () => {
            return votePoll(pollId, interaction.user.id, optionIndex);
        });

        if (result === null) {
            // Lock gagal — user klik terlalu cepat
            return interaction.reply({
                content: '⏳ Tunggu sebentar, kamu lagi klik terlalu cepat. Coba lagi dalam 1 detik.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (!result) {
            return interaction.reply({ content: '❌ Gagal vote. Option mungkin tidak valid.', flags: MessageFlags.Ephemeral });
        }
        if (result.closed) {
            return interaction.reply({ content: '❌ Poll sudah ditutup.', flags: MessageFlags.Ephemeral });
        }
        await updatePollVoteMessage(interaction, result);
        const opt = result.options[optionIndex];
        const voted = opt.votes.includes(interaction.user.id);
        return interaction.reply({
            content: voted
                ? `✅ Vote tercatat untuk **${opt.label}**!`
                : `🚪 Vote dibatalkan untuk **${opt.label}**.`,
            flags: MessageFlags.Ephemeral
        });
    } catch (err) {
        console.error('Poll button error:', err);
        if (interaction.isRepliable() && !interaction.replied) {
            await interaction.reply({ content: '❌ Terjadi error.', flags: MessageFlags.Ephemeral }).catch(()=>{});
        }
    }
}

async function updatePollVoteMessage(interaction, poll) {
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
                `🔄 Mode: ${poll.multiple ? 'Multi-vote (boleh pilih banyak)' : 'Single-vote (pilih satu)'}\n` +
                `⏰ Dibuat: <t:${Math.floor(poll.createdAt / 1000)}:R>\n\n` +
                `👇 Klik tombol di bawah untuk vote (toggle)`
            )
            .setColor(0x5865F2)
            .setFooter({ text: `Poll by ${poll.creatorTag} | ID: ${poll.id}` })
            .setTimestamp();
        await msg.edit({ embeds: [embed] });
    } catch (err) {
        console.warn('Gagal update poll message:', err.message);
    }
}

// ====================================================
// === HELPER: POLL MODAL CREATE (process input options) ===
// ====================================================
async function handlePollModalCreate(interaction) {
    try {
        // v3.9.1 FIX: customId sekarang hanya `poll_modal_create:<sessionId>`.
        // Data poll (channelId, multiple, question) disimpan di in-memory session
        // supaya customId tidak overflow 100-char Discord limit kalau question panjang.
        const parts = interaction.customId.split(':');
        const sessionId = parts[1];
        const session = getPollSession(sessionId);

        if (!session) {
            return interaction.reply({
                content: '❌ Session poll sudah expired (lebih dari 5 menit). Jalankan ulang `/poll create`.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Defense-in-depth: pastikan user yang submit modal = user yang buat session.
        if (session.userId !== interaction.user.id) {
            return interaction.reply({
                content: '❌ Modal ini bukan milik kamu. Jalankan `/poll create` sendiri.',
                flags: MessageFlags.Ephemeral
            });
        }

        const { channelId, multiple, question } = session;

        const optionsRaw = interaction.components[0]?.components?.[0]?.value?.trim() || '';
        if (!optionsRaw) {
            return interaction.reply({ content: '❌ Options tidak boleh kosong.', flags: MessageFlags.Ephemeral });
        }

        const optionLines = optionsRaw.split('\n').map(s => s.trim()).filter(s => s.length > 0);
        if (optionLines.length < 2) {
            return interaction.reply({ content: '❌ Minimal 2 options (1 per baris).', flags: MessageFlags.Ephemeral });
        }
        if (optionLines.length > 10) {
            return interaction.reply({ content: '❌ Maksimal 10 options.', flags: MessageFlags.Ephemeral });
        }

        const options = optionLines.map((label, i) => ({
            label: label.slice(0, 80),
            emoji: `${i + 1}️⃣`
        }));

        const channel = interaction.guild.channels.cache.get(channelId);
        if (!channel) {
            deletePollSession(sessionId);
            return interaction.reply({ content: '❌ Channel tidak ditemukan.', flags: MessageFlags.Ephemeral });
        }

        // Create poll entry
        const poll = createPoll({
            guildId: interaction.guild.id,
            channelId: channel.id,
            question,
            options,
            multiple,
            creatorId: interaction.user.id,
            creatorTag: interaction.user.tag
        });

        // Build embed + buttons
        const total = 0;
        const lines = poll.options.map((opt, i) => {
            const pct = 0;
            const bar = '░'.repeat(10);
            return `${opt.emoji} **${opt.label}** — 0 votes (0%)\n\`${bar}\``;
        }).join('\n\n');

        const embed = new EmbedBuilder()
            .setTitle(`📊 ${question}`)
            .setDescription(
                `${lines}\n\n` +
                `🗳️ Total votes: **0**\n` +
                `🔄 Mode: ${multiple ? 'Multi-vote (boleh pilih banyak)' : 'Single-vote (pilih satu)'}\n` +
                `⏰ Dibuat: <t:${Math.floor(poll.createdAt / 1000)}:R>\n\n` +
                `👇 Klik tombol di bawah untuk vote (toggle)`
            )
            .setColor(0x5865F2)
            .setFooter({ text: `Poll by ${interaction.user.tag} | ID: ${poll.id}` })
            .setTimestamp();

        // Build buttons — 5 per row (Discord limit), wrap to next row if more
        const rows = [];
        for (let i = 0; i < poll.options.length; i += 5) {
            const row = new ActionRowBuilder();
            for (let j = i; j < Math.min(i + 5, poll.options.length); j++) {
                const opt = poll.options[j];
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`poll_vote:${poll.id}:${j}`)
                        .setLabel(opt.label.slice(0, 80))
                        .setEmoji(opt.emoji)
                        .setStyle(ButtonStyle.Primary)
                );
            }
            rows.push(row);
        }

        const msg = await channel.send({ embeds: [embed], components: rows, content: `📊 **POLL BARU** oleh ${interaction.user}` }).catch(err => null);
        if (!msg) {
            // P0-5 FIX: rollback poll entry yang sudah tersimpan kalau gagal kirim message.
            try { removePoll(poll.id); } catch (_) {}
            deletePollSession(sessionId);
            return interaction.reply({ content: `❌ Gagal kirim poll ke ${channel}. Cek permission bot. Entry di-rollback.`, flags: MessageFlags.Ephemeral });
        }
        setPollMessageId(poll.id, msg.id);
        // v3.9.1: session sudah dipakai, hapus dari memory.
        deletePollSession(sessionId);
        // P1-10 FIX: tambah audit log untuk POLL_CREATE (sebelumnya missing).
        try {
            await logAudit(interaction.client, { action: 'POLL_CREATE', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Buat poll **${question}** (${poll.options.length} options, ${multiple ? 'multi' : 'single'}-vote) di ${channel}`, guildId: interaction.guild.id });
        } catch (_) {}
        return interaction.reply({ content: `✅ Poll dibuat di ${channel}!\n🆔 \`${poll.id}\`\n💡 Tutup pakai \`/poll close id:${poll.id}\``, flags: MessageFlags.Ephemeral });
    } catch (err) {
        console.error('Poll modal create error:', err);
        if (interaction.isRepliable() && !interaction.replied) {
            await interaction.reply({ content: '❌ Terjadi error: ' + err.message, flags: MessageFlags.Ephemeral }).catch(()=>{});
        }
    }
}

// ====================================================
// === v3.8: TEMP VOICE — Helper functions ===
// ====================================================

/**
 * Helper: cari SEMUA voice channel yang di-owner oleh interaction.user di guildnya.
 *
 * v3.8.3: support multiple channels per owner (mis. user owner 2 channel berbeda).
 * Return array of { guild, channel, channelInfo, channelId }.
 */
async function findAllOwnerVoiceChannels(interaction) {
    const tempVoiceManager = require('../utils/tempVoiceManager');
    const userId = interaction.user.id;
    const results = [];

    // Cari di guild tempat interaction terjadi (lebih efisien dari scan semua guild)
    if (interaction.guild) {
        const cfg = tempVoiceManager.getGuildConfig(interaction.guild.id);
        if (cfg?.channels) {
            for (const [channelId, info] of Object.entries(cfg.channels)) {
                if (info.ownerId === userId) {
                    const channel = interaction.guild.channels.cache.get(channelId);
                    if (channel) {
                        results.push({ guild: interaction.guild, channel, channelInfo: info, channelId });
                    }
                }
            }
        }
    }
    return results;
}

/**
 * Helper lama: cari voice channel pertama yang di-owner oleh interaction.user.
 * Dipertahankan untuk backward compat (digunakan di beberapa handler).
 */
async function findOwnerVoiceChannel(interaction) {
    const all = await findAllOwnerVoiceChannels(interaction);
    return all[0] || null;
}

/**
 * v3.8.3: Helper untuk guard button control panel — AUTO-DETECT owner.
 *
 * Logic:
 *   1. Cari semua voice channel yang user owner-nya di guild ini
 *   2. Filter: hanya channel yang user sedang berada di dalamnya
 *   3. Kalau 0 channel → error "kamu tidak punya voice aktif"
 *   4. Kalau 1 channel → langsung return channel itu (auto-detect!)
 *   5. Kalau 2+ channel → return flag needSelect, handler harus tampilkan
 *      select menu pilih channel dulu
 *
 * Returns:
 *   - { ok: true, found } — 1 channel, siap eksekusi
 *   - { ok: false, needSelect: true, channels } — multiple channels, perlu pilih
 *   - { ok: false, reason } — error, tampilkan ke user
 */
async function requireTempVoiceOwner(interaction) {
    const allOwned = await findAllOwnerVoiceChannels(interaction);

    if (allOwned.length === 0) {
        return {
            ok: false,
            reason: '❌ Kamu tidak punya voice channel aktif. Klik **🎤 Buat Voice** dulu untuk bikin channel sendiri.'
        };
    }

    // Filter: channel yang user sedang berada di dalamnya
    const inVoice = allOwned.filter(o => o.channel.members.has(interaction.user.id));

    if (inVoice.length === 0) {
        // User owner channel tapi tidak ada di mana-mana → tampilkan list channel mereka
        const channelList = allOwned.map(o => `• ${o.channel}`).join('\n');
        return {
            ok: false,
            reason: `❌ Kamu harus berada di voice channel kamu untuk pakai kontrol ini.\n\nVoice channel milikmu:\n${channelList}\n\n💡 Join salah satu channel di atas, lalu klik tombol kontrol lagi.`
        };
    }

    if (inVoice.length === 1) {
        // AUTO-DETECT: 1 channel → langsung pakai
        return { ok: true, found: inVoice[0] };
    }

    // Multiple channels: perlu pilih dulu
    return { ok: false, needSelect: true, channels: inVoice };
}

/**
 * v3.8.3: Build select menu untuk pilih channel (kalau owner punya multiple channels).
 */
async function showChannelSelectMenu(interaction, channels, action) {
    try {
        const { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
        const options = channels.map(o => ({
            label: o.channelInfo.name.slice(0, 100),
            value: `${action}:${o.channelId}`,
            description: `Kontrol ${o.channelInfo.name} (${o.channel.members.size} member)`.slice(0, 100)
        }));
        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('tv_channel_select')
                .setPlaceholder('Pilih channel yang ingin kamu kontrol...')
                .addOptions(options.slice(0, 25))
                .setMinValues(1)
                .setMaxValues(1)
        );
        const embed = new EmbedBuilder()
            .setTitle('🔄 PILIH CHANNEL')
            .setDescription('Kamu owner dari beberapa voice channel. Pilih channel yang ingin kamu kontrol:')
            .setColor(0x5865F2);
        return interaction.reply({ embeds: [embed], components: [selectRow], flags: MessageFlags.Ephemeral });
    } catch (err) {
        console.error('showChannelSelectMenu error:', err);
        await interaction.reply({ content: `❌ Gagal: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(()=>{});
    }
}

/**
 * Button: tv_rename — buka modal input nama baru.
 */
async function handleTempVoiceRename(interaction) {
    try {
        // v3.8.3: auto-detect owner
        const check = await requireTempVoiceOwner(interaction);
        if (!check.ok) {
            if (check.needSelect) {
                return showChannelSelectMenu(interaction, check.channels, 'rename');
            }
            return interaction.reply({ content: check.reason, flags: MessageFlags.Ephemeral });
        }
        const modal = new ModalBuilder()
            .setCustomId('tv_modal_rename')
            .setTitle('✏️ Rename Voice Channel');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('new_name')
                    .setLabel('Nama baru channel')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('mis. 🎮 Squad Mobile Legends')
                    .setMinLength(1)
                    .setMaxLength(95)
            )
        );
        return interaction.showModal(modal);
    } catch (err) {
        console.error('TempVoice rename modal error:', err);
        await interaction.reply({ content: `❌ Gagal: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(()=>{});
    }
}

/**
 * Modal: tv_modal_rename — submit rename.
 */
async function handleTempVoiceRenameSubmit(interaction) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const newName = interaction.components[0]?.components?.[0]?.value?.trim() || '';
        if (!newName) {
            return safeEditReply(interaction,{ content: '❌ Nama tidak boleh kosong.' });
        }

        const check = await requireTempVoiceOwner(interaction);
        if (!check.ok) {
            return safeEditReply(interaction,{ content: check.reason });
        }
        const found = check.found;
        const { guild, channel, channelId } = found;
        try {
            await channel.setName(newName.slice(0, 100));
        } catch (err) {
            return safeEditReply(interaction,{ content: `❌ Gagal rename: ${err.message}` });
        }

        const tempVoiceManager = require('../utils/tempVoiceManager');
        tempVoiceManager.updateChannel(guild.id, channelId, { name: newName.slice(0, 100) });

        // v3.8.1: refresh panel global supaya nama baru ter-update
        if (typeof interaction.client.refreshGlobalControlPanel === 'function') {
            await interaction.client.refreshGlobalControlPanel(interaction.client, guild.id);
        }

        return safeEditReply(interaction,{ content: `✅ Channel di-rename jadi: **${newName}**` });
    } catch (err) {
        console.error('TempVoice rename submit error:', err);
        if (interaction.deferred && !interaction.replied) {
            await safeEditReply(interaction,{ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
        }
    }
}

/**
 * Button: tv_kick — tampilkan select menu member untuk kick.
 */
async function handleTempVoiceKickMenu(interaction) {
    try {
        const check = await requireTempVoiceOwner(interaction);
        if (!check.ok) {
            if (check.needSelect) {
                return showChannelSelectMenu(interaction, check.channels, 'kick');
            }
            return interaction.reply({ content: check.reason, flags: MessageFlags.Ephemeral });
        }
        const found = check.found;
        const { buildKickSelectMenu } = require('../utils/tempVoiceControlPanel');
        const selectMenu = buildKickSelectMenu(found.channel, found.channelInfo.ownerId);
        if (!selectMenu) {
            return interaction.reply({ content: '❌ Tidak ada member lain di voice kamu saat ini.', flags: MessageFlags.Ephemeral });
        }

        const embed = new EmbedBuilder()
            .setTitle('🚫 KICK MEMBER')
            .setDescription('Pilih member yang ingin kamu keluarkan dari voice channel.')
            .setColor(0xED4245);

        return interaction.reply({ embeds: [embed], components: [selectMenu], flags: MessageFlags.Ephemeral });
    } catch (err) {
        console.error('TempVoice kick menu error:', err);
        await interaction.reply({ content: `❌ Gagal: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(()=>{});
    }
}

/**
 * Select: tv_kick_select — eksekusi kick.
 */
async function handleTempVoiceKickExecute(interaction) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const check = await requireTempVoiceOwner(interaction);
        if (!check.ok) {
            return safeEditReply(interaction,{ content: check.reason });
        }
        const found = check.found;

        const targetIds = interaction.values;
        const kicked = [];
        const failed = [];

        for (const targetId of targetIds) {
            const targetMember = found.channel.members.get(targetId);
            if (!targetMember) {
                failed.push(`<@${targetId}> — tidak ada di voice`);
                continue;
            }
            try {
                // Kick = pindahkan ke channel null (disconnect)
                await targetMember.voice.disconnect('Di-kick oleh owner temp voice');
                kicked.push(`<@${targetId}>`);
            } catch (err) {
                failed.push(`<@${targetId}> — ${err.message}`);
            }
        }

        let msg = `✅ Berhasil kick: ${kicked.join(', ') || '_(tidak ada)_'}`;
        if (failed.length > 0) {
            msg += `\n❌ Gagal: ${failed.join(', ')}`;
        }

        // v3.8.1: refresh panel global supaya member count ter-update
        if (typeof interaction.client.refreshGlobalControlPanel === 'function') {
            await interaction.client.refreshGlobalControlPanel(interaction.client, found.guild.id);
        }

        return safeEditReply(interaction,{ content: msg });
    } catch (err) {
        console.error('TempVoice kick execute error:', err);
        if (interaction.deferred && !interaction.replied) {
            await safeEditReply(interaction,{ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
        }
    }
}

/**
 * Button: tv_limit — buka modal input limit.
 */
async function handleTempVoiceLimit(interaction) {
    try {
        const check = await requireTempVoiceOwner(interaction);
        if (!check.ok) {
            if (check.needSelect) {
                return showChannelSelectMenu(interaction, check.channels, 'limit');
            }
            return interaction.reply({ content: check.reason, flags: MessageFlags.Ephemeral });
        }
        const modal = new ModalBuilder()
            .setCustomId('tv_modal_limit')
            .setTitle('👥 Atur Limit Member');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('limit_value')
                    .setLabel('Max member (0 = unlimited, max 99)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('mis. 5 untuk squad, 0 untuk unlimited')
                    .setMinLength(1)
                    .setMaxLength(2)
            )
        );
        return interaction.showModal(modal);
    } catch (err) {
        console.error('TempVoice limit modal error:', err);
        await interaction.reply({ content: `❌ Gagal: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(()=>{});
    }
}

/**
 * Modal: tv_modal_limit — submit limit.
 */
async function handleTempVoiceLimitSubmit(interaction) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const limitStr = interaction.components[0]?.components?.[0]?.value?.trim() || '0';
        let limit = parseInt(limitStr, 10);
        if (isNaN(limit) || limit < 0) limit = 0;
        if (limit > 99) limit = 99;

        const check = await requireTempVoiceOwner(interaction);
        if (!check.ok) {
            return safeEditReply(interaction,{ content: check.reason });
        }
        const found = check.found;

        try {
            await found.channel.setUserLimit(limit);
        } catch (err) {
            return safeEditReply(interaction,{ content: `❌ Gagal atur limit: ${err.message}` });
        }

        const tempVoiceManager = require('../utils/tempVoiceManager');
        tempVoiceManager.updateChannel(found.guild.id, found.channelId, { limit });

        // v3.8.1: refresh panel global supaya limit ter-update
        if (typeof interaction.client.refreshGlobalControlPanel === 'function') {
            await interaction.client.refreshGlobalControlPanel(interaction.client, found.guild.id);
        }

        const limitStr2 = limit === 0 ? 'unlimited' : `${limit} member`;
        return safeEditReply(interaction,{ content: `✅ Limit diatur ke: **${limitStr2}**` });
    } catch (err) {
        console.error('TempVoice limit submit error:', err);
        if (interaction.deferred && !interaction.replied) {
            await safeEditReply(interaction,{ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
        }
    }
}

/**
 * Button: tv_lock — toggle lock/unlock channel.
 * v3.8.5: Single button, toggles based on current locked state.
 */
async function handleTempVoiceLockToggle(interaction) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const check = await requireTempVoiceOwner(interaction);
        if (!check.ok) {
            if (check.needSelect) {
                // Untuk lock, kita bisa langsung proses semua channel (atau pilih satu).
                // Untuk simplicity, tampilkan select menu.
                await safeEditReply(interaction,{ content: 'Kamu owner beberapa channel. Gunakan switch select di panel global untuk fokus ke salah satu, lalu klik Lock/Unlock lagi.' });
                return;
            }
            return safeEditReply(interaction,{ content: check.reason });
        }
        const found = check.found;
        const tempVoiceManager = require('../utils/tempVoiceManager');
        const { PermissionFlagsBits: PFB } = require('discord.js');
        // v3.8.5: toggle based on current state (panel hanya punya 1 tombol Lock)
        const willLock = !found.channelInfo.locked;

        try {
            // Lock = deny Connect untuk @everyone, Unlock = allow Connect
            await found.channel.permissionOverwrites.edit(found.guild.roles.everyone.id, {
                [PFB.Connect]: willLock ? false : true
            });
        } catch (err) {
            return safeEditReply(interaction,{ content: `❌ Gagal ${willLock ? 'lock' : 'unlock'}: ${err.message}` });
        }

        tempVoiceManager.updateChannel(found.guild.id, found.channelId, { locked: willLock });

        // v3.8.1: refresh panel global supaya status lock ter-update
        if (typeof interaction.client.refreshGlobalControlPanel === 'function') {
            await interaction.client.refreshGlobalControlPanel(interaction.client, found.guild.id);
        }

        return safeEditReply(interaction,{
            content: willLock
                ? '🔒 Channel **terkunci**. Hanya owner yang bisa invite member (dengan mention/drag).'
                : '🔓 Channel **terbuka**. Member bisa join bebas.'
        });
    } catch (err) {
        console.error('TempVoice lock toggle error:', err);
        if (interaction.deferred && !interaction.replied) {
            await safeEditReply(interaction,{ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
        }
    }
}

/**
 * Button: tv_transfer — tampilkan select menu member untuk transfer ownership.
 */
async function handleTempVoiceTransferMenu(interaction) {
    try {
        const check = await requireTempVoiceOwner(interaction);
        if (!check.ok) {
            if (check.needSelect) {
                return showChannelSelectMenu(interaction, check.channels, 'transfer');
            }
            return interaction.reply({ content: check.reason, flags: MessageFlags.Ephemeral });
        }
        const found = check.found;
        const { buildTransferSelectMenu } = require('../utils/tempVoiceControlPanel');
        const selectMenu = buildTransferSelectMenu(found.channel, found.channelInfo.ownerId);
        if (!selectMenu) {
            return interaction.reply({ content: '❌ Tidak ada member lain di voice kamu saat ini.', flags: MessageFlags.Ephemeral });
        }

        const embed = new EmbedBuilder()
            .setTitle('🔄 TRANSFER OWNERSHIP')
            .setDescription('Pilih member yang akan menjadi owner baru. Kamu tidak akan jadi owner lagi setelah ini.')
            .setColor(0x5865F2);

        return interaction.reply({ embeds: [embed], components: [selectMenu], flags: MessageFlags.Ephemeral });
    } catch (err) {
        console.error('TempVoice transfer menu error:', err);
        await interaction.reply({ content: `❌ Gagal: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(()=>{});
    }
}

/**
 * Select: tv_transfer_select — eksekusi transfer ownership.
 */
async function handleTempVoiceTransferExecute(interaction) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const check = await requireTempVoiceOwner(interaction);
        if (!check.ok) {
            return safeEditReply(interaction,{ content: check.reason });
        }
        const found = check.found;

        const newOwnerId = interaction.values[0];
        const newOwner = found.channel.members.get(newOwnerId);
        if (!newOwner) {
            return safeEditReply(interaction,{ content: '❌ Member tersebut sudah tidak ada di voice kamu.' });
        }

        const tempVoiceManager = require('../utils/tempVoiceManager');
        const { PermissionFlagsBits: PFB } = require('discord.js');

        // Update permission: lepas owner lama, beri owner baru
        try {
            await found.channel.permissionOverwrites.edit(found.channelInfo.ownerId, {
                [PFB.ManageChannels]: false,
                [PFB.MoveMembers]: false,
                [PFB.MuteMembers]: false,
                [PFB.DeafenMembers]: false
            });
            await found.channel.permissionOverwrites.edit(newOwnerId, {
                [PFB.ViewChannel]: true,
                [PFB.Connect]: true,
                [PFB.ManageChannels]: true,
                [PFB.MoveMembers]: true,
                [PFB.MuteMembers]: true,
                [PFB.DeafenMembers]: true
            });
        } catch (err) {
            return safeEditReply(interaction,{ content: `❌ Gagal update permission: ${err.message}` });
        }

        tempVoiceManager.transferOwnership(found.guild.id, found.channelId, newOwnerId, newOwner.user.tag);

        // v3.8.1: refresh panel global supaya owner baru ter-display
        if (typeof interaction.client.refreshGlobalControlPanel === 'function') {
            await interaction.client.refreshGlobalControlPanel(interaction.client, found.guild.id);
        }

        return safeEditReply(interaction,{
            content: `✅ Ownership dipindahkan ke <@${newOwnerId}>. Kamu tidak lagi owner channel ini.`
        });
    } catch (err) {
        console.error('TempVoice transfer execute error:', err);
        if (interaction.deferred && !interaction.replied) {
            await safeEditReply(interaction,{ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
        }
    }
}

/**
 * Button: tv_delete — hapus channel temp voice milik user.
 */
async function handleTempVoiceDelete(interaction) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const check = await requireTempVoiceOwner(interaction);
        if (!check.ok) {
            if (check.needSelect) {
                await safeEditReply(interaction,{ content: 'Kamu owner beberapa channel. Gunakan switch select di panel global untuk fokus ke salah satu, lalu klik Delete lagi.' });
                return;
            }
            return safeEditReply(interaction,{ content: check.reason });
        }
        const found = check.found;
        const tempVoiceManager = require('../utils/tempVoiceManager');

        try {
            await found.channel.delete('Dihapus oleh owner via control panel');
        } catch (err) {
            if (err.code !== 10003) {
                return safeEditReply(interaction,{ content: `❌ Gagal hapus channel: ${err.message}` });
            }
        }
        tempVoiceManager.unregisterChannel(found.guild.id, found.channelId);

        // v3.8.1: refresh panel global supaya kembali ke tampilan idle
        if (typeof interaction.client.refreshGlobalControlPanel === 'function') {
            await interaction.client.refreshGlobalControlPanel(interaction.client, found.guild.id);
        }

        return safeEditReply(interaction,{ content: '🗑️ Voice channel kamu berhasil dihapus.' });
    } catch (err) {
        console.error('TempVoice delete error:', err);
        if (interaction.deferred && !interaction.replied) {
            await safeEditReply(interaction,{ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
        }
    }
}

/**
 * v3.8.5: Button: tv_info — tampilkan info room voice (ephemeral).
 *
 * Logic:
 *   - Kalau user adalah owner → tampilkan info channel miliknya
 *   - Kalau user bukan owner tapi sedang di voice → tampilkan info voice yang sedang dia tinggali
 *   - Kalau user tidak di voice → tampilkan daftar semua voice aktif
 */
async function handleTempVoiceInfo(interaction) {
    try {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ Hanya bisa dipakai di server.', flags: MessageFlags.Ephemeral });
        }

        const tempVoiceManager = require('../utils/tempVoiceManager');
        const { buildInfoRoomEmbed } = require('../utils/tempVoiceControlPanel');
        const config = tempVoiceManager.getGuildConfig(interaction.guild.id);

        if (!config?.channels || Object.keys(config.channels).length === 0) {
            return interaction.reply({ content: '❌ Tidak ada voice channel aktif saat ini.', flags: MessageFlags.Ephemeral });
        }

        // Cek apakah user sedang di voice channel yang merupakan temp voice
        const userVoiceChannel = interaction.member?.voice?.channelId;
        if (userVoiceChannel) {
            const channelInfo = tempVoiceManager.getChannel(interaction.guild.id, userVoiceChannel);
            if (channelInfo) {
                // User sedang di temp voice → tampilkan info room-nya
                const voiceChannel = interaction.guild.channels.cache.get(userVoiceChannel);
                if (voiceChannel) {
                    const { embed } = buildInfoRoomEmbed(channelInfo, voiceChannel, interaction.guild.name);
                    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                }
            }
        }

        // User tidak di temp voice → cek apakah user adalah owner dari channel manapun
        const allOwned = await findAllOwnerVoiceChannels(interaction);
        if (allOwned.length === 1) {
            // User punya 1 channel → tampilkan info
            const found = allOwned[0];
            const { embed } = buildInfoRoomEmbed(found.channelInfo, found.channel, interaction.guild.name);
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (allOwned.length > 1) {
            // User punya multiple channels → tampilkan select menu
            const { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
            const options = allOwned.map(o => ({
                label: o.channelInfo.name.slice(0, 100),
                value: o.channelId,
                description: `Owner: ${o.channelInfo.ownerTag} (${o.channel.members.size} member)`.slice(0, 100)
            }));
            const selectRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('tv_switch_select')
                    .setPlaceholder('Pilih channel untuk lihat info...')
                    .addOptions(options.slice(0, 25))
                    .setMinValues(1)
                    .setMaxValues(1)
            );
            const embed = new EmbedBuilder()
                .setTitle('ℹ️ INFO ROOM')
                .setDescription('Kamu owner dari beberapa voice channel. Pilih channel yang ingin kamu lihat infonya:')
                .setColor(0x5865F2);
            return interaction.reply({ embeds: [embed], components: [selectRow], flags: MessageFlags.Ephemeral });
        }

        // User bukan owner dan tidak di temp voice → tampilkan daftar semua voice aktif
        const activeList = [];
        for (const [channelId, info] of Object.entries(config.channels)) {
            const vc = interaction.guild.channels.cache.get(channelId);
            if (vc) {
                const mc = vc.members.size;
                const limitPart = info.limit > 0 ? `/${info.limit}` : '';
                const lockIcon = info.locked ? ' 🔒' : '';
                activeList.push(`• **${info.name}** — <@${info.ownerId}> (${mc}${limitPart} member${lockIcon})`);
            }
        }

        if (activeList.length === 0) {
            return interaction.reply({ content: '❌ Tidak ada voice channel aktif saat ini.', flags: MessageFlags.Ephemeral });
        }

        const embed = new EmbedBuilder()
            .setTitle('ℹ️ INFO ROOM — DAFTAR VOICE AKTIF')
            .setDescription(
                `Kamu tidak sedang berada di temp voice.\n\n` +
                `**Voice Channel Aktif (${activeList.length}):**\n${activeList.slice(0, 15).join('\n')}` +
                (activeList.length > 15 ? `\n... dan ${activeList.length - 15} lainnya` : '') +
                `\n\n💡 Join ke voice channel untuk melihat info room, atau gunakan dropdown di panel global.`
            )
            .setColor(0x5865F2);

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (err) {
        console.error('TempVoice info error:', err);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: `❌ Gagal: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(()=>{});
        }
    }
}

/**
 * v3.8.5: Select menu tv_switch_select — user pilih channel untuk lihat info room.
 *
 * Logic:
 *   - User pilih channelId dari dropdown
 *   - Tampilkan info room (ephemeral) untuk channel yang dipilih
 *   - Semua user bisa lihat info, bukan owner saja
 */
async function handleTempVoiceSwitchSelect(interaction) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!interaction.guild) {
            return safeEditReply(interaction,{ content: '❌ Hanya bisa dipakai di server.' });
        }

        const tempVoiceManager = require('../utils/tempVoiceManager');
        const selectedChannelId = interaction.values[0];
        const channelInfo = tempVoiceManager.getChannel(interaction.guild.id, selectedChannelId);

        if (!channelInfo) {
            return safeEditReply(interaction,{ content: '❌ Channel tersebut sudah tidak aktif.' });
        }

        const voiceChannel = interaction.guild.channels.cache.get(selectedChannelId);
        if (!voiceChannel) {
            return safeEditReply(interaction,{ content: '❌ Channel tidak ditemukan.' });
        }

        // Tampilkan info room (ephemeral)
        const { buildInfoRoomEmbed } = require('../utils/tempVoiceControlPanel');
        const { embed } = buildInfoRoomEmbed(channelInfo, voiceChannel, interaction.guild.name);

        return safeEditReply(interaction,{ embeds: [embed] });
    } catch (err) {
        console.error('TempVoice switch select error:', err);
        if (interaction.deferred && !interaction.replied) {
            await safeEditReply(interaction,{ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
        }
    }
}

/**
 * v3.8.3: Select menu tv_channel_select — owner pilih channel mana yang dikontrol
 * kalau mereka owner multiple channels sekaligus.
 *
 * Format value: `${action}:${channelId}` (mis. "rename:123456789")
 * Setelah pilih, bot langsung eksekusi action untuk channel tsb.
 */
async function handleTempVoiceChannelSelect(interaction) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!interaction.guild) {
            return safeEditReply(interaction,{ content: '❌ Hanya bisa dipakai di server.' });
        }

        const tempVoiceManager = require('../utils/tempVoiceManager');
        const value = interaction.values[0];
        const [action, channelId] = value.split(':');

        const channelInfo = tempVoiceManager.getChannel(interaction.guild.id, channelId);
        if (!channelInfo) {
            return safeEditReply(interaction,{ content: '❌ Channel tersebut sudah tidak aktif.' });
        }

        // Validasi: user harus owner channel ini
        if (channelInfo.ownerId !== interaction.user.id) {
            return safeEditReply(interaction,{ content: '❌ Kamu bukan owner channel itu.' });
        }

        const voiceChannel = interaction.guild.channels.cache.get(channelId);
        if (!voiceChannel) {
            return safeEditReply(interaction,{ content: '❌ Channel tidak ditemukan.' });
        }

        const found = {
            guild: interaction.guild,
            channel: voiceChannel,
            channelInfo,
            channelId
        };

        // Eksekusi action yang diminta
        switch (action) {
            case 'rename': {
                const newName = `Channel ${channelInfo.name}`.slice(0, 95); // placeholder, modal tidak bisa dari sini
                // Untuk rename, kita perlu modal. Tapi karena sudah defer, tidak bisa showModal.
                // Solusi: minta user klik tombol Rename lagi sekarang (sudah auto-detect ke channel ini)
                // karena user sekarang sedang di salah satu channel mereka.
                // Atau: langsung pakai nama default.
                // Untuk UX lebih baik, kita beri petunjuk.
                return safeEditReply(interaction,{
                    content: `✅ Channel dipilih: **${channelInfo.name}**\n\n💡 Klik tombol **✏️ Rename** lagi di panel global untuk membuka modal rename. Bot akan otomatis deteksi channel ini karena kamu sedang ada di dalamnya.`
                });
            }
            case 'kick': {
                const { buildKickSelectMenu } = require('../utils/tempVoiceControlPanel');
                const selectMenu = buildKickSelectMenu(voiceChannel, channelInfo.ownerId);
                if (!selectMenu) {
                    return safeEditReply(interaction,{ content: '❌ Tidak ada member lain di channel itu.' });
                }
                // Hapus reply ephemeral sebelumnya, kirim baru dengan select menu
                await safeEditReply(interaction,{
                    content: `🚫 Pilih member untuk di-kick dari **${channelInfo.name}**:`,
                    components: [selectMenu]
                });
                return;
            }
            case 'limit': {
                return safeEditReply(interaction,{
                    content: `✅ Channel dipilih: **${channelInfo.name}**\n\n💡 Klik tombol **👥 Limit** lagi di panel global untuk membuka modal input limit.`
                });
            }
            case 'transfer': {
                const { buildTransferSelectMenu } = require('../utils/tempVoiceControlPanel');
                const selectMenu = buildTransferSelectMenu(voiceChannel, channelInfo.ownerId);
                if (!selectMenu) {
                    return safeEditReply(interaction,{ content: '❌ Tidak ada member lain di channel itu.' });
                }
                await safeEditReply(interaction,{
                    content: `🔄 Pilih member baru untuk transfer ownership **${channelInfo.name}**:`,
                    components: [selectMenu]
                });
                return;
            }
            default:
                return safeEditReply(interaction,{ content: `❌ Action tidak dikenal: ${action}` });
        }
    } catch (err) {
        console.error('TempVoice channel select error:', err);
        if (interaction.deferred && !interaction.replied) {
            await safeEditReply(interaction,{ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
        }
    }
}

// ====================================================
// === v3.9.0: HELPER — Reset Config Confirmation ===
// ====================================================
/**
 * Handle tombol "Ya, Reset Total" yang muncul setelah admin jalankan /reset-config.
 * Sebelumnya, /reset-config langsung hapus semua config tanpa konfirmasi.
 * Sekarang, admin harus klik tombol ini untuk benar-benar reset.
 */
async function handleResetConfigConfirm(interaction) {
    try {
        const { saveConfig, DEFAULTS } = require('../utils/configManager');
        const { logAudit } = require('../utils/auditLog');

        // Verify admin permission (defense-in-depth, even though slash command already gated)
        const { isAdmin } = require('../utils/permissions');
        if (!isAdmin(interaction.member)) {
            return interaction.update({
                content: '❌ Kamu tidak punya permission admin. Reset dibatalkan.',
                components: []
            });
        }

        const fresh = {
            roles: {},
            channels: {},
            messages: { ...DEFAULTS.messages },
            colors: { ...DEFAULTS.colors },
            products: []
        };
        saveConfig(fresh);

        await logAudit(interaction.client, {
            action: 'RESET_CONFIG',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: '⚠️ RESET CONFIG TOTAL — semua setting dihapus (via 2-step confirm)',
            guildId: interaction.guild.id
        });

        return interaction.update({
            content: '⚠️ **SEMUA konfigurasi berhasil direset.**\n\n' +
                'Sekarang config.json kosong. Silakan set ulang:\n' +
                '• `/set-role verified @role`\n' +
                '• `/set-role unverified @role`\n' +
                '• `/set-role admin @role`\n' +
                '• `/set-channel welcome #channel`\n' +
                '• `/set-channel goodbye #channel`\n' +
                '• `/set-channel invoice #channel`\n' +
                '• `/add-product label value price duration`',
            components: []
        });
    } catch (err) {
        console.error('Reset config confirm error:', err);
        if (interaction.deferred && !interaction.replied) {
            await safeEditReply(interaction,{ content: `❌ Gagal reset: ${err.message}` }).catch(()=>{});
        } else if (!interaction.replied) {
            await interaction.update({ content: `❌ Gagal reset: ${err.message}`, components: [] }).catch(()=>{});
        }
    }
}

// ====================================================
// === v3.9.1: HELPER: RESTORE BACKUP CONFIRM ===
// ====================================================
async function handleRestoreBackupConfirm(interaction) {
    try {
        // customId: restore_backup_confirm:<ownerUserId>:<backupName>
        const parts = interaction.customId.split(':');
        const ownerId = parts[1];
        // backupName bisa mengandung ":" kalau ada edge case, jadi join sisa parts.
        const name = parts.slice(2).join(':');

        // Defense-in-depth: hanya admin yang memulai yang bisa konfirmasi.
        if (interaction.user.id !== ownerId) {
            return interaction.reply({
                content: '❌ Hanya admin yang memulai konfirmasi ini yang bisa mengeksekusi restore.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Verify admin permission (defense-in-depth, even though slash command already gated)
        const { isAdmin } = require('../utils/permissions');
        if (!isAdmin(interaction.member)) {
            return interaction.update({
                content: '❌ Kamu tidak punya permission admin. Restore dibatalkan.',
                components: []
            });
        }

        const { restoreBackup } = require('../utils/backupManager');
        const { logAudit } = require('../utils/auditLog');

        const result = restoreBackup(name);
        if (!result.ok) {
            return interaction.update({
                content: `❌ Gagal restore: ${result.errors[0]}\n\nPakai \`/backup-list\` untuk lihat daftar backup yang valid.`,
                components: []
            });
        }

        await logAudit(interaction.client, {
            action: 'RESTORE_BACKUP',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Restore backup \`${name}\` (${result.filesRestored} files, via 2-step confirm). Pre-restore backup: \`${result.preRestoreName}\``,
            guildId: interaction.guild.id
        });

        return interaction.update({
            content: `♻️ **Restore berhasil!**\n\n` +
                `📁 Dari: \`${name}\`\n` +
                `📦 File dipulihkan: **${result.filesRestored}**\n` +
                `💾 Backup sebelum restore: \`${result.preRestoreName}\` (safety net)\n\n` +
                `⚠️ **RESTART bot sekarang** supaya data baru ke-load penuh.\n\`\`\`bash\nnpm start\n\`\`\`\n` +
                (result.errors.length > 0 ? `⚠️ Error: \`\`\`\n${result.errors.join('\n')}\n\`\`\`` : ''),
            components: []
        });
    } catch (err) {
        console.error('Restore backup confirm error:', err);
        if (interaction.deferred && !interaction.replied) {
            await safeEditReply(interaction,{ content: `❌ Gagal restore: ${err.message}` }).catch(()=>{});
        } else if (!interaction.replied) {
            await interaction.update({ content: `❌ Gagal restore: ${err.message}`, components: [] }).catch(()=>{});
        }
    }
}

