/**
 * Unit tests for statsManager.parsePrice
 *
 * Run: npm test
 * or: node --test tests/unit/parsePrice.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const { parsePrice } = require('../../src/data/statsManager');

test('parsePrice: integer string', () => {
    assert.strictEqual(parsePrice('25000'), 25000);
    assert.strictEqual(parsePrice('0'), 0);
    assert.strictEqual(parsePrice('1000000'), 1000000);
});

test('parsePrice: number input (passthrough)', () => {
    assert.strictEqual(parsePrice(25000), 25000);
    assert.strictEqual(parsePrice(0), 0);
});

test('parsePrice: null/undefined/empty', () => {
    assert.strictEqual(parsePrice(null), 0);
    assert.strictEqual(parsePrice(undefined), 0);
    assert.strictEqual(parsePrice(''), 0);
});

test('parsePrice: "Rp" prefix', () => {
    assert.strictEqual(parsePrice('Rp 25000'), 25000);
    assert.strictEqual(parsePrice('Rp. 50.000'), 50000);
    assert.strictEqual(parsePrice('rp 100'), 100);
});

test('parsePrice: ID thousand separator (dot)', () => {
    // Indonesian format: "50.000" = 50000
    assert.strictEqual(parsePrice('50.000'), 50000);
    assert.strictEqual(parsePrice('1.000.000'), 1000000);
    assert.strictEqual(parsePrice('99.999'), 99999);
});

test('parsePrice v3.9.57: dot polos pecahan 2 digit = DESIMAL (bukan lagi ribuan)', () => {
    // v3.9.8/9/17 dulu (era sentris-Rupiah): "1.50" → 150, "100.00" → 10000 —
    // dot polos SELALU dibaca pemisah ribuan. v3.9.57 (permintaan user: "biar
    // support harga desimal untuk add produk nya misal 5.88"): ribuan Indonesia
    // yang SAH selalu grup 3 digit, jadi pecahan 1-2 digit tidak mungkin format
    // Rupiah yang benar — kini dibaca desimal, konsisten dengan aturan
    // berpenanda v3.9.55. Tulis 150 sebagai "150" dan 10000 sebagai "10.000".
    assert.strictEqual(parsePrice('1.50'), 1.5);
    assert.strictEqual(parsePrice('10.50'), 10.5);
    assert.strictEqual(parsePrice('100.00'), 100);
    assert.strictEqual(parsePrice('99.99'), 99.99);
});

test('parsePrice: decimal kecil tanpa penanda (pecahan 1 digit)', () => {
    // v3.9.9: int < 10 + 1-digit → decimal. v3.9.55: cents DIPERTAHANKAN
    // (stats currency-agnostic) — "2.5" → 2.5 dan "9.9" → 9.9, tidak lagi
    // dibulatkan ke 3 / 10. v3.9.57: aturan yang sama kini berlaku untuk
    // pecahan 2 digit juga (lihat blok v3.9.57 di bawah).
    assert.strictEqual(parsePrice('2.5'), 2.5);
    assert.strictEqual(parsePrice('9.9'), 9.9);
});

test('parsePrice: comma as thousand separator', () => {
    assert.strictEqual(parsePrice('25,000'), 25000);
    assert.strictEqual(parsePrice('1,234,567'), 1234567);
});

test('parsePrice: comma as decimal (ID/EU)', () => {
    // "2,5" → decimal 2.5 → 2.5 (v3.9.55: cents dipertahankan, tadinya dibulatkan ke 3)
    assert.strictEqual(parsePrice('2,5'), 2.5);
});

test('parsePrice: k/m suffix', () => {
    assert.strictEqual(parsePrice('25k'), 25000);
    assert.strictEqual(parsePrice('2.5m'), 2500000);
    assert.strictEqual(parsePrice('1m'), 1000000);
});

test('parsePrice: combined format (Rp + thousand + k)', () => {
    assert.strictEqual(parsePrice('Rp 25k'), 25000);
    assert.strictEqual(parsePrice('Rp 1.5m'), 1500000);
});

test('parsePrice: invalid string returns 0', () => {
    assert.strictEqual(parsePrice('abc'), 0);
    assert.strictEqual(parsePrice('Rp'), 0);
    assert.strictEqual(parsePrice('---'), 0);
});

test('parsePrice: mixed dot + comma (US format)', () => {
    // "1,234.56" → format US → 1234.56 (v3.9.55: cents dipertahankan — tadinya
    // dibulatkan ke 1235; stats sudah currency-AGNOSTIC sejak v3.9.54)
    assert.strictEqual(parsePrice('1,234.56'), 1234.56);
});

test('parsePrice: mixed dot + comma (EU/ID format)', () => {
    // "1.234,56" → format EU → 1234.56 (v3.9.55: cents dipertahankan, tadinya 1235)
    assert.strictEqual(parsePrice('1.234,56'), 1234.56);
});

// ============ v3.9.49 — Indonesian suffixes (user report: "total revenue doesn't update") ============
// "25rb" used to record Rp 25 instead of Rp 25.000 — every sale added a
// near-invisible amount, so the revenue looked frozen.

test('parsePrice v3.9.49: rb suffix = ribu (×1.000)', () => {
    assert.strictEqual(parsePrice('25rb'), 25000);
    assert.strictEqual(parsePrice('Rp 25rb'), 25000);
    assert.strictEqual(parsePrice('Rp 25 rb'), 25000);
    assert.strictEqual(parsePrice('150rb'), 150000);
    // The USER-REPORT scenario end-to-end: revenue now moves by the right amount.
    assert.strictEqual(parsePrice('100rb'), 100000);
});

test('parsePrice v3.9.49: jt/juta suffix = juta (×1.000.000)', () => {
    assert.strictEqual(parsePrice('2jt'), 2000000);
    assert.strictEqual(parsePrice('2 juta'), 2000000);
    assert.strictEqual(parsePrice('Rp1.5juta'), 1500000);
    // Longest-first: "juta" wins over the "jt" prefix ambiguity.
    assert.strictEqual(parsePrice('3juta'), 3000000);
});

test('parsePrice v3.9.49: legacy formats unchanged (no regression)', () => {
    assert.strictEqual(parsePrice('25000'), 25000);
    assert.strictEqual(parsePrice('25.000'), 25000);
    assert.strictEqual(parsePrice('25k'), 25000);
    assert.strictEqual(parsePrice('2.5M'), 2500000);
    assert.strictEqual(parsePrice('murah'), 0); // still unparseable → 0
});

test('parsePriceNumber v3.9.49 (midman): escrow now accepts rb/jt/juta', () => {
    const mm = require('../../src/data/midmanManager');
    // Before: 0 = deal creation blocked with a confusing "invalid price".
    assert.strictEqual(mm.parsePriceNumber('25rb'), 25000);
    assert.strictEqual(mm.parsePriceNumber('2jt'), 2000000);
    assert.strictEqual(mm.parsePriceNumber('2juta'), 2000000);
    assert.strictEqual(mm.parsePriceNumber('Rp 25 rb'), 25000);
    // Strictness preserved: suffix + separators is still rejected (10x-price guard).
    assert.strictEqual(mm.parsePriceNumber('1.5rb'), 0);
    assert.strictEqual(mm.parsePriceNumber('1,5jt'), 0);
    // Legacy formats unchanged.
    assert.strictEqual(mm.parsePriceNumber('25.000'), 25000);
    assert.strictEqual(mm.parsePriceNumber('100k'), 100000);
    assert.strictEqual(mm.parsePriceNumber('2.5'), 0);
});

// ============ v3.9.50 — harga dua mata uang (laporan user: "saya kasih harga 3$ USD | Rp. 25.000") ============
// Mata uang stats adalah Rupiah. Sebelum fix ini parseFloat berhenti di '$',
// jadi harga ganda itu tercatat **Rp 3** per penjualan — revenue kembali
// terlihat beku meski fix suffix v3.9.49 sudah terpasang.

test('parsePrice v3.9.50: dual-currency — the Rp half is recorded', () => {
    // Format persis seperti laporan user + varian umumnya.
    assert.strictEqual(parsePrice('3$ USD | Rp. 25.000'), 25000);
    assert.strictEqual(parsePrice('3$ USD | Rp 25.000'), 25000);
    assert.strictEqual(parsePrice('$3 USD | Rp 25.000'), 25000);
    assert.strictEqual(parsePrice('3 USD | Rp 25.000'), 25000);
    assert.strictEqual(parsePrice('Rp 25.000 | $3 USD'), 25000); // Rp duluan
    assert.strictEqual(parsePrice('3$ usd rp 25.000'), 25000);   // tanpa pipe
    assert.strictEqual(parsePrice('$5 USD | Rp 150rb'), 150000); // plus suffix
});

test('parsePrice v3.9.54: penanda mata uang APA SAJA diterima (internasional)', () => {
    // Permintaan user: "bot akan dipakai orang di luar Indonesia juga".
    // Bot currency-AGNOSTIC — mencatat nominal angka dalam mata uang apapun
    // yang dipakai admin untuk harga produknya (tanpa konversi, tanpa penolakan).
    assert.strictEqual(parsePrice('$3'), 3);
    assert.strictEqual(parsePrice('3$'), 3);
    assert.strictEqual(parsePrice('3 usd'), 3);
    assert.strictEqual(parsePrice('USD 3'), 3);
    assert.strictEqual(parsePrice('3$ USD'), 3);
    assert.strictEqual(parsePrice('€25'), 25);
    assert.strictEqual(parsePrice('£ 20'), 20);
    assert.strictEqual(parsePrice('¥1000'), 1000);
    assert.strictEqual(parsePrice('₩25.000'), 25000);
    assert.strictEqual(parsePrice('₱500'), 500);
    assert.strictEqual(parsePrice('25 eur'), 25);
    assert.strictEqual(parsePrice('IDR 30.000'), 30000);
    // Nominal PERTAMA yang menang kalau tidak ada bagian Rp ("$3 | €2" → 3).
    assert.strictEqual(parsePrice('$3 | €2'), 3);
    // Ada penanda tapi tanpa nominal tetap tidak terbaca.
    assert.strictEqual(parsePrice('usd'), 0);
    // Word safety: suffix k/m harus MENEMPEL supaya dihitung
    // ("beli 3 monyet buat $5" → 3, bukan "3 m" → 3000).
    assert.strictEqual(parsePrice('beli 3 monyet buat $5'), 3);
});

test('parsePrice v3.9.50: Rp formats keep working (no regression)', () => {
    assert.strictEqual(parsePrice('Rp 25.000'), 25000);
    assert.strictEqual(parsePrice('Rp. 50.000'), 50000);
    assert.strictEqual(parsePrice('Rp 25rb'), 25000);
    assert.strictEqual(parsePrice('25.000 rp'), 25000); // penanda setelah nominal
    assert.strictEqual(parsePrice('rp'), 0);
});

test('parsePriceNumber v3.9.50 (midman): dual-currency accepted, strictness kept', () => {
    const mm = require('../../src/data/midmanManager');
    assert.strictEqual(mm.parsePriceNumber('3$ USD | Rp. 25.000'), 25000);
    assert.strictEqual(mm.parsePriceNumber('$3 | Rp 25.000'), 25000);
    // v3.9.54: USD-only kini terparse juga (rekber currency-agnostic).
    assert.strictEqual(mm.parsePriceNumber('3$'), 3);
    assert.strictEqual(mm.parsePriceNumber('3 usd'), 3);
    // Guard ketat tetap: desimal + suffix di bagian Rp tetap ditolak.
    assert.strictEqual(mm.parsePriceNumber('3$ | Rp 1.5rb'), 0);
    // Strictness legacy tidak berubah.
    assert.strictEqual(mm.parsePriceNumber('1.5rb'), 0);
});

test('parsePriceNumber v3.9.54 (midman): mata uang internasional, angka bulat', () => {
    const mm = require('../../src/data/midmanManager');
    assert.strictEqual(mm.parsePriceNumber('$25,000'), 25000);
    assert.strictEqual(mm.parsePriceNumber('€2.500'), 2500); // titik ribuan gaya ID (grup konsisten)
    assert.strictEqual(mm.parsePriceNumber('¥1000'), 1000);
    // Rekber tetap ketat: desimal seperti "2.5" ambigu → ditolak.
    assert.strictEqual(mm.parsePriceNumber('$2.5'), 0);
    // Ada penanda tapi tanpa nominal → invalid.
    assert.strictEqual(mm.parsePriceNumber('usd'), 0);
});

test('priceValidationError v3.9.54 (products): mata uang apa saja diterima', () => {
    const products = require('../../src/commands/products');
    // Harga ganda dua mata uang, Rupiah polos, dan harga internasional semua valid.
    assert.strictEqual(products.priceValidationError('3$ USD | Rp. 25.000'), null);
    assert.strictEqual(products.priceValidationError('Rp 25rb'), null);
    assert.strictEqual(products.priceValidationError('25.000'), null);
    assert.strictEqual(products.priceValidationError('gratis'), null);
    // v3.9.54: USD-only tidak lagi ditolak — bot currency-agnostic.
    assert.strictEqual(products.priceValidationError('3$ USD'), null);
    assert.strictEqual(products.priceValidationError('$3'), null);
    assert.strictEqual(products.priceValidationError('€25'), null);
    // String sampah tetap ditolak dengan daftar format.
    const junkErr = products.priceValidationError('murah');
    assert.ok(typeof junkErr === 'string' && junkErr.includes('tidak bisa dibaca'));
    assert.ok(junkErr.includes('$3'), 'daftar format menampilkan contoh internasional');
});

// ============ v3.9.55 — DESIMAL internasional (pertanyaan user: "angka itu support desimal misal $2.5 USD?") ============
// Heuristic dot sentris-Rupiah dulu membaca "$2.50" sebagai 250 dan "$9.99"
// sebagai 999 (kesalahan senyap 100x untuk server yang pakai USD/EUR), dan
// Math.round di akhir membuang cents ("$2.5" → 3). Kalau ada penanda mata uang
// NON-Rp, harga kini di-parse dengan aturan internasional: satu dot dengan
// pecahan 1-2 digit adalah DECIMAL, pecahan 3 digit adalah grup ribuan, dan
// cents DIPERTAHANKAN di nominal yang tercatat.

test('parsePrice v3.9.55: desimal dengan penanda mata uang mempertahankan cents', () => {
    // Format persis yang ditanyakan user.
    assert.strictEqual(parsePrice('$2.5 USD'), 2.5);
    assert.strictEqual(parsePrice('$2.5'), 2.5);
    assert.strictEqual(parsePrice('$2.50'), 2.5);
    assert.strictEqual(parsePrice('$9.99'), 9.99);
    assert.strictEqual(parsePrice('$12.99'), 12.99);
    assert.strictEqual(parsePrice('$0.99'), 0.99);
    assert.strictEqual(parsePrice('$2.0'), 2);
    assert.strictEqual(parsePrice('£ 2.99'), 2.99);
    // Koma desimal EU juga mempertahankan cents (tadinya 9,99 dibulatkan ke 10).
    assert.strictEqual(parsePrice('€9,99'), 9.99);
});

test('parsePrice v3.9.55: grup dot 3 digit dengan penanda tetap RIBUAN', () => {
    // Ribuan gaya Jerman: "$50.000" adalah 50000, BUKAN 50.000 cents.
    assert.strictEqual(parsePrice('$50.000'), 50000);
    assert.strictEqual(parsePrice('$1.234.567'), 1234567);
    // Pemisah campuran tetap jalan — cents dipertahankan (tadinya dibulatkan ke 1235).
    assert.strictEqual(parsePrice('$1,234.56'), 1234.56);
    assert.strictEqual(parsePrice('$1.234,56'), 1234.56);
    // Suffix + desimal: "$2.5k" → 2.5 × 1000.
    assert.strictEqual(parsePrice('$2.5k'), 2500);
});

test('parsePrice v3.9.55/57: format Rp & grup ribuan 3 digit tidak berubah', () => {
    // Cabang Rp tidak tersentuh; grup dot 3 digit + multi-dot tetap ribuan.
    assert.strictEqual(parsePrice('Rp 2.5rb'), 2500);
    assert.strictEqual(parsePrice('Rp 25.000'), 25000);
    assert.strictEqual(parsePrice('50.000'), 50000);
    // v3.9.57 (perubahan yang DISENGAJA): desimal polos — "1.50" kini 1.5
    // (dulu 150) dan "9.99" kini 9.99 (dulu 999), konsisten dengan "$1.50".
    assert.strictEqual(parsePrice('1.50'), 1.5);
    assert.strictEqual(parsePrice('9.99'), 9.99);
    // Harga ganda dua mata uang tetap mencatat bagian Rp (v3.9.50, tidak berubah).
    assert.strictEqual(parsePrice('$2.5 USD | Rp 25.000'), 25000);
});

test('parsePriceNumber v3.9.55 (midman): rekber tetap wajib angka bulat', () => {
    const mm = require('../../src/data/midmanManager');
    // Desain SENGAJA: nominal deal rekber harus angka bulat — "$2.5" ambigu
    // antara 2.5 dan salah-ketik 2500, dan deal menggerakkan uang sungguhan.
    assert.strictEqual(mm.parsePriceNumber('$2.5'), 0);
    assert.strictEqual(mm.parsePriceNumber('$2.50'), 0);
    assert.strictEqual(mm.parsePriceNumber('€2,50'), 0);
    assert.strictEqual(mm.parsePriceNumber('$25,000'), 25000); // tetap sah
});

test('priceValidationError v3.9.55/57 (products): harga desimal valid', () => {
    const products = require('../../src/commands/products');
    assert.strictEqual(products.priceValidationError('$2.5 USD'), null);
    assert.strictEqual(products.priceValidationError('$2.50'), null);
    assert.strictEqual(products.priceValidationError('€9.99'), null);
    // v3.9.57: desimal POLOS juga valid — tanpa penanda mata uang apa pun.
    assert.strictEqual(products.priceValidationError('5.88'), null);
    assert.strictEqual(products.priceValidationError('5,88'), null);
    // Daftar format kini menampilkan contoh desimal (berpenanda + polos).
    const junkErr = products.priceValidationError('murah');
    assert.ok(junkErr.includes('$2.50'), 'daftar format menampilkan contoh desimal');
    assert.ok(junkErr.includes('5.88'), 'daftar format menampilkan contoh desimal polos v3.9.57');
});

// ============ v3.9.57 — DESIMAL POLOS (permintaan user: "biar support harga desimal untuk add produk nya misal 5.88") ============
// Aturan decimal v3.9.55 yang tadinya hanya berlaku dengan penanda mata uang
// kini berlaku untuk input POLOS juga: satu dot dengan pecahan 1-2 digit =
// desimal ("5.88" → 5.88, dulu terbaca 588 — salah 100x senyap), karena
// penulisan ribuan Indonesia yang sah selalu grup 3 digit ("50.000").

test('parsePrice v3.9.57: desimal POLOS didukung — "5.88" terbaca 5.88 (bukan 588)', () => {
    // Format persis yang diminta user + varian penulisannya.
    assert.strictEqual(parsePrice('5.88'), 5.88);
    assert.strictEqual(parsePrice('5,88'), 5.88); // koma desimal — sudah benar sejak lama
    assert.strictEqual(parsePrice('0.99'), 0.99);
    assert.strictEqual(parsePrice('12.99'), 12.99);
    assert.strictEqual(parsePrice('2.50'), 2.5);
    // Suffix + desimal: kini konsisten dengan versi komanya, tidak lagi meledak 100x.
    assert.strictEqual(parsePrice('1.50rb'), 1500); // dulu 150 × 1000 = 150.000
    assert.strictEqual(parsePrice('1,50rb'), 1500); // versi koma — sudah benar sejak lama
    assert.strictEqual(parsePrice('9.99jt'), 9990000); // dulu 999 × 1jt = 999 juta
    // Penanda mata uang bekerja seperti sebelumnya (v3.9.55 tidak berubah).
    assert.strictEqual(parsePrice('$5.88'), 5.88);
    assert.strictEqual(parsePrice('5.88 usd'), 5.88);
});

test('parsePrice v3.9.57: ribuan sah & multi-dot TIDAK berubah (no regression)', () => {
    // Grup 3 digit = ribuan — format Rupiah yang benar tetap terbaca sama.
    assert.strictEqual(parsePrice('5.880'), 5880);
    assert.strictEqual(parsePrice('50.000'), 50000);
    assert.strictEqual(parsePrice('1.000.000'), 1000000);
    assert.strictEqual(parsePrice('25,000'), 25000);
    assert.strictEqual(parsePrice('5.000rb'), 5000000);
    // Rekber tetap wajib angka bulat (tidak tersentuh v3.9.57).
    const mm = require('../../src/data/midmanManager');
    assert.strictEqual(mm.parsePriceNumber('5.88'), 0);
    assert.strictEqual(mm.parsePriceNumber('$5.88'), 0);
});
