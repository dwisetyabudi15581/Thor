/**
 * Unit tests untuk backupManager (data layer)
 *
 * Verify: createBackup, listBackups, restoreBackup, cleanOldBackups
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { createBackup, listBackups, restoreBackup, formatSize } = require('../../src/data/backupManager');

test('backupManager: formatSize handles various sizes', () => {
    assert.strictEqual(formatSize(0), '0 B');
    assert.strictEqual(formatSize(512), '512 B');
    assert.strictEqual(formatSize(1024), '1.0 KB');
    assert.strictEqual(formatSize(1536), '1.5 KB');
    assert.strictEqual(formatSize(1048576), '1.00 MB');
    assert.strictEqual(formatSize(1572864), '1.50 MB');
});

test('backupManager: createBackup returns valid structure', () => {
    const result = createBackup();
    assert.ok(typeof result === 'object');
    assert.ok('ok' in result);
    assert.ok('backupName' in result);
    assert.ok('filesCopied' in result);
    assert.ok('totalSize' in result);
    assert.ok('errors' in result);
    assert.ok(Array.isArray(result.errors));
    assert.ok(typeof result.backupName === 'string');
    assert.ok(typeof result.filesCopied === 'number');
    assert.ok(typeof result.totalSize === 'number');
});

test('backupManager: createBackup result.ok is true when files copied', () => {
    const result = createBackup();
    if (result.filesCopied > 0) {
        assert.strictEqual(result.ok, true);
    }
    // Kalau filesCopied === 0 (no data files yet), ok bisa false — itu OK.
});

test('backupManager: listBackups returns array', () => {
    const backups = listBackups();
    assert.ok(Array.isArray(backups));
    for (const b of backups) {
        assert.ok('name' in b);
        assert.ok('size' in b);
        assert.ok('fileCount' in b);
        assert.ok('mtime' in b);
    }
});

test('backupManager: restoreBackup rejects invalid name format', () => {
    const result = restoreBackup('invalid-name-without-timestamp');
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.length > 0);
    assert.match(result.errors[0], /Invalid backup name format/i);
});

test('backupManager: restoreBackup rejects path traversal attempts', () => {
    const result = restoreBackup('../../../etc/passwd');
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.length > 0);
    // Bisa match "Invalid backup name format" atau "path traversal"
    assert.ok(/Invalid|path traversal/i.test(result.errors[0]));
});

test('backupManager: restoreBackup rejects non-existent backup', () => {
    // Valid format tapi tidak ada di disk
    const result = restoreBackup('2020-01-01_00-00-00');
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.length > 0);
    assert.match(result.errors[0], /tidak ditemukan/i);
});

test('backupManager: createBackup + listBackups integration', () => {
    // Create backup
    const createResult = createBackup();
    assert.ok(createResult.ok, 'create should succeed');

    // List backups — should include the one we just created
    const backups = listBackups();
    const found = backups.find(b => b.name === createResult.backupName);
    assert.ok(found, 'created backup should appear in listBackups');
});
