/**
 * Unit tests untuk userLock (TOCTOU race condition guard)
 */

const test = require('node:test');
const assert = require('node:assert');
const { acquire, release, withLock } = require('../../src/infra/userLock');

test('acquire: returns true for first acquire', () => {
    const scope = 'test_scope_1';
    const userId = 'user_1';
    assert.strictEqual(acquire(scope, userId), true);
    release(scope, userId);
});

test('acquire: returns false for second acquire (locked)', () => {
    const scope = 'test_scope_2';
    const userId = 'user_2';
    acquire(scope, userId);
    assert.strictEqual(acquire(scope, userId), false);
    release(scope, userId);
});

test('acquire: independent scopes do not block each other', () => {
    const userId = 'user_3';
    acquire('scope_a', userId);
    assert.strictEqual(acquire('scope_b', userId), true);
    release('scope_a', userId);
    release('scope_b', userId);
});

test('acquire: independent users do not block each other', () => {
    const scope = 'test_scope_4';
    acquire(scope, 'user_a');
    assert.strictEqual(acquire(scope, 'user_b'), true);
    release(scope, 'user_a');
    release(scope, 'user_b');
});

test('release: idempotent (safe to call without prior acquire)', () => {
    assert.doesNotThrow(() => release('unused_scope', 'unused_user'));
});

test('v3.9.8 FIX: acquire throws on missing scope or userId', () => {
    // Sebelum v3.9.8: return true (bypass lock) — hide bug.
    // Sekarang: throw error.
    assert.throws(() => acquire(null, 'user'), /scope dan userId wajib diisi/);
    assert.throws(() => acquire('scope', null), /scope dan userId wajib diisi/);
    assert.throws(() => acquire('', 'user'), /scope dan userId wajib diisi/);
});

test('withLock: executes fn and returns its result', async () => {
    const result = await withLock('test_scope_5', 'user_5', async () => {
        return 42;
    });
    assert.strictEqual(result, 42);
});

test('withLock: returns null when lock is busy', async () => {
    const scope = 'test_scope_6';
    const userId = 'user_6';
    acquire(scope, userId);
    const result = await withLock(scope, userId, async () => 'should not run');
    assert.strictEqual(result, null);
    release(scope, userId);
});

test('withLock: releases lock even when fn throws', async () => {
    const scope = 'test_scope_7';
    const userId = 'user_7';

    await assert.rejects(
        withLock(scope, userId, async () => { throw new Error('boom'); }),
        /boom/
    );

    // Lock should be released → can acquire again
    assert.strictEqual(acquire(scope, userId), true);
    release(scope, userId);
});

test('withLock: serializes concurrent calls', async () => {
    const scope = 'test_scope_8';
    const userId = 'user_8';
    const order = [];

    // 2 concurrent calls — second should wait (or skip if timeout)
    const p1 = withLock(scope, userId, async () => {
        order.push('start_1');
        await new Promise(r => setTimeout(r, 50));
        order.push('end_1');
    });
    const p2 = withLock(scope, userId, async () => {
        order.push('start_2');
        await new Promise(r => setTimeout(r, 50));
        order.push('end_2');
    });

    await Promise.all([p1, p2]);

    // p2 should have been skipped (lock busy) → only p1's starts/ends
    // p2 returns null silently
    assert.deepStrictEqual(order, ['start_1', 'end_1']);
});
