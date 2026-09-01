/**
 * Unit tests v3.9.32 — fitur Midman/Rekber (deal escrow 3-pihak).
 *
 * Yang diuji (lapisan pure — pola classifyProduct: logic inti di-ekstrak ke
 * midmanManager supaya bisa diuji tanpa mock Discord):
 *   1. State machine: urutan langkah tidak bisa dilompati (canTransition/
 *      nextState) — inti keamanan escrow "gerbang ganda".
 *   2. actorAllowed: hanya pihak yang berhak yang bisa melakukan event.
 *   3. calcFee: persen / flat / 0 / cap / mode invalid.
 *   4. parseSellerInput: mention / raw ID / garbage.
 *   5. parsePriceNumber: "100000" / "100.000" / "100k" / "1m" / invalid.
 *   6. formatRupiah.
 *   7. Persistensi deals.json: setDeal/getDeal/removeDeal/hasActiveDealFor.
 *   8. Config: DEFAULTS midman + migration kategori 'midman' ke config lama
 *      (sekali saja — flag midmanCategoryDismissed mencegah re-add).
 *   9. findActiveTicketFor (ticketManager): meta ada → aktif; zombie meta
 *      (channel hilang) → di-cleanup & return null.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', '..', 'data');

// ====================================================
// === Sandbox: file data produksi di-snapshot & restore ===
// === (pola hardeningV31.test.js)                      ===
// ====================================================
const SANDBOX_FILES = ['deals.json', 'config.json', 'tickets.json'];
const backups = [];
for (const f of SANDBOX_FILES) {
    const p = path.join(dataDir, f);
    if (fs.existsSync(p)) {
        const b = p + '.v32-backup';
        fs.copyFileSync(p, b);
        backups.push({ orig: p, backup: b });
    }
}
process.on('exit', () => {
    for (const { orig, backup } of backups) {
        try {
            fs.copyFileSync(backup, orig);
            fs.rmSync(backup, { force: true });
        } catch (_) {}
    }
    // File yang TIDAK ada sebelum test → hapus hasil test (deals.json baru).
    for (const f of SANDBOX_FILES) {
        const p = path.join(dataDir, f);
        if (!backups.some(b => b.orig === p) && fs.existsSync(p)) {
            try {
                fs.unlinkSync(p);
            } catch (_) {}
        }
    }
});

function resetDataFile(name, content) {
    const p = path.join(dataDir, name);
    if (content === null) {
        if (fs.existsSync(p)) fs.unlinkSync(p);
        return;
    }
    fs.writeFileSync(p, JSON.stringify(content, null, 2));
}

// ====================================================
// === 1. STATE MACHINE — urutan tidak bisa dilompati ===
// ====================================================

const mm = require('../../src/data/midmanManager');

test('state machine: happy path lengkap seller→payment→delivery→release', () => {
    let state = 'WAITING_SELLER';
    state = mm.nextState(state, 'join');
    assert.strictEqual(state, 'WAITING_PAYMENT');
    state = mm.nextState(state, 'fundin');
    assert.strictEqual(state, 'WAITING_DELIVERY');
    state = mm.nextState(state, 'received');
    assert.strictEqual(state, 'WAITING_RELEASE');
    state = mm.nextState(state, 'release');
    assert.strictEqual(state, 'COMPLETED');
});

test('state machine: gerbang ganda — release ditolak sebelum barang diterima', () => {
    // Deal belum barang diterima → midman tidak bisa cairkan (skema fraud klasik).
    assert.strictEqual(mm.nextState('WAITING_DELIVERY', 'release'), null);
    assert.strictEqual(mm.canTransition('WAITING_DELIVERY', 'release'), false);
    // Begitu juga sebelum dana masuk.
    assert.strictEqual(mm.nextState('WAITING_PAYMENT', 'release'), null);
});

test('state machine: fundin dobel / join dobel ditolak', () => {
    assert.strictEqual(mm.nextState('WAITING_DELIVERY', 'fundin'), null);
    assert.strictEqual(mm.nextState('WAITING_PAYMENT', 'join'), null);
});

test('state machine: cancel hanya sebelum dana masuk', () => {
    assert.strictEqual(mm.canTransition('WAITING_SELLER', 'cancel'), true);
    assert.strictEqual(mm.canTransition('WAITING_PAYMENT', 'cancel'), true);
    // Setelah dana di midman — refund HARUS lewat dispute + admin resolve.
    assert.strictEqual(mm.canTransition('WAITING_DELIVERY', 'cancel'), false);
    assert.strictEqual(mm.canTransition('WAITING_RELEASE', 'cancel'), false);
    assert.strictEqual(mm.canTransition('DISPUTE', 'cancel'), false);
});

test('state machine: dispute valid di tengah jalan, tidak di awal/terminal', () => {
    assert.strictEqual(mm.canTransition('WAITING_PAYMENT', 'dispute'), true);
    assert.strictEqual(mm.canTransition('WAITING_DELIVERY', 'dispute'), true);
    assert.strictEqual(mm.canTransition('WAITING_RELEASE', 'dispute'), true);
    assert.strictEqual(mm.canTransition('WAITING_SELLER', 'dispute'), false);
    assert.strictEqual(mm.canTransition('COMPLETED', 'dispute'), false);
});

test('state machine: semua aksi mati saat DISPUTE & terminal state', () => {
    for (const event of ['join', 'fundin', 'received', 'release', 'cancel', 'dispute']) {
        assert.strictEqual(mm.canTransition('DISPUTE', event), false, `event ${event} harus mati saat DISPUTE`);
    }
    for (const event of ['join', 'fundin', 'received', 'release', 'cancel', 'dispute']) {
        assert.strictEqual(mm.canTransition('COMPLETED', event), false);
    }
    // Hanya admin resolve yang hidup dari DISPUTE.
    assert.strictEqual(mm.canTransition('DISPUTE', 'resolve_release'), true);
    assert.strictEqual(mm.canTransition('DISPUTE', 'resolve_refund'), true);
});

test('state machine: event tidak dikenal → false (defensive)', () => {
    assert.strictEqual(mm.canTransition('WAITING_SELLER', 'hack_the_system'), false);
    assert.strictEqual(mm.nextState('WAITING_SELLER', ''), null);
    assert.strictEqual(mm.canTransition(null, 'join'), false);
});

// ====================================================
// === 2. ACTOR — hanya pihak berhak ===
// ====================================================

const BUYER = { isBuyer: true, isSeller: false, isMidman: false, isAdmin: false };
const SELLER = { isBuyer: false, isSeller: true, isMidman: false, isAdmin: false };
const MIDMAN = { isBuyer: false, isSeller: false, isMidman: true, isAdmin: false };
const ADMIN = { isBuyer: false, isSeller: false, isMidman: false, isAdmin: true };
const OUTSIDER = { isBuyer: false, isSeller: false, isMidman: false, isAdmin: false };

test('actor: hanya seller bisa join, hanya buyer bisa received', () => {
    assert.strictEqual(mm.actorAllowed('join', SELLER), true);
    assert.strictEqual(mm.actorAllowed('join', BUYER), false);
    assert.strictEqual(mm.actorAllowed('join', MIDMAN), false);
    assert.strictEqual(mm.actorAllowed('received', BUYER), true);
    assert.strictEqual(mm.actorAllowed('received', SELLER), false);
    assert.strictEqual(mm.actorAllowed('received', MIDMAN), false);
});

test('actor: hanya midman/admin bisa fundin & release', () => {
    assert.strictEqual(mm.actorAllowed('fundin', MIDMAN), true);
    assert.strictEqual(mm.actorAllowed('fundin', ADMIN), true);
    assert.strictEqual(mm.actorAllowed('fundin', BUYER), false);
    assert.strictEqual(mm.actorAllowed('release', MIDMAN), true);
    assert.strictEqual(mm.actorAllowed('release', BUYER), false);
    assert.strictEqual(mm.actorAllowed('release', SELLER), false);
});

test('actor: hanya admin bisa resolve dispute', () => {
    assert.strictEqual(mm.actorAllowed('resolve_release', ADMIN), true);
    assert.strictEqual(mm.actorAllowed('resolve_refund', ADMIN), true);
    assert.strictEqual(mm.actorAllowed('resolve_release', MIDMAN), false);
    assert.strictEqual(mm.actorAllowed('resolve_refund', BUYER), false);
});

test('actor: peserta boleh dispute, orang luar tidak', () => {
    assert.strictEqual(mm.actorAllowed('dispute', BUYER), true);
    assert.strictEqual(mm.actorAllowed('dispute', SELLER), true);
    assert.strictEqual(mm.actorAllowed('dispute', MIDMAN), true);
    assert.strictEqual(mm.actorAllowed('dispute', OUTSIDER), false);
});

test('actor: cancel — buyer/seller/admin boleh, midman tidak', () => {
    assert.strictEqual(mm.actorAllowed('cancel', BUYER), true);
    assert.strictEqual(mm.actorAllowed('cancel', SELLER), true);
    assert.strictEqual(mm.actorAllowed('cancel', ADMIN), true);
    assert.strictEqual(mm.actorAllowed('cancel', MIDMAN), false);
    assert.strictEqual(mm.actorAllowed('cancel', OUTSIDER), false);
});

// ====================================================
// === 3. FEE ===
// ====================================================

test('calcFee: mode persen', () => {
    assert.strictEqual(mm.calcFee(100000, 'percent', 5), 5000);
    assert.strictEqual(mm.calcFee(250000, 'percent', 3), 7500);
    // Pembulatan: 99999 * 5% = 4999.95 → 5000
    assert.strictEqual(mm.calcFee(99999, 'percent', 5), 5000);
});

test('calcFee: mode flat', () => {
    assert.strictEqual(mm.calcFee(100000, 'flat', 5000), 5000);
    assert.strictEqual(mm.calcFee(50000, 'flat', 5000), 5000);
});

test('calcFee: fee 0 = gratis, nilai negatif/invalid = 0', () => {
    assert.strictEqual(mm.calcFee(100000, 'percent', 0), 0);
    assert.strictEqual(mm.calcFee(100000, 'percent', -10), 0);
    assert.strictEqual(mm.calcFee(-100, 'percent', 5), 0);
    assert.strictEqual(mm.calcFee('abc', 'percent', 5), 0);
});

test('calcFee: fee di-cap maksimal sebesar harga deal', () => {
    assert.strictEqual(mm.calcFee(100000, 'percent', 150), 100000);
    assert.strictEqual(mm.calcFee(10000, 'flat', 999999), 10000);
});

test('calcFee: mode tak dikenal → fee 0 (deal tetap jalan)', () => {
    assert.strictEqual(mm.calcFee(100000, 'weird', 50), 0);
    assert.strictEqual(mm.calcFee(100000, undefined, 50), 0);
});

// ====================================================
// === 4-5. PARSER INPUT MODAL ===
// ====================================================

test('parseSellerInput: mention / raw ID / teks campuran', () => {
    assert.strictEqual(mm.parseSellerInput('<@123456789012345678>'), '123456789012345678');
    assert.strictEqual(mm.parseSellerInput('<@!123456789012345678>'), '123456789012345678');
    assert.strictEqual(mm.parseSellerInput('123456789012345678'), '123456789012345678');
    assert.strictEqual(mm.parseSellerInput('jual akun sama user 123456789012345678 ya'), '123456789012345678');
});

test('parseSellerInput: input tidak valid → null', () => {
    assert.strictEqual(mm.parseSellerInput('budi'), null);
    assert.strictEqual(mm.parseSellerInput(''), null);
    assert.strictEqual(mm.parseSellerInput(null), null);
    assert.strictEqual(mm.parseSellerInput('12345'), null); // terlalu pendek untuk snowflake
});

test('parsePriceNumber: format umum rupiah', () => {
    assert.strictEqual(mm.parsePriceNumber('100000'), 100000);
    assert.strictEqual(mm.parsePriceNumber('100.000'), 100000);
    assert.strictEqual(mm.parsePriceNumber('100,000'), 100000);
    assert.strictEqual(mm.parsePriceNumber('Rp100.000'), 100000);
    assert.strictEqual(mm.parsePriceNumber('rp 100000'), 100000);
    assert.strictEqual(mm.parsePriceNumber('100k'), 100000);
    assert.strictEqual(mm.parsePriceNumber('1m'), 1000000);
    assert.strictEqual(mm.parsePriceNumber(50000), 50000);
});

test('parsePriceNumber: input tidak valid → 0', () => {
    assert.strictEqual(mm.parsePriceNumber('abc'), 0);
    assert.strictEqual(mm.parsePriceNumber(''), 0);
    assert.strictEqual(mm.parsePriceNumber('-5000'), 0);
    assert.strictEqual(mm.parsePriceNumber('0'), 0);
    assert.strictEqual(mm.parsePriceNumber(null), 0);
});

test('formatRupiah: locale id-ID', () => {
    assert.strictEqual(mm.formatRupiah(95000), 'Rp95.000');
    assert.strictEqual(mm.formatRupiah(1000000), 'Rp1.000.000');
    assert.strictEqual(mm.formatRupiah(0), 'Rp0');
});

// ====================================================
// === 6. PERSISTENSI deals.json ===
// ====================================================

test('deals.json: setDeal → getDeal → removeDeal', () => {
    resetDataFile('deals.json', {});
    const deal = {
        channelId: 'ch-deal-1',
        guildId: 'g1',
        buyerId: 'buyer-1',
        sellerId: 'seller-1',
        item: 'Akun ML',
        priceNum: 100000,
        state: 'WAITING_PAYMENT'
    };
    mm.setDeal('ch-deal-1', deal);
    assert.deepStrictEqual(mm.getDeal('ch-deal-1'), deal);
    assert.strictEqual(mm.getDeal('ch-tidak-ada'), null);
    mm.removeDeal('ch-deal-1');
    assert.strictEqual(mm.getDeal('ch-deal-1'), null);
});

test('hasActiveDealFor: buyer & seller terdeteksi, orang luar tidak', () => {
    resetDataFile('deals.json', {
        ch1: { guildId: 'g1', buyerId: 'buyer-1', sellerId: 'seller-1', state: 'WAITING_PAYMENT' }
    });
    assert.strictEqual(mm.hasActiveDealFor('g1', 'buyer-1'), true);
    assert.strictEqual(mm.hasActiveDealFor('g1', 'seller-1'), true);
    assert.strictEqual(mm.hasActiveDealFor('g1', 'random-guy'), false);
    // Guild lain dengan userId sama → tidak bocor (isolation per guild).
    assert.strictEqual(mm.hasActiveDealFor('g2', 'buyer-1'), false);
});

test('hasActiveDealFor: terminal state tidak dihitung aktif', () => {
    resetDataFile('deals.json', {
        ch1: { guildId: 'g1', buyerId: 'buyer-1', sellerId: 'seller-1', state: 'COMPLETED' }
    });
    assert.strictEqual(mm.hasActiveDealFor('g1', 'buyer-1'), false);
    assert.strictEqual(mm.hasActiveDealFor('g1', 'seller-1'), false);
});

test('recordTransition: state berubah + history tercatat; event invalid → null', () => {
    const deal = { state: 'WAITING_PAYMENT', history: [] };
    const actor = { id: 'midman-1', tag: 'rian#0001' };
    const result = mm.recordTransition(deal, 'fundin', actor);
    assert.strictEqual(result, deal);
    assert.strictEqual(deal.state, 'WAITING_DELIVERY');
    assert.strictEqual(deal.history.length, 1);
    assert.strictEqual(deal.history[0].event, 'fundin');
    assert.strictEqual(deal.history[0].actorId, 'midman-1');
    assert.strictEqual(deal.history[0].fromState, 'WAITING_PAYMENT');
    assert.strictEqual(deal.history[0].toState, 'WAITING_DELIVERY');

    // Event invalid dari state sekarang → null, state tidak berubah.
    assert.strictEqual(mm.recordTransition(deal, 'join', actor), null);
    assert.strictEqual(deal.state, 'WAITING_DELIVERY');
    assert.strictEqual(deal.history.length, 1); // tidak ada entry palsu
});

// ====================================================
// === 7. CONFIG: DEFAULTS + migration kategori midman ===
// ====================================================

function freshConfigManager() {
    delete require.cache[require.resolve('../../src/data/configManager')];
    return require('../../src/data/configManager');
}

test('config DEFAULTS: midman fee ada & kategori midman terdaftar', () => {
    resetDataFile('config.json', {});
    const { getConfig, DEFAULTS } = freshConfigManager();
    const config = getConfig();
    assert.strictEqual(DEFAULTS.midman.feeMode, 'percent');
    assert.strictEqual(DEFAULTS.midman.feeValue, 5);
    assert.strictEqual(DEFAULTS.midman.category, '🤝 REKBER');
    // Merge default hadir walau raw kosong.
    assert.strictEqual(config.midman.feeMode, 'percent');
    const cats = (config.ticketCategories || []).map(c => c.id);
    assert.ok(cats.includes('midman'), 'kategori midman harus ada di DEFAULTS ticketCategories');
});

test('config migration: config lama otomatis dapat kategori midman (sekali saja)', () => {
    // Simulasi config v3.9.31 lama — belum ada kategori midman.
    resetDataFile('config.json', {
        roles: { admin: '123' },
        ticketCategories: [
            { id: 'transaction', label: 'Beli Key / Transaksi', emoji: '🔑', style: 'Primary', requiresKey: true },
            { id: 'help', label: 'Help', emoji: '📞', style: 'Secondary', requiresKey: false }
        ],
        products: []
    });
    const { getConfig } = freshConfigManager();
    const config = getConfig();
    const cats = config.ticketCategories.map(c => c.id);
    assert.ok(cats.includes('midman'), 'migration harus menambah kategori midman');
    assert.ok(config.ticketCategories.find(c => c.id === 'midman').emoji === '🤝');
    // Migration di-save ke disk — getConfig ulang tidak menambah dobel.
    const config2 = freshConfigManager().getConfig();
    const midmanCount = config2.ticketCategories.filter(c => c.id === 'midman').length;
    assert.strictEqual(midmanCount, 1, 'kategori midman tidak boleh dobel setelah re-read');
});

test('config migration: flag midmanCategoryDismissed mencegah re-add setelah /remove-category', () => {
    resetDataFile('config.json', {
        roles: { admin: '123' },
        midmanCategoryDismissed: true,
        ticketCategories: [{ id: 'transaction', label: 'Beli Key', emoji: '🔑', style: 'Primary' }],
        products: []
    });
    const { getConfig } = freshConfigManager();
    const cats = getConfig().ticketCategories.map(c => c.id);
    assert.ok(!cats.includes('midman'), 'kategori midman TIDAK boleh ditambah lagi jika dismissed');
});

test('config merge: field midman custom admin preserve', () => {
    resetDataFile('config.json', { roles: { admin: '1' }, midman: { feeMode: 'flat', feeValue: 2500 }, products: [] });
    const { getConfig } = freshConfigManager();
    const config = getConfig();
    assert.strictEqual(config.midman.feeMode, 'flat');
    assert.strictEqual(config.midman.feeValue, 2500);
    // Field yang tidak di-set admin fallback ke DEFAULTS (category).
    assert.strictEqual(config.midman.category, '🤝 REKBER');
});

// ====================================================
// === 8. findActiveTicketFor (ticketManager) ===
// ====================================================

test('findActiveTicketFor: meta ada → aktif; zombie meta → cleanup & null', async () => {
    resetDataFile('tickets.json', {
        'ch-live': { userId: 'user-1', guildId: 'g1', productName: 'VIP' },
        'ch-zombie': { userId: 'user-2', guildId: 'g1', productName: 'VIP' }
    });
    delete require.cache[require.resolve('../../src/data/ticketManager')];
    const { findActiveTicketFor } = require('../../src/data/ticketManager');

    // Guild fake: ch-live ter-cache; ch-zombie tidak ter-cache & fetch → null.
    const fakeGuild = {
        id: 'g1',
        channels: {
            cache: new Map([['ch-live', { id: 'ch-live', name: 'ticket-1' }]]),
            fetch: async id => (id === 'ch-uncached' ? { id: 'ch-uncached' } : null)
        }
    };

    // user-1: meta + channel ter-cache → dapat channel.
    const live = await findActiveTicketFor(fakeGuild, 'user-1');
    assert.ok(live);
    assert.strictEqual(live.id, 'ch-live');

    // user-2: meta ada tapi channel hilang (fetch null) → null + zombie dihapus.
    const zombie = await findActiveTicketFor(fakeGuild, 'user-2');
    assert.strictEqual(zombie, null);
    const ticketsRaw = JSON.parse(fs.readFileSync(path.join(dataDir, 'tickets.json'), 'utf8'));
    assert.ok(!ticketsRaw['ch-zombie'], 'metadata zombie harus terhapus');
    assert.ok(ticketsRaw['ch-live'], 'metadata channel hidup tidak boleh ikut terhapus');

    // user-3: tidak punya tiket → null.
    assert.strictEqual(await findActiveTicketFor(fakeGuild, 'user-3'), null);
});
