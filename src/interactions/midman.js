/**
 * Midman (Rekber) domain handler — semua customId terkait deal rekber 3-pihak.
 * v3.9.34.
 *
 * CustomId yang ditangani:
 *   - ticket_cat:midman  (button)       → buka modal buat deal (dari panel tiket)
 *   - modal_mm_create    (modal)        → validasi item+harga → simpan sementara
 *                                        → tampilkan dropdown pilih PEMBELI
 *   - mm_pick_buyer      (user select)  → pilih pembeli (v3.9.34 — deal bisa
 *                                        dibuka siapa saja, jadi peran
 *                                        eksplisit dipilih di formulir)
 *   - mm_pick_seller     (user select)  → pilih penjual → buat channel deal
 *                                        + Deal Board (keduanya searchable —
 *                                        TIDAK perlu copy ID / mention)
 *   - mm_add_member      (button)       → midman/admin: tambah member tambahan
 *                                        (observer) ke channel deal
 *   - mm_pick_member     (user select)  → pilih user yang mau di-add
 *   - mm_remove_member   (button)       → midman/admin: keluarkan member
 *                                        tambahan dari channel deal
 *   - mm_remove_pick     (string select)→ pilih observer yang mau dikeluarkan
 *   - mm_join            (button)  → pembeli & penjual setuju deal — terms
 *                                   terkunci HANYA setelah DUA-DUANYA setuju
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
    UserSelectMenuBuilder,
    // v3.9.34: dropdown pilih member tambahan yang mau dikeluarkan
    // (string select — opsinya observer saat ini).
    StringSelectMenuBuilder
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
    // v3.9.34: persetujuan DUA pihak — deskripsi dinamis menunjukkan siapa
    // yang sudah/belum setuju, jadi Deal Board selalu jelas giliran siapa.
    WAITING_AGREE: deal =>
        `🛒 Pembeli — ${deal.buyerAgreed ? '✅ sudah setuju' : '⏳ **klik 🤝 Setuju Deal**'}\n` +
        `🏷️ Penjual — ${deal.sellerAgreed ? '✅ sudah setuju' : '⏳ **klik 🤝 Setuju Deal**'}\n` +
        'Dua-duanya harus setuju — setelah itu item & harga **TERKUNCI** (mau ubah = batal & buat deal baru).\n' +
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
            // v3.9.34: member tambahan (observer) — siapa pun di channel
            // langsung tahu siapa tamu, dan admin tahu siapa yang bisa
            // dikeluarkan lewat tombol ➖.
            {
                name: '👀 Member Tambahan',
                value:
                    deal.observers && deal.observers.length > 0
                        ? deal.observers.map(id => `<@${id}>`).join(', ').slice(0, 1000)
                        : '—',
                inline: false
            },
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
        case 'WAITING_AGREE':
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
    if (mm.TERMINAL_STATES.has(deal.state)) return [];

    // v3.9.34: baris ke-2 — kelola member tambahan (add/remove observer).
    // Tombol terlihat semua orang, tapi guard aktor (midman/admin) dijalankan
    // saat diklik — pembeli/penjual/observer ditolak dengan pesan jelas.
    const rows = [];
    if (buttons.length > 0) {
        rows.push(new ActionRowBuilder().addComponents(...buttons));
    }
    rows.push(
        new ActionRowBuilder().addComponents(
            mkButton('mm_add_member', 'Tambah Member', '👥', ButtonStyle.Secondary),
            mkButton('mm_remove_member', 'Keluarkan Member', '➖', ButtonStyle.Secondary)
        )
    );
    return rows;
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
    join: '❌ Hanya **pembeli** atau **penjual** deal yang bisa menyetujui deal.',
    cancel: '❌ Deal hanya bisa dibatalkan oleh pembeli, penjual, atau admin — dan hanya sebelum dana masuk.',
    fundin: '❌ Hanya **midman** yang bisa konfirmasi dana masuk.',
    received: '❌ Hanya **pembeli** yang bisa konfirmasi barang diterima.',
    release: '❌ Hanya **midman** yang bisa mencairkan dana.',
    dispute: '❌ Hanya peserta deal (pembeli / penjual / midman) yang bisa membuka dispute.',
    resolve_release: '❌ Hanya **admin server** yang bisa resolve dispute.',
    resolve_refund: '❌ Hanya **admin server** yang bisa resolve dispute.'
};

const CONFIRM_MSG = {
    join: '✅ Kedua pihak sudah setuju — terms **terkunci**. Pembeli silakan transfer ke midman.',
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
// === BUAT DEAL — FORMULIR 3 LANGKAH (v3.9.34) ===
// ===  Langkah 1 (modal)   : item + harga           ===
// ===  Langkah 2 (dropdown): pilih PEMBELI          ===
// ===  Langkah 3 (dropdown): pilih PENJUAL          ===
// ====================================================
// Deal bisa dibuka SIAPA SAJA — pembeli, penjual, atau pihak yang menolong
// (mis. midman/staff). Yang penting formulir jelas: item, harga, siapa
// pembeli, siapa penjual — peran tidak lagi ditebak dari siapa yang klik
// tombol. Karena creator bisa siapa saja, terms terkunci HANYA setelah
// pembeli & penjual DUA-DUANYA klik Setuju Deal (state WAITING_AGREE).
//
// Dropdown (User Select Menu) = daftar member bawaan Discord yang punya kolom
// pencarian + avatar + nama — user cukup KETIK nama/username, TIDAK perlu
// tahu cara mention atau copy user ID. Data langkah 1+2 disimpan sementara
// (in-memory) sampai penjual dipilih.

// TTL 15 menit — sejajar dengan umur pesan ephemeral & token interaction.
const PENDING_TTL_MS = 15 * 60 * 1000;
// key: `${guildId}:${userId}` → { item, priceNum, buyerId, ts }
const pendingDeals = new Map();

function setPendingDeal(guildId, userId, data) {
    // Prune entry kadaluarsa supaya Map tidak tumbuh tanpa batas.
    const now = Date.now();
    for (const [key, val] of pendingDeals) {
        if (now - val.ts > PENDING_TTL_MS) pendingDeals.delete(key);
    }
    pendingDeals.set(`${guildId}:${userId}`, {
        item: data.item,
        priceNum: data.priceNum,
        // v3.9.34: pembeli dipilih di langkah 2 (null sampai dipilih).
        buyerId: data.buyerId || null,
        ts: now
    });
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

/** Dropdown langkah 2 — pilih pembeli (re-renderable saat validasi gagal). */
function buyerSelectRow() {
    return [
        new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId('mm_pick_buyer')
                .setPlaceholder('🔍 Ketik nama PEMBELI di sini…')
                .setMinValues(1)
                .setMaxValues(1)
        )
    ];
}

/** Dropdown langkah 3 — pilih penjual (re-renderable saat validasi gagal). */
function sellerSelectRow() {
    return [
        new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId('mm_pick_seller')
                .setPlaceholder('🔍 Ketik nama PENJUAL di sini…')
                .setMinValues(1)
                .setMaxValues(1)
        )
    ];
}

/** Dropdown tambah member tambahan — pilih user (re-renderable). */
function memberSelectRow() {
    return [
        new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId('mm_pick_member')
                .setPlaceholder('🔍 Ketik nama member yang mau ditambah…')
                .setMinValues(1)
                .setMaxValues(1)
        )
    ];
}

/** Ringkasan item+harga untuk header pesan ephemeral tiap langkah. */
function pendingSummary(pending) {
    const buyerPart = pending.buyerId ? `\n🛒 Pembeli: **<@${pending.buyerId}>**` : '';
    return `🧾 Item: **${pending.item}** • 💰 Harga: **${mm.formatRupiah(pending.priceNum)}**${buyerPart}`;
}

/**
 * Langkah 1 — submit modal (item + harga): validasi input & config, simpan
 * sementara, lalu tampilkan dropdown pilih PEMBELI (ephemeral). Channel deal
 * BELUM dibuat di langkah ini.
 *
 * v3.9.34: creator bisa siapa saja — cek "user punya deal/tiket aktif"
 * TIDAK lagi dijalankan pada creator, tapi pada pembeli & penjual saat
 * mereka dipilih (langkah 2 & 3). Creator pihak ketiga (mis. midman yang
 * menolong) tetap boleh membuat deal untuk orang lain.
 */
async function handleCreateDeal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = getConfig();
    const guild = interaction.guild;
    const creator = interaction.user;

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

    setPendingDeal(guild.id, creator.id, { item, priceNum });

    return safeEditReply(interaction, {
        content:
            `${pendingSummary({ item, priceNum })}\n\n` +
            '👉 **Langkah 2/3 — pilih 🛒 PEMBELI** lewat daftar member di bawah — cukup **ketik namanya di kolom pencarian** (tidak perlu mention atau copy user ID).\n' +
            '⏳ Berlaku 15 menit — kalau pesan ini hilang, klik tombol 🤝 Rekber lagi.',
        components: buyerSelectRow()
    });
}

/**
 * Langkah 2 — pembeli dipilih dari dropdown member (v3.9.34): validasi
 * pembeli (ada di server, bukan bot, tidak sedang pegang deal/tiket aktif),
 * simpan ke pending, lalu tampilkan dropdown pilih penjual.
 *
 * Validasi gagal → pesan error + dropdown DIRENDER LAGI di pesan yang sama
 * (user tidak perlu isi ulang modal).
 */
async function handlePickBuyer(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    const creator = interaction.user;

    const pending = getPendingDeal(guild.id, creator.id);
    if (!pending) {
        return safeEditReply(interaction, {
            content: '❌ Sesi pembuatan deal kedaluwarsa / tidak ditemukan. Klik tombol 🤝 Rekber di panel lagi.'
        });
    }

    const buyerId = interaction.values && interaction.values[0];
    if (!buyerId) {
        return safeEditReply(interaction, { content: '❌ Pembeli tidak terpilih. Coba pilih lagi.', components: buyerSelectRow() });
    }

    // Resolve pembeli harus benar-benar ada di server.
    let buyerMember = interaction.members?.get(buyerId) || guild.members.cache.get(buyerId);
    if (!buyerMember) buyerMember = await guild.members.fetch(buyerId).catch(() => null);
    if (!buyerMember) {
        return safeEditReply(interaction, {
            content: '❌ Pembeli tidak ditemukan di server ini. Pilih lagi:',
            components: buyerSelectRow()
        });
    }
    if (buyerMember.user?.bot) {
        return safeEditReply(interaction, {
            content: '❌ Pembeli tidak boleh bot. Pilih lagi:',
            components: buyerSelectRow()
        });
    }

    // Pembeli tidak boleh terlibat deal lain yang masih aktif.
    if (mm.hasActiveDealFor(guild.id, buyerId)) {
        return safeEditReply(interaction, {
            content: `❌ <@${buyerId}> masih punya deal rekber **aktif**. Selesaikan dulu sebelum buat deal baru. Pilih pembeli lain:`,
            components: buyerSelectRow()
        });
    }
    // Pembeli tidak boleh punya tiket reguler aktif bersamaan (kebijakan
    // 1 channel aktif per user — konsisten dengan createTicket).
    const activeTicket = await findActiveTicketFor(guild, buyerId);
    if (activeTicket) {
        return safeEditReply(interaction, {
            content: `❌ <@${buyerId}> masih punya tiket aktif di ${activeTicket}. Tutup dulu sebelum buat deal rekber. Pilih pembeli lain:`,
            components: buyerSelectRow()
        });
    }

    // Simpan pembeli ke sesi pending (item & harga tetap dibawa).
    setPendingDeal(guild.id, creator.id, { item: pending.item, priceNum: pending.priceNum, buyerId });

    return safeEditReply(interaction, {
        content:
            `${pendingSummary({ item: pending.item, priceNum: pending.priceNum, buyerId })}\n\n` +
            '👉 **Langkah 3/3 — pilih 🏷️ PENJUAL** — ketik namanya di kolom pencarian.\n' +
            '⏳ Berlaku 15 menit — kalau pesan ini hilang, klik tombol 🤝 Rekber lagi.',
        components: sellerSelectRow()
    });
}

/**
 * Langkah 3 — penjual dipilih dari dropdown member: validasi penjual,
 * re-check pembeli & penjual (keadaan bisa berubah sejak langkah 1-2),
 * buat channel 3-pihak → kirim Deal Board → simpan deals.json.
 */
async function handlePickSeller(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = getConfig();
    const guild = interaction.guild;
    const creator = interaction.user;

    const pending = getPendingDeal(guild.id, creator.id);
    if (!pending) {
        return safeEditReply(interaction, {
            content: '❌ Sesi pembuatan deal kedaluwarsa / tidak ditemukan. Klik tombol 🤝 Rekber di panel lagi.'
        });
    }
    // v3.9.34: pembeli wajib sudah dipilih di langkah 2 — kalau belum,
    // sesi ini dari alur lama / tidak valid, minta ulang dari awal.
    if (!pending.buyerId) {
        return safeEditReply(interaction, {
            content: '❌ Sesi tidak lengkap (pembeli belum dipilih). Klik tombol 🤝 Rekber di panel lagi.'
        });
    }
    const buyerId = pending.buyerId;

    const sellerId = interaction.values && interaction.values[0];
    if (!sellerId) {
        return safeEditReply(interaction, { content: '❌ Penjual tidak terpilih. Coba pilih lagi dari daftar.', components: sellerSelectRow() });
    }
    if (sellerId === buyerId) {
        return safeEditReply(interaction, {
            content: '❌ Penjual tidak boleh orang yang sama dengan pembeli. Pilih penjual lain:',
            components: sellerSelectRow()
        });
    }

    const item = pending.item;
    const priceNum = pending.priceNum;

    // Resolve penjual harus benar-benar ada di server (prioritas data
    // resolved dari select menu, fallback ke cache → fetch — pola lama).
    let sellerMember = interaction.members?.get(sellerId) || guild.members.cache.get(sellerId);
    if (!sellerMember) sellerMember = await guild.members.fetch(sellerId).catch(() => null);
    if (!sellerMember) {
        return safeEditReply(interaction, {
            content: '❌ Penjual tidak ditemukan di server ini. Pilih lagi:',
            components: sellerSelectRow()
        });
    }
    if (sellerMember.user?.bot) {
        return safeEditReply(interaction, {
            content: '❌ Penjual tidak boleh bot. Pilih lagi:',
            components: sellerSelectRow()
        });
    }

    // Anti-jebol (re-check — keadaan bisa berubah sejak langkah 1-2):
    // pembeli & penjual tidak boleh terlibat deal lain yang masih aktif.
    if (mm.hasActiveDealFor(guild.id, buyerId)) {
        return safeEditReply(interaction, {
            content: `❌ <@${buyerId}> ternyata sudah punya deal rekber **aktif**. Selesaikan dulu deal-nya.`,
        });
    }
    if (mm.hasActiveDealFor(guild.id, sellerId)) {
        return safeEditReply(interaction, {
            content: `❌ <@${sellerId}> masih punya deal rekber aktif. Selesaikan dulu deal-nya. Pilih penjual lain:`,
            components: sellerSelectRow()
        });
    }
    // Pembeli tidak boleh punya tiket reguler aktif bersamaan (kebijakan 1
    // channel aktif per user — konsisten dengan createTicket).
    const activeTicket = await findActiveTicketFor(guild, buyerId);
    if (activeTicket) {
        return safeEditReply(interaction, {
            content: `❌ <@${buyerId}> ternyata sudah punya tiket aktif di ${activeTicket}. Tutup dulu sebelum buat deal rekber.`
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
        // v3.9.34: peran eksplisit dari formulir — siapa pun boleh membuat
        // deal (creator), tapi pembeli/penjual ditentukan pilihan langkah 2-3.
        buyerId,
        sellerId,
        // v3.9.34: persetujuan ganda — terms terkunci hanya setelah pembeli
        // & penjual dua-duanya klik Setuju Deal (state WAITING_AGREE).
        buyerAgreed: false,
        sellerAgreed: false,
        // v3.9.34: member tambahan (observer) — dikelola tombol 👥/➖ di board.
        observers: [],
        item,
        priceNum,
        priceText: mm.formatRupiah(priceNum),
        fee,
        // v3.9.33: snapshot fee saat deal dibuat (tampilan board & konsistensi
        // riwayat — config berubah tidak mengubah deal berjalan).
        feeMode,
        feeValue,
        state: 'WAITING_AGREE',
        boardMessageId: null,
        createdBy: creator.id,
        createdAt: Date.now(),
        history: []
    };

    const channelName = `rekber-${buyerId}`.toLowerCase().slice(0, 50);

    // v3.9.34: overwrites dibangun secara kondisional — creator pihak ketiga
    // (bukan pembeli/penjual, mis. midman/staff yang menolong) tetap dapat
    // akses channel yang dia buat. Kalau creator = pembeli/penjual, overwrite
    // creator dilewati (sudah ada di atas).
    const participantAllow = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
    ];
    const overwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: buyerId, allow: participantAllow },
        { id: sellerId, allow: participantAllow }
    ];
    if (creator.id !== buyerId && creator.id !== sellerId) {
        overwrites.push({ id: creator.id, allow: participantAllow });
    }
    overwrites.push(
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
    );

    let dealChannel;
    try {
        dealChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: `Deal Rekber | Buyer: ${buyerId} | Seller: ${sellerId} | Item: ${item}`.slice(0, 1024),
            permissionOverwrites: overwrites
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
        actorId: creator.id,
        actorTag: creator.tag,
        details:
            `Deal rekber dibuat oleh <@${creator.id}> — Item: **${item}** • Harga: ${mm.formatRupiah(priceNum)} • Fee: ${mm.formatRupiah(fee)} • Total dibayar pembeli: ${mm.formatRupiah(priceNum + fee)} • Pembeli: <@${buyerId}> • Penjual: <@${sellerId}>`,
        guildId: guild.id
    });

    // Deal resmi dibuat → data sementara formulir tidak diperlukan lagi.
    pendingDeals.delete(`${guild.id}:${creator.id}`);

    return safeEditReply(interaction, {
        content:
            `✅ Deal rekber dibuat: 🛒 <@${buyerId}> ⇄ 🏷️ <@${sellerId}> — ${dealChannel}\n` +
            '🤝 **Pembeli & penjual** dua-duanya harus klik **Setuju Deal** di Deal Board untuk mengunci terms.'
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
        // v3.9.34: join = persetujuan PER PRAK. Transisi ke WAITING_PAYMENT
        // hanya terjadi kalau pembeli & penjual DUA-DUANYA sudah setuju —
        // klik pertama tercatat sebagai persetujuan parsial (history +
        // board update + ping pihak yang belum), tanpa menggerakkan state.
        if (event === 'join') {
            const res = mm.applyAgreement(deal, interaction.user.id);
            if (!res.ok) {
                // Guard 2 sudah memastikan aktor = buyer/seller, jadi satu-satunya
                // penyebab gagal: pihak itu SUDAH setuju (double-click / tombol
                // stale di client yang belum ter-update).
                return interaction
                    .reply({
                        content: '✅ Kamu sudah menyetujui deal ini — menunggu pihak lainnya.',
                        flags: MessageFlags.Ephemeral
                    })
                    .catch(() => {});
            }
            if (!res.both) {
                // Persetujuan parsial — catat, update board, ping pihak yang
                // belum setuju. State TIDAK berubah (tetap WAITING_AGREE).
                deal.history = Array.isArray(deal.history) ? deal.history : [];
                deal.history.push({
                    ts: Date.now(),
                    event: `${res.role === 'buyer' ? '🛒 Pembeli' : '🏷️ Penjual'} setuju deal (menunggu pihak lain)`,
                    fromState: deal.state,
                    toState: deal.state,
                    actorId: interaction.user.id,
                    actorTag: interaction.user.tag
                });
                mm.setDeal(channel.id, deal);
                await refreshBoard(channel, deal, config);
                const waitingId = res.role === 'buyer' ? deal.sellerId : deal.buyerId;
                const waitingLabel = res.role === 'buyer' ? '🏷️ Penjual' : '🛒 Pembeli';
                await channel
                    .send(`⏳ ${res.role === 'buyer' ? '🛒 Pembeli' : '🏷️ Penjual'} sudah setuju. ${waitingLabel} <@${waitingId}> — giliranmu klik **🤝 Setuju Deal** supaya terms terkunci.`)
                    .catch(() => {});
                await logAudit(interaction.client, {
                    action: 'MIDMAN_AGREE',
                    actorId: interaction.user.id,
                    actorTag: interaction.user.tag,
                    details: `Deal <#${deal.channelId}> — ${res.role === 'buyer' ? 'pembeli' : 'penjual'} setuju (menunggu pihak lain)`,
                    guildId: deal.guildId
                }).catch(() => {});
                return interaction
                    .reply({
                        content: '✅ Persetujuanmu tercatat — menunggu pihak lainnya menyetujui deal.',
                        flags: MessageFlags.Ephemeral
                    })
                    .catch(() => {});
            }
            // Kedua pihak setuju → lanjut ke recordTransition('join') di bawah
            // (terms terkunci, state → WAITING_PAYMENT).
        }

        // Terapkan transisi + catat history.
        if (!mm.recordTransition(deal, event, interaction.user)) {
            return interaction
                .reply({ content: '❌ Transisi gagal (state berubah barusan). Coba lagi.', flags: MessageFlags.Ephemeral })
                .catch(() => {});
        }
        mm.setDeal(channel.id, deal);

        // Efek samping per event — pengumuman di channel (ikut transcript).
        try {
            if (event === 'join') {
                await channel.send(
                    '🤝 **Pembeli & penjual DUA-DUANYA sudah setuju** — item & harga **TERKUNCI**.\n' +
                        `🛒 <@${deal.buyerId}> — transfer **${mm.formatRupiah(deal.priceNum + deal.fee)}** ke midman, lalu kirim bukti transfer di channel ini.`
                );
            }
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
// === MEMBER TAMBAHAN (observer) v3.9.34 ===
// ====================================================

/**
 * Guard bersama kelola member: deal ada, belum terminal, aktor midman/admin.
 * (resolveActor otomatis menolak buyer/seller deal sebagai "midman/admin" —
 * anti self-dealing; observer tanpa role midman juga ditolak di sini.)
 */
function memberGuard(deal, interaction, config) {
    if (!deal) return '❌ Channel ini bukan channel deal rekber.';
    if (mm.TERMINAL_STATES.has(deal.state)) return '❌ Deal sudah selesai — member tidak bisa diubah.';
    const actor = resolveActor(deal, interaction, config);
    if (!actor.isMidman && !actor.isAdmin) {
        return '❌ Hanya **midman/admin** yang bisa mengelola member tambahan.';
    }
    return null; // lolos guard
}

/**
 * Tombol 👥 Tambah Member (baris 2 Deal Board) → tampilkan dropdown member
 * (searchable). Hanya midman/admin yang bisa sampai sini.
 */
async function showAddMemberSelect(interaction) {
    const config = getConfig();
    const deal = mm.getDeal(interaction.channel?.id);
    const blocked = memberGuard(deal, interaction, config);
    if (blocked) {
        return interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return interaction
        .reply({
            content:
                '👥 **Tambah member ke channel deal ini** — ketik namanya di kolom pencarian.\n' +
                'Member tambahan hanya bisa **melihat & chat** — TIDAK bisa menggerakkan deal (transisi tetap hak pembeli/penjual/midman/admin).',
            components: memberSelectRow(),
            flags: MessageFlags.Ephemeral
        })
        .catch(() => {});
}

/**
 * Submit dropdown mm_pick_member: validasi target (ada, bukan bot, bukan
 * peserta, belum ada, tidak penuh) → grant permission channel → catat di
 * history deal + audit log → refresh Deal Board.
 */
async function handlePickMember(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = getConfig();
    const channel = interaction.channel;
    const guild = interaction.guild;

    const deal = mm.getDeal(channel?.id);
    const blocked = memberGuard(deal, interaction, config);
    if (blocked) {
        return safeEditReply(interaction, { content: blocked });
    }

    const userId = interaction.values && interaction.values[0];
    if (!userId) {
        return safeEditReply(interaction, { content: '❌ Member tidak terpilih. Coba pilih lagi.', components: memberSelectRow() });
    }

    let member = interaction.members?.get(userId) || guild.members.cache.get(userId);
    if (!member) member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
        return safeEditReply(interaction, {
            content: '❌ User tidak ditemukan di server ini. Pilih lagi:',
            components: memberSelectRow()
        });
    }
    if (member.user?.bot) {
        return safeEditReply(interaction, {
            content: '❌ Bot tidak bisa ditambah sebagai member tambahan. Pilih lagi:',
            components: memberSelectRow()
        });
    }

    const check = mm.canAddObserver(deal, userId);
    if (!check.ok) {
        const hint =
            check.reason === 'principal'
                ? '❌ Dia sudah peserta deal (pembeli/penjual) — tidak perlu ditambah.'
                : check.reason === 'duplicate'
                  ? '❌ Dia sudah jadi member tambahan di deal ini.'
                  : `❌ Maksimal **${mm.MAX_OBSERVERS}** member tambahan per deal.`;
        return safeEditReply(interaction, { content: hint, components: memberSelectRow() });
    }

    // Grant akses channel (lihat + chat + attach + baca history).
    try {
        await channel.permissionOverwrites.edit(userId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true
        });
    } catch (permErr) {
        console.warn(`⚠️ Gagal grant akses member tambahan ${userId}:`, permErr.message);
        return safeEditReply(interaction, { content: '❌ Gagal menambah member. Cek izin bot (Manage Channels).' });
    }

    mm.addObserver(deal, userId);
    deal.history = Array.isArray(deal.history) ? deal.history : [];
    deal.history.push({
        ts: Date.now(),
        event: `👥 Member ditambahkan: <@${userId}>`,
        fromState: deal.state,
        toState: deal.state,
        actorId: interaction.user.id,
        actorTag: interaction.user.tag
    });
    mm.setDeal(channel.id, deal);

    await refreshBoard(channel, deal, config);
    await channel
        .send(`👥 <@${userId}> ditambahkan ke channel deal oleh **${interaction.user.tag}** sebagai **member tambahan** — hanya bisa melihat & chat.`)
        .catch(() => {});
    await logAudit(interaction.client, {
        action: 'MIDMAN_MEMBER_ADD',
        actorId: interaction.user.id,
        actorTag: interaction.user.tag,
        details: `Deal <#${deal.channelId}> — member tambahan ditambahkan: <@${userId}>`,
        guildId: deal.guildId
    }).catch(() => {});

    return safeEditReply(interaction, { content: `✅ <@${userId}> ditambahkan ke channel deal sebagai member tambahan.` });
}

/**
 * Tombol ➖ Keluarkan Member (baris 2 Deal Board) → tampilkan dropdown berisi
 * member tambahan saat ini. Pembeli/penjual TIDAK muncul di daftar (tidak
 * bisa dikeluarkan — urusan mereka lewat batal/dispute).
 */
async function showRemoveMemberSelect(interaction) {
    const config = getConfig();
    const deal = mm.getDeal(interaction.channel?.id);
    const blocked = memberGuard(deal, interaction, config);
    if (blocked) {
        return interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const observers = Array.isArray(deal.observers) ? deal.observers : [];
    if (observers.length === 0) {
        return interaction
            .reply({ content: 'ℹ️ Tidak ada member tambahan di deal ini.', flags: MessageFlags.Ephemeral })
            .catch(() => {});
    }

    const options = observers.slice(0, 25).map(id => {
        const m = interaction.guild?.members?.cache?.get(id);
        const label = m ? (m.displayName || m.user?.username || id) : `Member ${id}`;
        const option = { label: String(label).slice(0, 100), value: id };
        if (!m) option.description = 'sudah keluar server';
        return option;
    });
    const select = new StringSelectMenuBuilder()
        .setCustomId('mm_remove_pick')
        .setPlaceholder('Pilih member yang mau dikeluarkan…')
        .addOptions(options);

    return interaction
        .reply({
            content: '➖ Pilih **member tambahan** yang mau dikeluarkan dari channel deal (pembeli/penjual tidak bisa dikeluarkan):',
            components: [new ActionRowBuilder().addComponents(select)],
            flags: MessageFlags.Ephemeral
        })
        .catch(() => {});
}

/**
 * Submit dropdown mm_remove_pick: defensive re-check (target bukan peserta,
 * memang observer) → hapus overwrite permission → catat history + audit →
 * refresh Deal Board.
 */
async function handleRemovePick(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = getConfig();
    const channel = interaction.channel;

    const deal = mm.getDeal(channel?.id);
    const blocked = memberGuard(deal, interaction, config);
    if (blocked) {
        return safeEditReply(interaction, { content: blocked });
    }

    const userId = interaction.values && interaction.values[0];
    if (!userId) {
        return safeEditReply(interaction, { content: '❌ Member tidak terpilih. Coba lagi.' });
    }
    // Defensive: value dropdown berasal dari daftar observer, tapi guard tetap
    // dijalankan ulang (customId bisa forged / data berubah sejak dropdown
    // dirender).
    if (userId === deal.buyerId || userId === deal.sellerId) {
        return safeEditReply(interaction, {
            content: '❌ Pembeli/penjual tidak bisa dikeluarkan — urusan mereka lewat batal deal / dispute.'
        });
    }
    if (!mm.removeObserver(deal, userId)) {
        return safeEditReply(interaction, { content: '❌ User itu bukan member tambahan di deal ini.' });
    }

    // Hapus overwrite aksesnya (kalau overwrite tidak ada → error diabaikan,
    // meta tetap bersih).
    try {
        await channel.permissionOverwrites.delete(userId);
    } catch (_) {}

    deal.history.push({
        ts: Date.now(),
        event: `👋 Member dikeluarkan: <@${userId}>`,
        fromState: deal.state,
        toState: deal.state,
        actorId: interaction.user.id,
        actorTag: interaction.user.tag
    });
    mm.setDeal(channel.id, deal);

    await refreshBoard(channel, deal, config);
    await channel
        .send(`👋 <@${userId}> dikeluarkan dari channel deal oleh **${interaction.user.tag}**.`)
        .catch(() => {});
    await logAudit(interaction.client, {
        action: 'MIDMAN_MEMBER_REMOVE',
        actorId: interaction.user.id,
        actorTag: interaction.user.tag,
        details: `Deal <#${deal.channelId}> — member tambahan dikeluarkan: <@${userId}>`,
        guildId: deal.guildId
    }).catch(() => {});

    return safeEditReply(interaction, { content: `✅ <@${userId}> dikeluarkan dari channel deal.` });
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

    // Langkah 2: pilih pembeli (user select menu — searchable).
    if (interaction.isUserSelectMenu() && interaction.customId === 'mm_pick_buyer') {
        return handlePickBuyer(interaction);
    }

    // Langkah 3: pilih penjual (user select menu — searchable) → buat deal.
    if (interaction.isUserSelectMenu() && interaction.customId === 'mm_pick_seller') {
        return handlePickSeller(interaction);
    }

    // v3.9.34: kelola member tambahan di dalam channel deal.
    if (interaction.isButton() && interaction.customId === 'mm_add_member') {
        return showAddMemberSelect(interaction);
    }
    if (interaction.isButton() && interaction.customId === 'mm_remove_member') {
        return showRemoveMemberSelect(interaction);
    }
    if (interaction.isUserSelectMenu() && interaction.customId === 'mm_pick_member') {
        return handlePickMember(interaction);
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'mm_remove_pick') {
        return handleRemovePick(interaction);
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

