/**
 * Unit test v3.12.0 — SATU GUILD ID (anti bingung).
 *
 * Yang dibuktikan test ini:
 *   1. src/infra/guild.js — getPrimaryGuildId(): GUILD_ID di .env (trim)
 *      atau null. TIDAK ADA lagi allowlist multi-server (v3.11.0 dihapus).
 *   2. isGuildAllowed(): GUILD_ID kosong = mode publik (semua guild —
 *      perilaku v3.10.0/v3.11.0 mode terbuka tidak berubah), null/DM =
 *      false, GUILD_ID terisi = hanya guild itu.
 *   3. Guard event handler: guildMemberAdd/Remove dari guild lain
 *      diabaikan + TER-LOG menyebut GUILD_ID (kenapa); interactionCreate
 *      dari guild asing tidak pernah di-route.
 *   4. Gerbang klaim configManager: GUILD_ID terisi → guild lain tidak
 *      bisa "mencuri" config.json legacy; guild yang cocok tetap bisa.
 *   5. ready.js: startup memilih guild dari GUILD_ID (_startupGuilds) +
 *      kontrak statis registrasi (guild tunggal instan / global publik).
 *   6. PIN ANTI-BINGUNG: ALLOWED_GUILD_IDS tidak boleh muncul lagi di
 *      src/ manapun, .env.example, atau variabel yang diekspor guild.js.
 *
 * Env di-snapshot & direstore di finally() supaya test ini tidak bocor
 * ke test lain (pola welcomeDiagnostics.test.js).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { getPrimaryGuildId, isGuildAllowed, resolveGuildId } = require('../../src/infra/guild');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CONFIG_DIR = path.join(DATA_DIR, 'config');
const LEGACY = path.join(DATA_DIR, 'config.json');

/** Snapshot env lalu restore setelah test. */
async function withEnv(guild, fn) {
    const savedGuild = process.env.GUILD_ID;
    if (guild === undefined) delete process.env.GUILD_ID;
    else process.env.GUILD_ID = guild;
    try {
        await fn();
    } finally {
        if (savedGuild === undefined) delete process.env.GUILD_ID;
        else process.env.GUILD_ID = savedGuild;
    }
}

/** Tangkap console.log/warn/error selama fn jalan (output tetap bersih). */
async function captureConsole(fn) {
    const rows = [];
    const orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...a) => rows.push(['log', a.join(' ')]);
    console.warn = (...a) => rows.push(['warn', a.join(' ')]);
    console.error = (...a) => rows.push(['error', a.join(' ')]);
    try {
        await fn();
    } finally {
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
    }
    return rows;
}

// ====================================================
// === 1. getPrimaryGuildId() — SATU variabel        ===
// ====================================================

test('getPrimaryGuildId: GUILD_ID kosong → null (mode publik)', async () => {
    await withEnv(undefined, () => {
        assert.strictEqual(getPrimaryGuildId(), null, 'tanpa GUILD_ID = publik');
    });
});

test('getPrimaryGuildId: GUILD_ID terisi → nilainya (di-trim)', async () => {
    await withEnv('  guild_main  ', () => {
        assert.strictEqual(getPrimaryGuildId(), 'guild_main');
    });
});

test('getPrimaryGuildId: GUILD_ID string kosong (whitespace) → null', async () => {
    await withEnv('   ', () => {
        assert.strictEqual(getPrimaryGuildId(), null, 'whitespace-only dianggap kosong');
    });
});

// ====================================================
// === 2. Guard murni isGuildAllowed()                ===
// ====================================================

test('isGuildAllowed: GUILD_ID kosong (mode publik) → semua guild boleh', async () => {
    await withEnv(undefined, () => {
        assert.strictEqual(isGuildAllowed('111'), true);
        assert.strictEqual(isGuildAllowed('server_asing'), true, 'mode publik tidak menyaring');
    });
});

test('isGuildAllowed: GUILD_ID terisi → guild cocok true, guild lain false', async () => {
    await withEnv('guild_main', () => {
        assert.strictEqual(isGuildAllowed('guild_main'), true);
        assert.strictEqual(isGuildAllowed('guild_lain'), false, 'guild di luar GUILD_ID diblokir');
    });
});

test('isGuildAllowed: null / undefined (DM) → false', async () => {
    await withEnv('guild_main', () => {
        assert.strictEqual(isGuildAllowed(null), false);
        assert.strictEqual(isGuildAllowed(undefined), false);
    });
});

test('resolveGuildId: kontrak v3.10.0 tidak berubah oleh v3.12.0', () => {
    assert.strictEqual(resolveGuildId({ guildId: '111', guild: { id: '999' } }), '111');
    assert.strictEqual(resolveGuildId({ guild: { id: '999' } }), '999');
    assert.strictEqual(resolveGuildId(null), null);
});

// ====================================================
// === 3. Guard event handler memakai GUILD_ID       ===
// ====================================================

test('guard guildMemberAdd: join dari guild lain diabaikan + ter-log (menyebut GUILD_ID)', async () => {
    await withEnv('guild_main', async () => {
        const ev = require('../../src/bot/events/guildMemberAdd');
        const member = { guild: { id: 'guild_asing' } };
        const rows = await captureConsole(() => ev.execute(member));
        assert.ok(
            rows.some((r) => r[0] === 'warn' && /guild_asing/.test(r[1]) && /GUILD_ID/.test(r[1])),
            'skip harus kelihatan + menyebut GUILD_ID (pola v3.9.48)'
        );
    });
});

test('guard guildMemberRemove: leave dari guild lain diabaikan + ter-log (menyebut GUILD_ID)', async () => {
    await withEnv('guild_main', async () => {
        const ev = require('../../src/bot/events/guildMemberRemove');
        const member = { guild: { id: 'guild_asing' } };
        const rows = await captureConsole(() => ev.execute(member));
        assert.ok(
            rows.some((r) => r[0] === 'warn' && /guild_asing/.test(r[1]) && /GUILD_ID/.test(r[1])),
            'skip goodbye harus kelihatan + menyebut GUILD_ID'
        );
    });
});

test('guard interactionCreate: interaction guild asing tidak pernah di-route', async () => {
    await withEnv('guild_main', async () => {
        const ev = require('../../src/bot/events/interactionCreate');
        let routed = false;
        const interaction = {
            guildId: 'guild_asing',
            isChatInputCommand() {
                routed = true; // kalau guard lolos, ini pasti terpanggil
                return true;
            }
        };
        await captureConsole(() => ev.execute(interaction));
        assert.strictEqual(routed, false, 'interaction dari guild asing harus diblokir sebelum routing');
    });
});

// ====================================================
// === 4. Gerbang klaim legacy pakai GUILD_ID        ===
// ====================================================

test('klaim legacy v3.12.0: GUILD_ID terisi — guild asing dapat DEFAULTS, guild cocok klaim', async () => {
    // Sandbox: snapshot state config lama (kalau ada) lalu pasang legacy baru.
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const hadLegacy = fs.existsSync(LEGACY);
    if (hadLegacy) fs.copyFileSync(LEGACY, LEGACY + '.test-backup');
    const hadMigrated = fs.existsSync(LEGACY + '.migrated');
    if (hadMigrated) fs.copyFileSync(LEGACY + '.migrated', LEGACY + '.migrated.test-backup');
    const ownerPath = path.join(CONFIG_DIR, 'guild_owner_312.json');
    const strangerPath = path.join(CONFIG_DIR, 'guild_stranger_312.json');
    const hadOwner = fs.existsSync(ownerPath);
    const hadStranger = fs.existsSync(strangerPath);
    if (hadOwner) fs.copyFileSync(ownerPath, ownerPath + '.test-backup');
    if (hadStranger) fs.copyFileSync(strangerPath, strangerPath + '.test-backup');

    try {
        fs.writeFileSync(LEGACY, JSON.stringify({ channels: { welcome: 'ch_legacy_312' } }, null, 2));
        fs.rmSync(ownerPath, { force: true });
        fs.rmSync(strangerPath, { force: true });
        fs.rmSync(LEGACY + '.migrated', { force: true });
        // Reset flag in-process supaya klaim bisa diuji dari nol.
        const cm = require('../../src/data/configManager');
        if (typeof cm._resetLegacyClaimForTest === 'function') cm._resetLegacyClaimForTest();

        await withEnv('guild_owner_312', async () => {
            // 1) Guild asing memanggil duluan — TIDAK boleh mencuri legacy.
            const strangerConfig = cm.getConfig('guild_stranger_312');
            assert.notStrictEqual(
                strangerConfig.channels.welcome,
                'ch_legacy_312',
                'guild asing dapat DEFAULTS murni, bukan config legacy'
            );
            assert.ok(fs.existsSync(LEGACY), 'file legacy masih utuh (belum diklaim)');

            // 2) Guild yang cocok dengan GUILD_ID klaim legacy.
            const ownerConfig = cm.getConfig('guild_owner_312');
            assert.strictEqual(
                ownerConfig.channels.welcome,
                'ch_legacy_312',
                'guild GUILD_ID mengklaim config legacy'
            );
            assert.ok(fs.existsSync(ownerPath), 'config/guild_owner_312.json tercipta');
            assert.ok(fs.existsSync(LEGACY + '.migrated'), 'legacy di-rename .migrated (jejak audit)');
            assert.ok(!fs.existsSync(LEGACY), 'file legacy asli sudah pindah');
        });
    } finally {
        // Restore sandbox persis seperti semula.
        if (hadLegacy) fs.copyFileSync(LEGACY + '.test-backup', LEGACY);
        else fs.rmSync(LEGACY, { force: true });
        fs.rmSync(LEGACY + '.test-backup', { force: true });
        if (hadMigrated) fs.copyFileSync(LEGACY + '.migrated.test-backup', LEGACY + '.migrated');
        else fs.rmSync(LEGACY + '.migrated', { force: true });
        fs.rmSync(LEGACY + '.migrated.test-backup', { force: true });
        if (hadOwner) fs.copyFileSync(ownerPath + '.test-backup', ownerPath);
        else fs.rmSync(ownerPath, { force: true });
        fs.rmSync(ownerPath + '.test-backup', { force: true });
        if (hadStranger) fs.copyFileSync(strangerPath + '.test-backup', strangerPath);
        else fs.rmSync(strangerPath, { force: true });
        fs.rmSync(strangerPath + '.test-backup', { force: true });
    }
});

// ====================================================
// === 5. ready.js: startup guild + registrasi       ===
// ====================================================

test('_startupGuilds: GUILD_ID terisi → hanya guild itu yang ter-cache', async () => {
    const ready = require('../../src/bot/events/ready');
    const gA = { id: 'guild_main', name: 'A' };
    const gB = { id: 'guild_lain', name: 'B' };
    const client = { guilds: { cache: new Map([['guild_main', gA], ['guild_lain', gB]]) } };
    await withEnv('guild_main', () => {
        const picked = ready._startupGuilds(client);
        assert.deepStrictEqual(picked.map((g) => g.id), ['guild_main'], 'guild lain tidak ikut');
    });
});

test('_startupGuilds: GUILD_ID kosong → semua guild ter-cache (mode publik)', async () => {
    const ready = require('../../src/bot/events/ready');
    const gA = { id: '111', name: 'A' };
    const gB = { id: '222', name: 'B' };
    const client = { guilds: { cache: new Map([['111', gA], ['222', gB]]) } };
    await withEnv(undefined, () => {
        const picked = ready._startupGuilds(client);
        assert.strictEqual(picked.length, 2, 'mode publik = semua guild');
    });
});

test('_startupGuilds: GUILD_ID tidak ter-cache (bot belum di-invite) → [] tanpa throw', async () => {
    const ready = require('../../src/bot/events/ready');
    const gA = { id: '111', name: 'A' };
    const client = { guilds: { cache: new Map([['111', gA]]) } };
    await withEnv('999', () => {
        const picked = ready._startupGuilds(client);
        assert.deepStrictEqual(picked, [], '999 (belum di-invite) dilewati');
    });
});

test('kontrak statis ready.js: guild tunggal instan + global saat publik', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'bot', 'events', 'ready.js'), 'utf8');
    assert.match(src, /getPrimaryGuildId\(\)/, 'ready.js memakai GUILD_ID tunggal');
    assert.match(src, /guild\.commands\.set\(getCommands\(\)\)/, 'mode 1 server: daftar per-guild (instan)');
    assert.match(src, /client\.application\.commands\.set\(getCommands\(\)\)/, 'mode publik: global commands');
    assert.ok(!/ALLOWED_GUILD_IDS/.test(src), 'tidak ada lagi referensi allowlist');
    assert.ok(!/getAllowedGuildIds/.test(src), 'fungsi allowlist lama tidak dipakai');
});

// ====================================================
// === 6. PIN ANTI-BINGUNG: allowlist tidak kembali  ===
// ====================================================

test('PIN v3.12.0: ALLOWED_GUILD_IDS tidak boleh muncul di src/ manapun', () => {
    const srcRoot = path.join(__dirname, '..', '..', 'src');
    let violations = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) {
                const content = fs.readFileSync(full, 'utf8');
                if (content.includes('ALLOWED_GUILD_IDS') || content.includes('getAllowedGuildIds')) {
                    violations.push(path.relative(srcRoot, full));
                }
            }
        }
    };
    walk(srcRoot);
    assert.deepStrictEqual(violations, [], 'allowlist v3.11.0 harus terhapus total dari src/');
});

test('PIN v3.12.0: .env.example hanya punya GUILD_ID + mendokumentasikan mode publik', () => {
    const env = fs.readFileSync(path.join(__dirname, '..', '..', '.env.example'), 'utf8');
    assert.ok(env.includes('GUILD_ID='), 'variabel GUILD_ID ada');
    assert.ok(/mode publik/i.test(env), 'dokumentasi mode publik (ala Dyno) ada');
    assert.ok(!env.includes('ALLOWED_GUILD_IDS'), 'env example tidak menyebut allowlist lama');
    assert.strictEqual((env.match(/^GUILD_ID=/gm) || []).length, 1, 'tepat satu variabel GUILD_ID aktif');
});

test('PIN v3.12.0: guild.js hanya mengekspor resolveGuildId, getPrimaryGuildId, isGuildAllowed', () => {
    const guild = require('../../src/infra/guild');
    assert.deepStrictEqual(
        Object.keys(guild).sort(),
        ['getPrimaryGuildId', 'isGuildAllowed', 'resolveGuildId'],
        'kontrak ekspor v3.12.0 (tanpa allowlist)'
    );
});
