/**
 * Auto-Backup System — backup file JSON penting ke folder backups/.
 *
 * File yang di-backup:
 *   - config.json
 *   - keys.json
 *   - scheduledRoles.json
 *   - selfRoles.json
 *   - giveaways.json (kalau ada)
 *   - warns.json (kalau ada)
 *   - polls.json (kalau ada)
 *   - scheduledAnnouncements.json (kalau ada)
 *   - tempVoice.json (v3.8, kalau ada)
 *
 * Struktur folder:
 *   backups/
 *     2026-07-31_15-30-00/
 *       config.json
 *       keys.json
 *       ...
 *     2026-07-31_09-00-00/
 *       ...
 *
 * Auto-clean: maks 7 backup terbaru disimpan, sisanya dihapus.
 *
 * Backup otomatis:
 *   - Saat bot start (backup-on-boot)
 *   - Setiap 24 jam (interval)
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const backupsDir = path.join(rootDir, 'backups');

const FILES_TO_BACKUP = [
    'config.json',
    'keys.json',
    'scheduledRoles.json',
    'selfRoles.json',
    'giveaways.json',
    'warns.json',
    'polls.json',
    'scheduledAnnouncements.json',
    'stats.json',
    'tempVoice.json'
];

const MAX_BACKUPS = 7;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Bikin folder backups/ kalau belum ada.
 */
function ensureBackupsDir() {
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }
}

/**
 * Format timestamp jadi nama folder yang aman untuk filesystem.
 * Format: YYYY-MM-DD_HH-mm-ss
 */
function formatTimestamp(ts = new Date()) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
           `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/**
 * Bikin backup sekarang.
 * @returns {Object} { ok, backupName, filesCopied, totalSize, errors[] }
 */
function createBackup() {
    ensureBackupsDir();
    const name = formatTimestamp();
    const targetDir = path.join(backupsDir, name);
    fs.mkdirSync(targetDir, { recursive: true });

    const result = { ok: true, backupName: name, filesCopied: 0, totalSize: 0, errors: [] };

    for (const file of FILES_TO_BACKUP) {
        const src = path.join(rootDir, file);
        const dst = path.join(targetDir, file);
        try {
            if (fs.existsSync(src)) {
                const stats = fs.statSync(src);
                fs.copyFileSync(src, dst);
                result.filesCopied++;
                result.totalSize += stats.size;
            }
        } catch (err) {
            result.errors.push(`${file}: ${err.message}`);
        }
    }

    // Auto-clean backup lama
    cleanOldBackups();

    return result;
}

/**
 * Hapus backup lama, simpan maks MAX_BACKUPS terbaru.
 * @returns {number} jumlah backup yang dihapus
 */
function cleanOldBackups() {
    ensureBackupsDir();
    const entries = fs.readdirSync(backupsDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => ({ name: e.name, mtime: fs.statSync(path.join(backupsDir, e.name)).mtime }))
        .sort((a, b) => b.mtime - a.mtime); // terbaru di depan

    let removed = 0;
    for (let i = MAX_BACKUPS; i < entries.length; i++) {
        try {
            fs.rmSync(path.join(backupsDir, entries[i].name), { recursive: true, force: true });
            removed++;
        } catch (_) {}
    }
    return removed;
}

/**
 * List semua backup yang ada.
 * @returns {Array} [{ name, size, fileCount, mtime }]
 */
function listBackups() {
    ensureBackupsDir();
    const entries = fs.readdirSync(backupsDir, { withFileTypes: true })
        .filter(e => e.isDirectory());

    return entries.map(e => {
        const dir = path.join(backupsDir, e.name);
        const stat = fs.statSync(dir);
        let fileCount = 0;
        let totalSize = 0;
        try {
            const files = fs.readdirSync(dir);
            fileCount = files.length;
            for (const f of files) {
                totalSize += fs.statSync(path.join(dir, f)).size;
            }
        } catch (_) {}
        return {
            name: e.name,
            size: totalSize,
            fileCount,
            mtime: stat.mtime
        };
    }).sort((a, b) => b.mtime - a.mtime);
}

/**
 * Restore backup berdasarkan nama folder.
 * @param {string} name - nama folder backup (mis. "2026-07-31_15-30-00")
 * @returns {Object} { ok, filesRestored, errors[] }
 */
function restoreBackup(name) {
    // Sanitize name — kalau ada slash/dot, reject
    if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(name)) {
        return { ok: false, filesRestored: 0, errors: ['Invalid backup name format'] };
    }

    const srcDir = path.join(backupsDir, name);
    if (!fs.existsSync(srcDir)) {
        return { ok: false, filesRestored: 0, errors: [`Backup '${name}' tidak ditemukan`] };
    }

    // Sebelum restore, bikin backup "pre-restore" supaya aman
    const preRestoreName = `pre-restore_${formatTimestamp()}`;
    const preRestoreDir = path.join(backupsDir, preRestoreName);
    fs.mkdirSync(preRestoreDir, { recursive: true });
    for (const file of FILES_TO_BACKUP) {
        const src = path.join(rootDir, file);
        if (fs.existsSync(src)) {
            try { fs.copyFileSync(src, path.join(preRestoreDir, file)); } catch (_) {}
        }
    }

    // Restore: copy file dari backup ke root
    const result = { ok: true, filesRestored: 0, errors: [], preRestoreName };
    for (const file of FILES_TO_BACKUP) {
        const src = path.join(srcDir, file);
        const dst = path.join(rootDir, file);
        try {
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, dst);
                result.filesRestored++;
            }
        } catch (err) {
            result.errors.push(`${file}: ${err.message}`);
        }
    }
    return result;
}

/**
 * Start auto-backup interval (dipanggil di index.js saat bot online).
 * @param {Client} client - Discord client (untuk log kalau perlu)
 * @returns {Object} { stop } - function buat stop interval
 */
function startAutoBackup(client) {
    // Backup saat start
    const initial = createBackup();
    if (client) console.log(`💾 Auto-backup saat start: ${initial.backupName} (${initial.filesCopied} files, ${(initial.totalSize / 1024).toFixed(1)} KB)`);

    // Backup tiap 24 jam
    // P3-10 FIX: .unref() supaya interval tidak block process exit.
    const interval = setInterval(() => {
        const result = createBackup();
        if (client) console.log(`💾 Auto-backup berkala: ${result.backupName} (${result.filesCopied} files)`);
    }, BACKUP_INTERVAL_MS);
    if (typeof interval.unref === 'function') interval.unref();

    return {
        stop: () => clearInterval(interval)
    };
}

/**
 * Format byte ke human-readable.
 */
function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

module.exports = {
    createBackup,
    listBackups,
    restoreBackup,
    startAutoBackup,
    formatSize,
    FILES_TO_BACKUP,
    MAX_BACKUPS
};
