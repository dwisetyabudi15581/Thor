const { ChannelType, PermissionFlagsBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { getConfig } = require('./configManager');

/**
 * Buat channel tiket baru.
 * Tiket transaksi menampilkan tombol "Set Key" + "Tutup Tiket".
 * Tiket help/report menampilkan tombol "Tutup Tiket" saja.
 */
async function createTicket(interaction, product) {
    const guild = interaction.guild;
    const user = interaction.user;
    const config = getConfig();

    // Cek apakah user punya tiket aktif
    const existingTicket = guild.channels.cache.find(c => c.topic && c.topic.startsWith(`Ticket UserID: ${user.id}`));
    if (existingTicket) {
        return interaction.editReply({ content: `❌ Kamu sudah punya tiket aktif di ${existingTicket}!` });
    }

    // Admin role wajib sudah di-set
    if (!config.roles.admin) {
        return interaction.editReply({ content: '❌ Role Admin belum di-set. Pakai `/set-role admin @role` dulu.' });
    }

    const isTransaction = product.label !== 'Bantuan/Lapor';

    try {
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
            topic: `Ticket UserID: ${user.id} | Product: ${product.label} | Price: ${product.price}`,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
                { id: config.roles.admin, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
                { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
            ]
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
 * @param {Channel} channel - channel tiket
 * @param {User} closer - admin yang menutup
 * @param {boolean} isSuccess - true kalau transaksi sukses (kirim invoice), false kalau batal
 */
async function closeTicket(channel, closer, isSuccess) {
    try {
        const topic = channel.topic || '';
        const userIdMatch = topic.match(/UserID: (\d+)/);
        const productMatch = topic.match(/Product: (.+?) \|/);
        const priceMatch = topic.match(/Price: (.+)/);

        const userId = userIdMatch ? userIdMatch[1] : null;
        const productName = productMatch ? productMatch[1] : 'Unknown';
        const price = priceMatch ? priceMatch[1] : 'Unknown';

        // Kirim invoice kalau sukses & bukan tiket help/report
        if (isSuccess && userId) {
            await sendInvoice(channel, userId, productName, price, closer);
        }

        // Hapus channel
        await channel.delete();
    } catch (err) {
        console.error('Error closing ticket:', err);
        try { await channel.delete(); } catch (_) {}
    }
}

module.exports = { createTicket, closeTicket, sendInvoice };
