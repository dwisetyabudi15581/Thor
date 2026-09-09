/**
 * Unit test v3.9.47 — MATCH MODE auto-responder.
 *
 * Permintaan user (produksi): "kalau saya set trigger 'beli', terus member
 * nulis 'bagaimana cara beli' bot harus merespon" + setting untuk memilih
 * antara exact (sesuai yang di-set / awal pesan) dan contains (kata trigger
 * ada di mana saja dalam kalimat). Test ini mengunci kedua mode, perilaku
 * batas kata, migrasi entri lama, interaksi cooldown, dan opsi registry.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { safeWriteJSON } = require('../../src/infra/safeWrite');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const RESPONDERS_PATH = path.join(DATA_DIR, 'responders.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ============ MATCHER MURNI (messageMatchesTrigger) ============

test('messageMatchesTrigger: contains cocok untuk kata trigger di mana saja', () => {
    const { messageMatchesTrigger } = require('../../src/data/responderManager');
    // Skenario persis yang dilaporkan user.
    assert.strictEqual(messageMatchesTrigger('bagaimana cara beli', 'beli', 'contains'), true);
    assert.strictEqual(messageMatchesTrigger('beli', 'beli', 'contains'), true);
    assert.strictEqual(messageMatchesTrigger('mau beli dong', 'beli'), true); // tanpa mode = contains
    assert.strictEqual(messageMatchesTrigger('Bagaimana Cara Beli', 'beli', 'contains'), true);
});

test('messageMatchesTrigger: batas kata — kata yang lebih panjang TIDAK cocok', () => {
    const { messageMatchesTrigger } = require('../../src/data/responderManager');
    assert.strictEqual(messageMatchesTrigger('belian murah banget', 'beli', 'contains'), false);
    assert.strictEqual(messageMatchesTrigger('aku membeli diamond', 'beli', 'contains'), false);
    assert.strictEqual(messageMatchesTrigger('belipulsa disini', 'beli', 'contains'), false);
    // Tanda baca dianggap batas kata (tanya/jawab tetap kata itu).
    assert.strictEqual(messageMatchesTrigger('mau beli?', 'beli', 'contains'), true);
    assert.strictEqual(messageMatchesTrigger('beli!', 'beli', 'contains'), true);
});

test('messageMatchesTrigger: exact = awal pesan saja (perilaku lama)', () => {
    const { messageMatchesTrigger } = require('../../src/data/responderManager');
    assert.strictEqual(messageMatchesTrigger('!sosmed halo', '!sosmed', 'exact'), true);
    assert.strictEqual(messageMatchesTrigger('!sosmed', '!sosmed', 'exact'), true);
    assert.strictEqual(messageMatchesTrigger('oi !sosmed halo', '!sosmed', 'exact'), false);
    assert.strictEqual(messageMatchesTrigger('!sosmednya', '!sosmed', 'exact'), false);
});

test('messageMatchesTrigger: trigger multi-kata + perataan whitespace', () => {
    const { messageMatchesTrigger } = require('../../src/data/responderManager');
    assert.strictEqual(messageMatchesTrigger('bagaimana cara beli ya', 'cara beli', 'contains'), true);
    // Spasi dobel di pesan tetap cocok dengan trigger spasi tunggal.
    assert.strictEqual(messageMatchesTrigger('bagaimana cara  beli ya', 'cara beli', 'contains'), true);
    // "caranya" BUKAN kata "cara" — tidak cocok.
    assert.strictEqual(messageMatchesTrigger('caranya beli', 'cara beli', 'contains'), false);
});

test('messageMatchesTrigger: trigger ber-karakter regex di-escape, tidak pernah crash', () => {
    const { messageMatchesTrigger } = require('../../src/data/responderManager');
    assert.doesNotThrow(() => messageMatchesTrigger('oi !sos.med+ ya', '!sos.med+', 'contains'));
    assert.strictEqual(messageMatchesTrigger('oi !sos.med+ ya', '!sos.med+', 'contains'), true);
    assert.strictEqual(messageMatchesTrigger('plain text here', 'a.b*c', 'contains'), false);
});

test('messageMatchesTrigger: input tidak valid → false (tidak pernah throw)', () => {
    const { messageMatchesTrigger } = require('../../src/data/responderManager');
    assert.strictEqual(messageMatchesTrigger('', 'beli'), false);
    assert.strictEqual(messageMatchesTrigger('beli apa', ''), false);
    assert.strictEqual(messageMatchesTrigger(null, 'beli'), false);
    assert.strictEqual(messageMatchesTrigger('beli', undefined), false);
});

// ============ PENYIMPANAN (addResponder) ============

test('addResponder: menyimpan matchMode, default contains (v3.9.47)', () => {
    const { addResponder, removeResponder, invalidateCache } = require('../../src/data/responderManager');
    const G = 'test_guild_store';

    const a = addResponder(G, { trigger: 'beli', reply: 'x', createdBy: 'u', createdByTag: 'U' });
    assert.strictEqual(a.responder.matchMode, 'contains'); // default

    const b = addResponder(G, { trigger: 'jual', reply: 'y', matchMode: 'exact', createdBy: 'u', createdByTag: 'U' });
    assert.strictEqual(b.responder.matchMode, 'exact');

    // Nilai aneh dinormalisasi ke contains — file data tidak boleh membawa
    // mode tak dikenal ke depan.
    const c = addResponder(G, { trigger: 'sewa', reply: 'z', matchMode: 'weird', createdBy: 'u', createdByTag: 'U' });
    assert.strictEqual(c.responder.matchMode, 'contains');

    removeResponder(G, 'beli');
    removeResponder(G, 'jual');
    removeResponder(G, 'sewa');
    invalidateCache();
});

// ============ INTEGRASI (findMatch) ============

test('SKENARIO USER: trigger "beli" kini menjawab "bagaimana cara beli" (v3.9.47)', () => {
    const { addResponder, findMatch, removeResponder, invalidateCache } = require('../../src/data/responderManager');
    const G = 'test_guild_userscenario';

    addResponder(G, { trigger: 'beli', reply: 'Ini cara belinya!', createdBy: 'u', createdByTag: 'U' });

    const m = findMatch(G, 'Bagaimana cara beli ya?');
    assert.ok(m, '"bagaimana cara beli" harus cocok dengan trigger "beli"');
    assert.strictEqual(m.trigger, 'beli');

    removeResponder(G, 'beli');
    invalidateCache();
});

test('findMatch: exact mempertahankan perilaku lama awal-pesan', () => {
    const { addResponder, findMatch, removeResponder, invalidateCache } = require('../../src/data/responderManager');
    const G = 'test_guild_exact';

    addResponder(G, { trigger: 'kunci', reply: 'x', matchMode: 'exact', createdBy: 'u', createdByTag: 'U' });

    assert.ok(findMatch(G, 'kunci dong')); // diawali trigger + spasi
    assert.strictEqual(findMatch(G, 'oi kunci dong'), null); // di tengah kalimat: TIDAK cocok di mode exact
    assert.strictEqual(findMatch(G, 'kuncinya apa'), null); // akhiran nempel: juga tidak

    removeResponder(G, 'kunci');
    invalidateCache();
});

test('findMatch: contains tetap case-insensitive (v3.9.47)', () => {
    const { addResponder, findMatch, removeResponder, invalidateCache } = require('../../src/data/responderManager');
    const G = 'test_guild_case';

    addResponder(G, { trigger: 'BELI', reply: 'x', createdBy: 'u', createdByTag: 'U' });
    assert.ok(findMatch(G, 'mau Beli dong'));
    assert.ok(findMatch(G, 'GIMANA CARA BELI'));

    removeResponder(G, 'BELI');
    invalidateCache();
});

test('findMatch: entri lama tanpa matchMode diperlakukan sebagai contains (v3.9.47)', () => {
    const { addResponder, findMatch, removeResponder, invalidateCache } = require('../../src/data/responderManager');
    const G = 'test_guild_legacy';

    addResponder(G, { trigger: 'beli', reply: 'x', createdBy: 'u', createdByTag: 'U' });
    // Simulasikan entri yang dibuat SEBELUM v3.9.47: hapus matchMode di disk.
    const data = JSON.parse(fs.readFileSync(RESPONDERS_PATH, 'utf8'));
    for (const r of data[G]) delete r.matchMode;
    safeWriteJSON(RESPONDERS_PATH, data);
    invalidateCache();

    const m = findMatch(G, 'bagaimana cara beli');
    assert.ok(m, 'entri lama (tanpa matchMode) harus default ke mode contains');
    assert.strictEqual(m.trigger, 'beli');

    removeResponder(G, 'beli');
    invalidateCache();
});

test('findMatch: cooldown per-user tetap berlaku di mode contains (v3.9.47)', () => {
    const { addResponder, findMatch, markUsed, removeResponder, invalidateCache } = require('../../src/data/responderManager');
    const G = 'test_guild_cd';

    const res = addResponder(G, {
        trigger: 'stok',
        reply: 'x',
        cooldownMs: 60000,
        createdBy: 'u',
        createdByTag: 'U'
    });

    assert.ok(findMatch(G, 'stok ready?', 'userA'));
    markUsed(G, res.responder.id, 'userA');

    // User yang sama dalam cooldown → tidak match…
    assert.strictEqual(findMatch(G, 'stok ready?', 'userA'), null);
    // …tapi user BERBEDA tetap dapat reply (per-user, bukan global).
    assert.ok(findMatch(G, 'stok ready?', 'userB'));

    removeResponder(G, 'stok');
    invalidateCache();
});

test('findMatch: responder yang cooldown tidak lagi membatalkan scan (v3.9.47)', () => {
    const { addResponder, findMatch, markUsed, removeResponder, invalidateCache } = require('../../src/data/responderManager');
    const G = 'test_guild_cdscan';

    addResponder(G, { trigger: 'beli', reply: 'A', createdBy: 'u', createdByTag: 'U' });
    addResponder(G, { trigger: 'cara beli', reply: 'B', createdBy: 'u', createdByTag: 'U' });

    // Keduanya cocok dengan "bagaimana cara beli"; 'beli' lebih dulu di array.
    const first = findMatch(G, 'bagaimana cara beli', 'userA');
    assert.ok(first);
    assert.strictEqual(first.trigger, 'beli');
    markUsed(G, first.id, 'userA'); // userA kini cooldown untuk 'beli'

    // Perilaku LAMA: `return null` → TIDAK ada reply sama sekali. BARU: scan
    // LANJUT → responder 'cara beli' yang overlap tetap menjawab.
    const second = findMatch(G, 'bagaimana cara beli', 'userA');
    assert.ok(second, 'scan harus lanjut melewati responder yang cooldown');
    assert.strictEqual(second.trigger, 'cara beli');

    removeResponder(G, 'beli');
    removeResponder(G, 'cara beli');
    invalidateCache();
});

// ============ KONTRAK REGISTRY ============

test('registry: /add-responder mengekspos opsi match_mode (v3.9.47)', () => {
    const { getCommands } = require('../../src/commands/registry');
    const cmd = getCommands().find(c => c.name === 'add-responder');
    assert.ok(cmd, 'add-responder harus tetap terdaftar');

    const opt = cmd.options.find(o => o.name === 'match_mode');
    assert.ok(opt, 'add-responder butuh opsi match_mode');
    const values = opt.choices.map(c => c.value).sort();
    assert.deepStrictEqual(values, ['contains', 'exact']);
    // Opsional supaya Discord bisa mengosongkannya — bot lalu default ke contains.
    assert.strictEqual(opt.required, false);
    // Nama choice harus patuh limit Discord 100 char.
    for (const c of opt.choices) assert.ok(c.name.length <= 100);
});

// ============ CLEANUP ============

test('v3.9.47 cleanup: tidak ada sisa test-guild di responders.json', () => {
    const { invalidateCache } = require('../../src/data/responderManager');
    if (!fs.existsSync(RESPONDERS_PATH)) {
        assert.ok(true, 'tidak ada responders.json — tidak ada yang dibersihkan');
        return;
    }
    const data = JSON.parse(fs.readFileSync(RESPONDERS_PATH, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        assert.ok(true, 'file bentuk aneh — bukan urusan test ini');
        return;
    }
    let removed = 0;
    for (const key of Object.keys(data)) {
        if (/^test_guild/.test(key)) {
            delete data[key];
            removed++;
        }
    }
    if (removed > 0) safeWriteJSON(RESPONDERS_PATH, data);
    invalidateCache();
    assert.ok(true, `cleanup selesai (${removed} guild sisa dihapus)`);
});
