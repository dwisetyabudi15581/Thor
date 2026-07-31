const {
    EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
    MessageFlags, StringSelectMenuBuilder, PermissionFlagsBits,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { createTicket, closeTicket, sendInvoice } = require('../utils/ticketManager');
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
const { get: getPoll, vote: votePoll, getByMessage: getPollByMessage, getTotalVotes: getPollTotalVotes, remove: removePoll } = require('../utils/pollManager');
const { create: createPoll, setMessageId: setPollMessageId } = require('../utils/pollManager');
const { logAudit } = require('../utils/auditLog');

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
                if (!product) return interaction.editReply({ content: '❌ Produk tidak ditemukan.' });
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

            const topic = interaction.channel.topic || '';
            // P3-12 FIX: pakai [^|]+? supaya label yang mengandung " | " tidak ter-truncate.
            const productMatch = topic.match(/Product:\s*([^|]+?)\s*\|/);
            const productName = productMatch ? productMatch[1].trim() : 'Unknown';
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

            // Parse topic untuk validasi
            const topic = interaction.channel.topic || '';
            // P3-12 FIX: pakai [^|]+? supaya label yang mengandung " | " tidak ter-truncate.
            const productMatch = topic.match(/Product:\s*([^|]+?)\s*\|/);
            const productName = productMatch ? productMatch[1].trim() : null;
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
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(()=>{});

            const productValue = interaction.customId.split(':')[1];
            const keyValue = interaction.components[0]?.components?.[0]?.value?.trim() || '';

            // P1-8 FIX: validasi interaction.channel masih ada (belum dihapus admin lain).
            // Sebelumnya: kalau channel sudah dihapus saat admin submit modal,
            // `interaction.channel.topic` throw TypeError → error generik.
            if (!interaction.channel) {
                return interaction.editReply({ content: '❌ Channel tiket sudah tidak ada (mungkin sudah ditutup admin lain).' }).catch(()=>{});
            }

            // Parse topic
            const topic = interaction.channel.topic || '';
            // P3-12 FIX: pakai `([^|]+?)` (bukan `(.+?)`) supaya label yang mengandung
            // " | " tidak ter-truncate prematur. Trim hasil untuk hilangkan spasi.
            const userIdMatch = topic.match(/UserID: (\d+)/);
            const productMatch = topic.match(/Product:\s*([^|]+?)\s*\|/);
            const priceMatch = topic.match(/Price:\s*(.+)$/);
            const userId = userIdMatch ? userIdMatch[1] : null;
            const productName = productMatch ? productMatch[1].trim() : 'Unknown';
            const price = priceMatch ? priceMatch[1].trim() : 'Unknown';

            if (!userId) {
                return interaction.editReply({ content: '❌ Gagal parse UserID dari topic channel.' });
            }

            const product = config.products.find(p => p.value === productValue);
            if (!product) {
                return interaction.editReply({ content: `❌ Produk value \`${productValue}\` tidak ditemukan.` });
            }
            if (!product.roleId) {
                return interaction.editReply({ content: `❌ Produk **${product.label}** belum punya auto-role.` });
            }

            const guild = interaction.guild;
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                return interaction.editReply({ content: `❌ Member <@${userId}> sudah tidak ada di server.` });
            }
            const role = guild.roles.cache.get(product.roleId);
            if (!role) {
                return interaction.editReply({ content: `❌ Role ID \`${product.roleId}\` tidak ditemukan di guild.` });
            }

            // === 1. Simpan key baru (independent expireAt) ===
            const keyEntry = addKey({
                key: keyValue,
                userId: member.id,
                username: member.user.tag,
                roleId: role.id,
                productName: product.label,
                days: product.days || 0
            });

            // === 2. Berikan role ke member ===
            try {
                if (!member.roles.cache.has(role.id)) {
                    await member.roles.add(role);
                }
            } catch (err) {
                console.error('Gagal add role saat set key:', err.message);
                return interaction.editReply({ content: `❌ Gagal memberikan role ${role}. Pastikan role bot ada di ATAS role tersebut.\n\nKey tetap disimpan di keys.json.` });
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
                recordPurchase(userId, parsePrice(price));
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
            return interaction.reply({ content: '👁️ **Preview:**', embeds: [embed], flags: MessageFlags.Ephemeral });
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
            // Buka modal untuk input channel target
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
        // === v3.8: TEMP VOICE — Button / Modal / Select handlers ===
        // ====================================================
        if (interaction.isButton() && interaction.customId === 'tv_create') {
            return handleTempVoiceCreate(interaction);
        }
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
        if (interaction.isModalSubmit() && interaction.customId === 'tv_modal_rename') {
            return handleTempVoiceRenameSubmit(interaction);
        }
        if (interaction.isModalSubmit() && interaction.customId === 'tv_modal_limit') {
            return handleTempVoiceLimitSubmit(interaction);
        }

    } catch (err) {
        console.error('Interaction Handler Error:', err);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Terjadi error.', flags: MessageFlags.Ephemeral }).catch(()=>{});
        } else if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: '❌ Terjadi error.' }).catch(()=>{});
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

    const toAdd = panelRoleIds.filter(rid => selectedIds.has(rid) && !member.roles.cache.has(rid));
    const toRemove = panelRoleIds.filter(rid => !selectedIds.has(rid) && member.roles.cache.has(rid));

    // Untuk mode exclusive: hanya 1 role yang boleh, sisanya harus dihapus
    if (panel.exclusive) {
        // Hapus semua role panel lain yang sudah dimiliki tapi tidak dipilih
        // Tambahkan role yang dipilih
    }

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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const d = session.data;
    // Discord.js v14: ModalSubmitInteraction.components adalah array of ActionRowModalData.
    // Setiap ActionRowModalData punya .components (bukan .fields!) — array TextInputModalData.
    // Tiap TextInputModalData punya .value (string).
    // Pakai ?. di seluruh chain supaya gak throw kalau index gak ada.
    const getFieldValue = (idx) => interaction.components[idx]?.components?.[0]?.value?.trim() || '';

    // === TITLE ===
    if (modalType === 'emb_modal_title') {
        d.title = getFieldValue(0) || null;
    }

    // === DESCRIPTION ===
    else if (modalType === 'emb_modal_desc') {
        d.description = getFieldValue(0) || null;
    }

    // === COLOR ===
    else if (modalType === 'emb_modal_color') {
        const val = getFieldValue(0);
        if (!val) {
            d.color = 0x5865F2; // reset ke default
        } else {
            const parsed = parseColor(val);
            if (parsed === null) {
                return interaction.editReply({ content: `❌ Color tidak valid: \`${val}\`. Pakai format hex 6 digit, mis. \`#FF0000\`.` });
            }
            d.color = parsed;
        }
    }

    // === IMAGE ===
    else if (modalType === 'emb_modal_image') {
        const val = getFieldValue(0);
        if (val && !/^https?:\/\//i.test(val)) {
            return interaction.editReply({ content: '❌ Image URL harus mulai dengan `http://` atau `https://`' });
        }
        d.image = val ? { url: val } : null;
    }

    // === THUMBNAIL ===
    else if (modalType === 'emb_modal_thumbnail') {
        const val = getFieldValue(0);
        if (val && !/^https?:\/\//i.test(val)) {
            return interaction.editReply({ content: '❌ Thumbnail URL harus mulai dengan `http://` atau `https://`' });
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

    // === ADD FIELD ===
    else if (modalType === 'emb_modal_field') {
        const inline = parts[2] === '1';
        const name = getFieldValue(0);
        const value = getFieldValue(1);
        if (!name || !value) {
            return interaction.editReply({ content: '❌ Field name dan value wajib diisi.' });
        }
        if (d.fields.length >= 25) {
            return interaction.editReply({ content: '❌ Maksimal 25 field (batas Discord).' });
        }
        d.fields.push({ name, value, inline });
    }

    // === SEND TO CHANNEL ===
    else if (modalType === 'emb_modal_send') {
        const channelInput = getFieldValue(0);
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
            return interaction.editReply({ content: `❌ Channel tidak ditemukan: \`${channelInput}\`. Pakai #mention atau channel ID.` });
        }

        const embed = buildSessionEmbed(session);
        try {
            await targetChannel.send({ embeds: [embed] });
        } catch (err) {
            return interaction.editReply({ content: `❌ Gagal kirim ke ${targetChannel}: ${err.message}` });
        }

        // P1-10 FIX: audit log untuk EMBED_BUILDER_SEND (sebelumnya missing).
        try {
            await logAudit(interaction.client, {
                action: 'EMBED_BUILDER_SEND',
                actorId: interaction.user.id,
                actorTag: interaction.user.tag,
                details: `Kirim embed (builder) ke ${targetChannel}: ${session.data.title ? `**${session.data.title}**` : '_(no title)_'}`,
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
        return interaction.editReply({ content: `✅ Embed terkirim ke ${targetChannel}! Draft dihapus.` });
    }

    // Refresh draft dengan embed terbaru
    await refreshEmbedDraft(interaction, session);
    return interaction.editReply({ content: '✅ Embed diupdate.' });
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

        // JOIN
        if (action === 'gw_join') {
            if (gw.participantIds.includes(interaction.user.id)) {
                return interaction.reply({ content: 'ℹ️ Kamu sudah join giveaway ini.', flags: MessageFlags.Ephemeral });
            }
            const updated = gwAddParticipant(gwId, interaction.user.id);
            await updateGiveawayMessage(interaction, updated);
            return interaction.reply({ content: `✅ Kamu join giveaway **${gw.prize}**! 🎉\n👥 Total peserta: ${updated.participantIds.length}`, flags: MessageFlags.Ephemeral });
        }

        // LEAVE
        if (action === 'gw_leave') {
            if (!gw.participantIds.includes(interaction.user.id)) {
                return interaction.reply({ content: 'ℹ️ Kamu belum join giveaway ini.', flags: MessageFlags.Ephemeral });
            }
            const updated = gwRemoveParticipant(gwId, interaction.user.id);
            await updateGiveawayMessage(interaction, updated);
            return interaction.reply({ content: `🚪 Kamu keluar dari giveaway **${gw.prize}**.`, flags: MessageFlags.Ephemeral });
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
        const poll = getPoll(pollId);
        if (!poll) {
            return interaction.reply({ content: '❌ Poll tidak ditemukan.', flags: MessageFlags.Ephemeral });
        }
        if (poll.closed) {
            return interaction.reply({ content: '❌ Poll sudah ditutup.', flags: MessageFlags.Ephemeral });
        }
        const result = votePoll(pollId, interaction.user.id, optionIndex);
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
        // customId: poll_modal_create:<channelId>:<multiple>:<encoded question>
        const parts = interaction.customId.split(':');
        const channelId = parts[1];
        const multiple = parts[2] === '1';
        const question = decodeURIComponent(parts.slice(3).join(':'));

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
            return interaction.reply({ content: `❌ Gagal kirim poll ke ${channel}. Cek permission bot. Entry di-rollback.`, flags: MessageFlags.Ephemeral });
        }
        setPollMessageId(poll.id, msg.id);
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
 * Helper: cari voice channel yang di-owner oleh interaction.user.
 * Bisa dari interaction guild (klik button di server) atau DM (klik button di DM).
 *
 * v3.8.1: cek juga apakah owner saat ini sedang berada di voice channelnya.
 * Kalau owner sudah tidak di voice (channel mungkin kosong atau dia sudah leave),
 * button di panel global tidak akan bisa dieksekusi — tampilkan pesan jelas.
 */
async function findOwnerVoiceChannel(interaction) {
    const tempVoiceManager = require('../utils/tempVoiceManager');
    const userId = interaction.user.id;

    // Cari di semua guild yang bot join
    for (const guild of interaction.client.guilds.cache.values()) {
        const cfg = tempVoiceManager.getGuildConfig(guild.id);
        if (!cfg?.channels) continue;
        for (const [channelId, info] of Object.entries(cfg.channels)) {
            if (info.ownerId === userId) {
                const channel = guild.channels.cache.get(channelId);
                if (channel) {
                    return { guild, channel, channelInfo: info, channelId };
                }
            }
        }
    }
    return null;
}

/**
 * v3.8.1: Helper untuk guard button control panel.
 * Cek apakah user yang klik adalah owner dari voice channel yang sedang aktif
 * (yang ditampilkan di panel global).
 *
 * Returns: { ok: true, found } kalau owner valid, { ok: false, reason } kalau tidak.
 */
async function requireTempVoiceOwner(interaction) {
    const found = await findOwnerVoiceChannel(interaction);
    if (!found) {
        return {
            ok: false,
            reason: '❌ Kamu tidak punya voice channel aktif. Klik **🎤 Buat Voice** dulu untuk bikin channel sendiri.'
        };
    }
    // Cek apakah owner saat ini sedang di voice channelnya
    if (!found.channel.members.has(found.channelInfo.ownerId)) {
        return {
            ok: false,
            reason: `❌ Kamu harus berada di voice channel kamu (${found.channel}) untuk pakai kontrol ini.`
        };
    }
    return { ok: true, found };
}

/**
 * Button: tv_create — dipakai saat member klik tombol "Buat Voice" di panel setup.
 * Alternatif dari join trigger channel.
 */
async function handleTempVoiceCreate(interaction) {
    try {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ Command ini hanya bisa dipakai di server.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const tempVoiceManager = require('../utils/tempVoiceManager');
        const { ChannelType, PermissionFlagsBits: PFB } = require('discord.js');

        const config = tempVoiceManager.getGuildConfig(interaction.guild.id);
        if (!config?.creatorChannelId || !config?.categoryId) {
            return interaction.editReply({ content: '❌ Temp voice belum di-setup. Minta admin jalankan `/setup-tempvoice`.' });
        }

        const member = interaction.member;
        // Cek apakah member sudah punya channel
        const existingChannelId = tempVoiceManager.findChannelByOwner(interaction.guild.id, member.id);
        if (existingChannelId) {
            const existing = interaction.guild.channels.cache.get(existingChannelId);
            if (existing) {
                // Pindahkan member kalau sedang di voice
                if (member.voice.channelId) {
                    try { await member.voice.setChannel(existingChannelId); } catch (_) {}
                }
                return interaction.editReply({ content: `🎤 Kamu sudah punya voice channel: ${existing.name}` });
            }
        }

        // Bikin channel baru
        const channelName = `🔊 ${member.user.username}'s Room`;
        const newChannel = await interaction.guild.channels.create({
            name: channelName.slice(0, 100),
            type: ChannelType.GuildVoice,
            parent: config.categoryId,
            bitrate: 64000,
            permissionOverwrites: [
                { id: interaction.guild.roles.everyone.id, allow: [PFB.ViewChannel, PFB.Connect] },
                { id: member.id, allow: [
                    PFB.ViewChannel, PFB.Connect, PFB.ManageChannels,
                    PFB.MoveMembers, PFB.MuteMembers, PFB.DeafenMembers
                ]}
            ]
        });

        tempVoiceManager.registerChannel(interaction.guild.id, newChannel.id, member.id, member.user.tag, newChannel.name);

        // v3.8.1: TIDAK kirim DM owner — control panel sudah global di control channel.
        // Refresh panel global supaya menampilkan kontrol untuk owner baru.
        if (typeof interaction.client.refreshGlobalControlPanel === 'function') {
            await interaction.client.refreshGlobalControlPanel(interaction.client, interaction.guild.id);
        }

        // Pindahkan member ke channel baru kalau sedang di voice
        if (member.voice.channelId) {
            try { await member.voice.setChannel(newChannel.id); } catch (_) {}
        }

        return interaction.editReply({
            content: `✅ Voice channel dibuat: ${newChannel}\n\n🎛️ **Control panel ada di control channel** — lihat panel global temp voice untuk kontrol (rename, kick, limit, lock, dll).`
        });
    } catch (err) {
        console.error('TempVoice create error:', err);
        if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
        } else if (!interaction.replied) {
            await interaction.reply({ content: `❌ Gagal: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(()=>{});
        }
    }
}

/**
 * Button: tv_rename — buka modal input nama baru.
 */
async function handleTempVoiceRename(interaction) {
    try {
        // v3.8.1: cek owner valid sebelum buka modal
        const check = await requireTempVoiceOwner(interaction);
        if (!check.ok) {
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
            return interaction.editReply({ content: '❌ Nama tidak boleh kosong.' });
        }

        const check = await requireTempVoiceOwner(interaction);
        if (!check.ok) {
            return interaction.editReply({ content: check.reason });
        }
        const found = check.found;
        const { guild, channel, channelId } = found;
        try {
            await channel.setName(newName.slice(0, 100));
        } catch (err) {
            return interaction.editReply({ content: `❌ Gagal rename: ${err.message}` });
        }

        const tempVoiceManager = require('../utils/tempVoiceManager');
        tempVoiceManager.updateChannel(guild.id, channelId, { name: newName.slice(0, 100) });

        // v3.8.1: refresh panel global supaya nama baru ter-update
        if (typeof interaction.client.refreshGlobalControlPanel === 'function') {
            await interaction.client.refreshGlobalControlPanel(interaction.client, guild.id);
        }

        return interaction.editReply({ content: `✅ Channel di-rename jadi: **${newName}**` });
    } catch (err) {
        console.error('TempVoice rename submit error:', err);
        if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
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
            return interaction.editReply({ content: check.reason });
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

        return interaction.editReply({ content: msg });
    } catch (err) {
        console.error('TempVoice kick execute error:', err);
        if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
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
            return interaction.editReply({ content: check.reason });
        }
        const found = check.found;

        try {
            await found.channel.setUserLimit(limit);
        } catch (err) {
            return interaction.editReply({ content: `❌ Gagal atur limit: ${err.message}` });
        }

        const tempVoiceManager = require('../utils/tempVoiceManager');
        tempVoiceManager.updateChannel(found.guild.id, found.channelId, { limit });

        // v3.8.1: refresh panel global supaya limit ter-update
        if (typeof interaction.client.refreshGlobalControlPanel === 'function') {
            await interaction.client.refreshGlobalControlPanel(interaction.client, found.guild.id);
        }

        const limitStr2 = limit === 0 ? 'unlimited' : `${limit} member`;
        return interaction.editReply({ content: `✅ Limit diatur ke: **${limitStr2}**` });
    } catch (err) {
        console.error('TempVoice limit submit error:', err);
        if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
        }
    }
}

/**
 * Button: tv_lock / tv_unlock — toggle lock channel.
 */
async function handleTempVoiceLockToggle(interaction) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const check = await requireTempVoiceOwner(interaction);
        if (!check.ok) {
            return interaction.editReply({ content: check.reason });
        }
        const found = check.found;
        const tempVoiceManager = require('../utils/tempVoiceManager');
        const { PermissionFlagsBits: PFB } = require('discord.js');
        const willLock = interaction.customId === 'tv_lock';

        try {
            // Lock = deny Connect untuk @everyone, Unlock = allow Connect
            await found.channel.permissionOverwrites.edit(found.guild.roles.everyone.id, {
                [PFB.Connect]: willLock ? false : true
            });
        } catch (err) {
            return interaction.editReply({ content: `❌ Gagal ${willLock ? 'lock' : 'unlock'}: ${err.message}` });
        }

        tempVoiceManager.updateChannel(found.guild.id, found.channelId, { locked: willLock });

        // v3.8.1: refresh panel global supaya status lock ter-update
        if (typeof interaction.client.refreshGlobalControlPanel === 'function') {
            await interaction.client.refreshGlobalControlPanel(interaction.client, found.guild.id);
        }

        return interaction.editReply({
            content: willLock
                ? '🔒 Channel **terkunci**. Hanya owner yang bisa invite member (dengan mention/drag).'
                : '🔓 Channel **terbuka**. Member bisa join bebas.'
        });
    } catch (err) {
        console.error('TempVoice lock toggle error:', err);
        if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
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
            return interaction.editReply({ content: check.reason });
        }
        const found = check.found;

        const newOwnerId = interaction.values[0];
        const newOwner = found.channel.members.get(newOwnerId);
        if (!newOwner) {
            return interaction.editReply({ content: '❌ Member tersebut sudah tidak ada di voice kamu.' });
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
            return interaction.editReply({ content: `❌ Gagal update permission: ${err.message}` });
        }

        tempVoiceManager.transferOwnership(found.guild.id, found.channelId, newOwnerId, newOwner.user.tag);

        // v3.8.1: refresh panel global supaya owner baru ter-display
        if (typeof interaction.client.refreshGlobalControlPanel === 'function') {
            await interaction.client.refreshGlobalControlPanel(interaction.client, found.guild.id);
        }

        return interaction.editReply({
            content: `✅ Ownership dipindahkan ke <@${newOwnerId}>. Kamu tidak lagi owner channel ini.`
        });
    } catch (err) {
        console.error('TempVoice transfer execute error:', err);
        if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
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
            return interaction.editReply({ content: check.reason });
        }
        const found = check.found;
        const tempVoiceManager = require('../utils/tempVoiceManager');

        try {
            await found.channel.delete('Dihapus oleh owner via control panel');
        } catch (err) {
            if (err.code !== 10003) {
                return interaction.editReply({ content: `❌ Gagal hapus channel: ${err.message}` });
            }
        }
        tempVoiceManager.unregisterChannel(found.guild.id, found.channelId);

        // v3.8.1: refresh panel global supaya kembali ke tampilan idle
        if (typeof interaction.client.refreshGlobalControlPanel === 'function') {
            await interaction.client.refreshGlobalControlPanel(interaction.client, found.guild.id);
        }

        return interaction.editReply({ content: '🗑️ Voice channel kamu berhasil dihapus.' });
    } catch (err) {
        console.error('TempVoice delete error:', err);
        if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(()=>{});
        }
    }
}

