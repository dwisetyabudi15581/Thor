const {
    EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
    MessageFlags, StringSelectMenuBuilder, PermissionFlagsBits,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { createTicket, closeTicket, sendInvoice } = require('../utils/ticketManager');
const { getConfig } = require('../utils/configManager');
const { isAdmin: checkIsAdmin } = require('../utils/permissions');
const {
    addKey, getActiveKeysByUserAndRole, hasPermanentKey,
    getMaxExpireAtByUserAndRole, formatRemaining
} = require('../utils/keyManager');
const { scheduleRoleRemoval } = require('../utils/roleScheduler');
const { getPanelByMessage, getPanel } = require('../utils/selfRoleManager');
const { buildPanelEmbed, buildPanelComponents } = require('../utils/selfRolePanelBuilder');
const { getSession, deleteSession, buildEmbed: buildSessionEmbed, parseColor } = require('../utils/embedBuilderSessions');

module.exports = async (interaction) => {
    if (interaction.replied || interaction.deferred) {
        // Untuk modal submit, replied=false default; skip cuma untuk non-modal
        if (!interaction.isModalSubmit()) return;
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
            const keyValue = interaction.components[0].fields[0].value.trim();

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
                .setLabel('Title (maks 256 char, kosongkan untuk hapus)')
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
                .setLabel('Description (maks 4000 char, kosongkan untuk hapus)')
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
                .setLabel('Image URL (https://..., kosongkan untuk hapus)')
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
                .setLabel('Thumbnail URL (https://..., kosongkan untuk hapus)')
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
    const getFieldValue = (idx) => interaction.components[idx]?.fields[0]?.value?.trim() || '';

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
