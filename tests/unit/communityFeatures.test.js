/**
 * Unit tests untuk v3.9.13 — 4 fitur community baru
 * - responderManager (auto-responder)
 * - automodManager (anti-spam)
 * - afkManager (AFK system)
 * - levelManager (leveling)
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ============ RESPONDER MANAGER ============

test('responderManager: addResponder creates entry', () => {
    const { addResponder, getGuildResponders, removeResponder } = require('../../src/data/responderManager');
    const result = addResponder('test_guild_resp', {
        trigger: '!test-trigger',
        reply: 'Test reply',
        replyType: 'text',
        createdBy: 'test_user',
        createdByTag: 'TestUser'
    });
    assert.ok(result.ok);
    assert.strictEqual(result.responder.trigger, '!test-trigger');
    assert.strictEqual(result.responder.reply, 'Test reply');

    const list = getGuildResponders('test_guild_resp');
    assert.ok(list.some(r => r.trigger === '!test-trigger'));

    removeResponder('test_guild_resp', '!test-trigger');
});

test('responderManager: duplicate trigger rejected', () => {
    const { addResponder, removeResponder } = require('../../src/data/responderManager');
    addResponder('test_guild_dup', {
        trigger: '!dup-test',
        reply: 'First',
        createdBy: 'u', createdByTag: 'U'
    });
    const result = addResponder('test_guild_dup', {
        trigger: '!dup-test',
        reply: 'Second',
        createdBy: 'u', createdByTag: 'U'
    });
    assert.ok(!result.ok);
    assert.match(result.error, /sudah ada/);
    removeResponder('test_guild_dup', '!dup-test');
});

test('responderManager: findMatch returns correct responder', () => {
    const { addResponder, findMatch, removeResponder, markUsed } = require('../../src/data/responderManager');
    addResponder('test_guild_match', {
        trigger: '!sosmed-test',
        reply: 'IG: @test',
        createdBy: 'u', createdByTag: 'U'
    });

    const match = findMatch('test_guild_match', '!sosmed-test halo');
    assert.ok(match);
    assert.strictEqual(match.trigger, '!sosmed-test');

    // No match untuk trigger lain
    const noMatch = findMatch('test_guild_match', '!lain');
    assert.strictEqual(noMatch, null);

    removeResponder('test_guild_match', '!sosmed-test');
});

test('responderManager: case-insensitive trigger match', () => {
    const { addResponder, findMatch, removeResponder } = require('../../src/data/responderManager');
    addResponder('test_guild_case', {
        trigger: '!SOSMED',
        reply: 'Test',
        createdBy: 'u', createdByTag: 'U'
    });

    const match = findMatch('test_guild_case', '!sosmed halo');
    assert.ok(match);

    removeResponder('test_guild_case', '!SOSMED');
});

// ============ AUTOMOD MANAGER ============

test('automodManager: getDefaultConfig returns valid structure', () => {
    const { getDefaultConfig } = require('../../src/data/automodManager');
    const config = getDefaultConfig();
    assert.ok('spamThreshold' in config);
    assert.ok('spamWindowMs' in config);
    assert.ok('spamAction' in config);
    assert.ok('blockLinks' in config);
    assert.ok('blockWords' in config);
    assert.ok('maxMentions' in config);
    assert.ok('enabled' in config);
});

test('automodManager: setGuildConfig persists updates', () => {
    const { setGuildConfig, getGuildConfig } = require('../../src/data/automodManager');
    setGuildConfig('test_guild_automod', { spamThreshold: 10, blockLinks: true });
    const config = getGuildConfig('test_guild_automod');
    assert.strictEqual(config.spamThreshold, 10);
    assert.strictEqual(config.blockLinks, true);
});

test('automodManager: containsLink detects URLs', () => {
    const { containsLink } = require('../../src/data/automodManager');
    assert.ok(containsLink('cek https://google.com'));
    assert.ok(containsLink('cek http://example.com'));
    assert.ok(containsLink('cek www.google.com'));
    assert.ok(!containsLink('pesan biasa tanpa link'));
});

test('automodManager: containsBlockedWord detects bad words', () => {
    const { containsBlockedWord } = require('../../src/data/automodManager');
    const blockWords = ['spam', 'scam'];
    assert.strictEqual(containsBlockedWord('ini spam banget', blockWords), 'spam');
    assert.strictEqual(containsBlockedWord('awas scam', blockWords), 'scam');
    assert.strictEqual(containsBlockedWord('pesan bersih', blockWords), null);
});

test('automodManager: checkSpam detects spam pattern', () => {
    const { checkSpam, resetSpamTracker, getDefaultConfig } = require('../../src/data/automodManager');
    const config = { ...getDefaultConfig(), spamThreshold: 3, spamWindowMs: 10000, enabled: true };
    resetSpamTracker('test_guild_spam', 'test_user_spam');

    // 3 pesan dalam window → spam (threshold 3, jadi pesan ke-4 yang trigger)
    // Actually checkSpam returns true kalau length > threshold
    assert.ok(!checkSpam('test_guild_spam', 'test_user_spam', config));  // 1 msg
    assert.ok(!checkSpam('test_guild_spam', 'test_user_spam', config));  // 2 msg
    assert.ok(!checkSpam('test_guild_spam', 'test_user_spam', config));  // 3 msg (== threshold, not >)
    assert.ok(checkSpam('test_guild_spam', 'test_user_spam', config));   // 4 msg (> threshold)

    resetSpamTracker('test_guild_spam', 'test_user_spam');
});

// ============ AFK MANAGER ============

test('afkManager: setAFK creates entry', () => {
    const { setAFK, getAFK, isAFK, clearAFK } = require('../../src/data/afkManager');
    setAFK('test_guild_afk', 'test_user_afk', 'Makan dulu');
    assert.ok(isAFK('test_guild_afk', 'test_user_afk'));
    const data = getAFK('test_guild_afk', 'test_user_afk');
    assert.strictEqual(data.reason, 'Makan dulu');
    clearAFK('test_guild_afk', 'test_user_afk');
});

test('afkManager: clearAFK removes entry', () => {
    const { setAFK, isAFK, clearAFK } = require('../../src/data/afkManager');
    setAFK('test_guild_clear', 'test_user_clear', 'AFK');
    assert.ok(isAFK('test_guild_clear', 'test_user_clear'));
    clearAFK('test_guild_clear', 'test_user_clear');
    assert.ok(!isAFK('test_guild_clear', 'test_user_clear'));
});

test('afkManager: AFK scoped per guild', () => {
    const { setAFK, isAFK, clearAFK } = require('../../src/data/afkManager');
    setAFK('guild_A', 'user_x', 'AFK di A');
    assert.ok(isAFK('guild_A', 'user_x'));
    assert.ok(!isAFK('guild_B', 'user_x'));  // not AFK in guild B
    clearAFK('guild_A', 'user_x');
});

test('afkManager: formatDuration returns readable string', () => {
    const { formatDuration } = require('../../src/data/afkManager');
    const now = Date.now();
    assert.match(formatDuration(now - 30 * 1000, now), /detik/);
    assert.match(formatDuration(now - 5 * 60 * 1000, now), /menit/);
    assert.match(formatDuration(now - 2 * 60 * 60 * 1000, now), /jam/);
    assert.match(formatDuration(now - 24 * 60 * 60 * 1000, now), /hari/);
});

// ============ LEVEL MANAGER ============

test('levelManager: xpForLevel formula', () => {
    const { xpForLevel } = require('../../src/data/levelManager');
    assert.strictEqual(xpForLevel(0), 0);
    assert.strictEqual(xpForLevel(1), 100);
    assert.strictEqual(xpForLevel(2), 300);
    assert.strictEqual(xpForLevel(5), 1500);
    assert.strictEqual(xpForLevel(10), 5500);
});

test('levelManager: levelFromXp correct calculation', () => {
    const { levelFromXp, xpForLevel } = require('../../src/data/levelManager');
    assert.strictEqual(levelFromXp(0), 0);
    assert.strictEqual(levelFromXp(99), 0);      // kurang dari 100 = level 0
    assert.strictEqual(levelFromXp(100), 1);     // exactly 100 = level 1
    assert.strictEqual(levelFromXp(299), 1);     // kurang dari 300 = level 1
    assert.strictEqual(levelFromXp(300), 2);     // exactly 300 = level 2
    assert.strictEqual(levelFromXp(1500), 5);    // exactly 1500 = level 5
});

test('levelManager: addXp increases level', () => {
    const { addXp, getUser } = require('../../src/data/levelManager');
    const config = { cooldownMs: 0 };  // no cooldown for test
    const gid = 'test_guild_lvl_' + Date.now();
    const uid = 'test_user_lvl_' + Date.now();

    // Add 100 XP → level 1
    const result1 = addXp(gid, uid, 100, config);
    assert.ok(result1.leveledUp);
    assert.strictEqual(result1.newLevel, 1);

    const user = getUser(gid, uid);
    assert.strictEqual(user.level, 1);
    assert.strictEqual(user.totalXp, 100);
});

test('levelManager: addXp respects cooldown', () => {
    const { addXp } = require('../../src/data/levelManager');
    const config = { cooldownMs: 60000 };  // 1 minute cooldown
    const gid = 'test_guild_cd_' + Date.now();
    const uid = 'test_user_cd_' + Date.now();

    // First call → gain XP
    const result1 = addXp(gid, uid, 50, config);
    assert.ok(!result1.onCooldown);

    // Second call immediately → on cooldown, no XP gain
    const result2 = addXp(gid, uid, 50, config);
    assert.ok(result2.onCooldown);
    assert.ok(!result2.leveledUp);
});

test('levelManager: getTopUsers returns sorted list', () => {
    const { addXp, getTopUsers } = require('../../src/data/levelManager');
    const config = { cooldownMs: 0 };

    // Add different XP to 3 users
    addXp('test_guild_top', 'user_low', 50, config);
    addXp('test_guild_top', 'user_mid', 200, config);
    addXp('test_guild_top', 'user_high', 500, config);

    const top = getTopUsers('test_guild_top', 10);
    assert.ok(top.length >= 3);
    // Sorted descending by totalXp
    assert.strictEqual(top[0].userId, 'user_high');
    assert.strictEqual(top[1].userId, 'user_mid');
    assert.strictEqual(top[2].userId, 'user_low');
});

test('levelManager: getRoleForLevel returns correct role', () => {
    const { getRoleForLevel } = require('../../src/data/levelManager');
    const config = {
        levelRoles: [
            { level: 10, roleId: 'role_10' },
            { level: 50, roleId: 'role_50' }
        ]
    };
    assert.strictEqual(getRoleForLevel(5, config), null);     // below any threshold
    assert.strictEqual(getRoleForLevel(10, config), 'role_10');
    assert.strictEqual(getRoleForLevel(30, config), 'role_10');  // still role_10 (highest <= 30)
    assert.strictEqual(getRoleForLevel(50, config), 'role_50');
    assert.strictEqual(getRoleForLevel(100, config), 'role_50'); // still role_50
});

// ============ CONFIG MANAGER — leveling config ============

test('configManager: leveling config defaults applied', () => {
    const { getConfig } = require('../../src/data/configManager');
    const config = getConfig();
    assert.ok(config.leveling);
    assert.strictEqual(config.leveling.enabled, false);  // default off
    assert.ok('xpPerMessage' in config.leveling);
    assert.ok('cooldownMs' in config.leveling);
    assert.ok(Array.isArray(config.levelRoles));
});
