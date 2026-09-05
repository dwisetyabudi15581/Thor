/**
 * Unit tests v3.9.43 — Server Log (event server → channel server-log).
 *
 * Yang dijaga:
 *   A. logServerEvent (behavioral, configManager di-inject via require.cache):
 *      - channel belum di-set → false (silent skip, kontrak auditLog)
 *      - kirim sukses → true, embed punya judul/warna sesuai tipe event
 *      - field value >1024 di-truncate; >25 fields di-potong 25 (limit Discord)
 *      - channel.send throw → false TANPA throw (event handler tak boleh crash)
 *   B. snip (behavioral): collapse newline, truncate ellipsis, kosong.
 *   C. findAuditExecutor (behavioral): entry termutakhir dgn target cocok +
 *      window 60 detik; entri basi / target beda → tidak ketemu.
 *   D. Registrasi event (statis): index.js me-register 6 event baru +
 *      intent GuildBans aktif (tanpa itu guildBanAdd/Remove TIDAK pernah nyala).
 *   E. Guard per event file (statis): single-guild GUILD_ID, skip bot,
 *      fetch audit log best-effort.
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
// === A. logServerEvent (behavioral) ===
// ====================================================

// configManager di-mock via require.cache — logServerEvent me-require-nya
// secara LAZY di dalam fungsi, jadi injeksi sebelum pemanggilan berlaku.
const configManagerPath = require.resolve('../../src/data/configManager');
const originalConfigExports = require.cache[configManagerPath]
    ? require.cache[configManagerPath].exports
    : undefined;

function injectConfig(channels) {
    require.cache[configManagerPath] = {
        id: configManagerPath,
        filename: configManagerPath,
        loaded: true,
        exports: { getConfig: () => ({ channels }) }
    };
}

function restoreConfig() {
    if (originalConfigExports) {
        require.cache[configManagerPath].exports = originalConfigExports;
    } else {
        delete require.cache[configManagerPath];
    }
}

function makeClientWithChannel(channelId, sendImpl) {
    const channel = { id: channelId, send: sendImpl };
    return {
        channels: {
            cache: new Map([[channelId, channel]]),
            fetch: async () => channel
        }
    };
}

test('v3.9.43 #13 serverLog: channel belum di-set → false (silent skip); tipe tak dikenal → false', async () => {
    const { logServerEvent } = require('../../src/infra/serverLog');
    injectConfig({}); // tidak ada server-log
    try {
        const client = makeClientWithChannel('chan1', async () => { throw new Error('tidak boleh terkirim'); });
        const r = await logServerEvent(client, { type: 'MSG_DELETE', guildId: 'g1', fields: [{ name: 'a', value: 'b' }] });
        assert.strictEqual(r, false, 'belum di-set harus skip tanpa kirim');

        const bad = await logServerEvent(client, { type: 'TIDAK_ADA', guildId: 'g1', fields: [] });
        assert.strictEqual(bad, false, 'tipe tak dikenal → false');
    } finally {
        restoreConfig();
    }
});

test('v3.9.43 #14 serverLog: kirim sukses → true; embed judul + warna sesuai tipe; fields terkirim', async () => {
    const { logServerEvent } = require('../../src/infra/serverLog');
    injectConfig({ 'server-log': 'chan1' });
    try {
        const sent = [];
        const client = makeClientWithChannel('chan1', async payload => {
            sent.push(payload);
            return { id: 'x' };
        });
        const r = await logServerEvent(client, {
            type: 'MSG_DELETE',
            guildId: 'g1',
            fields: [
                { name: '✍️ Pengirim', value: '<@123> (`user`)', inline: true },
                { name: '📄 Isi', value: 'pesan tes' }
            ],
            footer: 'User ID: 123'
        });
        assert.strictEqual(r, true);
        assert.strictEqual(sent.length, 1);
        const embed = sent[0].embeds[0];
        assert.strictEqual(embed.data.title, '🗑️ Pesan Dihapus');
        assert.strictEqual(embed.data.color, 0xed4245);
        assert.strictEqual(embed.data.fields.length, 2);
        assert.strictEqual(embed.data.fields[0].name, '✍️ Pengirim');
        assert.ok(embed.data.timestamp, 'timestamp terpasang otomatis');
    } finally {
        restoreConfig();
    }
});

test('v3.9.43 #15 serverLog: field value >1024 di-truncate; >25 field dipotong 25 (limit Discord)', async () => {
    const { logServerEvent } = require('../../src/infra/serverLog');
    injectConfig({ 'server-log': 'chan1' });
    try {
        let captured = null;
        const client = makeClientWithChannel('chan1', async payload => {
            captured = payload;
            return {};
        });
        const bigVal = 'x'.repeat(3000);
        const manyFields = Array.from({ length: 40 }, (_, i) => ({ name: `f${i}`, value: 'v' }));
        const r = await logServerEvent(client, {
            type: 'MSG_EDIT',
            guildId: 'g1',
            fields: [{ name: 'big', value: bigVal }, ...manyFields]
        });
        assert.strictEqual(r, true);
        const fields = captured.embeds[0].data.fields;
        assert.strictEqual(fields.length, 25, 'maksimal 25 field');
        assert.ok(fields.every(f => f.value.length <= 1024), 'semua value ≤ 1024');
        assert.ok(fields.every(f => f.name.length <= 256), 'semua name ≤ 256');
        // Value besar ter-truncate + fields berlebih terbuang (bukan crash throw).
        assert.ok(fields[0].value.length <= 1024 && fields[0].value.length > 1000, 'value besar terpotong aman');
    } finally {
        restoreConfig();
    }
});

test('v3.9.43 #16 serverLog: channel.send throw → false, TIDAK re-throw (event handler aman)', async () => {
    const { logServerEvent } = require('../../src/infra/serverLog');
    injectConfig({ 'server-log': 'chan1' });
    try {
        const client = makeClientWithChannel('chan1', async () => {
            throw new Error('Missing Permissions');
        });
        const r = await logServerEvent(client, { type: 'BAN_ADD', guildId: 'g1', fields: [{ name: 'a', value: 'b' }] });
        assert.strictEqual(r, false, 'gagal kirim → false, tanpa throw');
    } finally {
        restoreConfig();
    }
});

// ====================================================
// === B. snip ===
// ====================================================

test('v3.9.43 #17 snip: collapse newline, truncate ellipsis, kosong → placeholder', () => {
    const { snip } = require('../../src/infra/serverLog');
    assert.strictEqual(snip('baris1\n\nbaris2  \n baris3'), 'baris1 baris2 baris3');
    const long = snip('a'.repeat(1500), 1000);
    assert.strictEqual(long.length, 1000);
    assert.ok(long.endsWith('…'));
    assert.strictEqual(snip(null), '');
    assert.strictEqual(snip('   '), '_(kosong)_');
});

// ====================================================
// === C. findAuditExecutor ===
// ====================================================

test('v3.9.43 #18 findAuditExecutor: termutakhir + target cocok + window 60s; basi/beda target → null', () => {
    const { findAuditExecutor } = require('../../src/infra/serverLog');
    const now = Date.now();
    const entries = [
        { executorId: 'admin-lama', targetId: 'victim', createdTimestamp: now - 120000 }, // basi
        { executorId: 'admin-benar', targetId: 'victim', createdTimestamp: now - 3000 },
        { executorId: 'admin-benar', targetId: 'orang-lain', createdTimestamp: now - 1000 } // beda target
    ];
    const r = findAuditExecutor({ entries, targetId: 'victim', now });
    assert.strictEqual(r.executorId, 'admin-benar', 'harus pilih entry segar dengan target cocok');

    assert.strictEqual(
        findAuditExecutor({ entries: [], targetId: 'victim' }).executorId,
        null,
        'entries kosong → null'
    );
    // Window default: entry >60 detik dianggap bukan pelaku aksi ini.
    assert.strictEqual(
        findAuditExecutor({ entries: [entries[0]], targetId: 'victim', now }).executorId,
        null,
        'entry basi → null'
    );
    // Filter channel (MessageDelete punya entry.extra.channel).
    const withChannel = [
        { executorId: 'admin-ch', targetId: 'victim', createdTimestamp: now - 1000, extra: { channel: { id: 'chA' } } },
        { executorId: 'admin-ch2', targetId: 'victim', createdTimestamp: now - 500, extra: { channel: { id: 'chB' } } }
    ];
    const rc = findAuditExecutor({ entries: withChannel, targetId: 'victim', channelId: 'chA', now });
    assert.strictEqual(rc.executorId, 'admin-ch', 'filter channel harus memilih entry channel yang cocok');
});

// ====================================================
// === D. Registrasi event + intent ===
// ====================================================

test('v3.9.43 #19 index.js: 6 event server-log ter-register + intent GuildBans aktif', () => {
    const src = readSrc('index.js');
    for (const ev of ['messageDelete', 'messageUpdate', 'messageBulkDelete', 'guildBanAdd', 'guildBanRemove', 'guildMemberUpdate']) {
        assert.ok(src.includes(`events/${ev}`), `event ${ev} harus di-require di index.js`);
    }
    // GuildBans WAJIB — tanpa intent ini, guildBanAdd/guildBanRemove tidak pernah jalan.
    assert.ok(src.includes('GatewayIntentBits.GuildBans'), 'intent GuildBans harus aktif');
});

// ====================================================
// === E. Guard per event file (statis) ===
// ====================================================

test('v3.9.43 #20 event file: single-guild guard + skip bot + audit-log best-effort', () => {
    // Single-guild guard semua file event baru.
    for (const rel of [
        'src/bot/events/messageDelete.js',
        'src/bot/events/messageUpdate.js',
        'src/bot/events/messageBulkDelete.js',
        'src/bot/events/guildBanAdd.js',
        'src/bot/events/guildBanRemove.js',
        'src/bot/events/guildMemberUpdate.js'
    ]) {
        const src = readSrc(rel);
        assert.ok(src.includes('process.env.GUILD_ID'), `${rel}: guard single-guild wajib (pattern v3.9.26)`);
        assert.ok(src.includes('try'), `${rel}: handler wajib try/catch (event error tak boleh crash bot)`);
    }

    // Skip pesan bot di message events (log tidak boleh kebanjiran embed bot sendiri).
    const del = readSrc('src/bot/events/messageDelete.js');
    assert.ok(del.includes('message.author?.bot'), 'messageDelete: skip pesan bot');
    assert.ok(del.includes('AuditLogEvent.MessageDelete'), 'messageDelete: deteksi executor via audit log');
    assert.ok(del.includes('findAuditExecutor('), 'messageDelete: pakai findAuditExecutor');

    const upd = readSrc('src/bot/events/messageUpdate.js');
    assert.ok(upd.includes('oldC === newC'), 'messageUpdate: skip edit tanpa perubahan konten (pin/embed)');
    assert.ok(upd.includes('msg.url'), 'messageUpdate: sertakan link pesan');

    const memUpd = readSrc('src/bot/events/guildMemberUpdate.js');
    assert.ok(memUpd.includes('oldMember.roles.cache'), 'guildMemberUpdate: diff role butuh state lama ter-cache');
    assert.ok(memUpd.includes('newMember.user?.bot'), 'guildMemberUpdate: skip member bot');

    const remove = readSrc('src/bot/events/guildMemberRemove.js');
    assert.ok(remove.includes('AuditLogEvent.MemberKick'), 'guildMemberRemove: kick manual terdeteksi via audit log');
    assert.ok(remove.includes('logServerEvent('), 'guildMemberRemove: log leave');

    const add = readSrc('src/bot/events/guildMemberAdd.js');
    assert.ok(add.includes('logServerEvent('), 'guildMemberAdd: log join');
});

test('v3.9.43 #21 kontrak channel server-log: set-channel menerima tipe, serverLog membaca config benar', () => {
    const src = readSrc('src/infra/serverLog.js');
    assert.ok(src.includes("config.channels['server-log']"), 'serverLog harus baca channels[server-log] — konsisten dengan set-channel');
    assert.ok(src.includes("config.channels && config.channels['server-log']"), 'akses channel harus null-safe');

    // helpCatalog mengiklankan cara aktifkan server log.
    const cat = readSrc('src/ui/helpCatalog.js');
    assert.ok(cat.includes('set-channel server-log'), 'helpCatalog harus menampilkan cara set server-log');
});
