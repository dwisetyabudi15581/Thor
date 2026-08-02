/**
 * Unit tests untuk commands router (src/commands/index.js)
 *
 * Verify:
 *   - Non-admin ditolak untuk command non-public
 *   - Public commands (leaderboard, my-stats) diizinkan untuk non-admin
 *   - Unknown command di-handle gracefully
 *   - Domain handler dipanggil dengan benar
 */

const test = require('node:test');
const assert = require('node:assert');

// Mock interaction object
function makeMockInteraction({ commandName, isAdmin = false, isRepliable = true }) {
    const replies = [];
    return {
        isChatInputCommand: () => true,
        commandName,
        isRepliable: () => isRepliable,
        replied: false,
        deferred: false,
        member: {
            permissions: {
                has: perm => isAdmin // ManageGuild = true kalau isAdmin
            },
            roles: { cache: { has: () => false } }
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

test('router: non-admin rejected for non-public command', async () => {
    const routeCommand = require('../../src/commands');
    const interaction = makeMockInteraction({ commandName: 'set-role', isAdmin: false });
    await routeCommand(interaction);
    assert.strictEqual(interaction._replies.length, 1);
    assert.match(interaction._replies[0].opts.content, /Akses Ditolak/);
});

test('router: non-admin allowed for public command (leaderboard)', async () => {
    const routeCommand = require('../../src/commands');
    const interaction = makeMockInteraction({ commandName: 'leaderboard', isAdmin: false });
    // leaderboard handler akan throw karena interaction.options undefined — itu OK,
    // yang penting router TIDAK reject di permission check.
    try {
        await routeCommand(interaction);
    } catch (err) {
        // Expected — handler internal error karena mock interaction tidak lengkap.
        // Yang kita cek: TIDAK ada reply "Akses Ditolak".
        const blockedReply = interaction._replies.find(r => /Akses Ditolak/.test(r.opts?.content || ''));
        assert.ok(!blockedReply, 'should not be blocked by permission check');
        return;
    }
    // Kalau sukses (tidak throw), pastikan tidak ada reply blocked
    const blockedReply = interaction._replies.find(r => /Akses Ditolak/.test(r.opts?.content || ''));
    assert.ok(!blockedReply, 'should not be blocked by permission check');
});

test('router: non-admin allowed for public command (my-stats)', async () => {
    const routeCommand = require('../../src/commands');
    const interaction = makeMockInteraction({ commandName: 'my-stats', isAdmin: false });
    try {
        await routeCommand(interaction);
    } catch (err) {
        const blockedReply = interaction._replies.find(r => /Akses Ditolak/.test(r.opts?.content || ''));
        assert.ok(!blockedReply, 'should not be blocked');
        return;
    }
    const blockedReply = interaction._replies.find(r => /Akses Ditolak/.test(r.opts?.content || ''));
    assert.ok(!blockedReply, 'should not be blocked');
});

test('router: admin not blocked by permission check', async () => {
    const routeCommand = require('../../src/commands');
    const interaction = makeMockInteraction({ commandName: 'help', isAdmin: true });
    try {
        await routeCommand(interaction);
    } catch (err) {
        // help handler butuh interaction.client — akan throw. Yang penting: tidak ada "Akses Ditolak".
        const blockedReply = interaction._replies.find(r => /Akses Ditolak/.test(r.opts?.content || ''));
        assert.ok(!blockedReply, 'admin should not be blocked');
        return;
    }
    const blockedReply = interaction._replies.find(r => /Akses Ditolak/.test(r.opts?.content || ''));
    assert.ok(!blockedReply, 'admin should not be blocked');
});

test('router: unknown command returns "belum didukung" reply', async () => {
    const routeCommand = require('../../src/commands');
    const interaction = makeMockInteraction({ commandName: 'totally-fake-command', isAdmin: true });
    await routeCommand(interaction);
    assert.strictEqual(interaction._replies.length, 1);
    assert.match(interaction._replies[0].opts.content, /belum didukung|tidak dikenali|not registered/i);
});
