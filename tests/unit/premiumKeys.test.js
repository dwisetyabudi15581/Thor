/**
 * Unit tests untuk v3.13.0 — Premium SaaS: stok key + penukaran mandiri.
 *
 * Coverage:
 *   - generateKeyString: format, alphabet anti-ambigu, keunikan
 *   - createStockKey: field stok (status available, userId null, expireAt
 *     null = durasi belum jalan), validasi productName/roleId
 *   - redeemKey: sukses (status/expireAt dihitung SEJAK DITUKAR),
 *     permanen (days=0), semua kegagalan → pesan GENERIK (anti-enumeration),
 *     guild-scoped, atomic single-use (redeem kedua → generik)
 *   - listStockKeys: guild-scoped
 *   - revokeStockKey: sukses, sudah-ditukar → null, guild lain → null
 *   - Rate limiter /redeem: 5 kegagalan → limited, window 10 menit
 *     sliding (reset otomatis), sukses mereset hitungan
 *   - getStats/getStatsByGuild: key stok dihitung `available` TERPISAH
 *     (tidak masuk active/permanen)
 *   - removeExpiredKeys: stok (expireAt null) SELAMAT dari pembersihan
 *   - Kontrak registry/router: 4 command terdaftar, ter-route ke domain
 *     premium, /redeem PUBLIC + tanpa gate permission, 3 lain admin-gated
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// ====================================================
// === Snapshot & restore keys.json produksi (pola keyManager.test.js) ===
// ====================================================
const realKeysPath = path.join(__dirname, '..', '..', 'data', 'keys.json');
const keysBackupPath = realKeysPath + '.test-backup';
let keysBackedUp = false;
if (fs.existsSync(realKeysPath)) {
    fs.copyFileSync(realKeysPath, keysBackupPath);
    keysBackedUp = true;
    fs.unlinkSync(realKeysPath);
}
process.on('exit', () => {
    try {
        if (keysBackedUp) {
            fs.copyFileSync(keysBackupPath, realKeysPath);
            fs.rmSync(keysBackupPath, { force: true });
        } else if (fs.existsSync(realKeysPath)) {
            fs.unlinkSync(realKeysPath);
        }
    } catch (_) {}
});

const {
    generateKeyString,
    createStockKey,
    findKeyByString,
    redeemKey,
    listStockKeys,
    revokeStockKey,
    isRedeemRateLimited,
    noteRedeemFailure,
    noteRedeemSuccess,
    _resetRedeemRateLimitForTest,
    getStats,
    getStatsByGuild,
    removeExpiredKeys,
    getAllKeys
} = require('../../src/data/keyManager');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const KEY_RE = new RegExp(`^[${ALPHABET}]{5}(-[${ALPHABET}]{5}){2}$`);
const GENERIC_RE = /tidak valid atau sudah dipakai/i;

// ====================================================
// === generateKeyString ===
// ====================================================

test('v3.13.0 generateKeyString: format XXXXX-XXXXX-XXXXX + alphabet anti-ambigu (tanpa I/L/O/0/1)', () => {
    for (let i = 0; i < 25; i++) {
        const key = generateKeyString();
        assert.match(key, KEY_RE, `key "${key}" harus format 3 grup 5 char alphabet aman`);
        assert.strictEqual(key.length, 17, '3x5 char + 2 dash');
    }
});

test('v3.13.0 generateKeyString: tidak pernah duplikat dengan existing list', () => {
    const existing = [];
    for (let i = 0; i < 60; i++) {
        const key = generateKeyString(existing);
        existing.push({ key });
    }
    const unique = new Set(existing.map(e => e.key));
    assert.strictEqual(unique.size, existing.length, '60 key → semua unik');
});

// ====================================================
// === createStockKey ===
// ====================================================

test('v3.13.0 createStockKey: entry stok punya status available, userId null, expireAt null', () => {
    const entry = createStockKey({
        productName: 'VIP 30 Hari',
        roleId: 'role_vip',
        days: 30,
        guildId: 'guild_a',
        note: 'stok launch',
        createdBy: 'Admin#0001'
    });
    assert.ok(entry.id, 'punya id');
    assert.match(entry.key, KEY_RE);
    assert.strictEqual(entry.status, 'available');
    assert.strictEqual(entry.userId, null, 'belum ditukar siapa pun');
    assert.strictEqual(entry.expireAt, null, 'durasi BELUM jalan — dihitung saat redeem');
    assert.strictEqual(entry.guildId, 'guild_a');
    assert.strictEqual(entry.days, 30);
    assert.ok(entry.createdAt > 0);
    // Persisted
    const found = findKeyByString(entry.key);
    assert.ok(found, 'tersimpan ke keys.json');
    assert.strictEqual(found.status, 'available');
});

test('v3.13.0 createStockKey: throw tanpa productName / tanpa roleId (fail-fast)', () => {
    assert.throws(() => createStockKey({ roleId: 'r', days: 30, guildId: 'g' }), /nama produk/i);
    assert.throws(() => createStockKey({ productName: 'P', days: 30, guildId: 'g' }), /roleId/i);
});

test('v3.13.0 createStockKey: days=0 → key stok permanen-saat-ditukar (bukan error)', () => {
    const entry = createStockKey({ productName: 'VIP Permanen', roleId: 'r', days: 0, guildId: 'g' });
    assert.strictEqual(entry.days, 0);
    assert.strictEqual(entry.expireAt, null);
});

// ====================================================
// === redeemKey ===
// ====================================================

test('v3.13.0 redeemKey: sukses — status redeemed, expireAt = SEKARANG + days (durasi mulai saat ditukar)', () => {
    const stock = createStockKey({ productName: 'VIP 30', roleId: 'r1', days: 30, guildId: 'guild_a' });
    const before = Date.now();
    const redeemed = redeemKey(stock.key, { userId: 'user_x', username: 'X#0001', guildId: 'guild_a' });
    const after = Date.now();

    assert.strictEqual(redeemed.status, 'redeemed');
    assert.strictEqual(redeemed.userId, 'user_x');
    assert.strictEqual(redeemed.username, 'X#0001');
    assert.ok(redeemed.redeemedAt >= before && redeemed.redeemedAt <= after);
    // 30 hari sejak ditukar (toleransi beberapa ms eksekusi test)
    assert.ok(redeemed.expireAt >= before + 30 * 86400000, 'expireAt >= now + 30 hari');
    assert.ok(redeemed.expireAt <= after + 30 * 86400000, 'expireAt <= now + 30 hari');
});

test('v3.13.0 redeemKey: days=0 → expireAt null (permanen)', () => {
    const stock = createStockKey({ productName: 'VIP Perm', roleId: 'r1', days: 0, guildId: 'guild_a' });
    const redeemed = redeemKey(stock.key, { userId: 'user_p', username: 'P', guildId: 'guild_a' });
    assert.strictEqual(redeemed.expireAt, null);
});

test('v3.13.0 redeemKey: single-use — redeem KEDUA dengan key yang sama → generik', () => {
    const stock = createStockKey({ productName: 'VIP 7', roleId: 'r1', days: 7, guildId: 'guild_a' });
    redeemKey(stock.key, { userId: 'user_a', username: 'A', guildId: 'guild_a' });
    assert.throws(
        () => redeemKey(stock.key, { userId: 'user_b', username: 'B', guildId: 'guild_a' }),
        GENERIC_RE
    );
});

test('v3.13.0 redeemKey: key tidak ditemukan → pesan GENERIK (anti-enumeration)', () => {
    _resetRedeemRateLimitForTest();
    assert.throws(() => redeemKey('ZZZZZ-ZZZZZ-ZZZZZ', { userId: 'u', username: 'u', guildId: 'guild_a' }), GENERIC_RE);
});

test('v3.13.0 redeemKey: key legacy non-stok (sudah diklaim) → generik', () => {
    _resetRedeemRateLimitForTest();
    const { addKey } = require('../../src/data/keyManager');
    const legacy = addKey({
        key: 'LEGACY-CLAIMED-001',
        userId: 'user_legacy',
        username: 'Legacy',
        roleId: 'r1',
        productName: 'Legacy',
        days: 30,
        guildId: 'guild_a'
    });
    assert.ok(!legacy.status, 'key legacy tidak punya field status');
    assert.throws(
        () => redeemKey('LEGACY-CLAIMED-001', { userId: 'user_other', username: 'O', guildId: 'guild_a' }),
        GENERIC_RE
    );
});

test('v3.13.0 redeemKey: key stok guild LAIN → generik (guild-scoped, penting mode publik)', () => {
    _resetRedeemRateLimitForTest();
    const stock = createStockKey({ productName: 'VIP 7', roleId: 'r1', days: 7, guildId: 'guild_a' });
    assert.throws(
        () => redeemKey(stock.key, { userId: 'user_b', username: 'B', guildId: 'guild_b' }),
        GENERIC_RE
    );
});

test('v3.13.0 redeemKey: input kosong/whitespace → throw (tidak bocor ke validasi)', () => {
    assert.throws(() => redeemKey('   ', { userId: 'u', username: 'u', guildId: 'g' }));
    assert.throws(() => redeemKey('', { userId: 'u', username: 'u', guildId: 'g' }));
});

// ====================================================
// === listStockKeys + revokeStockKey ===
// ====================================================

test('v3.13.0 listStockKeys: guild-scoped — stok guild lain tidak muncul', () => {
    createStockKey({ productName: 'A', roleId: 'r', days: 7, guildId: 'guild_list_a' });
    createStockKey({ productName: 'B', roleId: 'r', days: 7, guildId: 'guild_list_b' });
    createStockKey({ productName: 'C', roleId: 'r', days: 7, guildId: 'guild_list_a' });
    const names = listStockKeys('guild_list_a').map(k => k.productName).sort();
    assert.deepStrictEqual(names, ['A', 'C'], 'cuma stok guild_list_a');
});

test('v3.13.0 revokeStockKey: sukses hapus key stok yang belum ditukar', () => {
    const stock = createStockKey({ productName: 'R', roleId: 'r', days: 7, guildId: 'guild_rev' });
    const removed = revokeStockKey(stock.key, 'guild_rev');
    assert.ok(removed, 'return entry yang dihapus');
    assert.strictEqual(removed.key, stock.key);
    assert.strictEqual(findKeyByString(stock.key), null, 'hilang dari keys.json');
    // Key yang sudah di-revoke tidak bisa ditukar
    assert.throws(
        () => redeemKey(stock.key, { userId: 'u', username: 'u', guildId: 'guild_rev' }),
        GENERIC_RE
    );
});

test('v3.13.0 revokeStockKey: key SUDAH ditukar → null (pencairan sah, bukan wewenang revoke)', () => {
    const stock = createStockKey({ productName: 'R2', roleId: 'r', days: 7, guildId: 'guild_rev2' });
    redeemKey(stock.key, { userId: 'u', username: 'u', guildId: 'guild_rev2' });
    assert.strictEqual(revokeStockKey(stock.key, 'guild_rev2'), null);
});

test('v3.13.0 revokeStockKey: stok guild lain → null (admin guild A tak bisa revoke guild B)', () => {
    const stock = createStockKey({ productName: 'R3', roleId: 'r', days: 7, guildId: 'guild_rev3' });
    assert.strictEqual(revokeStockKey(stock.key, 'guild_lain'), null);
    // ... dan stoknya tetap utuh
    assert.ok(findKeyByString(stock.key));
});

test('v3.13.0 revokeStockKey: key tidak ditemukan → null', () => {
    assert.strictEqual(revokeStockKey('ZZZZZ-ZZZZZ-ZZZZZ', 'guild_rev'), null);
});

// ====================================================
// === Rate limiter /redeem (anti brute-force) ===
// ====================================================

test('v3.13.0 rate limiter: 5 kegagalan → user kena cooldown, kegagalan ke-6 masih limited', () => {
    _resetRedeemRateLimitForTest();
    const uid = 'user_rl_1';
    for (let i = 0; i < 5; i++) {
        assert.strictEqual(isRedeemRateLimited(uid), false, `kegagalan ke-${i + 1} sebelum limited`);
        noteRedeemFailure(uid);
    }
    assert.strictEqual(isRedeemRateLimited(uid), true, 'setelah 5 kegagalan → limited');
    noteRedeemFailure(uid); // kegagalan ke-6 (dari handler saat generik throw)
    assert.strictEqual(isRedeemRateLimited(uid), true, 'masih limited');
});

test('v3.13.0 rate limiter: window 10 menit sliding — lewat window → reset otomatis', () => {
    _resetRedeemRateLimitForTest();
    const uid = 'user_rl_2';
    const t0 = 1000000000000;
    for (let i = 0; i < 5; i++) noteRedeemFailure(uid, t0);
    assert.strictEqual(isRedeemRateLimited(uid, t0 + 10 * 60 * 1000 - 1), true, 'di dalam window → limited');
    assert.strictEqual(isRedeemRateLimited(uid, t0 + 10 * 60 * 1000 + 1), false, 'window lewat → reset');
});

test('v3.13.0 rate limiter: redeem SUKSES mereset hitungan user', () => {
    _resetRedeemRateLimitForTest();
    const uid = 'user_rl_3';
    for (let i = 0; i < 4; i++) noteRedeemFailure(uid);
    noteRedeemSuccess(uid);
    assert.strictEqual(isRedeemRateLimited(uid), false, 'sukses → hitungan reset');
});

test('v3.13.0 rate limiter: user berbeda tidak saling memengaruhi', () => {
    _resetRedeemRateLimitForTest();
    for (let i = 0; i < 5; i++) noteRedeemFailure('user_rl_4a');
    assert.strictEqual(isRedeemRateLimited('user_rl_4a'), true);
    assert.strictEqual(isRedeemRateLimited('user_rl_4b'), false, 'user lain bersih');
});

// ====================================================
// === getStats / getStatsByGuild: stok dihitung TERPISAH ===
// ====================================================

test('v3.13.0 getStats: key stok dihitung `available`, TIDAK masuk active/permanen', () => {
    const before = getStats();
    createStockKey({ productName: 'S1', roleId: 'r', days: 30, guildId: 'guild_st' });
    createStockKey({ productName: 'S2', roleId: 'r', days: 0, guildId: 'guild_st' });
    const after = getStats();
    // Delta relatif (test lain bisa menyisakan data di file yang sama).
    assert.strictEqual(after.available - before.available, 2, 'dua stok baru terhitung available');
    assert.strictEqual(after.active - before.active, 0, 'stok TIDAK dihitung aktif');
    assert.strictEqual(after.permanent - before.permanent, 0, 'stok permanen-potensial TIDAK dihitung permanen');
    assert.strictEqual(after.total - before.total, 2);
});

test('v3.13.0 getStatsByGuild: available guild-scoped + stok guild lain tidak ikut', () => {
    const before = getStatsByGuild('guild_st2');
    createStockKey({ productName: 'S3', roleId: 'r', days: 30, guildId: 'guild_st2' });
    createStockKey({ productName: 'S4', roleId: 'r', days: 30, guildId: 'guild_st_lain' });
    const after = getStatsByGuild('guild_st2');
    assert.strictEqual(after.available - before.available, 1, 'cuma stok guild_st2');
});

// ====================================================
// === removeExpiredKeys: stok selamat (expireAt null) ===
// ====================================================

test('v3.13.0 removeExpiredKeys: key STOK tidak pernah dihapus oleh pembersih (expireAt null)', () => {
    const stock = createStockKey({ productName: 'KeepMe', roleId: 'r', days: 30, guildId: 'guild_keep' });
    removeExpiredKeys();
    assert.ok(findKeyByString(stock.key), 'stok bertahan — belum ditukar, belum ada durasi');
});

// ====================================================
// === Kontrak registry + router (pola v3.9.24 GUARD) ===
// ====================================================

test('v3.13.0 KONTRAK: /gen-key /redeem /list-stock /revoke-key terdaftar & ter-route ke domain premium', () => {
    const { getCommands } = require('../../src/commands/registry');
    const routeCommand = require('../../src/commands');

    const cmds = getCommands();
    assert.strictEqual(cmds.length, 96, '96 command (92 + 4 premium v3.13.0)');

    const byName = Object.fromEntries(cmds.map(c => [c.name, c]));
    for (const name of ['gen-key', 'redeem', 'list-stock', 'revoke-key']) {
        assert.ok(byName[name], `/${name} terdaftar di registry`);
        assert.strictEqual(
            routeCommand.COMMAND_TO_DOMAIN[name],
            'premium',
            `/${name} di-route ke domain premium`
        );
    }
    assert.strictEqual(typeof routeCommand.DOMAIN_HANDLERS.premium, 'function', 'handler premium ada');
});

test('v3.13.0 KONTRAK: /redeem PUBLIC (tanpa gate permission) — 3 command lain admin-gated', () => {
    const { getCommands } = require('../../src/commands/registry');
    const routeCommand = require('../../src/commands');
    const byName = Object.fromEntries(getCommands().map(c => [c.name, c]));

    assert.strictEqual(byName['redeem'].defaultMemberPermissions, undefined, '/redeem tanpa gate → semua member');
    for (const name of ['gen-key', 'list-stock', 'revoke-key']) {
        assert.ok(byName[name].defaultMemberPermissions, `/${name} admin-gated (ManageGuild)`);
    }

    assert.ok(routeCommand.PUBLIC_COMMANDS.includes('redeem'), '/redeem di PUBLIC_COMMANDS');
    for (const name of ['gen-key', 'list-stock', 'revoke-key']) {
        assert.ok(!routeCommand.PUBLIC_COMMANDS.includes(name), `/${name} bukan public`);
    }
});

test('v3.13.0 KONTRAK: /gen-key punya opsi value/count/note; /redeem & /revoke-key punya opsi key', () => {
    const { getCommands } = require('../../src/commands/registry');
    const byName = Object.fromEntries(getCommands().map(c => [c.name, c]));
    const genOpts = byName['gen-key'].options.map(o => o.name);
    assert.ok(genOpts.includes('value') && genOpts.includes('count') && genOpts.includes('note'));
    assert.strictEqual(byName['redeem'].options[0].name, 'key');
    assert.strictEqual(byName['revoke-key'].options[0].name, 'key');
});

test('v3.13.0 KONTRAK: premium.js handler memakai pesan generik yang SAMA dengan redeemKey (anti bocor enumerasi)', () => {
    // Baca source premium.js — pastikan string generik di handler identik
    // dengan yang di-throw keyManager.redeemKey (kalau beda, bocor mana
    // error dari data layer vs handler).
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'commands', 'premium.js'), 'utf8');
    assert.ok(src.includes('Key tidak valid atau sudah dipakai'), 'handler memakai pesan generik yang sama');
});
