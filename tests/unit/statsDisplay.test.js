/**
 * Unit test v3.9.47 — akurasi tampilan /stats & /my-stats.
 *
 * Laporan user: "stats-nya gak sesuai". Akar masalah yang diperbaiki v3.9.47:
 *   1. /stats menampilkan "Total Member Tracked" (entri stats.json) — BUKAN
 *      jumlah member asli, dan gak ada data live server sama sekali.
 *   2. Label bilang "Pembelian VIP" padahal dihitung SEMUA transaksi
 *      (order tiket + deal rekber).
 *   3. /my-stats menampilkan "Joined Tracking: belum tercatat" untuk semua
 *      orang yang gabung sebelum v3.2 — tanggal gabung asli ada di objek member.
 *
 * Test ini menjalankan modul command ASLI end-to-end dengan interaction stub
 * (deferReply/editReply ditangkap) lalu memverifikasi isi embed.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { safeWriteJSON } = require('../../src/infra/safeWrite');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const TICKETS_PATH = path.join(DATA_DIR, 'tickets.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const GUILD_ID = 'test_guild_statsdisp';
const USER_ID = 'test_user_statsdisp';
// Timestamp tetap supaya asersi <t:...:R> deterministik.
const REAL_JOINED_TS = 1600000000000;

/**
 * Interaction stub yang bentuknya persis seperti yang disentuh
 * src/commands/stats.js: commandName / deferReply / editReply (ditangkap) /
 * guild / user / member.
 */
function makeStubInteraction(overrides = {}) {
    const replies = [];
    const interaction = {
        commandName: 'stats',
        deferReply: async () => {},
        editReply: async opts => {
            replies.push(opts);
            return {};
        },
        guild: {
            id: GUILD_ID,
            name: 'Test Server',
            memberCount: 123,
            premiumTier: 2,
            premiumSubscriptionCount: 5,
            iconURL: () => 'https://example.com/icon.png'
        },
        user: { id: USER_ID, tag: 'Tester#0001' },
        member: { joinedTimestamp: REAL_JOINED_TS },
        options: { getString: () => null, getInteger: () => null }
    };
    Object.assign(interaction, overrides);
    interaction.__replies = replies;
    return interaction;
}

function fieldMap(embed) {
    // embeds[0].data.fields → { name → value } (nama field unik di embed kita)
    return Object.fromEntries((embed.data.fields || []).map(f => [f.name, f.value]));
}

/** Isi stats.json + tickets.json dengan data test yang deterministik. */
function seedTestData() {
    const statsManager = require('../../src/data/statsManager');
    // 3 pesan untuk user test (sekalian men-seed "member terlacak").
    for (let i = 0; i < 3; i++) statsManager.incrementMessages(GUILD_ID, USER_ID);
    // 2 transaksi × Rp 10.000 → revenue Rp 20.000.
    statsManager.recordPurchase(GUILD_ID, USER_ID, 10000);
    statsManager.recordPurchase(GUILD_ID, USER_ID, 10000);

    // 2 tiket terbuka untuk guild ini (tickets.json di-scope via meta.guildId).
    const { setTicketMeta } = require('../../src/data/ticketManager');
    setTicketMeta('test_guild_statsdisp_ch1', {
        userId: USER_ID,
        productName: 'Produk Test A',
        price: 'Rp 10.000',
        guildId: GUILD_ID
    });
    setTicketMeta('test_guild_statsdisp_ch2', {
        userId: USER_ID,
        productName: 'Produk Test B',
        price: 'Rp 10.000',
        guildId: GUILD_ID
    });
}

test('LAPORAN USER /stats: member live, boost, tiket + aktivitas terlacak', async () => {
    seedTestData();
    const statsCommand = require('../../src/commands/stats');

    const interaction = makeStubInteraction();
    await statsCommand(interaction);

    assert.strictEqual(interaction.__replies.length, 1, 'tepat satu reply');
    const embed = interaction.__replies[0].embeds[0];
    const fields = fieldMap(embed);

    // Data live langsung dari objek guild — bisa diverifikasi ke Discord.
    assert.strictEqual(fields['👥 Member (live)'], '123');
    assert.strictEqual(fields['🎫 Tiket Terbuka'], '2');
    assert.strictEqual(fields['🚀 Boost Server'], 'Level 2 (5 boost)');

    // Aktivitas terlacak dari stats.json — di-seed di atas.
    assert.strictEqual(fields['💬 Total Pesan Terlacak'], '3');
    assert.strictEqual(fields['👤 Member Terlacak'], '1');
    assert.strictEqual(fields['🛒 Total Transaksi'], '2');
    assert.strictEqual(fields['💰 Total Revenue'], 'Rp 20.000');

    // Judul menyebut nama server; ikon dilampirkan kalau ada.
    assert.match(embed.data.title, /STATISTIK SERVER — Test Server/);
    assert.strictEqual(embed.data.thumbnail?.url, 'https://example.com/icon.png');
});

test('LAPORAN USER /stats: label menyesatkan "Pembelian VIP" sudah dihapus', async () => {
    const statsCommand = require('../../src/commands/stats');
    const interaction = makeStubInteraction();
    await statsCommand(interaction);

    const embed = interaction.__replies[0].embeds[0];
    const names = (embed.data.fields || []).map(f => f.name);
    // Rename v3.9.47: dihitung SEMUA transaksi (order tiket + rekber), jadi
    // kata "VIP" yang lama tidak boleh balik lagi.
    assert.ok(!names.some(n => /VIP/i.test(n)), `tidak boleh ada field "VIP": ${names.join(' | ')}`);
    assert.ok(names.includes('🛒 Total Transaksi'));
});

test('/stats edge: tanpa boost → "Belum ada"; tanpa ikon → tidak ada thumbnail', async () => {
    const statsCommand = require('../../src/commands/stats');
    const interaction = makeStubInteraction({
        guild: {
            id: GUILD_ID,
            name: 'Test Server',
            memberCount: 7,
            premiumTier: 0,
            premiumSubscriptionCount: null,
            iconURL: () => null
        }
    });
    await statsCommand(interaction);

    const embed = interaction.__replies[0].embeds[0];
    const fields = fieldMap(embed);
    assert.strictEqual(fields['🚀 Boost Server'], 'Belum ada');
    assert.strictEqual(fields['👥 Member (live)'], '7');
    assert.strictEqual(embed.data.thumbnail, undefined, 'iconURL() null → tanpa thumbnail');
});

test('LAPORAN USER /my-stats: tanggal gabung ASLI + label transaksi', async () => {
    const statsCommand = require('../../src/commands/stats');
    const interaction = makeStubInteraction({ commandName: 'my-stats' });
    await statsCommand(interaction);

    const embed = interaction.__replies[0].embeds[0];
    const fields = fieldMap(embed);

    // Tanggal gabung asli dari objek member — BUKAN tracking v3.2
    // (stats.joinedAt null di sini: recordJoin tidak pernah dipanggil).
    assert.strictEqual(fields['📅 Gabung Server Ini'], `<t:${Math.floor(REAL_JOINED_TS / 1000)}:R>`);
    assert.strictEqual(fields['💬 Pesan'], '3');
    assert.strictEqual(fields['🛒 Transaksi'], '2');
    assert.strictEqual(fields['💰 Total Belanja'], 'Rp 20.000');

    const names = (embed.data.fields || []).map(f => f.name);
    assert.ok(!names.some(n => /VIP/i.test(n)), 'my-stats juga tidak boleh bilang "VIP"');
});

test('/my-stats edge: member partial (tanpa data gabung) → "tidak diketahui"', async () => {
    const statsCommand = require('../../src/commands/stats');
    const interaction = makeStubInteraction({ commandName: 'my-stats', member: undefined });
    await statsCommand(interaction);

    const fields = fieldMap(interaction.__replies[0].embeds[0]);
    assert.strictEqual(fields['📅 Gabung Server Ini'], 'tidak diketahui');
});

test('ticketManager: getActiveTicketCount ter-scope per guild (v3.9.47)', () => {
    const { getActiveTicketCount } = require('../../src/data/ticketManager');
    assert.strictEqual(getActiveTicketCount(GUILD_ID), 2);
    assert.strictEqual(getActiveTicketCount('test_guild_other'), 0);
    assert.strictEqual(getActiveTicketCount(''), 0);
});

// ============ CLEANUP (sisa seeding) ============

test('v3.9.47 cleanup: hapus sisa test stats/tickets', () => {
    const statsManager = require('../../src/data/statsManager');

    // 1) stats.json — buang semua key test_guild.
    if (fs.existsSync(STATS_PATH)) {
        try {
            const data = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                let removed = 0;
                for (const key of Object.keys(data)) {
                    if (/^test_guild/.test(key)) {
                        delete data[key];
                        removed++;
                    }
                }
                if (removed > 0) safeWriteJSON(STATS_PATH, data);
            }
        } catch (_) {}
    }
    // Reset cache in-memory + flag dirty supaya tidak ada flush data basi.
    statsManager.reload();

    // 2) tickets.json — hapus channel tiket sintetis.
    const { removeTicketMeta, getActiveTicketCount } = require('../../src/data/ticketManager');
    removeTicketMeta('test_guild_statsdisp_ch1');
    removeTicketMeta('test_guild_statsdisp_ch2');
    assert.strictEqual(getActiveTicketCount(GUILD_ID), 0, 'sisa tiket sudah dibersihkan');

    assert.ok(true, 'cleanup stats/tickets selesai');
});
