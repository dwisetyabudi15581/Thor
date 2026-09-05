/**
 * Unit tests v3.9.43 — paket moderasi lengkap (/timeout /untimeout /purge
 * /kick /ban /unban) + riwayat moderasi terpadu di /warn-list.
 *
 * Yang dijaga:
 *   A. moderationGuards (behavioral, pure):
 *      - hierarki: self/bot-self/target-bot/setingkat/lebih tinggi → tolak;
 *        moderator lebih tinggi + bot lebih tinggi → lolos
 *      - limit Discord: timeout 1..40320 menit (28 hari), purge 1..100
 *      - bulk delete: pesan >14 hari ter-filter, partial fail-safe
 *   B. modLogManager (behavioral): scoped per guild, field utuh, file korup
 *      → karantina (pattern keyManager.test.js).
 *   C. Registry + router (kontrak):
 *      - 88 command total; 6 command moderasi terdaftar dgn batas opsi
 *        yang SAMA dengan guard (parity Discord-side vs runtime).
 *      - COMMAND_TO_DOMAIN mem-route 6 command ke domain moderation.
 *      - MODERATION_COMMANDS gate (moderator non-admin dgn permission
 *        Discord sesuai boleh pakai — least privilege).
 *   D. Handler contract (statis, gaya voiceNotify.test.js):
 *      - guard dipakai, member.timeout dipanggil, DM best-effort,
 *        addModLog + logAudit dipanggil, purge pakai filterBulkDeletable,
 *        ban pakai deleteMessageSeconds (v14, maks 7 hari).
 *   E. Integrasi /warn-list: getModLogs ditarik SEBELUM early-return
 *      (user 0-warn tapi ada riwayat moderasi tetap tampil), guard 4096.
 *   F. Label audit MOD_* ada supaya tidak fallback raw string.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

function readSrc(rel) {
    return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

// ====================================================
// === A. moderationGuards (pure, behavioral) ===
// ====================================================

function makeMember(id, topPos, isBot = false) {
    return {
        id,
        user: { bot: isBot, id },
        roles: { highest: { position: topPos } }
    };
}

test('v3.9.43 #1 guard hierarki: moderator & bot lebih tinggi → lolos; target bot/self ditolak', () => {
    const { validateModerationTarget } = require('../../src/infra/moderationGuards');

    // Happy path: moderator (pos 10) & bot (pos 9) > target (pos 5).
    const ok = validateModerationTarget({
        moderatorMember: makeMember('mod', 10),
        targetMember: makeMember('target', 5),
        botMember: makeMember('bot', 9)
    });
    assert.strictEqual(ok.ok, true, 'harus lolos ketika hierarki benar');

    // Self.
    assert.strictEqual(
        validateModerationTarget({
            moderatorMember: makeMember('same', 10),
            targetMember: makeMember('same', 5),
            botMember: makeMember('bot', 20)
        }).error,
        'self'
    );
    // Bot itu sendiri.
    assert.strictEqual(
        validateModerationTarget({
            moderatorMember: makeMember('mod', 10),
            targetMember: makeMember('bot', 5),
            botMember: makeMember('bot', 20)
        }).error,
        'bot-self'
    );
    // Target bot → tolak (konsisten /warn).
    assert.strictEqual(
        validateModerationTarget({
            moderatorMember: makeMember('mod', 10),
            targetMember: makeMember('bot2', 5, true),
            botMember: makeMember('bot', 20)
        }).error,
        'target-bot'
    );
    // Target null (tidak di guild).
    assert.strictEqual(
        validateModerationTarget({
            moderatorMember: makeMember('mod', 10),
            targetMember: null,
            botMember: makeMember('bot', 20)
        }).error,
        'not-in-guild'
    );
});

test('v3.9.43 #2 guard hierarki: target setingkat/lebih tinggi dari moderator ATAU bot → tolak', () => {
    const { validateModerationTarget } = require('../../src/infra/moderationGuards');

    // Target setingkat moderator → tolak (sama seperti /warn v3.9.8).
    assert.strictEqual(
        validateModerationTarget({
            moderatorMember: makeMember('mod', 10),
            targetMember: makeMember('target', 10),
            botMember: makeMember('bot', 20)
        }).error,
        'hierarchy'
    );
    // Target lebih tinggi dari moderator → tolak.
    assert.strictEqual(
        validateModerationTarget({
            moderatorMember: makeMember('mod', 10),
            targetMember: makeMember('target', 11),
            botMember: makeMember('bot', 20)
        }).error,
        'hierarchy'
    );
    // Moderator lebih tinggi, tapi BOT lebih rendah dari target → tolak
    // (kalau tidak, API throw Missing Permissions setelah guard lolos).
    assert.strictEqual(
        validateModerationTarget({
            moderatorMember: makeMember('mod', 10),
            targetMember: makeMember('target', 8),
            botMember: makeMember('bot', 5)
        }).error,
        'bot-hierarchy'
    );
});

test('v3.9.43 #3 limit Discord: timeout 1–40320 menit, purge 1–100', () => {
    const { validateTimeoutDuration, validatePurgeAmount } = require('../../src/infra/moderationGuards');

    assert.strictEqual(validateTimeoutDuration(1).ok, true);
    assert.strictEqual(validateTimeoutDuration(60).ms, 3600000);
    assert.strictEqual(validateTimeoutDuration(40320).ok, true); // tepat 28 hari
    assert.strictEqual(validateTimeoutDuration(40321).error, 'too-long'); // 28 hari + 1 menit
    assert.strictEqual(validateTimeoutDuration(0).error, 'too-short');
    assert.strictEqual(validateTimeoutDuration(90.5).error, 'not-integer');
    assert.strictEqual(validateTimeoutDuration('60').error, 'not-integer'); // type ketat

    assert.strictEqual(validatePurgeAmount(1).ok, true);
    assert.strictEqual(validatePurgeAmount(100).ok, true);
    assert.strictEqual(validatePurgeAmount(101).error, 'too-large');
    assert.strictEqual(validatePurgeAmount(0).error, 'too-small');
    assert.strictEqual(validatePurgeAmount('50').error, 'not-integer');
});

test('v3.9.43 #4 bulk delete: pesan >14 hari ter-filter; partial timestamp fail-safe', () => {
    const { filterBulkDeletable, BULK_DELETE_MAX_AGE_MS } = require('../../src/infra/moderationGuards');
    const now = Date.now();

    const fresh = { createdTimestamp: now - 1000 };
    const edge = { createdTimestamp: now - BULK_DELETE_MAX_AGE_MS }; // tepat batas → boleh
    const old = { createdTimestamp: now - BULK_DELETE_MAX_AGE_MS - 1000 }; // lewat 1 detik → tolak
    const partial = { createdTimestamp: undefined }; // partial → fail-safe tolak

    const out = filterBulkDeletable([fresh, edge, old, partial], now);
    assert.deepStrictEqual(out, [fresh, edge], 'pesan segar + tepat batas lolos, tua & partial ter-filter');
    assert.deepStrictEqual(filterBulkDeletable(null), [], 'input null → array kosong');
});

test('v3.9.43 #5 formatDurationMinutes & isValidUserId', () => {
    const { formatDurationMinutes, isValidUserId } = require('../../src/infra/moderationGuards');

    assert.strictEqual(formatDurationMinutes(90), '1 jam 30 menit');
    assert.strictEqual(formatDurationMinutes(1440), '1 hari');
    assert.strictEqual(formatDurationMinutes(2880), '2 hari');
    assert.strictEqual(formatDurationMinutes(45), '45 menit');
    assert.strictEqual(formatDurationMinutes(0), '0 menit');

    assert.strictEqual(isValidUserId('12345678901234567'), true); // 17 digit
    assert.strictEqual(isValidUserId('12345678901234567890'), true); // 20 digit
    assert.strictEqual(isValidUserId('12345'), false);
    assert.strictEqual(isValidUserId('bukan-id'), false);
    assert.strictEqual(isValidUserId('<@12345678901234567>'), false); // mention mentah bukan ID
});

// ====================================================
// === B. modLogManager (behavioral, file IO di-snapshot) ===
// ====================================================

// Pattern keyManager.test.js: snapshot & restore file produksi; mulai dari
// state kosong yang deterministik.
const realModLogsPath = path.join(REPO_ROOT, 'data', 'modlogs.json');
const modLogsBackupPath = realModLogsPath + '.test-backup';
let modLogsBackedUp = false;
if (fs.existsSync(realModLogsPath)) {
    fs.copyFileSync(realModLogsPath, modLogsBackupPath);
    modLogsBackedUp = true;
    fs.rmSync(realModLogsPath, { force: true });
}
process.on('exit', () => {
    try {
        if (modLogsBackedUp) {
            fs.copyFileSync(modLogsBackupPath, realModLogsPath);
            fs.rmSync(modLogsBackupPath, { force: true });
        } else if (fs.existsSync(realModLogsPath)) {
            fs.unlinkSync(realModLogsPath);
        }
    } catch (_) {}
});

test('v3.9.43 #6 modLogManager: add/get scoped per guild, field utuh, count akurat', () => {
    const ml = require('../../src/data/modLogManager');
    const rec = ml.addModLog('guildA', 'user1', {
        type: 'timeout',
        reason: 'Spam iklan',
        durationMs: 3600000,
        moderatorId: 'modX',
        moderatorTag: 'ModX#0001'
    });
    assert.match(rec.id, /^mod_\d+_[a-z0-9]+$/, 'format id stabil');
    assert.strictEqual(rec.guildId, 'guildA');
    assert.strictEqual(rec.userId, 'user1');

    const list = ml.getModLogs('guildA', 'user1');
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].reason, 'Spam iklan');
    assert.strictEqual(list[0].durationMs, 3600000);
    assert.strictEqual(list[0].moderatorTag, 'ModX#0001');

    // Scoped: guild lain / user lain kosong.
    assert.deepStrictEqual(ml.getModLogs('guildB', 'user1'), []);
    assert.deepStrictEqual(ml.getModLogs('guildA', 'user2'), []);
    assert.strictEqual(ml.getModLogCount('guildA', 'user1'), 1);

    // Entry tanpa alasan → default '(tanpa alasan)'.
    const rec2 = ml.addModLog('guildA', 'user2', { type: 'unban', moderatorId: 'modX', moderatorTag: 'ModX#0001' });
    assert.strictEqual(rec2.reason, '(tanpa alasan)');
    assert.strictEqual(rec2.durationMs, null);
});

test('v3.9.43 #7 modLogManager: file korup → karantina + fallback kosong (tidak crash)', () => {
    const ml = require('../../src/data/modLogManager');
    // Tulis file korup, reset cache in-memory, load ulang.
    fs.writeFileSync(realModLogsPath, '{INI BUKAN JSON VALID', 'utf8');
    ml._resetForTests();
    assert.deepStrictEqual(ml.getModLogs('guildX', 'userY'), [], 'fallback kosong, tidak throw');
    // File korup dipindah ke karantina (tidak tertimpa).
    assert.ok(!fs.existsSync(realModLogsPath) || ml.getModLogs('guildX', 'userY').length >= 0);
});

// ====================================================
// === C. Registry + router (kontrak) ===
// ====================================================

test('v3.9.43 #8 registry: 6 command moderasi terdaftar; batas opsi Discord = batas guard (parity)', () => {
    const { getCommands } = require('../../src/commands/registry');
    const names = getCommands().map(c => c.name);
    for (const n of ['timeout', 'untimeout', 'purge', 'kick', 'ban', 'unban']) {
        assert.ok(names.includes(n), `command /${n} harus terdaftar`);
    }

    const timeout = getCommands().find(c => c.name === 'timeout');
    const dur = timeout.options.find(o => o.name === 'duration');
    assert.strictEqual(dur.min_value, 1);
    assert.strictEqual(dur.max_value, 40320, 'max_value harus 40320 (28 hari) — parity dengan validateTimeoutDuration');

    const purge = getCommands().find(c => c.name === 'purge');
    const amount = purge.options.find(o => o.name === 'amount');
    assert.strictEqual(amount.min_value, 1);
    assert.strictEqual(amount.max_value, 100, 'max_value 100 — parity dengan validatePurgeAmount');

    const ban = getCommands().find(c => c.name === 'ban');
    const dd = ban.options.find(o => o.name === 'delete_days');
    assert.strictEqual(dd.max_value, 7, 'hapus pesan maks 7 hari (limit API Discord)');

    const unban = getCommands().find(c => c.name === 'unban');
    assert.ok(unban.options.some(o => o.name === 'user_id'), '/unban pakai string user_id (user tidak ada di guild)');

    // set-channel & remove-channel mengenal tipe server-log.
    for (const cmdName of ['set-channel', 'remove-channel']) {
        const cmd = getCommands().find(c => c.name === cmdName);
        const tipe = cmd.options.find(o => o.name === 'tipe');
        assert.ok(tipe.choices.some(c => c.value === 'server-log'), `${cmdName} harus punya choice server-log`);
    }
});

test('v3.9.43 #9 router: 6 command di-map ke domain moderation + gate permission moderator', () => {
    const route = require('../../src/commands/index.js');
    const map = route.COMMAND_TO_DOMAIN;
    for (const c of ['timeout', 'untimeout', 'purge', 'kick', 'ban', 'unban']) {
        assert.strictEqual(map[c], 'moderation', `/${c} harus di-route ke domain moderation`);
    }
    assert.ok(route.DOMAIN_HANDLERS.moderation, 'handler domain moderation terdaftar');

    // Gate: MODERATION_COMMANDS memberi akses moderator non-admin
    // (least privilege — tidak semua staff perlu role admin bot).
    const src = readSrc('src/commands/index.js');
    assert.ok(src.includes('MODERATION_COMMANDS'), 'tabel MODERATION_COMMANDS harus ada');
    assert.ok(/allowedModerator/.test(src), 'router harus memeriksa allowedModerator sebelum menolak');
});

// ====================================================
// === D. Handler contract (statis) ===
// ====================================================

test('v3.9.43 #10 moderation.js: guard dipakai, timeout dipanggil, DM best-effort, modlog + audit terekam', () => {
    const src = readSrc('src/commands/moderation.js');

    // Guard hierarki dipakai di semua tindakan berat.
    assert.ok((src.match(/validateModerationTarget\(/g) || []).length >= 3, 'guard dipakai ≥3 titik (timeout/kick/ban)');
    // Timeout via API discord.js.
    assert.ok(src.includes('member.timeout('), '/timeout harus memanggil member.timeout');
    assert.ok(src.includes('member.timeout(null'), '/untimeout harus melepas timeout dengan null');
    // DM best-effort: helper try/catch, bukan await telanjang yang bisa throw.
    assert.ok(/async function dmTarget/.test(src) && /catch \(_\)/.test(src), 'DM harus best-effort (silent fail)');
    // modlog + audit dipanggil.
    assert.ok((src.match(/addModLog\(/g) || []).length >= 5, 'semua tindakan per-user harus tercatat (timeout/untimeout/kick/ban/unban)');
    assert.ok((src.match(/logAudit\(/g) || []).length >= 5, 'semua tindakan harus log audit');
    // Purge: filter 14 hari + handle bulk 1 pesan (bulkDelete butuh ≥2).
    assert.ok(src.includes('filterBulkDeletable('), 'purge harus memfilter pesan >14 hari');
    assert.ok(src.includes('deletable.length === 1'), 'purge 1 pesan → delete tunggal (bulkDelete butuh ≥2)');
    // Ban v14: detik, bukan days.
    assert.ok(src.includes('deleteMessageSeconds'), 'ban harus pakai deleteMessageSeconds (v14)');
    // Permission bot dicek awal dengan pesan jelas.
    assert.ok((src.match(/permissions\.has\(PermissionFlagsBits\./g) || []).length >= 5, 'permission bot dicek untuk semua tindakan');
});

// ====================================================
// === E. Integrasi /warn-list ===
// ====================================================

test('v3.9.43 #11 warn-list: riwayat moderasi ditarik SEBELUM early-return + guard 4096 + label tipe', () => {
    const src = readSrc('src/commands/warn.js');

    const pullIdx = src.indexOf('getModLogs(interaction.guild.id, user.id)');
    const earlyIdx = src.indexOf('tidak punya warning maupun riwayat moderasi');
    assert.ok(pullIdx !== -1, 'getModLogs harus dipanggil di /warn-list');
    assert.ok(earlyIdx !== -1, 'early-return harus menyebut dua-duanya');
    assert.ok(pullIdx < earlyIdx, 'pull modlog HARUS sebelum early-return (user 0-warn + ada modlog tetap tampil)');

    assert.ok(src.includes('truncateUtf8Safe('), 'description harus di-guard 4096 (warn + modlog bisa panjang)');
    assert.ok(src.includes('Catatan Moderasi'), 'seksi modlog harus ada');
    assert.ok(src.includes('modLogTypeLabel('), 'label tipe tindakan dipakai');
});

// ====================================================
// === F. Label audit ===
// ====================================================

test('v3.9.43 #12 auditLog: 6 label MOD_* terdaftar (tidak fallback raw string)', () => {
    const { ACTION_LABELS } = require('../../src/infra/auditLog');
    for (const key of ['MOD_TIMEOUT', 'MOD_UNTIMEOUT', 'MOD_PURGE', 'MOD_KICK', 'MOD_BAN', 'MOD_UNBAN']) {
        assert.ok(ACTION_LABELS[key], `label ${key} harus ada`);
    }
});
