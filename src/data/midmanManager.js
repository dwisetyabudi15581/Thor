/**
 * Midman (Rekber) Manager — data layer & state machine deal escrow 3-pihak.
 * v3.9.32.
 *
 * File: data/deals.json
 * {
 *   "<channelId>": {
 *     "channelId": "123...",
 *     "guildId":    "123...",
 *     "buyerId":    "123...",   // pembeli (pembuat deal)
 *     "sellerId":   "123...",   // penjual
 *     "item":       "Akun ML Mythic",
 *     "priceNum":   100000,     // harga deal dalam rupiah (number)
 *     "priceText":  "Rp100.000",
 *     "fee":        5000,       // fee midman (dihitung saat deal dibuat)
 *     "feeMode":    "percent",  // v3.9.33: snapshot mode fee saat deal dibuat
 *     "feeValue":   5,          // v3.9.33: snapshot nilai fee saat deal dibuat
 *     "state":      "WAITING_PAYMENT",
 *     "boardMessageId": "123...", // ID pesan Deal Board (embed sumber kebenaran)
 *     "createdBy":  "123...",
 *     "createdAt":  1725...,
 *     "history": [ { ts, event, fromState, toState, actorId, actorTag } ]
 *   }
 * }
 *
 * === PRINSIP INTI ===
 * Rekber = ada ORANG KETIGA yang pegang dana. Mode gagal rekber selalu soal
 * "siapa bilang apa di chat" — chat bisa diedit/dihapus, jadi chat bukan bukti.
 * Solusinya: Deal Board (embed bot) jadi sumber kebenaran, dan SEMUA
 * perpindahan state hanya lewat tombol dengan validasi GANDA:
 *   1. `canTransition(state, event)`  → urutan langkah tidak bisa dilompati.
 *   2. `actorAllowed(event, roles)`   → hanya pihak yang berhak yang bisa klik.
 *
 * Contoh yang OTOMATIS DITOLAK bot:
 *   - Midman klik "Cairkan" saat buyer belum konfirmasi barang  (release dari
 *     WAITING_DELIVERY → invalid).
 *   - Buyer klik "Dana Masuk" menyamar midman                  (aktor salah).
 *   - Semua aksi saat DISPUTE                                  (state dibekukan).
 *
 * Fungsi pure (canTransition, nextState, actorAllowed, calcFee,
 * calcTotals, parsePriceNumber, formatRupiah) mengikuti pola
 * classifyProduct() v3.9.28: di-ekstrak supaya bisa di-unit-test tanpa mock
 * Discord.
 *
 * v3.9.33 revisi fee: fee DITAMBAHKAN DI ATAS harga (additive), TIDAK dipotong
 * dari dana penjual. Contoh: harga 100.000 + fee 5% (5.000) → pembeli
 * transfer 105.000, penjual menerima 100.000 PENUH, midman menyimpan 5.000.
 * Penjual tidak pernah "kehilangan" sebagian harga deal karena fee.
 */

const fs = require('fs');
const path = require('path');
const { safeWriteJSON, quarantineCorruptFile } = require('../infra/safeWrite');

const dealsPath = path.join(__dirname, '..', '..', 'data', 'deals.json');

// ====================================================
// === STATE DEAL ===
// ====================================================
const STATES = {
    WAITING_SELLER: { label: '⏳ Menunggu Penjual Setuju Deal', color: 0xf1c40f },
    WAITING_PAYMENT: { label: '💰 Menunggu Pembayaran ke Midman', color: 0xe67e22 },
    WAITING_DELIVERY: { label: '📦 Menunggu Barang Dikirim Penjual', color: 0x3498db },
    WAITING_RELEASE: { label: '✅ Barang Diterima — Menunggu Pencairan', color: 0x9b59b6 },
    DISPUTE: { label: '🚨 DISPUTE — Deal Dibekukan', color: 0xed4245 },
    // Terminal states (deal selesai — meta dihapus dari deals.json saat close):
    COMPLETED: { label: '✅ Selesai — Dana Cair ke Penjual', color: 0x2ecc71 },
    REFUNDED: { label: '↩️ Selesai — Dana Kembali ke Pembeli', color: 0x95a5a6 },
    CANCELLED: { label: '❌ Dibatalkan (sebelum dana masuk)', color: 0x95a5a6 }
};

const TERMINAL_STATES = new Set(['COMPLETED', 'REFUNDED', 'CANCELLED']);

// ====================================================
// === TABEL TRANSISI — jantung escrow ===
// ====================================================
// Urutan normal: WAITING_SELLER → (seller join) → WAITING_PAYMENT → (midman
// fundin) → WAITING_DELIVERY → (buyer received) → WAITING_RELEASE → (midman
// release) → COMPLETED.
//
// Dua "gerbang ganda" (inti keamanan escrow):
//   - Barang boleh dikirim HANYA setelah midman konfirmasi dana masuk.
//   - Dana boleh dicairkan HANYA setelah pembeli konfirmasi barang diterima.
// Tidak ada satu orang pun yang bisa gerakkan deal sendirian melewati
// gerbang yang bukan otoritasnya.
const TRANSITIONS = {
    join: { from: ['WAITING_SELLER'], to: 'WAITING_PAYMENT', actors: ['seller'] },
    // Cancel hanya sebelum dana masuk — setelah dana di midman, urusan
    // pengembalian dana HARUS lewat dispute + resolve admin (tercatat).
    cancel: { from: ['WAITING_SELLER', 'WAITING_PAYMENT'], to: 'CANCELLED', actors: ['buyer', 'seller', 'admin'] },
    fundin: { from: ['WAITING_PAYMENT'], to: 'WAITING_DELIVERY', actors: ['midman', 'admin'] },
    received: { from: ['WAITING_DELIVERY'], to: 'WAITING_RELEASE', actors: ['buyer'] },
    dispute: { from: ['WAITING_PAYMENT', 'WAITING_DELIVERY', 'WAITING_RELEASE'], to: 'DISPUTE', actors: ['buyer', 'seller', 'midman', 'admin'] },
    release: { from: ['WAITING_RELEASE'], to: 'COMPLETED', actors: ['midman', 'admin'] },
    // Resolve dispute — hanya admin (midman pihak berkepentingan atas fee,
    // jadi keputusan akhir dispute harus di atas midman):
    resolve_release: { from: ['DISPUTE'], to: 'COMPLETED', actors: ['admin'] },
    resolve_refund: { from: ['DISPUTE'], to: 'REFUNDED', actors: ['admin'] }
};

// Lock per-channel: cegah double-click race saat transisi diproses.
const transitionLocks = new Set();

// ====================================================
// === PERSISTENCE (pola ticketManager/keyManager) ===
// ====================================================

function loadDeals() {
    try {
        const raw = fs.readFileSync(dealsPath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.warn('⚠️ deals.json rusak, pakai {}. Pesan:', err.message);
            // v3.9.26 pattern: karantina file korup sebelum lanjut pakai kosong —
            // supaya save berikutnya tidak menimpa data lama tanpa bekas.
            quarantineCorruptFile(dealsPath);
        }
        return {};
    }
}

function saveDeals(all) {
    safeWriteJSON(dealsPath, all);
}

function getDeal(channelId) {
    if (!channelId) return null;
    return loadDeals()[channelId] || null;
}

function setDeal(channelId, deal) {
    if (!channelId || !deal) return;
    const all = loadDeals();
    all[channelId] = deal;
    saveDeals(all);
}

function removeDeal(channelId) {
    if (!channelId) return;
    const all = loadDeals();
    if (all[channelId]) {
        delete all[channelId];
        saveDeals(all);
    }
}

/**
 * User terlibat deal aktif (sebagai buyer ATAU seller) di guild ini?
 *
 * Dipakai ganda:
 *   - createDeal: buyer & seller tidak boleh terlibat 2 deal bersamaan.
 *   - createTicket (ticketManager): user dengan deal aktif tidak bisa buka
 *     tiket reguler lain — cegah bypass alur escrow lewat tiket biasa.
 */
function hasActiveDealFor(guildId, userId) {
    if (!guildId || !userId) return false;
    const all = loadDeals();
    return Object.values(all).some(
        d =>
            d &&
            d.guildId === guildId &&
            !TERMINAL_STATES.has(d.state) &&
            (d.buyerId === userId || d.sellerId === userId)
    );
}

function getActiveDealsByGuild(guildId) {
    const all = loadDeals();
    return Object.values(all).filter(d => d && d.guildId === guildId && !TERMINAL_STATES.has(d.state));
}

// ====================================================
// === PURE FUNCTIONS (testable — pola classifyProduct) ===
// ====================================================

/**
 * Apakah event valid dari state sekarang? (validasi URUTAN langkah)
 */
function canTransition(state, event) {
    const t = TRANSITIONS[event];
    return Boolean(t && state && t.from.includes(state));
}

/**
 * State berikutnya setelah event — null kalau transisi invalid.
 */
function nextState(state, event) {
    return canTransition(state, event) ? TRANSITIONS[event].to : null;
}

// Mapping nama aktor di TRANSITIONS → key object roles.
// TRANSITIONS pakai nama pendek ('buyer'), pemanggil pakai boolean flags
// ({isBuyer}) — mapping ini menyatukan keduanya.
const ACTOR_KEY_MAP = { buyer: 'isBuyer', seller: 'isSeller', midman: 'isMidman', admin: 'isAdmin' };

/**
 * Apakah aktor boleh melakukan event? (validasi PERAN)
 *
 * @param {string} event
 * @param {{isBuyer: boolean, isSeller: boolean, isMidman: boolean, isAdmin: boolean}} roles
 *   Catatan: pemanggil (interactions/midman.js resolveActor) sudah menjamin
 *   isMidman/isAdmin FALSE kalau user adalah buyer/seller deal itu — anti
 *   self-dealing (midman tidak bisa megang deal-nya sendiri sebagai peserta).
 */
function actorAllowed(event, roles) {
    const t = TRANSITIONS[event];
    if (!t || !roles) return false;
    return t.actors.some(a => roles[ACTOR_KEY_MAP[a] || a] === true);
}

/**
 * Hitung fee midman. PURE — tidak baca config (caller yang passes).
 *
 * v3.9.33: fee ADDITIVE — ditambah di atas harga, bukan dipotong dari dana
 * penjual. Karena tidak lagi "memotong" dana siapa pun, fee tidak di-cap
 * sebesar harga deal (fee flat boleh melebihi harga; /set-midman-fee sudah
 * membatasi persen maks 90% sebagai sanity guard di sisi command).
 *
 * @param {number} priceNum - harga deal (rupiah)
 * @param {string} feeMode - 'percent' | 'flat'
 * @param {number} feeValue - persen (mis. 5 = 5%) atau nominal flat
 * @returns {number} fee nominal rupiah
 */
function calcFee(priceNum, feeMode, feeValue) {
    const price = Number(priceNum) || 0;
    if (price <= 0) return 0;
    const val = Number(feeValue) || 0;
    if (val <= 0) return 0;
    if (feeMode === 'percent') {
        return Math.round((price * val) / 100);
    }
    if (feeMode === 'flat') {
        return Math.round(val);
    }
    return 0; // mode tak dikenal → fee 0 (deal tetap jalan, gratis)
}

/**
 * Rincian nominal deal (v3.9.33 — fee additive, sumber tunggal perhitungan):
 *   buyerPays   = price + fee → yang ditransfer pembeli ke midman
 *   sellerGets  = price       → yang diterima penjual (harga PENUH, tanpa potongan)
 *   midmanKeeps = fee         → sisa dana di tangan midman setelah cairkan
 *
 * Contoh: calcTotals(100000, 5000) →
 *   { buyerPays: 105000, sellerGets: 100000, midmanKeeps: 5000 }
 */
function calcTotals(priceNum, fee) {
    // Clamp negatif → 0 (defensive: calcFee tidak pernah return negatif, tapi
    // data lama/manual edit deals.json tidak boleh bikin total jadi minus).
    const price = Math.max(0, Number(priceNum) || 0);
    const feeNum = Math.max(0, Number(fee) || 0);
    return {
        buyerPays: price + feeNum,
        sellerGets: price,
        midmanKeeps: feeNum
    };
}

/**
 * Parse harga dari input modal. Terima: "100000", "100.000", "100,000",
 * "100k", "1m", "Rp100.000". Return 0 kalau invalid.
 *
 * Catatan: separator . dan , diperlakukan sebagai pemisah ribuan (harga deal
 * rekber di Indonesia praktis selalu integer rupiah).
 */
function parsePriceNumber(input) {
    if (typeof input === 'number') return input > 0 ? Math.floor(input) : 0;
    if (!input || typeof input !== 'string') return 0;
    let s = String(input)
        .toLowerCase()
        .trim()
        .replace(/rp\.?/g, '')
        .replace(/\s/g, '');
    let multiplier = 1;
    if (s.endsWith('k')) {
        multiplier = 1000;
        s = s.slice(0, -1);
    } else if (s.endsWith('m')) {
        multiplier = 1000000;
        s = s.slice(0, -1);
    }
    s = s.replace(/[.,]/g, '');
    if (!/^\d+$/.test(s)) return 0;
    return parseInt(s, 10) * multiplier;
}

/**
 * Format rupiah: 95000 → "Rp95.000" (locale id-ID).
 */
function formatRupiah(n) {
    const num = Number(n) || 0;
    return 'Rp' + num.toLocaleString('id-ID');
}

/**
 * Terapkan event ke deal (mutate): push history + set state.
 * TIDAK menyimpan ke disk — caller panggil setDeal() setelah ini.
 *
 * @returns {Object|null} deal yang sudah di-update, atau null kalau event
 *   invalid dari state sekarang (caller harus cek nextState dulu).
 */
function recordTransition(deal, event, actor) {
    if (!deal || !actor) return null;
    const next = nextState(deal.state, event);
    if (!next) return null;
    deal.history = Array.isArray(deal.history) ? deal.history : [];
    deal.history.push({
        ts: Date.now(),
        event,
        fromState: deal.state,
        toState: next,
        actorId: actor.id,
        actorTag: actor.tag || actor.username || 'unknown'
    });
    deal.state = next;
    return deal;
}

module.exports = {
    // persistence
    loadDeals,
    saveDeals,
    getDeal,
    setDeal,
    removeDeal,
    hasActiveDealFor,
    getActiveDealsByGuild,
    // state machine (pure)
    canTransition,
    nextState,
    actorAllowed,
    recordTransition,
    // helpers (pure)
    calcFee,
    calcTotals,
    parsePriceNumber,
    formatRupiah,
    // constants
    STATES,
    TRANSITIONS,
    TERMINAL_STATES,
    transitionLocks
};
