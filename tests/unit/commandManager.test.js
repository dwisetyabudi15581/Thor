/**
 * Unit tests untuk Command Manager v3.19.0 (ala Dyno).
 *
 * Verify:
 *   - normalizeDisabledList: valid + dedupe, command tak dikenal, command
 *     protected (/commands), non-array, >100 entri
 *   - Router gate: command yang dinonaktifkan ditolak ephemeral dengan pesan
 *     jelas; /commands sendiri TIDAK PERNAH diblokir gate (anti-lockout);
 *     command aktif lolos gate seperti biasa
 *   - Kontrak Discord↔web: normalizeDisabledList dipakai DASH API (lihat
 *     dashServer.test.js) — aturan identik di kedua interface
 *
 * File config guild test di-snapshot & restore (pola dashServer.test.js).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dataConfigDir = path.join(__dirname, '..', '..', 'data', 'config');
const GUILD_ID = '999555999555999555';
const CONFIG_PATH = path.join(dataConfigDir, `${GUILD_ID}.json`);

// Snapshot & restore
const hadConfig = fs.existsSync(CONFIG_PATH);
const configBackup = hadConfig ? fs.readFileSync(CONFIG_PATH) : null;
if (hadConfig) fs.unlinkSync(CONFIG_PATH);

process.on('exit', () => {
    try {
        if (hadConfig) fs.writeFileSync(CONFIG_PATH, configBackup);
        else if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
    } catch (_) {}
});

const { getCommands } = require('../../src/commands/registry');
const commandsHandler = require('../../src/commands/commands');
const { normalizeDisabledList, getDisabledCommands, PROTECTED_COMMANDS } = commandsHandler;
const { getConfig, saveConfig } = require('../../src/data/configManager');
const routeCommand = require('../../src/commands');

// ====================================================
// === normalizeDisabledList (aturan bersama Discord & web) ===
// ====================================================

test('cmdmgr: normalize — valid + dedupe', () => {
    const result = normalizeDisabledList(['giveaway', 'poll', 'giveaway', 'warn']);
    assert.ok(result.ok);
    assert.deepStrictEqual(result.value, ['giveaway', 'poll', 'warn']);
});

test('cmdmgr: normalize — command tak dikenal ditolak', () => {
    const result = normalizeDisabledList(['giveaway', 'hocus-pocus']);
    assert.ok(!result.ok);
    assert.match(result.error, /hocus-pocus/);
});

test('cmdmgr: normalize — command protected (/commands) ditolak', () => {
    const result = normalizeDisabledList(['commands']);
    assert.ok(!result.ok);
    assert.match(result.error, /tidak bisa dinonaktifkan/);
});

test('cmdmgr: normalize — non-array ditolak', () => {
    assert.ok(!normalizeDisabledList('giveaway').ok);
    assert.ok(!normalizeDisabledList(null).ok);
});

test('cmdmgr: normalize — lebih dari 100 entri ditolak', () => {
    const list = Array.from({ length: 101 }, (_, i) => `cmd-${i}`);
    // cmd-* tidak terdaftar — tapi cek urutan guard: limit dicek SEBELUM lookup
    // nama, jadi pesan error harus soal jumlah, bukan nama tak dikenal.
    const result = normalizeDisabledList(list);
    assert.ok(!result.ok);
    assert.match(result.error, /100/);
});

test('cmdmgr: registry — /commands terdaftar (92) & ter-map ke domain sendiri', () => {
    const cmds = getCommands();
    assert.strictEqual(cmds.length, 92);
    assert.ok(cmds.some((c) => c.name === 'commands'));
    assert.strictEqual(routeCommand.COMMAND_TO_DOMAIN.commands, 'commands');
});

// ====================================================
// === Router gate ===
// ====================================================

function makeMockInteraction({ commandName, isAdmin = true, guildId = GUILD_ID }) {
    const replies = [];
    return {
        isChatInputCommand: () => true,
        commandName,
        guildId,
        isRepliable: () => true,
        replied: false,
        deferred: false,
        member: {
            permissions: { has: () => isAdmin },
            roles: { cache: { has: () => false } }
        },
        reply: async (opts) => {
            replies.push({ type: 'reply', opts });
            return {};
        },
        editReply: async (opts) => {
            replies.push({ type: 'editReply', opts });
            return {};
        },
        _replies: replies
    };
}

function setDisabled(list) {
    const config = getConfig(GUILD_ID);
    config.disabledCommands = list;
    saveConfig(GUILD_ID, config);
}

test('cmdmgr: router — command dinonaktifkan ditolak dengan pesan jelas', async () => {
    setDisabled(['giveaway']);
    const interaction = makeMockInteraction({ commandName: 'giveaway' });
    await routeCommand(interaction);
    assert.strictEqual(interaction._replies.length, 1);
    assert.match(interaction._replies[0].opts.content, /dinonaktifkan/);
    assert.match(interaction._replies[0].opts.content, /\/commands toggle/);
    assert.ok(interaction._replies[0].opts.flags, 'ephemeral');
});

test('cmdmgr: router — /commands sendiri tidak pernah diblokir gate (anti-lockout)', async () => {
    // Simulasi config "nakal": /commands ada di daftar disabled (bisa terjadi
    // kalau file diedit manual). Gate tetap harus meloloskannya.
    setDisabled(['giveaway', 'commands']);
    const interaction = makeMockInteraction({ commandName: 'commands' });
    try {
        await routeCommand(interaction);
    } catch (_) {
        // Handler /commands butuh interaction.options lengkap — throw di sini
        // OK; yang penting TIDAK ada reply "dinonaktifkan".
    }
    const blocked = interaction._replies.find((r) => /dinonaktifkan/.test(r.opts?.content || ''));
    assert.ok(!blocked, '/commands tidak boleh bisa diblokir gate');
});

test('cmdmgr: router — command aktif lolos gate', async () => {
    setDisabled(['giveaway']);
    const interaction = makeMockInteraction({ commandName: 'backup-now' });
    try {
        await routeCommand(interaction);
    } catch (_) {
        // Handler backup-now butuh interaction.options/client — throw OK.
    }
    const blocked = interaction._replies.find((r) => /dinonaktifkan/.test(r.opts?.content || ''));
    assert.ok(!blocked, 'command aktif tidak boleh tersangkut gate');
});

test('cmdmgr: router — interaksi tanpa guildId (DM) lolos gate', async () => {
    setDisabled(['giveaway']);
    const interaction = makeMockInteraction({ commandName: 'giveaway', guildId: null });
    try {
        await routeCommand(interaction);
    } catch (_) {
        // Handler throw karena guild undefined — OK, gate tidak crash.
    }
    const blocked = interaction._replies.find((r) => /dinonaktifkan oleh admin/.test(r.opts?.content || ''));
    assert.ok(!blocked, 'DM tidak punya config guild — tidak boleh diblokir');
});

test('cmdmgr: getDisabledCommands — config tanpa field → array kosong', () => {
    assert.deepStrictEqual(getDisabledCommands({}), []);
    assert.deepStrictEqual(getDisabledCommands(null), []);
    assert.deepStrictEqual(getDisabledCommands({ disabledCommands: ['poll'] }), ['poll']);
});

test('cmdmgr: PROTECTED_COMMANDS berisi /commands', () => {
    assert.deepStrictEqual(PROTECTED_COMMANDS, ['commands']);
});
