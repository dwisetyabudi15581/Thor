/**
 * Unit tests untuk premiumGate (v3.15.0) + integrasi router.
 *
 * Verify:
 *   - isGateEnabled: auto (default) → on hanya di mode publik; on/off override
 *   - FREE_COMMANDS berisi moderasi inti + komunitas dasar
 *   - checkCommandAccess: no-guild pass, bypass guild pass, premium admin
 *     pass, free command pass, guild berlangganan pass, guild free blocked
 *   - Integrasi routeCommand: command premium di guild free → embed upsell
 *     (ephemeral), command free tetap lewat gate
 *   - Kontrak: command 'premium' terdaftar di registry & ter-route
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
            fs.unlinkSync(realPath);
        }
    } catch (_) {}
});

const gate = require('../../src/infra/premiumGate');
const gpm = require('../../src/data/guildPremiumManager');

const GUILD_FREE = '111000222000333000';
const GUILD_SUB = '444000555000666000';
const GUILD_HOME = '777000888000999000';
const OWNER_ID = '1290700587373039619';

/** Mock interaction ala commandsRouter.test.js + konteks guild. */
function makeMockInteraction({ commandName, guildId = null, userId = '12345', isAdmin = false }) {
    const replies = [];
    return {
        isChatInputCommand: () => true,
        commandName,
        guildId: guildId || undefined,
        guild: guildId ? { id: guildId, name: 'Mock Server' } : undefined,
        isRepliable: () => true,
        replied: false,
        deferred: false,
        user: { id: userId, tag: 'user#0001', username: 'user' },
        member: {
            permissions: { has: () => isAdmin },
            roles: { cache: { has: () => false } },
            guild: guildId ? { id: guildId } : undefined
        },
        reply: async opts => {
            replies.push({ type: 'reply', opts });
            return {};
        },
        editReply: async opts => {
            replies.push({ type: 'editReply', opts });
            return {};
        },
        _replies: replies
    };
}

/** Save/restore env premium di sekitar satu test. */
async function withEnv(env, fn) {
    const keys = ['PREMIUM_GATE', 'PREMIUM_BYPASS_GUILDS', 'PREMIUM_ADMIN_IDS', 'GUILD_ID'];
    const saved = {};
    for (const k of keys) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
    try {
        for (const [k, v] of Object.entries(env)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        await fn();
    } finally {
        for (const k of keys) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
        gpm.invalidateStatusCacheAll();
    }
}

// ====================================================
// === isGateEnabled ===
// ====================================================

test('gate: auto (default) — aktif saat mode publik (GUILD_ID kosong)', async () => {
    await withEnv({ GUILD_ID: '' }, () => {
        assert.strictEqual(gate.isGateEnabled(), true, 'mode publik → gate aktif');
    });
});

test('gate: auto (default) — mati saat mode 1 server (GUILD_ID terisi)', async () => {
    await withEnv({ GUILD_ID: GUILD_HOME }, () => {
        assert.strictEqual(gate.isGateEnabled(), false, 'mode 1 server → gate mati (perilaku lama)');
    });
});

test('gate: PREMIUM_GATE=on memaksa aktif walau GUILD_ID terisi', async () => {
    await withEnv({ GUILD_ID: GUILD_HOME, PREMIUM_GATE: 'on' }, () => {
        assert.strictEqual(gate.isGateEnabled(), true);
    });
});

test('gate: PREMIUM_GATE=off memaksa mati walau mode publik', async () => {
    await withEnv({ GUILD_ID: '', PREMIUM_GATE: 'off' }, () => {
        assert.strictEqual(gate.isGateEnabled(), false);
    });
});

// ====================================================
// === FREE_COMMANDS — tier free ===
// ====================================================

test('gate: FREE_COMMANDS berisi moderasi inti + komunitas dasar', () => {
    for (const cmd of ['help', 'premium', 'timeout', 'untimeout', 'purge', 'kick', 'ban', 'unban',
        'warn', 'warn-list', 'warn-remove', 'warn-clear', 'setup-verify', 'set-verify-button',
        'config-show', 'my-stats', 'rank', 'leaderboard', 'leaderboard-level', 'boosters',
        'afk', 'afk-clear']) {
        assert.ok(gate.FREE_COMMANDS.includes(cmd), `${cmd} harus free`);
    }
});

test('gate: fitur jualan/otomasi TIDAK ada di FREE_COMMANDS', () => {
    for (const cmd of ['setup-ticket', 'add-product', 'set-key', 'set-midman-fee', 'giveaway',
        'setup-selfrole', 'setup-tempvoice', 'announce', 'backup-now', 'serverstats',
        'set-automod', 'send-message']) {
        assert.ok(!gate.FREE_COMMANDS.includes(cmd), `${cmd} harus premium`);
    }
});

// ====================================================
// === checkCommandAccess ===
// ====================================================

test('gate: interaksi tanpa guild (DM/mock) dibiarkan lewat', async () => {
    await withEnv({ GUILD_ID: '' }, () => {
        const r = gate.checkCommandAccess(makeMockInteraction({ commandName: 'giveaway' }));
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.reason, 'no-guild');
    });
});

test('gate: bypass guild (server rumah pemilik) selalu lolos', async () => {
    await withEnv({ GUILD_ID: '', PREMIUM_BYPASS_GUILDS: GUILD_HOME }, () => {
        const r = gate.checkCommandAccess(makeMockInteraction({ commandName: 'giveaway', guildId: GUILD_HOME }));
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.reason, 'bypass-guild');
    });
});

test('gate: pemilik bot (PREMIUM_ADMIN_IDS) lolos di guild manapun', async () => {
    await withEnv({ GUILD_ID: '', PREMIUM_ADMIN_IDS: OWNER_ID }, () => {
        const r = gate.checkCommandAccess(
            makeMockInteraction({ commandName: 'setup-ticket', guildId: GUILD_FREE, userId: OWNER_ID })
        );
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.reason, 'premium-admin');
    });
});

test('gate: command free lolos di guild tanpa langganan', async () => {
    await withEnv({ GUILD_ID: '' }, () => {
        const r = gate.checkCommandAccess(makeMockInteraction({ commandName: 'timeout', guildId: GUILD_FREE }));
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.reason, 'free-command');
    });
});

test('gate: command premium DIBLOKIR di guild tanpa langganan', async () => {
    await withEnv({ GUILD_ID: '' }, () => {
        const r = gate.checkCommandAccess(makeMockInteraction({ commandName: 'giveaway', guildId: GUILD_FREE }));
        assert.strictEqual(r.allowed, false);
        assert.strictEqual(r.reason, 'blocked');
    });
});

test('gate: command premium LOLOS di guild berlangganan', async () => {
    await withEnv({ GUILD_ID: '' }, () => {
        gpm.activateGuildKey({ guildId: GUILD_SUB, keyCode: 'TESTA-TESTB-TESTC', plan: 'premium30' });
        const r = gate.checkCommandAccess(makeMockInteraction({ commandName: 'giveaway', guildId: GUILD_SUB }));
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.reason, 'guild-premium');
    });
});

test('gate: gate off (mode 1 server) — semua command lolos', async () => {
    await withEnv({ GUILD_ID: GUILD_HOME }, () => {
        const r = gate.checkCommandAccess(makeMockInteraction({ commandName: 'giveaway', guildId: GUILD_FREE }));
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.reason, 'gate-off');
    });
});

// ====================================================
// === buildUpsellEmbed ===
// ====================================================

test('gate: upsell embed menyebut cara aktivasi + status command', () => {
    const embed = gate.buildUpsellEmbed('Server Mock');
    const json = embed.toJSON();
    assert.strictEqual(json.title, '🔒 Thor Premium');
    assert.ok(/premium activate/.test(json.description), 'harus menyebut /premium activate');
    assert.ok(/Server Mock/.test(json.description), 'harus menyebut nama guild');
});

// ====================================================
// === Integrasi router (routeCommand) ===
// ====================================================

test('router: command premium di guild free → diblokir gate dengan embed upsell', async () => {
    await withEnv({ GUILD_ID: '' }, async () => {
        const routeCommand = require('../../src/commands');
        const interaction = makeMockInteraction({ commandName: 'giveaway', guildId: GUILD_FREE, isAdmin: true });
        await routeCommand(interaction);
        assert.strictEqual(interaction._replies.length, 1, 'tepat satu reply');
        const opts = interaction._replies[0].opts;
        assert.ok(opts.embeds && opts.embeds.length === 1, 'reply berupa embed upsell');
        assert.match(opts.embeds[0].toJSON().title, /Thor Premium/);
    });
});

test('router: command free (timeout) di guild free → TIDAK diblokir gate', async () => {
    await withEnv({ GUILD_ID: '' }, async () => {
        const routeCommand = require('../../src/commands');
        const interaction = makeMockInteraction({ commandName: 'timeout', guildId: GUILD_FREE, isAdmin: true });
        // Mock has()=true → lolos cek admin AND cek moderator (MODERATION_COMMANDS);
        // handler moderation akan throw karena mock tidak lengkap — itu OK.
        try {
            await routeCommand(interaction);
        } catch (_) {}
        const upsell = interaction._replies.find(r => r.opts.embeds && /Thor Premium/.test(r.opts.embeds[0]?.toJSON()?.title || ''));
        assert.ok(!upsell, 'command free tidak boleh kena upsell premium');
        const blocked = interaction._replies.find(r => /Akses Ditolak/.test(r.opts?.content || ''));
        assert.ok(!blocked, 'moderator tidak boleh kena tolak admin');
    });
});

// ====================================================
// === Kontrak registry ↔ router ↔ gate ===
// ====================================================

test('kontrak: command premium terdaftar di registry, ter-route, dan free', () => {
    const { getCommands } = require('../../src/commands/registry');
    const routeCommand = require('../../src/commands');

    const registered = getCommands().map(c => c.name);
    assert.ok(registered.includes('premium'), '/premium terdaftar di registry');

    assert.strictEqual(routeCommand.COMMAND_TO_DOMAIN.premium, 'premium');
    assert.ok(routeCommand.DOMAIN_HANDLERS.premium, 'handler premium ter-map');

    // /premium harus free (member bisa cek status server).
    assert.ok(gate.FREE_COMMANDS.includes('premium'));
    assert.ok(routeCommand.PUBLIC_COMMANDS.includes('premium'));
});

test('kontrak: setiap command registry terklasifikasi (free atau premium, tanpa celah typo)', () => {
    // Mirror guard v3.9.24: tidak ada command yang "nyasar" — semua command
    // non-free otomatis premium saat gate aktif, jadi daftar free harus
    // EKSPLISIT dan hanya berisi command yang benar-benar ada di registry.
    const { getCommands } = require('../../src/commands/registry');
    const registered = new Set(getCommands().map(c => c.name));
    for (const cmd of gate.FREE_COMMANDS) {
        assert.ok(registered.has(cmd), `FREE_COMMANDS berisi command tak dikenal: ${cmd}`);
    }
});
