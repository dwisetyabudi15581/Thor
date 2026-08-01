const { ChannelType, PermissionFlagsBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { getConfig } = require('./configManager');
const fs = require('fs');
const path = require('path');
const { safeWriteJSON } = require('../infra/safeWrite');

// P2-2 FIX: per-user lock supaya tidak bisa buka 2 tiket bersamaan (race condition).
// Sebelumnya: 2 klik tombol <100ms → kedua interaction lolos check existing ticket
// (channel belum dibuat) → 2 tiket terbuat. Sekarang: lock per userId sampai selesai.
//
// v3.9.8 FIX: lock di-scope per `${guildId}:${userId}`. Sebelumnya key cuma `userId`,
// jadi user yang ada di 2 guild bot gak bisa bikin ticket barengan di kedua guild.
const ticketLocks = new Map();

// FIX v3.7.1: per-channel close lock — cegah double-close race condition.
// Skenario: admin klik "Tutup Tiket" → network lambat → admin klik lagi →
// 2 closeTicket jalan bersamaan → salah satunya dapat "Unknown Channel".
// Lock ini memastikan hanya 1 closeTicket per channel pada satu waktu.
const closeTicketLocks = new Set();

// === v3.9.1: tickets.json — persistent ticket metadata ===
// Sebelumnya, metadata tiket (userId, productName, price) disimpan di channel
// topic dengan format "Ticket UserID: 123 | Product: Foo | Price: Rp 50.000".
// Masalah:
//   1. Channel topic bisa di-edit admin → metadata bisa rusak / dispoof.
//   2. Channel topic dibatasi 1024 char, bisa ter-truncate kalau nama produk panjang.
//   3. Parsing regex rentan false-positive kalau nama produk mengandung " | ".
//
// Sekarang: metadata utama ada di tickets.json (keyed by channelId). Channel
// topic tetap di-set untuk human-readable info, tapi tidak dipakai sebagai
// sumber kebenaran. Backward compat: kalau channelId tidak ada di tickets.json,
// fallback ke topic parsing (untuk tiket lama yang dibuat sebelum v3.9.1).
const ticketsPath = path.join(__dirname, '..', '..', 'data', 'tickets.json');

function loadTickets() {
    try {
        if (!fs.existsSync(ticketsPath)) return {};
        return JSON.parse(fs.readFileSync(ticketsPath, 'utf8'));
    } catch (err) {
        console.warn('⚠️ tickets.json rusak:', err.message);
        return {};
    }
}

function saveTickets(data) {
    safeWriteJSON(ticketsPath, data);
}

/**
 * Simpan metadata tiket baru.
 * @param {string} channelId
 * @param {Object} meta - { userId, productName, price, guildId, createdAt }
 */
function setTicketMeta(channelId, meta) {
    const all = loadTickets();
    all[channelId] = {
        userId: meta.userId,
        productName: meta.productName,
        price: meta.price,
        guildId: meta.guildId,
        createdAt: meta.createdAt || Date.now()
    };
    saveTickets(all);
}

/**
 * Ambil metadata tiket by channelId. Fallback ke topic parsing kalau tidak ada
 * (untuk tiket lama yang dibuat sebelum v3.9.1).
 */
function getTicketMeta(channelId, topicFallback) {
    const all = loadTickets();
    if (all[channelId]) return all[channelId];

    // Backward compat: parse dari channel topic (tiket lama).
    if (topicFallback) {
        const userIdMatch = topicFallback.match(/UserID: (\d+)/);
        const productMatch = topicFallback.match(/Product:\s*([^|]+?)\s*\|/);
        const priceMatch = topicFallback.match(/Price:\s*(.+)$/);
        if (userIdMatch) {
            return {
                userId: userIdMatch[1],
                productName: productMatch ? productMatch[1].trim() : 'Unknown',
                price: priceMatch ? priceMatch[1].trim() : 'Unknown',
                guildId: null,
                createdAt: null,
                _legacy: true
            };
        }
    }
    return null;
}

/**
 * Hapus metadata tiket (dipanggil saat tiket ditutup).
 */
function removeTicketMeta(channelId) {
    const all = loadTickets();
    if (!all[channelId]) return false;
    delete all[channelId];
    saveTickets(all);
    return true;
}

/**
 * Buat channel tiket baru.
 * Tiket transaksi menampilkan tombol "Set Key" + "Tutup Tiket".
 * Tiket help/report menampilkan tombol "Tutup Tiket" saja.
 */
async function createTicket(interaction, product) {
    const guild = interaction.guild;
    const user = interaction.user;
    const config = getConfig();

    // P2-2 FIX: cek lock dulu — kalau sedang diproses, reject.
    // v3.9.8: lock di-scope per guild supaya user di multi-guild bot gak saling block.
    const lockKey = `${guild.id}:${user.id}`;
    if (ticketLocks.has(lockKey)) {
        return interaction.editReply({ content: '⏳ Tiket kamu sedang dibuat, tunggu sebentar...' }).catch(()=>{});
    }
    ticketLocks.set(lockKey, true);

    try {
        // Cek apakah user punya tiket aktif.
        // v3.9.1: cek dari tickets.json (sumber kebenaran), fallback ke topic scan
        // untuk tiket lama yang dibuat sebelum v3.9.1.
        //
        // v3.9.8 FIX:
        //   1. Pakai tickets.json metadata sebagai sumber kebenaran — bahkan kalau
        //      channel tidak ter-cache (bot baru start), tetap dianggap aktif.
        //      Sebelumnya `cache.get(chId)` miss → duplicate ticket untuk user yang sama.
        //   2. Fix false-positive `startsWith` — tambah separator ` |` supaya
        //      user ID yang merupakan prefix dari user ID lain tidak false-match.
        const ticketsData = loadTickets();
        let existingTicket = null;
        // Cek via tickets.json dulu
        for (const [chId, meta] of Object.entries(ticketsData)) {
            if (meta.userId === user.id && meta.guildId === guild.id) {
                const ch = guild.channels.cache.get(chId);
                if (ch) {
                    existingTicket = ch;
                    break;
                } else {
                    // v3.9.8: channel gak ter-cache, tapi metadata ada. Anggap aktif.
                    // Fetch dari API untuk dapat object channel-nya.
                    try {
                        const fetched = await guild.channels.fetch(chId).catch(() => null);
                        if (fetched) { existingTicket = fetched; break; }
                        // Channel benar-benar hilang — cleanup metadata zombie.
                        removeTicketMeta(chId);
                    } catch (_) {}
                }
            }
        }
        // Fallback: scan channel topic (tiket lama)
        if (!existingTicket) {
            // v3.9.8: tambah ` |` supaya ID yang prefix dari ID lain tidak false-match.
            existingTicket = guild.channels.cache.find(c => c.topic && c.topic.startsWith(`Ticket UserID: ${user.id} |`));
        }
        if (existingTicket) {
            return interaction.editReply({ content: `❌ Kamu sudah punya tiket aktif di ${existingTicket}!` });
        }

        // Admin role wajib sudah di-set
        if (!config.roles.admin) {
            return interaction.editReply({ content: '❌ Role Admin belum di-set. Pakai `/set-role admin @role` dulu.' });
        }

        const isTransaction = product.label !== 'Bantuan/Lapor';

        // Buat kategori kalau belum ada
        let category = guild.channels.cache.find(c => c.name === '🎫 TICKETS' && c.type === ChannelType.GuildCategory);
        if (!category) {
            category = await guild.channels.create({ name: '🎫 TICKETS', type: ChannelType.GuildCategory });
        }

        const channelName = `ticket-${user.id}`.toLowerCase().slice(0, 50);

        const ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category.id,
            // Topic tetap di-set untuk human-readable info, tapi bukan sumber kebenaran.
            topic: `Ticket UserID: ${user.id} | Product: ${product.label} | Price: ${product.price}`,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
                { id: config.roles.admin, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
                { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
            ]
        });

        // v3.9.1: simpan metadata tiket ke tickets.json (sumber kebenaran).
        setTicketMeta(ticketChannel.id, {
            userId: user.id,
            productName: product.label,
            price: product.price,
            guildId: guild.id,
            createdAt: Date.now()
        });

        const ticketEmbed = new EmbedBuilder()
            .setTitle(isTransaction ? '🛒 TIKET TRANSAKSI' : '🎫 TIKET BANTUAN')
            .setDescription(
                `Halo <@${user.id}>!\n\n` +
                (isTransaction
                    ? `Kamu memesan paket **${product.label}** dengan harga **${product.price}**.\n\n` +
                      `Silakan lakukan pembayaran dan kirim bukti pembayaran di sini.\n` +
                      `Admin <@&${config.roles.admin}> akan memproses pesananmu.\n\n` +
                      `💡 Setelah pembayaran dikonfirmasi, admin klik tombol **🔑 Set Key** untuk memberikan key + role.`
                    : `Silakan jelaskan kebutuhanmu di channel ini.\n` +
                      `Admin <@&${config.roles.admin}> akan segera membantu.`)
            )
            .setColor(isTransaction ? 0x3498DB : 0xE67E22)
            .addFields(
                isTransaction
                    ? [
                        { name: '📦 Produk', value: `Key MLBB${product.duration ? ` (${product.duration})` : ''}`, inline: true },
                        { name: '💰 Harga', value: product.price, inline: true }
                    ]
                    : [{ name: '📋 Jenis', value: product.label, inline: false }]
            )
            .setFooter({ text: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        // Tombol: Set Key (hanya transaksi) + Tutup Tiket
        const components = [];
        if (isTransaction) {
            components.push(
                new ButtonBuilder()
                    .setCustomId('ticket_set_key')
                    .setLabel('Set Key')
                    .setEmoji('🔑')
                    .setStyle(ButtonStyle.Success)
            );
        }
        components.push(
            new ButtonBuilder()
                .setCustomId('ticket_close')
                .setLabel('Tutup Tiket')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Danger)
        );
        const closeRow = new ActionRowBuilder().addComponents(...components);

        await ticketChannel.send({ content: `<@&${config.roles.admin}> | <@${user.id}>`, embeds: [ticketEmbed], components: [closeRow] });
        await interaction.editReply({ content: `✅ Tiket berhasil dibuat: ${ticketChannel}` });
    } catch (err) {
        console.error('Error creating ticket:', err);
        await interaction.editReply({ content: '❌ Terjadi error saat membuat tiket. Cek izin bot!' }).catch(()=>{});
    } finally {
        // P2-2 FIX: pastikan lock dilepas walau ada error.
        // v3.9.8: gunakan lockKey scoped per guild.
        ticketLocks.delete(`${guild.id}:${user.id}`);
    }
}

/**
 * Kirim invoice ke channel invoice (testimoni).
 * Dipakai oleh Set Key flow & closeTicket.
 */
async function sendInvoice(channel, userId, productName, price, closer) {
    const config = getConfig();
    if (!config.channels.invoice) return false;
    if (productName === 'Bantuan/Lapor') return false;

    const invoiceChannel = channel.guild.channels.cache.get(config.channels.invoice);
    if (!invoiceChannel) return false;

    const orderId = `INV-${Date.now().toString().slice(-6)}`;
    const invoiceEmbed = new EmbedBuilder()
        .setTitle('🧾 BUKTI TRANSAKSI / TESTIMONI')
        .setColor(0x2ECC71)
        .addFields(
            { name: '🆔 Order ID', value: orderId, inline: false },
            { name: '👤 Pembeli', value: `<@${userId}>`, inline: false },
            { name: '📦 Produk', value: productName, inline: true },
            { name: '💰 Harga', value: price, inline: true },
            { name: '🕒 Tanggal', value: new Date().toLocaleString('id-ID'), inline: false }
        )
        .setFooter({ text: `Diproses oleh ${closer.tag}`, iconURL: closer.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    await invoiceChannel.send({ content: `✅ Transaksi sukses oleh <@${userId}>!`, embeds: [invoiceEmbed] });
    return true;
}

/**
 * Tutup tiket — HANYA hapus channel + kirim invoice (kalau sukses).
 * Role granting & key delivery sekarang ditangani oleh Set Key button.
 *
 * FIX v3.7.1:
 *   - Per-channel lock mencegah double-close race condition
 *   - Handle DiscordAPIError 10003 (Unknown Channel) sebagai sukses —
 *     channel sudah tidak ada, yang artinya tujuan close sudah tercapai
 *     (mungkin dihapus admin lain atau close sebelumnya berhasil tapi
 *     reply-nya timeout).
 *   - Invoice failure tidak block close (log warning saja)
 *
 * @param {Channel} channel - channel tiket
 * @param {User} closer - admin yang menutup
 * @param {boolean} isSuccess - true kalau transaksi sukses (kirim invoice), false kalau batal
 */
async function closeTicket(channel, closer, isSuccess) {
    const channelId = channel?.id;

    // FIX v3.7.1: skip kalau channel sudah tidak ada (partial/deleted)
    if (!channelId) {
        console.log('ℹ️ closeTicket dipanggil tanpa channel valid — skip.');
        return;
    }

    // FIX v3.7.1: cegah double-close — kalau channel ini sedang di-close, skip.
    if (closeTicketLocks.has(channelId)) {
        console.log(`⏭️ Channel ${channelId} sedang di-close, skip double-close.`);
        return;
    }
    closeTicketLocks.add(channelId);

    try {
        // v3.9.1: baca metadata dari tickets.json (sumber kebenaran), fallback ke
        // topic parsing untuk tiket lama yang dibuat sebelum v3.9.1.
        const topic = channel.topic || '';
        const meta = getTicketMeta(channelId, topic);
        const userId = meta?.userId || null;
        const productName = meta?.productName || 'Unknown';
        const price = meta?.price || 'Unknown';

        // Kirim invoice kalau sukses & bukan tiket help/report
        // FIX v3.7.1: invoice failure tidak boleh block close — log warning saja.
        if (isSuccess && userId) {
            try {
                await sendInvoice(channel, userId, productName, price, closer);
            } catch (invoiceErr) {
                console.warn(`⚠️ Gagal kirim invoice saat close ticket ${channelId}:`, invoiceErr.message);
            }
        }

        // Hapus channel
        // FIX v3.7.1: handle 10003 (Unknown Channel) sebagai sukses.
        try {
            await channel.delete();
        } catch (deleteErr) {
            // DiscordAPIError code 10003 = Unknown Channel — sudah dihapus.
            // Anggap sukses karena tujuan close sudah tercapai.
            if (deleteErr.code === 10003) {
                console.log(`ℹ️ Channel ${channelId} sudah tidak ada (kemungkinan dihapus admin lain atau close sebelumnya). Anggap sukses.`);
            } else {
                // Error lain (permission, network) — log tapi jangan crash
                console.warn(`⚠️ Gagal hapus channel ${channelId}:`, deleteErr.message);
            }
        }

        // v3.9.1: hapus metadata tiket dari tickets.json (cleanup).
        // Dilakukan setelah channel berhasil/anggap-sukses dihapus supaya
        // tidak ada zombie metadata untuk channel yang masih ada.
        try {
            removeTicketMeta(channelId);
        } catch (cleanupErr) {
            console.warn(`⚠️ Gagal hapus ticket meta ${channelId}:`, cleanupErr.message);
        }
    } catch (err) {
        // Error saat parse topic atau operasi lain — log tapi jangan crash
        console.error('Error closing ticket:', err.message);
    } finally {
        // FIX v3.7.1: pastikan lock dilepas walau ada error.
        closeTicketLocks.delete(channelId);
    }
}

module.exports = { createTicket, closeTicket, sendInvoice, getTicketMeta, setTicketMeta, removeTicketMeta };
