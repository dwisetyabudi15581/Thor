const {
    EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
    MessageFlags, StringSelectMenuBuilder, PermissionFlagsBits,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelSelectMenuBuilder, ChannelType, UserSelectMenuBuilder
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
const { get: getGiveaway, addParticipant: gwAddParticipant, removeParticipant: gwRemoveParticipant, end: endGiveaway, pickWinners, formatTimeLeft } = require('../utils/giveawayManager');
const { get: getPoll, vote: votePoll, getByMessage: getPollByMessage, getTotalVotes: getPollTotalVotes } = require('../utils/pollManager');
const { create: createPoll, setMessageId: setPollMessageId } = require('../utils/pollManager');
const {
    buildTempVoicePanel,
    buildResetConfirmPanel,
    buildHubChannelSelectRow,
    buildCategorySelectRow,
    buildDeployChannelSelectRow
} = require('../utils/tempVoicePanel');
const { buildControlPanel: buildTempVoiceControlPanel, buildUserSelectRow: buildTempVoiceUserSelectRow } = require('../utils/tempVoiceControlPanel');
const {
    getByGuild: getTempVoiceByGuild,
    getByChannel: getTempVoiceByChannel,
    updateSession: updateTempVoiceSession,
    transferOwnership: transferTempVoiceOwnership
} = require('../utils/tempVoice');
const { logAudit } = require('../utils/auditLog');

module.exports = async (interaction) => {
    if (interaction.replied || interaction.deferred) {
        // Untuk modal submit, replied=false default; skip cuma untuk non-modal
        if (!interaction.isModalSubmit()) return;
    }
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit() && !interaction.isChannelSelectMenu() && !interaction.isUserSelectMenu()) return;

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
            const productMatch = topic.match(/Product: (.+?) \|/);
            const productName = productMatch ? productMatch[1] : 'Unknown';
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
            const productMatch = topic.match(/Product: (.+?) \|/);
            const productName = productMatch ? productMatch[1] : null;
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

            // Parse topic
            const topic = interaction.channel.topic || '';
            const userIdMatch = topic.match(/UserID: (\d+)/);
            const productMatch = topic.match(/Product: (.+?) \|/);
            const priceMatch = topic.match(/Price: (.+)/);
            const userId = userIdMatch ? userIdMatch[1] : null;
            const productName = productMatch ? productMatch[1] : 'Unknown';
            const price = priceMatch ? priceMatch[1] : 'Unknown';

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
        // === TEMP VOICE PANEL — buttons, channel selects, modals ===
        // ====================================================
        // All custom IDs start with `tvp_` (Temp Voice Panel).
        // Permission: Admin only (ManageGuild or admin role).
        if (
            (interaction.isButton() && interaction.customId.startsWith('tvp_')) ||
            (interaction.isChannelSelectMenu() && interaction.customId.startsWith('tvp_')) ||
            (interaction.isModalSubmit() && interaction.customId.startsWith('tvp_'))
        ) {
            return handleTempVoicePanel(interaction);
        }

        // ====================================================
        // === TEMP VOICE MEMBER CONTROL PANEL (tvm_*) ===
        // ====================================================
        // Member-facing panel — kelola room voice via tombol (ganti /tempvoice).
        // Custom IDs: tvm_rename, tvm_limit, tvm_lock, tvm_unlock,
        //             tvm_transfer, tvm_kick, tvm_claim, tvm_info,
        //             tvm_sel_transfer, tvm_sel_kick,
        //             tvm_modal_rename, tvm_modal_limit
        if (
            (interaction.isButton() && interaction.customId.startsWith('tvm_')) ||
            (interaction.isUserSelectMenu() && interaction.customId.startsWith('tvm_')) ||
            (interaction.isModalSubmit() && interaction.customId.startsWith('tvm_'))
        ) {
            return handleTempVoiceMemberPanel(interaction);
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
            return interaction.reply({ content: `❌ Gagal kirim poll ke ${channel}. Cek permission bot.`, flags: MessageFlags.Ephemeral });
        }
        setPollMessageId(poll.id, msg.id);
        return interaction.reply({ content: `✅ Poll dibuat di ${channel}!\n🆔 \`${poll.id}\`\n💡 Tutup pakai \`/poll close id:${poll.id}\``, flags: MessageFlags.Ephemeral });
    } catch (err) {
        console.error('Poll modal create error:', err);
        if (interaction.isRepliable() && !interaction.replied) {
            await interaction.reply({ content: '❌ Terjadi error: ' + err.message, flags: MessageFlags.Ephemeral }).catch(()=>{});
        }
    }
}

// ====================================================
// === HELPER: TEMP VOICE PANEL ===
// ====================================================
// Handles all interactions with customId starting with `tvp_`:
//   Buttons: tvp_btn_hub, tvp_btn_category, tvp_btn_name, tvp_btn_limit,
//            tvp_btn_toggle, tvp_btn_test, tvp_btn_reset,
//            tvp_btn_reset_yes, tvp_btn_reset_no, tvp_btn_close
//   ChannelSelects: tvp_sel_hub, tvp_sel_category
//   Modals: tvp_modal_name, tvp_modal_limit
//
// Permission: Admin only (ManageGuild or admin role).
// Pattern: update config -> re-render panel message -> ephemeral feedback
async function handleTempVoicePanel(interaction) {
    const customId = interaction.customId;

    // === Permission check ===
    if (!checkIsAdmin(interaction.member)) {
        return interaction.reply({
            content: '🚫 Hanya admin yang bisa mengatur Temp Voice.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    const config = getConfig();
    const tv = config.tempVoice || {};

    // ---------- BUTTON: Set Hub ----------
    if (customId === 'tvp_btn_hub') {
        await interaction.deferUpdate().catch(() => {});
        const row = buildHubChannelSelectRow(interaction.message.id);
        return interaction.followUp({
            content: '🎙️ **Pilih Hub Channel** — voice channel yang jadi "trigger" (member join → auto-bikin room):',
            components: [row],
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    // ---------- BUTTON: Set Category ----------
    if (customId === 'tvp_btn_category') {
        await interaction.deferUpdate().catch(() => {});
        const row = buildCategorySelectRow(interaction.message.id);
        return interaction.followUp({
            content: '📁 **Pilih Category** — tempat room baru akan dibuat (opsional, default = same as hub):',
            components: [row],
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    // ---------- BUTTON: Set Name ----------
    if (customId === 'tvp_btn_name') {
        const modal = new ModalBuilder()
            .setCustomId('tvp_modal_name')
            .setTitle('Set Default Name')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('tvp_name_input')
                        .setLabel('Default Name (placeholder: {username} {tag})')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder("{username}'s Room")
                        .setValue(tv.defaultName || "{username}'s Room")
                        .setRequired(true)
                        .setMaxLength(100)
                )
            );
        return interaction.showModal(modal).catch(() => {});
    }

    // ---------- BUTTON: Set Limit ----------
    if (customId === 'tvp_btn_limit') {
        const currentLimit = (typeof tv.defaultLimit === 'number' && tv.defaultLimit > 0) ? String(tv.defaultLimit) : '0';
        const modal = new ModalBuilder()
            .setCustomId('tvp_modal_limit')
            .setTitle('Set Default Limit')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('tvp_limit_input')
                        .setLabel('User Limit (0 = tanpa limit, maks 99)')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('0')
                        .setValue(currentLimit)
                        .setRequired(true)
                        .setMaxLength(2)
                )
            );
        return interaction.showModal(modal).catch(() => {});
    }

    // ---------- BUTTON: Toggle Enable/Disable ----------
    if (customId === 'tvp_btn_toggle') {
        await interaction.deferUpdate().catch(() => {});
        // Re-fetch latest config to avoid clobbering concurrent admin changes
        const freshTv = getConfig().tempVoice || {};
        const currentEnabled = freshTv.enabled !== false;
        const newEnabled = !currentEnabled;
        setField('tempVoice', { ...freshTv, enabled: newEnabled });

        const tvSessions = getTempVoiceByGuild(interaction.guild.id);
        const { embed, components } = buildTempVoicePanel(getConfig(), { activeRooms: tvSessions.length }, interaction.client);
        await interaction.editReply({ embeds: [embed], components }).catch(() => {});

        await logAudit(interaction.client, {
            action: 'SETUP_TEMPVOICE',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Temp Voice ${newEnabled ? '**diaktifkan**' : '**dinonaktifkan**'} via panel.`,
            guildId: interaction.guild.id
        });
        return interaction.followUp({
            content: newEnabled
                ? '✅ Temp Voice **diaktifkan**. Member sekarang bisa join hub untuk bikin room.'
                : '🔴 Temp Voice **dinonaktifkan**. Member yang join hub tidak akan dapat room baru (room yang sudah ada tetap aktif sampai kosong).',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    // ---------- BUTTON: Test Create ----------
    if (customId === 'tvp_btn_test') {
        await interaction.deferUpdate().catch(() => {});

        // Admin harus ada di voice channel
        const memberVoice = interaction.member.voice?.channel;
        if (!memberVoice) {
            return interaction.followUp({
                content: '❌ Kamu harus berada di **salah satu voice channel** untuk test (bot akan pindahkan kamu ke room baru).',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }

        // Jangan test kalau admin lagi di hub channel (itu udah auto-trigger)
        if (memberVoice.id === tv.hubChannelId) {
            return interaction.followUp({
                content: 'ℹ️ Kamu sedang di hub channel — bot otomatis akan bikin room untukmu. Tinggal leave & join lagi aja.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }

        const { createRoom } = require('../utils/tempVoice');
        const result = await createRoom(interaction.client, interaction.guild, interaction.member, tv);
        if (result.ok) {
            await logAudit(interaction.client, {
                action: 'SETUP_TEMPVOICE',
                actorId: interaction.user.id,
                actorTag: interaction.user.tag,
                details: `Test create temp voice room via panel. Channel ID: \`${result.channelId}\``,
                guildId: interaction.guild.id
            });
            return interaction.followUp({
                content: `🧪 **Test berhasil!** Room baru dibuat: <#${result.channelId}>\nKamu sekarang owner — coba \`/tempvoice rename\`, \`/tempvoice limit\`, dll.`,
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
        return interaction.followUp({
            content: `❌ Test gagal: ${result.error || 'unknown error'}\n\nPastikan bot punya permission **Create Channels** & **Move Members**.`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    // ---------- BUTTON: Reset (tampilkan konfirmasi) ----------
    if (customId === 'tvp_btn_reset') {
        await interaction.deferUpdate().catch(() => {});
        const { embed, components } = buildResetConfirmPanel(interaction.client);
        return interaction.editReply({ embeds: [embed], components }).catch(() => {});
    }

    // ---------- BUTTON: Deploy Member Panel ----------
    if (customId === 'tvp_btn_deploy') {
        await interaction.deferUpdate().catch(() => {});
        const row = buildDeployChannelSelectRow(interaction.message.id);
        return interaction.followUp({
            content: '📱 **Pilih Text Channel** — tempat member control panel akan dideploy:\n\n💡 Kalau sudah ada panel lama di channel lain, panel lama akan dihapus otomatis saat re-deploy.',
            components: [row],
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    // ---------- BUTTON: Reset Confirm YES ----------
    if (customId === 'tvp_btn_reset_yes') {
        await interaction.deferUpdate().catch(() => {});
        setField('tempVoice', {
            hubChannelId: null,
            categoryId: null,
            defaultName: "{username}'s Room",
            defaultLimit: 0,
            enabled: false
        });
        const { embed, components } = buildTempVoicePanel(getConfig(), {}, interaction.client);
        await interaction.editReply({ embeds: [embed], components }).catch(() => {});
        await logAudit(interaction.client, {
            action: 'SETUP_TEMPVOICE',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: '❌ **RESET** config Temp Voice via panel. Hub/Category/Name/Limit dikosongkan, status=Disabled.',
            guildId: interaction.guild.id
        });
        return interaction.followUp({
            content: '🗑️ Config Temp Voice sudah di-reset. Pakai 🎙️ **Set Hub** untuk setup ulang.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    // ---------- BUTTON: Reset Confirm NO ----------
    if (customId === 'tvp_btn_reset_no') {
        await interaction.deferUpdate().catch(() => {});
        const tvSessions = getTempVoiceByGuild(interaction.guild.id);
        const { embed, components } = buildTempVoicePanel(getConfig(), { activeRooms: tvSessions.length }, interaction.client);
        return interaction.editReply({ embeds: [embed], components }).catch(() => {});
    }

    // ---------- BUTTON: Close Panel ----------
    if (customId === 'tvp_btn_close') {
        try {
            await interaction.message.delete();
        } catch (_) {
            await interaction.deferUpdate().catch(() => {});
        }
        return interaction.reply({
            content: '❌ Panel ditutup.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    // ---------- CHANNEL SELECT: Hub ----------
    // customId format: `tvp_sel_hub:<panelMessageId>`
    if (customId.startsWith('tvp_sel_hub')) {
        const parts = customId.split(':');
        const panelMessageId = parts[1] || null;
        const selectedChannelId = interaction.values?.[0];
        if (!selectedChannelId) {
            return interaction.reply({ content: '❌ Tidak ada channel dipilih.', flags: MessageFlags.Ephemeral });
        }
        const channel = interaction.guild.channels.cache.get(selectedChannelId);
        if (!channel || channel.type !== ChannelType.GuildVoice) {
            return interaction.reply({ content: '❌ Channel yang dipilih bukan voice channel.', flags: MessageFlags.Ephemeral });
        }

        // First-time setup: set enabled=true automatically
        // Re-fetch latest config to avoid clobbering concurrent admin changes
        const freshTvHub = getConfig().tempVoice || {};
        const wasFirstSetup = !freshTvHub.hubChannelId;
        const newTv = {
            ...freshTvHub,
            hubChannelId: selectedChannelId,
            enabled: wasFirstSetup ? true : (freshTvHub.enabled !== false)
        };
        setField('tempVoice', newTv);

        // Update ephemeral select-menu message → "done"
        await interaction.update({
            content: `✅ Hub Channel di-set ke <#${selectedChannelId}>.`,
            components: []
        }).catch(() => {});

        // Update original panel message
        if (panelMessageId) {
            try {
                const panelMsg = await interaction.channel.messages.fetch(panelMessageId);
                if (panelMsg) {
                    const tvSessions = getTempVoiceByGuild(interaction.guild.id);
                    const { embed, components } = buildTempVoicePanel(getConfig(), { activeRooms: tvSessions.length }, interaction.client);
                    await panelMsg.edit({ embeds: [embed], components });
                }
            } catch (_) {}
        }

        await logAudit(interaction.client, {
            action: 'SETUP_TEMPVOICE',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Set Hub Channel via panel: <#${selectedChannelId}> (\`${selectedChannelId}\`)${wasFirstSetup ? ' — system otomatis diaktifkan' : ''}`,
            guildId: interaction.guild.id
        });
        return;
    }

    // ---------- CHANNEL SELECT: Category ----------
    // customId format: `tvp_sel_category:<panelMessageId>`
    if (customId.startsWith('tvp_sel_category')) {
        const parts = customId.split(':');
        const panelMessageId = parts[1] || null;
        const selectedCategoryId = interaction.values?.[0];
        if (!selectedCategoryId) {
            return interaction.reply({ content: '❌ Tidak ada category dipilih.', flags: MessageFlags.Ephemeral });
        }
        const channel = interaction.guild.channels.cache.get(selectedCategoryId);
        if (!channel || channel.type !== ChannelType.GuildCategory) {
            return interaction.reply({ content: '❌ Channel yang dipilih bukan category.', flags: MessageFlags.Ephemeral });
        }

        // Re-fetch latest config to avoid clobbering concurrent admin changes
        const freshTvCat = getConfig().tempVoice || {};
        setField('tempVoice', { ...freshTvCat, categoryId: selectedCategoryId });

        // Update ephemeral select-menu message → "done"
        await interaction.update({
            content: `✅ Category di-set ke <#${selectedCategoryId}>.`,
            components: []
        }).catch(() => {});

        // Update original panel message
        if (panelMessageId) {
            try {
                const panelMsg = await interaction.channel.messages.fetch(panelMessageId);
                if (panelMsg) {
                    const tvSessions = getTempVoiceByGuild(interaction.guild.id);
                    const { embed, components } = buildTempVoicePanel(getConfig(), { activeRooms: tvSessions.length }, interaction.client);
                    await panelMsg.edit({ embeds: [embed], components });
                }
            } catch (_) {}
        }

        await logAudit(interaction.client, {
            action: 'SETUP_TEMPVOICE',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Set Category via panel: <#${selectedCategoryId}> (\`${selectedCategoryId}\`)`,
            guildId: interaction.guild.id
        });
        return;
    }

    // ---------- CHANNEL SELECT: Deploy Member Panel ----------
    // customId format: `tvp_sel_deploy:<panelMessageId>`
    if (customId.startsWith('tvp_sel_deploy')) {
        const parts = customId.split(':');
        const panelMessageId = parts[1] || null;
        const targetChannelId = interaction.values?.[0];
        if (!targetChannelId) {
            return interaction.reply({ content: '❌ Tidak ada channel dipilih.', flags: MessageFlags.Ephemeral });
        }
        const targetChannel = interaction.guild.channels.cache.get(targetChannelId);
        if (!targetChannel || !targetChannel.isTextBased()) {
            return interaction.reply({ content: '❌ Channel yang dipilih bukan text channel.', flags: MessageFlags.Ephemeral });
        }

        const freshTvDeploy = getConfig().tempVoice || {};
        if (!freshTvDeploy.hubChannelId) {
            return interaction.update({
                content: '❌ Hub channel belum di-set. Set hub dulu sebelum deploy panel.',
                components: []
            }).catch(() => {});
        }

        // Hapus panel lama kalau ada
        if (freshTvDeploy.panelChannelId && freshTvDeploy.panelMessageId) {
            try {
                const oldChan = interaction.guild.channels.cache.get(freshTvDeploy.panelChannelId);
                if (oldChan) {
                    const oldMsg = await oldChan.messages.fetch(freshTvDeploy.panelMessageId).catch(() => null);
                    if (oldMsg) await oldMsg.delete().catch(() => {});
                }
            } catch (_) {}
        }

        // Build & kirim member control panel ke text channel
        const { embed: controlEmbed, components: controlComponents } = buildTempVoiceControlPanel(freshTvDeploy, interaction.client);
        let sentMsg;
        try {
            sentMsg = await targetChannel.send({ embeds: [controlEmbed], components: controlComponents });
        } catch (err) {
            return interaction.update({
                content: `❌ Gagal kirim panel ke ${targetChannel}: ${err.message}\n\nCek permission bot (Send Messages, Embed Links).`,
                components: []
            }).catch(() => {});
        }

        // Simpan panel location
        setField('tempVoice', {
            ...freshTvDeploy,
            panelChannelId: targetChannelId,
            panelMessageId: sentMsg.id
        });

        // Update ephemeral deploy message → "done"
        await interaction.update({
            content: `✅ Member control panel dideploy ke ${targetChannel}.\n🆔 Message ID: \`${sentMsg.id}\`\n\n💡 Member sekarang bisa pakai tombol di panel itu untuk kelola room mereka.`,
            components: []
        }).catch(() => {});

        // Update original admin panel message
        if (panelMessageId) {
            try {
                const panelMsg = await interaction.channel.messages.fetch(panelMessageId);
                if (panelMsg) {
                    const tvSessions = getTempVoiceByGuild(interaction.guild.id);
                    const { embed, components } = buildTempVoicePanel(getConfig(), { activeRooms: tvSessions.length }, interaction.client);
                    await panelMsg.edit({ embeds: [embed], components });
                }
            } catch (_) {}
        }

        await logAudit(interaction.client, {
            action: 'SETUP_TEMPVOICE',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Deploy member control panel to <#${targetChannelId}> (msg \`${sentMsg.id}\`)`,
            guildId: interaction.guild.id
        });
        return;
    }

    // ---------- MODAL: Set Default Name ----------
    if (customId === 'tvp_modal_name') {
        const newName = interaction.components[0]?.components?.[0]?.value?.trim() || "{username}'s Room";
        const safeName = newName.slice(0, 100);
        // Re-fetch latest config to avoid clobbering concurrent admin changes
        const freshTvName = getConfig().tempVoice || {};
        setField('tempVoice', { ...freshTvName, defaultName: safeName });

        const tvSessions = getTempVoiceByGuild(interaction.guild.id);
        const { embed, components } = buildTempVoicePanel(getConfig(), { activeRooms: tvSessions.length }, interaction.client);
        await interaction.update({ embeds: [embed], components }).catch(() => {});

        await logAudit(interaction.client, {
            action: 'SETUP_TEMPVOICE',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Set Default Name via panel: \`${safeName}\``,
            guildId: interaction.guild.id
        });
        return interaction.followUp({
            content: `✅ Default Name di-set ke \`${safeName}\``,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    // ---------- MODAL: Set Default Limit ----------
    if (customId === 'tvp_modal_limit') {
        const raw = interaction.components[0]?.components?.[0]?.value?.trim() || '0';
        const parsed = parseInt(raw, 10);
        if (isNaN(parsed) || parsed < 0 || parsed > 99) {
            return interaction.reply({
                content: '❌ Limit harus angka 0-99 (0 = tanpa limit).',
                flags: MessageFlags.Ephemeral
            });
        }
        // Re-fetch latest config to avoid clobbering concurrent admin changes
        const freshTvLimit = getConfig().tempVoice || {};
        setField('tempVoice', { ...freshTvLimit, defaultLimit: parsed });

        const tvSessions = getTempVoiceByGuild(interaction.guild.id);
        const { embed, components } = buildTempVoicePanel(getConfig(), { activeRooms: tvSessions.length }, interaction.client);
        await interaction.update({ embeds: [embed], components }).catch(() => {});

        await logAudit(interaction.client, {
            action: 'SETUP_TEMPVOICE',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Set Default Limit via panel: ${parsed} ${parsed > 0 ? 'user' : '(tanpa limit)'}`,
            guildId: interaction.guild.id
        });
        return interaction.followUp({
            content: `✅ Default Limit di-set ke ${parsed > 0 ? `${parsed} user` : '_(tanpa limit)_'}`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }
}

// ====================================================
// === HELPER: TEMP VOICE MEMBER CONTROL PANEL ===
// ====================================================
// Member-facing panel — kelola room voice via tombol (ganti /tempvoice).
//
// Custom IDs handled:
//   Buttons: tvm_rename, tvm_limit, tvm_lock, tvm_unlock,
//            tvm_transfer, tvm_kick, tvm_claim, tvm_info
//   UserSelects: tvm_sel_transfer, tvm_sel_kick
//   Modals: tvm_modal_rename, tvm_modal_limit
//
// Permission: PUBLIC — siapa saja bisa klik. Akses di-filter
// berdasarkan apakah user adalah owner dari temp voice room-nya.
async function handleTempVoiceMemberPanel(interaction) {
    const customId = interaction.customId;

    // ---------- BUTTON: Rename (modal) ----------
    if (customId === 'tvm_rename') {
        // Validate: must be in a temp voice room owned by them
        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ Kamu harus berada di temp voice room milikmu untuk rename.', flags: MessageFlags.Ephemeral });
        }
        const session = getTempVoiceByChannel(voiceChannel.id);
        if (!session) {
            return interaction.reply({ content: '❌ Channel ini bukan temp voice channel.', flags: MessageFlags.Ephemeral });
        }
        if (session.ownerId !== interaction.user.id) {
            return interaction.reply({ content: `❌ Kamu bukan owner room ini. Owner: <@${session.ownerId}>.\n\n💡 Pakai tombol **Claim** kalau owner sudah leave.`, flags: MessageFlags.Ephemeral });
        }

        const modal = new ModalBuilder()
            .setCustomId('tvm_modal_rename')
            .setTitle('Rename Room')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('tvm_rename_input')
                        .setLabel('Nama Baru (maks 100 karakter)')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('My Cool Room')
                        .setValue(voiceChannel.name.slice(0, 100))
                        .setRequired(true)
                        .setMaxLength(100)
                )
            );
        return interaction.showModal(modal).catch(() => {});
    }

    // ---------- BUTTON: Limit (modal) ----------
    if (customId === 'tvm_limit') {
        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ Kamu harus berada di temp voice room milikmu untuk set limit.', flags: MessageFlags.Ephemeral });
        }
        const session = getTempVoiceByChannel(voiceChannel.id);
        if (!session) {
            return interaction.reply({ content: '❌ Channel ini bukan temp voice channel.', flags: MessageFlags.Ephemeral });
        }
        if (session.ownerId !== interaction.user.id) {
            return interaction.reply({ content: `❌ Kamu bukan owner room ini. Owner: <@${session.ownerId}>.`, flags: MessageFlags.Ephemeral });
        }

        const currentLimit = voiceChannel.userLimit > 0 ? String(voiceChannel.userLimit) : '0';
        const modal = new ModalBuilder()
            .setCustomId('tvm_modal_limit')
            .setTitle('Set User Limit')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('tvm_limit_input')
                        .setLabel('Limit (0 = tanpa limit, maks 99)')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('0')
                        .setValue(currentLimit)
                        .setRequired(true)
                        .setMaxLength(2)
                )
            );
        return interaction.showModal(modal).catch(() => {});
    }

    // ---------- BUTTON: Lock ----------
    if (customId === 'tvm_lock') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel) {
            return interaction.editReply({ content: '❌ Kamu harus berada di temp voice room milikmu untuk lock.' });
        }
        const session = getTempVoiceByChannel(voiceChannel.id);
        if (!session) {
            return interaction.editReply({ content: '❌ Channel ini bukan temp voice channel.' });
        }
        if (session.ownerId !== interaction.user.id) {
            return interaction.editReply({ content: `❌ Kamu bukan owner room ini. Owner: <@${session.ownerId}>.` });
        }
        try {
            await voiceChannel.permissionOverwrites.edit(interaction.guild.id, {
                Connect: false
            }, { reason: `Temp voice lock by ${interaction.user.tag}` });
            updateTempVoiceSession(voiceChannel.id, { locked: true });
            return interaction.editReply({ content: `🔒 **Room dikunci.** Member baru tidak bisa join sampai di-unlock.` });
        } catch (err) {
            return interaction.editReply({ content: `❌ Gagal lock: ${err.message}` });
        }
    }

    // ---------- BUTTON: Unlock ----------
    if (customId === 'tvm_unlock') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel) {
            return interaction.editReply({ content: '❌ Kamu harus berada di temp voice room milikmu untuk unlock.' });
        }
        const session = getTempVoiceByChannel(voiceChannel.id);
        if (!session) {
            return interaction.editReply({ content: '❌ Channel ini bukan temp voice channel.' });
        }
        if (session.ownerId !== interaction.user.id) {
            return interaction.editReply({ content: `❌ Kamu bukan owner room ini. Owner: <@${session.ownerId}>.` });
        }
        try {
            await voiceChannel.permissionOverwrites.edit(interaction.guild.id, {
                Connect: true
            }, { reason: `Temp voice unlock by ${interaction.user.tag}` });
            updateTempVoiceSession(voiceChannel.id, { locked: false });
            return interaction.editReply({ content: `🔓 **Room dibuka.** Member bebas join lagi.` });
        } catch (err) {
            return interaction.editReply({ content: `❌ Gagal unlock: ${err.message}` });
        }
    }

    // ---------- BUTTON: Transfer (show user select) ----------
    if (customId === 'tvm_transfer') {
        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ Kamu harus berada di temp voice room milikmu untuk transfer.', flags: MessageFlags.Ephemeral });
        }
        const session = getTempVoiceByChannel(voiceChannel.id);
        if (!session) {
            return interaction.reply({ content: '❌ Channel ini bukan temp voice channel.', flags: MessageFlags.Ephemeral });
        }
        if (session.ownerId !== interaction.user.id) {
            return interaction.reply({ content: `❌ Kamu bukan owner room ini. Owner: <@${session.ownerId}>.`, flags: MessageFlags.Ephemeral });
        }

        const row = buildTempVoiceUserSelectRow('transfer');
        return interaction.reply({
            content: '👑 **Pilih member baru** yang akan jadi owner (harus ada di room kamu saat ini):',
            components: [row],
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    // ---------- BUTTON: Kick (show user select) ----------
    if (customId === 'tvm_kick') {
        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ Kamu harus berada di temp voice room milikmu untuk kick.', flags: MessageFlags.Ephemeral });
        }
        const session = getTempVoiceByChannel(voiceChannel.id);
        if (!session) {
            return interaction.reply({ content: '❌ Channel ini bukan temp voice channel.', flags: MessageFlags.Ephemeral });
        }
        if (session.ownerId !== interaction.user.id) {
            return interaction.reply({ content: `❌ Kamu bukan owner room ini. Owner: <@${session.ownerId}>.`, flags: MessageFlags.Ephemeral });
        }

        const row = buildTempVoiceUserSelectRow('kick');
        return interaction.reply({
            content: '🦵 **Pilih member** yang akan di-kick dari room kamu:',
            components: [row],
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    // ---------- BUTTON: Claim ----------
    if (customId === 'tvm_claim') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel) {
            return interaction.editReply({ content: '❌ Kamu harus berada di temp voice room untuk claim.' });
        }
        const session = getTempVoiceByChannel(voiceChannel.id);
        if (!session) {
            return interaction.editReply({ content: '❌ Channel ini bukan temp voice channel.' });
        }
        if (session.ownerId === interaction.user.id) {
            return interaction.editReply({ content: '❌ Kamu sudah owner room ini.' });
        }
        const ownerStillHere = voiceChannel.members.has(session.ownerId);
        if (ownerStillHere) {
            return interaction.editReply({ content: `❌ Owner (<@${session.ownerId}>) masih ada di room. Tidak bisa di-claim.` });
        }

        try {
            // Hapus permission owner lama
            try {
                if (voiceChannel.permissionOverwrites.cache.has(session.ownerId)) {
                    await voiceChannel.permissionOverwrites.delete(session.ownerId, 'Claim temp voice — owner changed');
                }
            } catch (_) {}
            // Tambah permission owner baru
            await voiceChannel.permissionOverwrites.edit(interaction.user.id, {
                ViewChannel: true, Connect: true, Speak: true, Stream: true,
                ManageChannels: true, MoveMembers: true, PrioritySpeaker: true,
                MuteMembers: true, DeafenMembers: true
            }, { reason: 'Claim temp voice — new owner' });

            transferTempVoiceOwnership(voiceChannel.id, interaction.user.id, interaction.user.tag);
            return interaction.editReply({ content: `✅ **Ownership room di-claim!**\n\nRoom: **${voiceChannel.name}**\n👑 Owner baru: <@${interaction.user.id}>\n\n💡 Sekarang kamu bisa kelola room (rename, limit, lock, transfer, kick).` });
        } catch (err) {
            return interaction.editReply({ content: `❌ Gagal claim: ${err.message}` });
        }
    }

    // ---------- BUTTON: Info ----------
    if (customId === 'tvm_info') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel) {
            return interaction.editReply({ content: '❌ Kamu sedang tidak berada di voice channel manapun.' });
        }
        const session = getTempVoiceByChannel(voiceChannel.id);
        if (!session) {
            return interaction.editReply({ content: `❌ Channel **${voiceChannel.name}** bukan temp voice channel.` });
        }

        const isOwner = session.ownerId === interaction.user.id;
        const ageMs = Date.now() - session.createdAt;
        const ageMin = Math.floor(ageMs / 60000);
        const ageStr = ageMin < 60 ? `${ageMin} menit` : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m`;
        const memberCount = voiceChannel.members.filter(m => !m.user.bot).size;

        const embed = new EmbedBuilder()
            .setTitle(`🎤 Temp Voice Info — ${voiceChannel.name}`)
            .setColor(isOwner ? 0x57F287 : 0x5865F2)
            .addFields(
                { name: '👑 Owner', value: `<@${session.ownerId}>${isOwner ? ' *(kamu)*' : ''}`, inline: true },
                { name: '👥 Member', value: `${memberCount} user`, inline: true },
                { name: '🔒 Status', value: session.locked ? 'Terkunci' : 'Terbuka', inline: true },
                { name: '🕐 Dibuat', value: `${ageStr} lalu`, inline: true },
                { name: '🆔 Channel ID', value: `\`${session.channelId}\``, inline: true },
                { name: '📊 User Limit', value: voiceChannel.userLimit > 0 ? `${voiceChannel.userLimit}` : '_(tanpa limit)_', inline: true }
            )
            .setFooter({ text: isOwner ? 'Kamu owner — pakai tombol panel untuk kelola' : 'Bukan owner — pakai tombol Claim kalau owner sudah leave' })
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }

    // ---------- USER SELECT: Transfer ----------
    if (customId === 'tvm_sel_transfer') {
        await interaction.deferUpdate().catch(() => {});
        const newOwnerId = interaction.values?.[0];
        if (!newOwnerId) {
            return interaction.editReply({ content: '❌ Tidak ada user dipilih.' }).catch(() => {});
        }

        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel) {
            return interaction.editReply({ content: '❌ Kamu tidak lagi berada di temp voice room.' }).catch(() => {});
        }
        const session = getTempVoiceByChannel(voiceChannel.id);
        if (!session || session.ownerId !== interaction.user.id) {
            return interaction.editReply({ content: '❌ Kamu bukan owner room ini lagi.' }).catch(() => {});
        }
        if (newOwnerId === interaction.user.id) {
            return interaction.editReply({ content: '❌ Tidak bisa transfer ke diri sendiri.' }).catch(() => {});
        }
        const newOwnerMember = voiceChannel.members.get(newOwnerId);
        if (!newOwnerMember) {
            return interaction.editReply({ content: `❌ <@${newOwnerId}> tidak ada di room kamu. Minta dia join dulu.` }).catch(() => {});
        }
        if (newOwnerMember.user.bot) {
            return interaction.editReply({ content: '❌ Tidak bisa transfer ke bot.' }).catch(() => {});
        }

        try {
            // Hapus permission owner lama
            try {
                await voiceChannel.permissionOverwrites.delete(interaction.user.id, 'Transfer temp voice — old owner');
            } catch (_) {}
            // Tambah permission owner baru
            await voiceChannel.permissionOverwrites.edit(newOwnerId, {
                ViewChannel: true, Connect: true, Speak: true, Stream: true,
                ManageChannels: true, MoveMembers: true, PrioritySpeaker: true,
                MuteMembers: true, DeafenMembers: true
            }, { reason: `Transfer temp voice to ${newOwnerMember.user.tag}` });

            transferTempVoiceOwnership(voiceChannel.id, newOwnerId, newOwnerMember.user.tag);
            return interaction.editReply({ content: `✅ **Ownership ditransfer!**\n\n👑 Owner baru: <@${newOwnerId}>\n📍 Room: **${voiceChannel.name}**\n\n💡 Kamu tidak bisa lagi kelola room ini.` }).catch(() => {});
        } catch (err) {
            return interaction.editReply({ content: `❌ Gagal transfer: ${err.message}` }).catch(() => {});
        }
    }

    // ---------- USER SELECT: Kick ----------
    if (customId === 'tvm_sel_kick') {
        await interaction.deferUpdate().catch(() => {});
        const targetUserId = interaction.values?.[0];
        if (!targetUserId) {
            return interaction.editReply({ content: '❌ Tidak ada user dipilih.' }).catch(() => {});
        }

        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel) {
            return interaction.editReply({ content: '❌ Kamu tidak lagi berada di temp voice room.' }).catch(() => {});
        }
        const session = getTempVoiceByChannel(voiceChannel.id);
        if (!session || session.ownerId !== interaction.user.id) {
            return interaction.editReply({ content: '❌ Kamu bukan owner room ini lagi.' }).catch(() => {});
        }
        if (targetUserId === interaction.user.id) {
            return interaction.editReply({ content: '❌ Tidak bisa kick diri sendiri. Pakai disconnect manual.' }).catch(() => {});
        }
        const targetMember = voiceChannel.members.get(targetUserId);
        if (!targetMember) {
            return interaction.editReply({ content: `❌ <@${targetUserId}> tidak ada di room kamu.` }).catch(() => {});
        }
        if (targetMember.user.bot) {
            return interaction.editReply({ content: '❌ Tidak bisa kick bot.' }).catch(() => {});
        }

        try {
            await targetMember.voice.disconnect(`Kicked from temp voice by ${interaction.user.tag}`);
            return interaction.editReply({ content: `👢 <@${targetUserId}> dikick dari room **${voiceChannel.name}**.` }).catch(() => {});
        } catch (err) {
            return interaction.editReply({ content: `❌ Gagal kick: ${err.message}` }).catch(() => {});
        }
    }

    // ---------- MODAL: Rename ----------
    if (customId === 'tvm_modal_rename') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const newName = interaction.components[0]?.components?.[0]?.value?.trim() || '';
        if (!newName || newName.length > 100) {
            return interaction.editReply({ content: '❌ Nama harus 1-100 karakter.' });
        }

        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel) {
            return interaction.editReply({ content: '❌ Kamu tidak lagi berada di temp voice room.' });
        }
        const session = getTempVoiceByChannel(voiceChannel.id);
        if (!session || session.ownerId !== interaction.user.id) {
            return interaction.editReply({ content: '❌ Kamu bukan owner room ini lagi.' });
        }

        try {
            await voiceChannel.setName(newName, `Temp voice rename by ${interaction.user.tag}`);
            return interaction.editReply({ content: `✅ Nama room diubah ke: **${newName}**` });
        } catch (err) {
            return interaction.editReply({ content: `❌ Gagal rename: ${err.message}` });
        }
    }

    // ---------- MODAL: Limit ----------
    if (customId === 'tvm_modal_limit') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const raw = interaction.components[0]?.components?.[0]?.value?.trim() || '0';
        const parsed = parseInt(raw, 10);
        if (isNaN(parsed) || parsed < 0 || parsed > 99) {
            return interaction.editReply({ content: '❌ Limit harus angka 0-99 (0 = tanpa limit).' });
        }

        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel) {
            return interaction.editReply({ content: '❌ Kamu tidak lagi berada di temp voice room.' });
        }
        const session = getTempVoiceByChannel(voiceChannel.id);
        if (!session || session.ownerId !== interaction.user.id) {
            return interaction.editReply({ content: '❌ Kamu bukan owner room ini lagi.' });
        }

        try {
            await voiceChannel.setUserLimit(parsed, `Temp voice limit by ${interaction.user.tag}`);
            return interaction.editReply({ content: `✅ User limit diubah ke: ${parsed > 0 ? `**${parsed} user**` : '**tanpa limit**'}` });
        } catch (err) {
            return interaction.editReply({ content: `❌ Gagal set limit: ${err.message}` });
        }
    }
}
