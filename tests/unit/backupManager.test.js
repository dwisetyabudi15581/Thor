/**
 * Unit tests untuk backupManager (data layer)
 *
 * Verify: createBackup, listBackups, restoreBackup, cleanOldBackups
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
    createBackup,
    listBackups,
    restoreBackup,
    formatSize,
    FILES_TO_BACKUP
} = require('../../src/data/backupManager');

// ====================================================
// === v3.9.24 FIX: sandbox backups/ produksi ===
// ====================================================
// Test sebelumnya bikin backup beneran di backups/ produksi DAN memicu
// cleanOldBackups() (keep-7) yang meng-EVICT backup asli. Sekarang: folder
// backups/ asli di-rename sementara saat test jalan, dikembalikan saat exit.
const realBackupsDir = path.join(__dirname, '..', '..', 'backups');
const stashBackupsDir = path.join(__dirname, '..', '..', 'backups_test_stash');
let backupsStashed = false;
if (fs.existsSync(realBackupsDir)) {
    fs.renameSync(realBackupsDir, stashBackupsDir);
    backupsStashed = true;
}
process.on('exit', () => {
    // Harus sync (dalam exit handler). Restore backups/ asli, buang hasil test.
    try {
        if (fs.existsSync(realBackupsDir)) {
            fs.rmSync(realBackupsDir, { recursive: true, force: true });
        }
        if (backupsStashed) {
            fs.renameSync(stashBackupsDir, realBackupsDir);
        }
    } catch (_) {}
});

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

// ====================================================
// === v3.9.24 GUARD: FILES_TO_BACKUP tidak boleh bolong ===
// ====================================================
// Bug nyata: automod.json (word rules auto-mod), levels.json, responders.json,
// afk.json, panels.json TIDAK pernah di-backup — /restore-backup tidak bisa
// memulihkan fitur-fitur itu. Guard: setiap file JSON live di data/ WAJIB
// ada di FILES_TO_BACKUP (test gagal kalau ada file baru yang lupa di-register).
test('v3.9.24 GUARD: FILES_TO_BACKUP mencakup semua file JSON live di data/', () => {
    const dataDir = path.join(__dirname, '..', '..', 'data');
    if (!fs.existsSync(dataDir)) {
        return; // fresh checkout tanpa data — tidak ada yang bisa bolong
    }
    const liveFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    if (liveFiles.length === 0) {
        // v3.9.60 FIX: fresh checkout / CI — data/ ada (gitkeep) tapi tidak punya
        // JSON runtime (semua data/*.json di-gitignore). Sebelumnya cabang ini
        // GAGAL di assertion bawah → npm test merah di setiap fresh clone.
        // Tidak ada file live di disk → tidak ada yang bisa bolong dari
        // FILES_TO_BACKUP. Registry-nya sendiri dijaga test regression khusus di bawah.
        return;
    }
    for (const f of liveFiles) {
        assert.ok(
            FILES_TO_BACKUP.includes(f),
            `File data live "${f}" TIDAK ada di FILES_TO_BACKUP — backup jadi bolong! Tambahkan ke src/data/backupManager.js`
        );
    }
});

// ====================================================
// === v3.9.60 REGRESSION: kelengkapan registry FILES_TO_BACKUP ===
// ====================================================
// GUARD test di atas cuma bisa menangkap bolongnya kalau data/ berisi file
// runtime live (tidak pernah benar di fresh clone / CI — data/*.json
// di-gitignore). Assertion registry ini bebas urutan & bebas environment,
// jadi lubang yang pernah ketemu di lapangan dipaten di sini selamanya.

test('v3.9.60 REGRESSION: modlogs.json ada di FILES_TO_BACKUP (bolong modLogManager v3.9.43)', () => {
    // Bug nyata: modLogManager (v3.9.43) menulis data/modlogs.json (riwayat
    // timeout/kick/ban per user yang ditampilkan /warn-list), tapi file itu
    // TIDAK PERNAH ditambahkan ke FILES_TO_BACKUP → /backup-now melewatinya
    // dan /restore-backup diam-diam kehilangan seluruh riwayat moderasi.
    assert.ok(
        FILES_TO_BACKUP.includes('modlogs.json'),
        'modlogs.json wajib ada di FILES_TO_BACKUP — riwayat moderasi dulunya senyap tidak ikut di-backup'
    );
});

test('v3.9.60 REGRESSION: semua nama file JSON manager data ada di FILES_TO_BACKUP', () => {
    // Cross-check manager yang persist ke data/<nama>.json (grep
    // path.join(..., 'data', '<file>.json') di src/data/*). Manager baru yang
    // lupa dapat entri FILES_TO_BACKUP mematahkan test ini — invarian yang sama
    // dengan GUARD file live di atas, tapi tetap hijau di fresh clone.
    // v3.10.0: 'config' kini DIREKTORI per-guild (data/config/<guildId>.json),
    // bukan file datar config.json.
    const managerFiles = [
        'config',
        'keys.json',
        'scheduledRoles.json',
        'selfRoles.json',
        'giveaways.json',
        'warns.json',
        'polls.json',
        'scheduledAnnouncements.json',
        'stats.json',
        'tempVoice.json',
        'tickets.json',
        'automod.json',
        'levels.json',
        'responders.json',
        'afk.json',
        'panels.json',
        'deals.json',
        'boosts.json',
        'serverstats.json',
        'modlogs.json'
    ];
    for (const f of managerFiles) {
        assert.ok(
            FILES_TO_BACKUP.includes(f),
            `"${f}" (file manager data layer) bolong dari FILES_TO_BACKUP — tambahkan ke src/data/backupManager.js`
        );
    }
});

// ====================================================
// === v3.9.60 REGRESSION: invalidasi cache pasca-restore ===
// ====================================================
// Bug nyata: boosts.json ikut di-restore sejak v3.9.49, tapi boostManager
// menyimpan cache in-memory `store` PERMANEN yang tidak pernah di-invalidate
// pasca-restore (cuma stats/serverstats/permissions/panels/automod/afk/
// responders/levels yang di-invalidate). Event boost pertama setelah restore
// memutasi objek SEBELUM-restore yang basi, lalu save() menimpanya ke
// boosts.json hasil restore → riwayat boost hasil restore hilang senyap.
// modlogs.json (masuk FILES_TO_BACKUP di v3.9.60) punya pola cache permanen
// yang sama → wajib di-invalidate juga.
test('v3.9.60 REGRESSION: restoreBackup meng-invalidate cache boostManager & modLogManager', () => {
    // 1. Buat backup asli yang berisi boosts.json + modlogs.json.
    const boostsPath = path.join(__dirname, '..', '..', 'data', 'boosts.json');
    const modlogsPath = path.join(__dirname, '..', '..', 'data', 'modlogs.json');
    const hadBoosts = fs.existsSync(boostsPath);
    const hadModlogs = fs.existsSync(modlogsPath);
    const oldBoosts = hadBoosts ? fs.readFileSync(boostsPath, 'utf8') : null;
    const oldModlogs = hadModlogs ? fs.readFileSync(modlogsPath, 'utf8') : null;
    // v3.9.60: fresh clone bisa tanpa folder data/ sama sekali (tidak ada
    // .gitkeep di repo ini) — pastikan foldernya ada sebelum menulis file test.
    fs.mkdirSync(path.join(__dirname, '..', '..', 'data'), { recursive: true });
    fs.writeFileSync(
        boostsPath,
        JSON.stringify({ 'g1:u1': { guildId: 'g1', userId: 'u1', totalBoosts: 7 } }),
        'utf8'
    );
    fs.writeFileSync(modlogsPath, JSON.stringify({ 'g1:u1': [{ id: 'mod_x', type: 'ban' }] }), 'utf8');
    try {
        const created = createBackup();
        assert.ok(created.ok, 'createBackup harus sukses');
        assert.ok(created.filesCopied >= 2, 'boosts.json + modlogs.json harus ikut dalam backup');

        // 2. Isi dulu cache permanen manager dengan state live saat ini.
        const boostManager = require('../../src/data/boostManager');
        const modLogManager = require('../../src/data/modLogManager');
        boostManager.getBoostHistory('g1'); // mengisi cache store
        modLogManager.getModLogs('g1', 'u1'); // mengisi cache store

        // 3. Ubah file live jadi SESUATU yang BERBEDA dari backup...
        fs.writeFileSync(
            boostsPath,
            JSON.stringify({ 'g1:u1': { guildId: 'g1', userId: 'u1', totalBoosts: 99 } }),
            'utf8'
        );
        fs.writeFileSync(modlogsPath, JSON.stringify({ 'g1:u1': [{ id: 'mod_y', type: 'kick' }] }), 'utf8');

        // 4. Restore backup (harus menyalin kembali nilai hasil backup DAN
        //    membuang cache in-memory basi). Restore ter-sandbox ke folder
        //    backups/ asli oleh stash di bagian atas file ini.
        const restored = restoreBackup(created.backupName);
        assert.ok(restored.ok, 'restoreBackup harus sukses');
        assert.strictEqual(
            JSON.parse(fs.readFileSync(boostsPath, 'utf8'))['g1:u1'].totalBoosts,
            7,
            'isi boosts.json harus yang hasil restore'
        );
        assert.strictEqual(
            JSON.parse(fs.readFileSync(modlogsPath, 'utf8'))['g1:u1'][0].id,
            'mod_x',
            'isi modlogs.json harus yang hasil restore'
        );

        // 5. INTI REGRESSION: cache harus mencerminkan data hasil RESTORE, bukan
        //    state sebelum-restore (cache store permanen yang masih menyimpan
        //    totalBoosts=99 / mod_y akan menimpa file hasil restore di save()
        //    berikutnya).
        assert.strictEqual(
            boostManager.getBoostHistory('g1').find(e => e.userId === 'u1')?.totalBoosts,
            7,
            'cache boostManager harus di-reload dari boosts.json hasil RESTORE (basi → data hilang senyap)'
        );
        assert.strictEqual(
            modLogManager.getModLogs('g1', 'u1')[0]?.id,
            'mod_x',
            'cache modLogManager harus di-reload dari modlogs.json hasil RESTORE (basi → data hilang senyap)'
        );
    } finally {
        // 6. Kembalikan kondisi file live seperti sebelum test.
        try {
            if (oldBoosts !== null) fs.writeFileSync(boostsPath, oldBoosts, 'utf8');
            else fs.rmSync(boostsPath, { force: true });
            if (oldModlogs !== null) fs.writeFileSync(modlogsPath, oldModlogs, 'utf8');
            else fs.rmSync(modlogsPath, { force: true });
        } catch (_) {}
        // Buang cache supaya test lain / start fresh berikutnya baca ulang dari disk.
        try {
            require('../../src/data/boostManager').reload();
            require('../../src/data/modLogManager').reload();
        } catch (_) {}
        void hadBoosts;
        void hadModlogs;
    }
});
