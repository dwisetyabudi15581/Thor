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
