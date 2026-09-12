/**
 * Unit test v3.11.0 — fase 2 multi-guild: allowlist ALLOWED_GUILD_IDS.
 *
 * Yang dibuktikan test ini:
 *   1. src/infra/guild.js — parsing daftar: koma + spasi, entri kosong
 *      dibuang, prioritas ALLOWED_GUILD_IDS > GUILD_ID (fallback kompat
 *      penuh dengan .env admin lama yang cuma punya GUILD_ID).
 *   2. isGuildAllowed(): daftar kosong = mode terbuka (semua guild —
 *      perilaku v3.10.0 tidak berubah), null/DM = false.
 *   3. Guard event handler memakai allowlist: guildMemberAdd dari guild
 *      di luar daftar diabaikan + TER-LOG (kenapa), interactionCreate dari
 *      guild di luar daftar tidak pernah di-route.
 *   4. Gerbang klaim configManager (v3.10.0) kini pakai allowlist:
 *      allowlist TUNGGAL → guild lain tidak bisa "mencuri" config.json
 *      legacy; guild yang cocok tetap bisa klaim.
 *   5. ready.js: startup memilih guild dari allowlist (_startupGuilds) +
 *      kontrak statis registrasi per-guild (loop semua guild allowlist,
 *      bukan cuma guild pertama).
 *
 * Env di-snapshot & direstore di finally() supaya test ini tidak bocor
 * ke test lain (pola welcomeDiagnostics.test.js).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { getAllowedGuildIds, isGuildAllowed, resolveGuildId } = require('../../src/infra/guild');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CONFIG_DIR = path.join(DATA_DIR, 'config');
const LEGACY = path.join(DATA_DIR, 'config.json');

/** Snapshot env allowlist lalu restore setelah test. */
async function withEnv(allow, guild, fn) {
    const savedAllow = process.env.ALLOWED_GUILD_IDS;
    const savedGuild = process.env.GUILD_ID;
    if (allow === undefined) delete process.env.ALLOWED_GUILD_IDS;
    else process.env.ALLOWED_GUILD_IDS = allow;
    if (guild === undefined) delete process.env.GUILD_ID;
    else process.env.GUILD_ID = guild;
    try {
        await fn();
    } finally {
        if (savedAllow === undefined) delete process.env.ALLOWED_GUILD_IDS;
        else process.env.ALLOWED_GUILD_IDS = savedAllow;
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
// === 1. Parsing daftar allowlist                    ===
// ====================================================

test('getAllowedGuildIds: env kosong → [] (mode terbuka)', async () => {
    await withEnv(undefined, undefined, () => {
        assert.deepStrictEqual(getAllowedGuildIds(), [], 'tanpa ALLOWED_GUILD_IDS & GUILD_ID');
    });
});

test('getAllowedGuildIds: fallback GUILD_ID tunggal (kompat .env lama)', async () => {
    await withEnv(undefined, 'guild_main', () => {
        assert.deepStrictEqual(getAllowedGuildIds(), ['guild_main']);
    });
});

test('getAllowedGuildIds: ALLOWED_GUILD_IDS multi — koma + spasi + entri kosong', async () => {
    await withEnv('111, 222 ,333,,', undefined, () => {
        assert.deepStrictEqual(getAllowedGuildIds(), ['111', '222', '333']);
    });
});

test('getAllowedGuildIds: ALLOWED_GUILD_IDS menang atas GUILD_ID', async () => {
    await withEnv('111,222', '999', () => {
        assert.deepStrictEqual(getAllowedGuildIds(), ['111', '222'], 'GUILD_ID diabaikan kalau allowlist terisi');
    });
});

// ====================================================
// === 2. Guard murni isGuildAllowed()                ===
// ====================================================

test('isGuildAllowed: daftar kosong (mode terbuka) → semua guild boleh', async () => {
    await withEnv(undefined, undefined, () => {
        assert.strictEqual(isGuildAllowed('111'), true);
        assert.strictEqual(isGuildAllowed('server_asing'), true, 'v3.10.0 open-mode tidak berubah');
    });
});

test('isGuildAllowed: anggota daftar true, guild asing false', async () => {
    await withEnv('111,222', undefined, () => {
        assert.strictEqual(isGuildAllowed('111'), true);
        assert.strictEqual(isGuildAllowed('222'), true);
        assert.strictEqual(isGuildAllowed('333'), false, 'guild di luar allowlist diblokir');
    });
});

test('isGuildAllowed: null / undefined (DM) → false', async () => {
    await withEnv('111,222', undefined, () => {
        assert.strictEqual(isGuildAllowed(null), false);
        assert.strictEqual(isGuildAllowed(undefined), false);
    });
});

test('resolveGuildId: kontrak v3.10.0 tidak berubah oleh fase 2', () => {
    assert.strictEqual(resolveGuildId({ guildId: '111', guild: { id: '999' } }), '111');
    assert.strictEqual(resolveGuildId({ guild: { id: '999' } }), '999');
    assert.strictEqual(resolveGuildId(null), null);
});

// ====================================================
// === 3. Guard event handler memakai allowlist      ===
// ====================================================

test('guard guildMemberAdd: join guild di luar allowlist diabaikan + ter-log', async () => {
    await withEnv('111,222', undefined, async () => {
        const ev = require('../../src/bot/events/guildMemberAdd');
        const member = { guild: { id: '333' } };
        const rows = await captureConsole(() => ev.execute(member));
        assert.ok(
            rows.some((r) => r[0] === 'warn' && /333/.test(r[1]) && /allowlist/i.test(r[1])),
            'skip harus kelihatan + menyebut allowlist (pola v3.9.48)'
        );
    });
});

test('guard interactionCreate: interaction guild asing tidak pernah di-route', async () => {
    await withEnv('111,222', undefined, async () => {
        const ev = require('../../src/bot/events/interactionCreate');
        let routed = false;
        const interaction = {
            guildId: '333',
            isChatInputCommand() {
                routed = true; // kalau guard lolos, ini pasti terpanggil
                return true;
            }
        };
        await captureConsole(() => ev.execute(interaction));
        assert.strictEqual(routed, false, 'interaction dari guild 333 harus diblokir sebelum routing');
    });
});

// ====================================================
// === 4. Gerbang klaim legacy pakai allowlist       ===
// ====================================================

test('klaim legacy v3.11.0: allowlist tunggal — guild asing dapat DEFAULTS, guild cocok klaim', async () => {
    // Sandbox: snapshot state config lama (kalau ada) lalu pasang legacy baru.
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const hadLegacy = fs.existsSync(LEGACY);
    if (hadLegacy) fs.copyFileSync(LEGACY, LEGACY + '.test-backup');
    const hadMigrated = fs.existsSync(LEGACY + '.migrated');
    if (hadMigrated) fs.copyFileSync(LEGACY + '.migrated', LEGACY + '.migrated.test-backup');
    const ownerPath = path.join(CONFIG_DIR, 'guild_owner_311.json');
    const strangerPath = path.join(CONFIG_DIR, 'guild_stranger_311.json');
    const hadOwner = fs.existsSync(ownerPath);
    const hadStranger = fs.existsSync(strangerPath);
    if (hadOwner) fs.copyFileSync(ownerPath, ownerPath + '.test-backup');
    if (hadStranger) fs.copyFileSync(strangerPath, strangerPath + '.test-backup');

    try {
        fs.writeFileSync(LEGACY, JSON.stringify({ channels: { welcome: 'ch_legacy_311' } }, null, 2));
        fs.rmSync(ownerPath, { force: true });
        fs.rmSync(strangerPath, { force: true });
        fs.rmSync(LEGACY + '.migrated', { force: true });
        // Reset flag in-process supaya klaim bisa diuji dari nol.
        const cm = require('../../src/data/configManager');
        if (typeof cm._resetLegacyClaimForTest === 'function') cm._resetLegacyClaimForTest();

        await withEnv('guild_owner_311', undefined, async () => {
            // 1) Guild asing memanggil duluan — TIDAK boleh mencuri legacy.
            const strangerConfig = cm.getConfig('guild_stranger_311');
            assert.notStrictEqual(
                strangerConfig.channels.welcome,
                'ch_legacy_311',
                'guild asing dapat DEFAULTS murni, bukan config legacy'
            );
            assert.ok(fs.existsSync(LEGACY), 'file legacy masih utuh (belum diklaim)');

            // 2) Guild yang cocok (satu-satunya anggota allowlist) klaim legacy.
            const ownerConfig = cm.getConfig('guild_owner_311');
            assert.strictEqual(
                ownerConfig.channels.welcome,
                'ch_legacy_311',
                'guild allowlist tunggal mengklaim config legacy'
            );
            assert.ok(fs.existsSync(ownerPath), 'config/guild_owner_311.json tercipta');
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

test('_startupGuilds: allowlist terisi → hanya guild allowlist yang ter-cache', async () => {
    const ready = require('../../src/bot/events/ready');
    const gA = { id: '111', name: 'A' };
    const gB = { id: '222', name: 'B' };
    const gC = { id: '333', name: 'C-asing' };
    const client = { guilds: { cache: new Map([['111', gA], ['222', gB], ['333', gC]]) } };
    await withEnv('111,222', undefined, () => {
        const picked = ready._startupGuilds(client);
        assert.deepStrictEqual(picked.map((g) => g.id).sort(), ['111', '222'], 'guild 333 tidak ikut');
    });
});

test('_startupGuilds: allowlist kosong → semua guild ter-cache (mode terbuka)', async () => {
    const ready = require('../../src/bot/events/ready');
    const gA = { id: '111', name: 'A' };
    const gB = { id: '222', name: 'B' };
    const client = { guilds: { cache: new Map([['111', gA], ['222', gB]]) } };
    await withEnv(undefined, undefined, () => {
        const picked = ready._startupGuilds(client);
        assert.strictEqual(picked.length, 2, 'mode terbuka = semua guild');
    });
});

test('_startupGuilds: guild allowlist yang tidak ter-cache di-skip tanpa throw', async () => {
    const ready = require('../../src/bot/events/ready');
    const gA = { id: '111', name: 'A' };
    const client = { guilds: { cache: new Map([['111', gA]]) } };
    await withEnv('111,999', undefined, () => {
        const picked = ready._startupGuilds(client);
        assert.deepStrictEqual(picked.map((g) => g.id), ['111'], '999 (belum di-invite) dilewati');
    });
});

test('kontrak statis ready.js: registrasi command loop SEMUA guild allowlist', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'bot', 'events', 'ready.js'), 'utf8');
    assert.match(src, /getAllowedGuildIds\(\)/, 'ready.js memakai allowlist');
    assert.match(src, /for \(const gid of allowed\)/, 'registrasi loop per guild allowlist');
    assert.match(src, /guild\.commands\.set\(getCommands\(\)\)/, 'masih daftar per-guild (instan)');
    assert.ok(!/const GUILD_ID = process\.env\.GUILD_ID/.test(src), 'variabel GUILD_ID lama sudah bersih');
});
