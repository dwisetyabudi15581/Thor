/**
 * Unit tests untuk guildPremiumManager (data layer — v3.15.0)
 *
 * Verify:
 *   - generatePremiumKey: format kode, pool status available
 *   - findAvailableLocalKey / consumeLocalKey: validasi + konsumsi sekali pakai
 *   - activateGuildKey: expireAt = now + days (fresh guild)
 *   - MAX EXTEND: aktivasi kedua ditaruh SETELAH sisa terpanjang
 *   - lifetime: expireAt null + mengunci status guild
 *   - isGuildPremium / getGuildStatus: aktif, expired, lifetime
 *   - sweepExpiredSubscriptions: hapus entry expired
 *   - revokeGuildSubscription: cabut semua entry guild
 *
 * File data produksi di-snapshot & restore (pola keyManager.test.js).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const realPath = path.join(__dirname, '..', '..', 'data', 'guildPremium.json');
const backupPath = realPath + '.test-backup';
let backedUp = false;
if (fs.existsSync(realPath)) {
    fs.copyFileSync(realPath, backupPath);
    backedUp = true;
    fs.unlinkSync(realPath);
}
process.on('exit', () => {
    try {
        if (backedUp) {
            fs.copyFileSync(backupPath, realPath);
            fs.unlinkSync(backupPath);
        } else if (fs.existsSync(realPath)) {
            // Dibuat oleh test tapi tidak ada backup → hapus supaya clean.
            fs.unlinkSync(realPath);
        }
    } catch (_) {}
});

const pm = require('../../src/data/guildPremiumManager');

const GUILD_A = '111222333444555666';
const GUILD_B = '999888777666555444';

function opts(expireAt) {
    return { __proto__: null, configurable: true, writable: true, enumerable: true, value: expireAt };
}

// ====================================================
// === Pool key lokal ===
// ====================================================

test('premium: generatePremiumKey membuat key format benar & available', () => {
    const code = pm.generatePremiumKey({ plan: 'premium30', note: 'test unit' });
    assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    // Alphabet bebas karakter ambigu I/L/O/0/1
    assert.ok(!/[ILO01]/.test(code), 'key tidak boleh mengandung karakter ambigu');

    const entry = pm.findAvailableLocalKey(code);
    assert.ok(entry, 'key baru harus tersedia di pool');
    assert.strictEqual(entry.plan, 'premium30');
    assert.strictEqual(entry.days, 30);
    assert.strictEqual(entry.status, 'available');
});

test('premium: generatePremiumKey menolak plan tidak dikenal', () => {
    assert.throws(() => pm.generatePremiumKey({ plan: 'bogus' }), /Plan tidak dikenal/);
});

test('premium: findAvailableLocalKey case-insensitive + trim', () => {
    const code = pm.generatePremiumKey({ plan: 'premium90' });
    assert.ok(pm.findAvailableLocalKey(`  ${code.toLowerCase()} `));
});

test('premium: consumeLocalKey sekali pakai — key tidak bisa dipakai 2x', () => {
    const code = pm.generatePremiumKey({ plan: 'premium30' });
    assert.strictEqual(pm.consumeLocalKey(code), true);
    assert.strictEqual(pm.consumeLocalKey(code), false, 'konsumsi kedua harus gagal');
    assert.strictEqual(pm.findAvailableLocalKey(code), null, 'key consumed tidak lagi available');
});

test('premium: revokeLocalKey menandai revoked', () => {
    const code = pm.generatePremiumKey({ plan: 'lifetime' });
    assert.strictEqual(pm.revokeLocalKey(code), true);
    assert.strictEqual(pm.findAvailableLocalKey(code), null);
    const keys = pm.listLocalKeys();
    assert.ok(keys.some(k => k.code === code && k.status === 'revoked'));
});

// ====================================================
// === Aktivasi guild ===
// ====================================================

test('premium: activateGuildKey — guild fresh dapat expireAt = now + days', () => {
    const code = pm.generatePremiumKey({ plan: 'premium30' });
    const before = Date.now();
    const entry = pm.activateGuildKey({
        guildId: GUILD_A,
        guildName: 'Server A',
        keyCode: code,
        plan: 'premium30',
        activatedBy: '42',
        activatedByName: 'owner#0001',
        source: 'local'
    });
    const after = Date.now();

    assert.strictEqual(entry.guildId, GUILD_A);
    assert.strictEqual(entry.plan, 'premium30');
    const min = before + 30 * 86400000;
    const max = after + 30 * 86400000;
    assert.ok(entry.expireAt >= min && entry.expireAt <= max, 'expireAt = now + 30 hari');
    assert.ok(pm.isGuildPremium(GUILD_A), 'guild A sekarang premium');
});

test('premium: MAX EXTEND — aktivasi kedua ditaruh SETELAH sisa terpanjang', () => {
    // Guild A sudah punya premium30 dari test sebelumnya (fresh state 30 hari).
    const code = pm.generatePremiumKey({ plan: 'premium30' });
    const entry = pm.activateGuildKey({
        guildId: GUILD_A,
        keyCode: code,
        plan: 'premium30'
    });
    // Base = expireAt entry pertama (masih ~30 hari ke depan) → total ~60 hari.
    const status = pm.getGuildStatus(GUILD_A);
    assert.strictEqual(status.tier, 'premium');
    const daysLeft = (status.expireAt - Date.now()) / 86400000;
    assert.ok(
        daysLeft > 29 + 29 && daysLeft < 30 + 30 + 1,
        `sisa harus ~60 hari (dapat ${daysLeft.toFixed(1)}) — paket baru TIDAK boleh menimpa`
    );
    assert.ok(entry.expireAt > Date.now() + 29 * 86400000, 'entry kedua extend, bukan restart');
});

test('premium: lifetime — expireAt null dan tidak bisa ditimpa paket biasa', () => {
    const code = pm.generatePremiumKey({ plan: 'lifetime' });
    pm.activateGuildKey({ guildId: GUILD_B, keyCode: code, plan: 'lifetime' });

    const status = pm.getGuildStatus(GUILD_B);
    assert.strictEqual(status.tier, 'lifetime');
    assert.strictEqual(status.expireAt, null, 'lifetime = null');

    // Paket biasa setelah lifetime: entry baru tetap dibuat, tapi status guild
    // tetap lifetime (sisa terpanjang = selamanya).
    const code2 = pm.generatePremiumKey({ plan: 'premium30' });
    pm.activateGuildKey({ guildId: GUILD_B, keyCode: code2, plan: 'premium30' });
    assert.strictEqual(pm.getGuildStatus(GUILD_B).tier, 'lifetime');
});

test('premium: activateGuildKey menolak plan tidak dikenal & guildId kosong', () => {
    assert.throws(() => pm.activateGuildKey({ guildId: GUILD_A, plan: 'bogus' }), /Plan tidak dikenal/);
    assert.throws(() => pm.activateGuildKey({ guildId: '', plan: 'premium30' }), /guildId wajib/);
});

// ====================================================
// === Status, sweep, revoke ===
// ====================================================

test('premium: getGuildStatus guild tanpa langganan → tier null', () => {
    const status = pm.getGuildStatus('555000111222333444');
    assert.strictEqual(status.tier, null);
});

test('premium: sweepExpiredSubscriptions menghapus entry expired', () => {
    // Injeksi entry expired langsung ke file (simulasi waktu berlalu).
    const raw = JSON.parse(fs.readFileSync(realPath, 'utf8'));
    raw.subscriptions.push({
        id: 'sub_test_expired',
        guildId: '777888999000111222',
        guildName: 'Expired Server',
        keyCode: 'AAAAA-BBBBB-CCCCC',
        plan: 'premium30',
        days: 30,
        expireAt: Date.now() - 1000, // sudah lewat
        activatedAt: Date.now() - 31 * 86400000,
        activatedBy: '1',
        activatedByName: 'x',
        source: 'local'
    });
    fs.writeFileSync(realPath, JSON.stringify(raw));
    pm.invalidateStatusCacheAll();

    const expired = pm.sweepExpiredSubscriptions();
    assert.ok(expired.some(e => e.guildId === '777888999000111222'), 'entry expired harus ter-sweep');
    const after = JSON.parse(fs.readFileSync(realPath, 'utf8'));
    assert.ok(
        !after.subscriptions.some(s => s.guildId === '777888999000111222'),
        'entry expired hilang dari file'
    );
});

test('premium: revokeGuildSubscription menghapus semua entry guild', () => {
    const removed = pm.revokeGuildSubscription(GUILD_A);
    assert.ok(removed >= 1, `minimal 1 entry guild A terhapus (dapat ${removed})`);
    assert.strictEqual(pm.isGuildPremium(GUILD_A), false);
    assert.strictEqual(pm.revokeGuildSubscription(GUILD_A), 0, 'revoke kedua = 0');
});

// ====================================================
// === Util tampilan ===
// ====================================================

test('premium: formatRemaining — lifetime / hari / jam / kedaluwarsa', () => {
    assert.strictEqual(pm.formatRemaining(null), 'Seumur hidup (lifetime)');
    assert.match(pm.formatRemaining(Date.now() + 5 * 86400000), /5 hari lagi/);
    assert.match(pm.formatRemaining(Date.now() + 2 * 3600000), /2 jam lagi/);
    assert.strictEqual(pm.formatRemaining(Date.now() - 1000), 'Kedaluwarsa');
});

test('premium: maskKey menyembunyikan nilai penuh', () => {
    const masked = pm.maskKey('ABCDE-FGHJK-LMNPQ');
    assert.notStrictEqual(masked, 'ABCDE-FGHJK-LMNPQ');
    assert.ok(masked.startsWith('ABCDE'));
    assert.ok(masked.includes('•'));
});

test('premium: struktur file valid setelah semua operasi', () => {
    const raw = JSON.parse(fs.readFileSync(realPath, 'utf8'));
    assert.ok(Array.isArray(raw.subscriptions));
    assert.ok(Array.isArray(raw.keys));
    for (const s of raw.subscriptions) {
        assert.ok(s.id && s.guildId && s.plan, 'entry subscription punya field wajib');
        assert.ok(['local', 'remote'].includes(s.source));
    }
});

// Cleanup test-state non-expired milik GUILD_B (lifetime test) — file akan
// di-restore dari backup saat exit, ini cuma hygiene antar-file test.
opts(undefined);
