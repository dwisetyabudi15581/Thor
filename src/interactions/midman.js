/**
 * Midman (Rekber) domain handler — semua customId terkait deal rekber 3-pihak.
 * v3.9.32.
 *
 * CustomId yang ditangani:
 *   - ticket_cat:midman  (button)       → buka modal buat deal (dari panel tiket)
 *   - modal_mm_create    (modal)        → validasi item+harga → simpan sementara
 *                                        → tampilkan dropdown pilih penjual
 *   - mm_pick_seller     (user select)  → pilih penjual dari daftar member
 *                                        (ada kolom pencarian — TIDAK perlu
 *                                        copy ID / mention manual)
 *                                        → buat channel deal + Deal Board
 *   - mm_join            (button)  → penjual setuju deal (terms terkunci)
 *   - mm_cancel          (button)  → batalkan deal (hanya sebelum dana masuk)
 *   - mm_fundin          (button)  → midman konfirmasi dana masuk
 *   - mm_received        (button)  → pembeli konfirmasi barang diterima
 *   - mm_release         (button)  → midman cairkan dana → invoice + close
 *   - mm_dispute         (button)  → bekukan deal (peserta deal / admin)
 *   - mm_resolve_release (button)  → admin: selesaikan dispute → cairkan
 *   - mm_resolve_refund  (button)  → admin: selesaikan dispute → refund
 *
 * Router (src/interactions/index.js) sudah apply:
 *   - dedup (checkAndMark), guard replied/deferred, filter tipe interaction.
 *
 * Deal Board = embed bot yang jadi SATU-SATUNYA sumber kebenaran deal
 * (item, harga, fee, status, siapa harus aksi). Channel chat hanya tempat
 * bukti (screenshot transfer, bukti kirim barang). Setiap transisi state:
 *   1. dicek URUTANNYA valid (midmanManager.canTransition)
 *   2. dicek AKTORNYA berhak (midmanManager.actorAllowed)
 *   3. dicatat ke history deal + audit log
 *   4. Deal Board di-update (embed diedit — tidak bisa dimanipulasi user)
 */

const {
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
    ChannelType,
    PermissionFlagsBits,
    // v3.9.33: dropdown pilih penjual (native member picker Discord —
    // searchable, ada avatar; solusi untuk "nama susah / gak bisa copy ID").
    UserSelectMenuBuilder
} = require('discord.js');
const { getConfig, safeEditReply, logAudit, checkIsAdmin } = require('../commands/_shared');
const mm = require('../data/midmanManager');
const { sendInvoice, saveTranscript, findActiveTicketFor } = require('../data/ticketManager');
const { recordPurchase } = require('../data/statsManager');

// Jeda sebelum channel deal dihapus setelah selesai (detik) — kasih waktu
// peserta membaca ringkasan riwayat sebelum channel hilang.
const DELETE_DELAY_MS = 5000;

/**
 * v3.9.17 pattern (copy dari ticket.js, policy sama): kalau verified role
 * di-set, user harus verified dulu sebelum buat deal.
 */
function passesVerifiedCheck(interaction, config) {
    if (!interaction.member?.roles?.cache) return false;
    if (!config.roles.verified) return true;
    return interaction.member.roles.cache.has(config.roles.verified);
}

// ====================================================
// === DEAL BOARD RENDER ===
// ====================================================

const STATE_DESCRIPTIONS = {
    WAITING_SELLER:
        '**🏷️ Penjual** — klik **🤝 Setuju Deal** untuk mengunci kesepakatan.\n' +
        'Setelah disetujui, item & harga **TERKUNCI** — mau ubah = batal & buat deal baru.\n' +
        'Membatalkan sekarang aman (dana belum berpindah).',
    WAITING_PAYMENT: deal =>
        '**🛒 Pembeli** — transfer **Total Pembayaran** ke midman, lalu kirim bukti transfer di channel ini.\n' +
        `💳 Total: **${mm.formatRupiah(deal.priceNum + deal.fee)}** (harga ${mm.formatRupiah(deal.priceNum)} + fee ${mm.formatRupiah(deal.fee)}).\n` +
        '**🛡️ Midman** — verifikasi dana benar-benar masuk, baru klik **✅ Dana Masuk**.\n' +
        'Setelah ini penjual baru boleh kirim barang.',
    WAITING_DELIVERY:
        '**🏷️ Penjual** — kirim barang sekarang (chat di channel ini sebagai bukti).\n' +
        '**🛒 Pembeli** — cek barang, kalau sudah sesuai klik **✅ Barang Diterima**.',
    WAITING_RELEASE: deal =>
        '**🛡️ Midman** — transfer **PENUH** ke penjual (JANGAN dipotong), lalu klik **💸 Cairkan ke Penjual**.\n' +
        `🏷️ Penjual menerima: **${mm.formatRupiah(deal.priceNum)}** • 🧾 Fee midman (sisa di tanganmu): **${mm.formatRupiah(deal.fee)}**.\n` +
        'Invoice & transcript otomatis tersimpan saat deal ditutup.',
    DISPUTE:
        '**🚨 Deal DIBEKUKAN** — tidak ada dana/barang yang boleh berpindah.\n' +
        'Hanya **Admin server** yang bisa resolve: cairkan ke penjual atau refund ke pembeli.\n' +
        'Semua riwayat klik terekam dan tersimpan di transcript.',
    COMPLETED: '✅ Deal selesai — dana sudah cair ke penjual. Channel akan ditutup otomatis.',
    REFUNDED: '↩️ Deal selesai — dana dikembalikan ke pembeli. Channel akan ditutup otomatis.',
    CANCELLED: '❌ Deal dibatalkan (dana belum masuk). Channel akan ditutup otomatis.'
};

function boardEmbed(deal, config) {
    // v3.9.33: deskripsi state bisa berupa string ATAU fungsi (untuk nominal
    // dinamis — total transfer & pencairan tampil persis di description).
    const rawDesc = STATE_DESCRIPTIONS[deal.state];
    const desc = typeof rawDesc === 'function' ? rawDesc(deal) : rawDesc || '';
    // v3.9.33: fee ADDITIVE — pembeli bayar harga + fee, penjual menerima
    // harga PENUH (tidak dipotong fee). calcTotals = sumber tunggal hitungan.
    const totals = mm.calcTotals(deal.priceNum, deal.fee);
    const feeLabel =
        deal.feeMode === 'percent'
            ? `${mm.formatRupiah(deal.fee)} (${deal.feeValue}%)`
            : mm.formatRupiah(deal.fee);
    return new EmbedBuilder()
        .setTitle('🤝 DEAL BOARD — REKBER')
        .setDescription(desc)
        .setColor(mm.STATES[deal.state]?.color || 0x2ecc71)
        .addFields(
            { name: '📦 Item', value: String(deal.item).slice(0, 1000), inline: false },
            { name: '💰 Harga Deal', value: mm.formatRupiah(deal.priceNum), inline: true },
            { name: '🧾 Fee Midman', value: feeLabel, inline: true },
            { name: '💳 Total Dibayar Pembeli', value: `**${mm.formatRupiah(totals.buyerPays)}** (harga + fee)`, inline: true },
            { name: '🏷️ Diterima Penjual', value: `${mm.formatRupiah(totals.sellerGets)} — penuh, tanpa potongan`, inline: true },
            { name: '🛒 Pembeli', value: `<@${deal.buyerId}>`, inline: true },
            { name: '🏷️ Penjual', value: `<@${deal.sellerId}>`, inline: true },
            { name: '🛡️ Midman', value: config.roles.midman ? `<@&${config.roles.midman}>` : '_belum di-set_', inline: true },
            { name: '📍 Status', value: `${mm.STATES[deal.state]?.label || deal.state}`, inline: false }
        )
        .setFooter({ text: `Deal ID: ${deal.channelId} • Terms terkunci • Chat = bukti, Board = kesepakatan` })
        .setTimestamp();
}

function mkButton(customId, label, emoji, style) {
    return new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(style);
}

/**
 * Tombol per state — HANYA aksi yang valid dari state itu yang dirender.
 * Discord tetap mengirim klik lama (user bisa klik tombol stale di client
 * yang belum ter-update) → itu ditangkap guard canTransition di handleEvent.
 */
function boardComponents(deal) {
    let buttons = [];
    switch (deal.state) {
        case 'WAITING_SELLER':
            buttons = [
                mkButton('mm_join', 'Setuju Deal', '🤝', ButtonStyle.Success),
                mkButton('mm_cancel', 'Batalkan', '❌', ButtonStyle.Danger)
            ];
            break;
        case 'WAITING_PAYMENT':
            buttons = [
                mkButton('mm_fundin', 'Dana Masuk', '✅', ButtonStyle.Success),
                mkButton('mm_cancel', 'Batalkan', '❌', ButtonStyle.Danger)
            ];
            break;
        case 'WAITING_DELIVERY':
            buttons = [
                mkButton('mm_received', 'Barang Diterima', '✅', ButtonStyle.Success),
                mkButton('mm_dispute', 'Ada Masalah', '⚠️', ButtonStyle.Danger)
            ];
            break;
        case 'WAITING_RELEASE':
            buttons = [
                mkButton('mm_release', 'Cairkan ke Penjual', '💸', ButtonStyle.Success),
                mkButton('mm_dispute', 'Ada Masalah', '⚠️', ButtonStyle.Danger)
            ];
            break;
        case 'DISPUTE':
            buttons = [
                mkButton('mm_resolve_release', 'Resolve: Cairkan', '⚖️', ButtonStyle.Success),
                mkButton('mm_resolve_refund', 'Resolve: Refund', '↩️', ButtonStyle.Secondary)
            ];
            break;
        default:
            break; // terminal state → tanpa tombol
    }
    if (buttons.length === 0) return [];
    return [new ActionRowBuilder().addComponents(...buttons)];
}

function boardPing(deal, config) {
    const parts = [];
    if (config.roles.midman) parts.push(`<@&${config.roles.midman}>`);
    parts.push(`<@${deal.buyerId}>`, `<@${deal.sellerId}>`);
    return parts.join(' | ');
}

/**
 * Update Deal Board di channel. Self-healing: kalau board terhapus admin,
 * kirim board baru & simpan boardMessageId baru.
 */
async function refreshBoard(channel, deal, config) {
    if (!deal.boardMessageId || !channel) return;
    const payload = { embeds: [boardEmbed(deal, config)], components: boardComponents(deal) };
    try {
        await channel.messages.edit(deal.boardMessageId, payload);
    } catch (editErr) {
        console.warn(`⚠️ Deal Board ${deal.channelId} gagal diedit (${editErr.message}) — coba kirim ulang.`);
        try {
            const sent = await channel.send({ content: boardPing(deal, config), ...payload });
            deal.boardMessageId = sent.id;
            mm.setDeal(deal.channelId, deal);
        } catch (sendErr) {
            console.warn(`⚠️ Gagal kirim ulang Deal Board: ${sendErr.message}`);
        }
    }
}

// ====================================================
// === AKTOR & GUARD ===
// ====================================================

/**
 * Peran user yang klik relatif ke deal ini.
 * Anti self-dealing: buyer/seller deal TIDAK dihitung sebagai midman/admin
 * di deal-nya sendiri (midman tidak boleh sekalian pegang deal sebagai peserta).
 */
function resolveActor(deal, interaction, config) {
    const uid = interaction.user.id;
    const isBuyer = uid === deal.buyerId;
    const isSeller = uid === deal.sellerId;
    const hasMidmanRole =
        Boolean(config.roles.midman) && Boolean(interaction.member?.roles?.cache?.has(config.roles.midman));
    const isMidman = hasMidmanRole && !isBuyer && !isSeller;
    const isAdmin = !isBuyer && !isSeller && Boolean(checkIsAdmin(interaction.member));
    return { isBuyer, isSeller, isMidman, isAdmin };
}

const ACTOR_HINT = {
    join: '❌ Hanya **penjual** yang bisa menyetujui deal.',
    cancel: '❌ Deal hanya bisa dibatalkan oleh pembeli, penjual, atau admin — dan hanya sebelum dana masuk.',
    fundin: '❌ Hanya **midman** yang bisa konfirmasi dana masuk.',
    received: '❌ Hanya **pembeli** yang bisa konfirmasi barang diterima.',
    release: '❌ Hanya **midman** yang bisa mencairkan dana.',
    dispute: '❌ Hanya peserta deal (pembeli / penjual / midman) yang bisa membuka dispute.',
    resolve_release: '❌ Hanya **admin server** yang bisa resolve dispute.',
    resolve_refund: '❌ Hanya **admin server** yang bisa resolve dispute.'
};

const CONFIRM_MSG = {
    join: '✅ Deal disetujui — terms **terkunci**. Pembeli silakan transfer ke midman.',
    cancel: '❌ Deal dibatalkan. Channel akan ditutup otomatis.',
    fundin: '✅ Dana dikonfirmasi masuk. Penjual sekarang boleh kirim barang.',
    received: '✅ Barang dikonfirmasi diterima. Midman bisa mencairkan dana ke penjual.',
    release: '💸 Dana dicairkan! Deal selesai — invoice & transcript otomatis tersimpan.',
    dispute: '🚨 Dispute dibuka. Deal **dibekukan** — hanya admin yang bisa resolve.',
    resolve_release: '⚖️ Dispute selesai — diputuskan CAIRKAN ke penjual. Channel akan ditutup.',
    resolve_refund: '⚖️ Dispute selesai — diputuskan REFUND ke pembeli. Channel akan ditutup.'
};

// ====================================================
// === BUAT DEAL (modal) ===
// ====================================================

/**
 * Entry dari panel tiket: tombol kategori `midman` (routed ke domain ini oleh
 * router: prefix `ticket_cat:midman`) atau dropdown kategori (redirect dari
 * ticket.js). Tampilkan modal input deal.
 */
async function openCreateModal(interaction) {
    const config = getConfig();

    if (!passesVerifiedCheck(interaction, config)) {
        return interaction.reply({ content: '❌ Verifikasi dulu!', flags: MessageFlags.Ephemeral });
    }
    if (!config.roles.midman) {
        return interaction.reply({
            content: '❌ Role Midman belum di-set. Admin pakai `/set-role midman @role` dulu.',
            flags: MessageFlags.Ephemeral
        });
    }

    const modal = new ModalBuilder()
        .setCustomId('modal_mm_create')
        .setTitle('Buat Deal Rekber — Item & Harga')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('mm_field_item')
                    .setLabel('Item yang dijual')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100)
                    .setPlaceholder('Contoh: Akun ML Mythic full hero')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('mm_field_price')
                    .setLabel('Harga (contoh: 100000 / 100k)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(20)
                    .setPlaceholder('100000')
            )
            // v3.9.33: field "penjual" DIHAPUS dari modal — penjual dipilih
            // lewat dropdown member (mm_pick_seller) setelah modal di-submit,
            // biar user gak perlu mention/copy user ID.
        );
    return interaction.showModal(modal);
}

// ====================================================
// === BUAT DEAL — 2 LANGKAH (v3.9.33) ===
// ===  Langkah 1 (modal)   : item + harga           ===
// ===  Langkah 2 (dropdown): pilih penjual          ===
// ====================================================
// Dropdown (User Select Menu) = daftar member bawaan Discord yang punya kolom
// pencarian + avatar + nama — user cukup KETIK nama/username, TIDAK perlu
// tahu cara mention atau copy user ID. Nama/username tersusah pun ketemu
// lewat search box. Data langkah 1 disimpan sementara (in-memory) sampai
// penjual dipilih.

// TTL 15 menit — sejajar dengan umur pesan ephemeral & token interaction.
const PENDING_TTL_MS = 15 * 60 * 1000;
// key: `${guildId}:${userId}` → { item, priceNum, ts }
const pendingDeals = new Map();

function setPendingDeal(guildId, userId, data) {
    // Prune entry kadaluarsa supaya Map tidak tumbuh tanpa batas.
    const now = Date.now();
    for (const [key, val] of pendingDeals) {
        if (now - val.ts > PENDING_TTL_MS) pendingDeals.delete(key);
    }
    pendingDeals.set(`${guildId}:${userId}`, { item: data.item, priceNum: data.priceNum, ts: now });
}

function getPendingDeal(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const pending = pendingDeals.get(key);
    if (!pending) return null;
    if (Date.now() - pending.ts > PENDING_TTL_MS) {
        pendingDeals.delete(key);
        return null;
    }
    return pending;
}

/**
 * Langkah 1 — submit modal (item + harga): validasi input, cek deal/tiket
 * aktif secara fail-fast, simpan sementara, lalu tampilkan dropdown pilih
 * penjual (ephemeral). Channel deal BELUM dibuat di langkah ini.
 */
async function handleCreateDeal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = getConfig();
    const guild = interaction.guild;
    const buyer = interaction.user;

    // Validasi config
    if (!config.roles.admin) {
        return safeEditReply(interaction, { content: '❌ Role Admin belum di-set. Pakai `/set-role admin @role` dulu.' });
    }
    if (!config.roles.midman) {
        return safeEditReply(interaction, { content: '❌ Role Midman belum di-set. Pakai `/set-role midman @role` dulu.' });
    }

    // Validasi input modal
    const item = (interaction.fields.getTextInputValue('mm_field_item') || '').trim();
    const priceRaw = (interaction.fields.getTextInputValue('mm_field_price') || '').trim();

    if (item.length < 3) {
        return safeEditReply(interaction, { content: '❌ Nama item minimal 3 karakter.' });
    }
    const priceNum = mm.parsePriceNumber(priceRaw);
    if (priceNum <= 0) {
        return safeEditReply(interaction, { content: '❌ Harga tidak valid. Contoh: `100000`, `100.000`, atau `100k`.' });
    }

    // Fail-fast SEBELUM minta user pilih penjual — jangan suruh orang capek
    // memilih dulu baru ditolak. (Re-check lengkap tetap dilakukan di langkah 2.)
    if (mm.hasActiveDealFor(guild.id, buyer.id)) {
        return safeEditReply(interaction, {
            content: '❌ Kamu masih punya deal rekber **aktif**. Selesaikan dulu sebelum buat deal baru.'
        });
    }
    const activeTicket = await findActiveTicketFor(guild, buyer.id);
    if (activeTicket) {
        return safeEditReply(interaction, {
            content: `❌ Kamu sudah punya tiket aktif di ${activeTicket}. Tutup dulu sebelum buat deal rekber.`
        });
    }

    setPendingDeal(guild.id, buyer.id, { item, priceNum });

    const sellerSelect = new UserSelectMenuBuilder()
        .setCustomId('mm_pick_seller')
        .setPlaceholder('🔍 Ketik nama penjual di sini…')
        .setMinValues(1)
        .setMaxValues(1);

    return safeEditReply(interaction, {
        content:
            `🧾 Item: **${item}**\n💰 Harga: **${mm.formatRupiah(priceNum)}**\n\n` +
            '👉 **Pilih penjual** lewat daftar member di bawah — cukup **ketik namanya di kolom pencarian** (tidak perlu mention atau copy user ID).\n' +
            '⏳ Berlaku 15 menit — kalau pesan ini hilang, klik tombol 🤝 Rekber lagi.',
        components: [new ActionRowBuilder().addComponents(sellerSelect)]
    });
}

/**
 * Langkah 2 — penjual dipilih dari dropdown member: validasi penjual,
 * re-check deal/tiket aktif (keadaan bisa berubah sejak modal langkah 1),
 * buat channel 3-pihak → kirim Deal Board → simpan deals.json.
 */
async function handlePickSeller(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = getConfig();
    const guild = interaction.guild;
    const buyer = interaction.user;

    const pending = getPendingDeal(guild.id, buyer.id);
    if (!pending) {
        return safeEditReply(interaction, {
            content: '❌ Sesi pembuatan deal kedaluwarsa / tidak ditemukan. Klik tombol 🤝 Rekber di panel lagi.'
        });
    }

    const sellerId = interaction.values && interaction.values[0];
    if (!sellerId) {
        return safeEditReply(interaction, { content: '❌ Penjual tidak terpilih. Coba pilih lagi dari daftar.' });
    }
    if (sellerId === buyer.id) {
        return safeEditReply(interaction, { content: '❌ Kamu tidak bisa jadi penjual di deal-mu sendiri.' });
    }

    const item = pending.item;
    const priceNum = pending.priceNum;

    // Resolve penjual harus benar-benar ada di server (prioritas data
    // resolved dari select menu, fallback ke cache → fetch — pola lama).
    let sellerMember = interaction.members?.get(sellerId) || guild.members.cache.get(sellerId);
    if (!sellerMember) sellerMember = await guild.members.fetch(sellerId).catch(() => null);
    if (!sellerMember) {
        return safeEditReply(interaction, { content: '❌ Penjual tidak ditemukan di server ini.' });
    }
    if (sellerMember.user?.bot) {
        return safeEditReply(interaction, { content: '❌ Penjual tidak boleh bot.' });
    }

    // Anti-jebol (re-check — keadaan bisa berubah sejak modal langkah 1):
    // buyer & seller tidak boleh terlibat deal lain yang masih aktif.
    if (mm.hasActiveDealFor(guild.id, buyer.id)) {
        return safeEditReply(interaction, {
            content: '❌ Kamu masih punya deal rekber **aktif**. Selesaikan dulu sebelum buat deal baru.'
        });
    }
    if (mm.hasActiveDealFor(guild.id, sellerId)) {
        return safeEditReply(interaction, {
            content: `❌ <@${sellerId}> masih punya deal rekber aktif. Selesaikan dulu deal-nya.`
        });
    }
    // Buyer tidak boleh punya tiket reguler aktif bersamaan (kebijakan 1 channel
    // aktif per user — konsisten dengan createTicket).
    const activeTicket = await findActiveTicketFor(guild, buyer.id);
    if (activeTicket) {
        return safeEditReply(interaction, {
            content: `❌ Kamu sudah punya tiket aktif di ${activeTicket}. Tutup dulu sebelum buat deal rekber.`
        });
    }

    // Kategori channel deal (pola v3.9.16 ticketManager: find → create → error jelas)
    const categoryName = config.midman?.category || '🤝 REKBER';
    let category = guild.channels.cache.find(
        c => c.name === categoryName && c.type === ChannelType.GuildCategory
    );
    if (!category) {
        try {
            category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory });
            console.log(`📁 Kategori rekber dibuat: ${categoryName}`);
        } catch (catErr) {
            console.error(`Gagal buat kategori ${categoryName}:`, catErr.message);
            return safeEditReply(interaction, {
                content: `❌ Gagal buat kategori "${categoryName}". Cek permission Manage Channels bot.`
            });
        }
    }

    // Fee dihitung dari config — TIDAK dari ketikan manual (anti manipulasi).
    // v3.9.33: fee DITAMBAH di atas harga (pembeli bayar harga+fee, penjual
    // menerima harga PENUH). Mode+nilai di-snapshot ke deal supaya Deal Board
    // & riwayat deal TIDAK berubah walau admin ubah config di tengah jalan.
    const feeMode = config.midman?.feeMode || 'percent';
    const feeValue = config.midman?.feeValue !== undefined ? config.midman.feeValue : 5;
    const fee = mm.calcFee(priceNum, feeMode, feeValue);

    const deal = {
        channelId: null, // di-set setelah channel dibuat
        guildId: guild.id,
        buyerId: buyer.id,
        sellerId,
        item,
        priceNum,
        priceText: mm.formatRupiah(priceNum),
        fee,
        // v3.9.33: snapshot fee saat deal dibuat (tampilan board & konsistensi
        // riwayat — config berubah tidak mengubah deal berjalan).
        feeMode,
        feeValue,
        state: 'WAITING_SELLER',
        boardMessageId: null,
        createdBy: buyer.id,
        createdAt: Date.now(),
        history: []
    };

    const channelName = `rekber-${buyer.id}`.toLowerCase().slice(0, 50);
    let dealChannel;
    try {
        dealChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: `Deal Rekber | Buyer: ${buyer.id} | Seller: ${sellerId} | Item: ${item}`.slice(0, 1024),
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                {
                    id: buyer.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles
                    ]
                },
                {
                    id: sellerId,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles
                    ]
                },
                {
                    // Semua anggota role midman bisa lihat & handle deal (pola role
                    // admin di tiket). Siapa yang KLIK tercatat di history deal.
                    id: config.roles.midman,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.ManageMessages
                    ]
                },
                {
                    id: config.roles.admin,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageMessages
                    ]
                },
                {
                    id: guild.client.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.EmbedLinks,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageChannels
                    ]
                }
            ]
        });
    } catch (chErr) {
        console.error('Gagal buat channel deal:', chErr);
        return safeEditReply(interaction, { content: '❌ Gagal membuat channel deal. Cek izin bot!' });
    }

    deal.channelId = dealChannel.id;

    // Kirim Deal Board (sumber kebenaran) + simpan meta
    let board;
    try {
        board = await dealChannel.send({
            content: boardPing(deal, config),
            embeds: [boardEmbed(deal, config)],
            components: boardComponents(deal)
        });
    } catch (sendErr) {
        console.error('Gagal kirim Deal Board:', sendErr);
        await dealChannel.delete().catch(() => {});
        return safeEditReply(interaction, { content: '❌ Gagal mengirim Deal Board. Cek izin bot!' });
    }

    deal.boardMessageId = board.id;
    mm.setDeal(dealChannel.id, deal);

    await logAudit(interaction.client, {
        action: 'MIDMAN_CREATE',
        actorId: buyer.id,
        actorTag: buyer.tag,
        details: `Deal rekber dibuat — Item: **${item}** • Harga: ${mm.formatRupiah(priceNum)} • Fee: ${mm.formatRupiah(fee)} • Total dibayar pembeli: ${mm.formatRupiah(priceNum + fee)} • Penjual: <@${sellerId}>`,
        guildId: guild.id
    });

    // Deal resmi dibuat → data sementara langkah 1 tidak diperlukan lagi.
    pendingDeals.delete(`${guild.id}:${buyer.id}`);

    return safeEditReply(interaction, {
        content: `✅ Deal rekber dibuat dengan penjual <@${sellerId}>: ${dealChannel}\n🏷️ Penjual tinggal klik **🤝 Setuju Deal** di Deal Board.`
    });
}

// ====================================================
// === FINALISASI (terminal state) ===
// ====================================================

/**
 * Selesaikan deal: ringkasan riwayat (pesan biasa → ikut ke transcript),
 * transcript, invoice + stats (hanya COMPLETED), hapus channel + meta.
 *
 * Pola closeTicket v3.9.31: meta deals.json hanya dihapus kalau channel
 * BENAR-BENAR sudah tidak ada — jangan tinggalkan channel orphan tanpa meta
 * (kalau delete gagal, admin bisa resolve lagi nanti).
 */
async function finalizeDeal(channel, deal, closer, endState, config) {
    // 1. Ringkasan riwayat — dikirim sebagai pesan biasa supaya ikut
    //    ke-capture saveTranscript (bukti audit "siapa klik apa kapan").
    try {
        const histLines = (deal.history || [])
            .map(
                h =>
                    `• [${new Date(h.ts).toLocaleString('id-ID')}] **${h.event}** oleh <@${h.actorId}> (${h.actorTag}) → ${mm.STATES[h.toState]?.label || h.toState}`
            )
            .join('\n');
        await channel.send({
            content: `📋 **RIWAYAT DEAL**\n${histLines.slice(0, 1800)}\n\n📍 Status akhir: **${mm.STATES[endState]?.label || endState}**`
        });
    } catch (_) {}

    // 2. Transcript (kalau channel transcript di-set via /set-channel tipe:transcript)
    if (config.channels?.transcript) {
        try {
            await saveTranscript(
                channel,
                {
                    userId: deal.buyerId,
                    productName: `🤝 Rekber: ${deal.item}`,
                    // v3.9.33: rincian fee additive ikut terekam di transcript.
                    price: `${mm.formatRupiah(deal.priceNum + deal.fee)} (harga ${mm.formatRupiah(
                        deal.priceNum
                    )} + fee ${mm.formatRupiah(deal.fee)})`,
                    category: 'midman'
                },
                closer,
                endState === 'COMPLETED'
            );
        } catch (transcriptErr) {
            console.warn(`⚠️ Gagal save transcript deal ${deal.channelId}:`, transcriptErr.message);
        }
    }

    // 3. Invoice + stats — hanya deal COMPLETED (uang cair ke penjual).
    //    v3.9.33: yang dicatat = pengeluaran NYATA pembeli (harga + fee).
    if (endState === 'COMPLETED') {
        try {
            await sendInvoice(
                channel,
                deal.buyerId,
                `🤝 Rekber: ${deal.item}`,
                mm.formatRupiah(deal.priceNum + deal.fee),
                closer
            );
        } catch (invoiceErr) {
            console.warn(`⚠️ Gagal kirim invoice deal ${deal.channelId}:`, invoiceErr.message);
        }
        try {
            recordPurchase(deal.guildId, deal.buyerId, deal.priceNum + deal.fee);
        } catch (statsErr) {
            console.warn('⚠️ Gagal record purchase stats:', statsErr.message);
        }
    }

    // 4. Hapus channel — kasih jeda supaya peserta sempat baca ringkasan.
    await new Promise(resolve => setTimeout(resolve, DELETE_DELAY_MS));
    let channelGone = false;
    try {
        await channel.delete();
        channelGone = true;
    } catch (deleteErr) {
        if (deleteErr.code === 10003) {
            channelGone = true; // Unknown Channel — sudah dihapus pihak lain
        } else {
            console.warn(`⚠️ Gagal hapus channel deal ${deal.channelId}:`, deleteErr.message);
        }
    }
    if (channelGone) {
        mm.removeDeal(deal.channelId);
    }
}

// ====================================================
// === HANDLE EVENT (transisi state via tombol) ===
// ====================================================

/**
 * Inti state machine: satu pintu untuk SEMUA tombol transisi.
 * Guard berlapis: channel valid → deal ada → tidak sedang diproses (lock) →
 * transisi valid (urutan) → aktor berhak (peran). Aksi ilegal ditolak bot
 * dengan pesan jelas — bukan cuma larangan tertulis.
 */
async function handleEvent(interaction, event) {
    const config = getConfig();
    const channel = interaction.channel;

    if (!channel) {
        return interaction
            .reply({ content: '❌ Channel tidak tersedia (mungkin sudah dihapus).', flags: MessageFlags.Ephemeral })
            .catch(() => {});
    }

    const deal = mm.getDeal(channel.id);
    if (!deal) {
        return interaction
            .reply({ content: '❌ Channel ini bukan channel deal rekber.', flags: MessageFlags.Ephemeral })
            .catch(() => {});
    }
    if (mm.transitionLocks.has(channel.id)) {
        return interaction
            .reply({ content: '⏳ Deal sedang diproses, tunggu sebentar...', flags: MessageFlags.Ephemeral })
            .catch(() => {});
    }

    // Guard 1: urutan langkah — state harus mengizinkan event ini.
    // (Menangkap klik tombol stale: user klik tombol lama di client yang
    // belum ter-update setelah state berubah.)
    const next = mm.nextState(deal.state, event);
    if (!next) {
        return interaction
            .reply({
                content: `❌ Aksi ini tidak bisa dilakukan sekarang.\n📍 Status deal: **${mm.STATES[deal.state]?.label || deal.state}**.`,
                flags: MessageFlags.Ephemeral
            })
            .catch(() => {});
    }

    // Guard 2: peran — hanya pihak yang berhak.
    const actor = resolveActor(deal, interaction, config);
    if (!mm.actorAllowed(event, actor)) {
        return interaction
            .reply({ content: ACTOR_HINT[event] || '❌ Kamu tidak berhak melakukan aksi ini.', flags: MessageFlags.Ephemeral })
            .catch(() => {});
    }

    mm.transitionLocks.add(channel.id);
    try {
        // Terapkan transisi + catat history.
        if (!mm.recordTransition(deal, event, interaction.user)) {
            return interaction
                .reply({ content: '❌ Transisi gagal (state berubah barusan). Coba lagi.', flags: MessageFlags.Ephemeral })
                .catch(() => {});
        }
        mm.setDeal(channel.id, deal);

        // Efek samping per event — pengumuman di channel (ikut transcript).
        try {
            if (event === 'fundin') {
                await channel.send(
                    `💰 Dana **${mm.formatRupiah(deal.priceNum + deal.fee)}** (harga + fee) dikonfirmasi masuk oleh **${interaction.user.tag}**.\n🏷️ <@${deal.sellerId}>, silakan kirim barang. Chat di channel ini menjadi bukti pengiriman.`
                );
            }
            if (event === 'release') {
                await channel.send(
                    `💸 **${interaction.user.tag}** mencairkan **${mm.formatRupiah(deal.priceNum)}** ke <@${deal.sellerId}> (penuh, tanpa potongan).\n🧾 Fee midman **${mm.formatRupiah(deal.fee)}** tetap milik midman.`
                );
            }
            if (event === 'received') {
                await channel.send(`✅ <@${deal.buyerId}> mengonfirmasi barang **diterima & sesuai**.`);
            }
            if (event === 'dispute') {
                await channel.send(
                    `🚨 <@&${config.roles.admin}> — **DISPUTE** dibuka oleh **${interaction.user.tag}**.\n` +
                        'Semua proses deal **dibekukan** sampai admin resolve (cairkan / refund). Jangan kirim barang/dana lagi.'
                );
            }
        } catch (announceErr) {
            console.warn('⚠️ Gagal kirim pengumuman deal:', announceErr.message);
        }

        // Update Deal Board (embed sumber kebenaran).
        await refreshBoard(channel, deal, config);

        // Konfirmasi ke pelaku (ephemeral).
        await interaction
            .reply({ content: CONFIRM_MSG[event] || '✅ Berhasil.', flags: MessageFlags.Ephemeral })
            .catch(() => {});

        // Audit log — semua klik tercatat.
        await logAudit(interaction.client, {
            action: `MIDMAN_${event.toUpperCase()}`,
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Deal <#${deal.channelId}> (${deal.item} — ${mm.formatRupiah(deal.priceNum)}) → ${mm.STATES[deal.state]?.label || deal.state}`,
            guildId: deal.guildId
        }).catch(() => {});

        // Terminal state → finalisasi (transcript, invoice, close channel).
        if (mm.TERMINAL_STATES.has(deal.state)) {
            await finalizeDeal(channel, deal, interaction.user, deal.state, config);
        }
    } catch (err) {
        console.error(`[midman] Error event ${event}:`, err);
        await interaction
            .reply({ content: '❌ Terjadi error saat memproses aksi. Coba lagi.', flags: MessageFlags.Ephemeral })
            .catch(() => {});
    } finally {
        mm.transitionLocks.delete(channel.id);
    }
}

// ====================================================
// === DOMAIN HANDLER ENTRY (dipanggil router) ===
// ====================================================

module.exports = async function midmanDomain(interaction) {
    // Panel tiket → tombol kategori midman → buka modal buat deal.
    if (interaction.isButton() && interaction.customId === 'ticket_cat:midman') {
        return openCreateModal(interaction);
    }

    // Submit modal buat deal (langkah 1: item + harga).
    if (interaction.isModalSubmit() && interaction.customId === 'modal_mm_create') {
        return handleCreateDeal(interaction);
    }

    // Pilih penjual dari dropdown member (langkah 2: user select menu —
    // searchable, tanpa perlu copy ID).
    if (interaction.isUserSelectMenu() && interaction.customId === 'mm_pick_seller') {
        return handlePickSeller(interaction);
    }

    // Semua tombol transisi state.
    if (interaction.isButton()) {
        const eventMap = {
            mm_join: 'join',
            mm_cancel: 'cancel',
            mm_fundin: 'fundin',
            mm_received: 'received',
            mm_release: 'release',
            mm_dispute: 'dispute',
            mm_resolve_release: 'resolve_release',
            mm_resolve_refund: 'resolve_refund'
        };
        const event = eventMap[interaction.customId];
        if (event) return handleEvent(interaction, event);
    }

    // Fallback: customId mm_* yang belum ter-handle (defensive observability).
    console.warn(`[midman] customId tidak dikenali: ${interaction.customId}`);
};

// Dipakai ticket.js saat user pilih kategori "midman" via dropdown panel
// (ticket_cat_select mengirim value kategori, router tidak bisa intercept).
module.exports.openCreateModal = openCreateModal;

