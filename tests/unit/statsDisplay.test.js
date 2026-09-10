/**
 * Unit tests for v3.9.47 — /stats & /my-stats display accuracy.
 *
 * User report: "the stats don't match". Root causes fixed in v3.9.47:
 *   1. /stats showed "Total Member Tracked" (stats.json entries) — NOT the
 *      real member count, and no live server data at all.
 *   2. The label said "VIP Purchases" while it counts ALL transactions
 *      (ticket orders + escrow deals).
 *   3. /my-stats showed "Joined Tracking: not recorded" for everyone who
 *      joined before v3.2 — the real join date lives on the member object.
 *
 * These tests run the REAL command module end-to-end with a stubbed
 * interaction (deferReply/editReply captured) and assert the embed content.
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
// Fixed timestamps so the <t:...:R> assertions are deterministic.
const REAL_JOINED_TS = 1600000000000;

/**
 * Stub interaction shaped exactly like what src/commands/stats.js touches:
 * commandName / deferReply / editReply (captured) / guild / user / member.
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
    // embeds[0].data.fields → { name → value } (names are unique in our embeds)
    return Object.fromEntries((embed.data.fields || []).map(f => [f.name, f.value]));
}

/** Populate stats.json + tickets.json with deterministic test data. */
function seedTestData() {
    const statsManager = require('../../src/data/statsManager');
    // 3 messages for the test user (also seeds "members tracked").
    for (let i = 0; i < 3; i++) statsManager.incrementMessages(GUILD_ID, USER_ID);
    // 2 transactions × Rp 10.000 (tetap tampil sebagai counter "Total
    // Transaksi" — tampilan revenue agregat dihapus di v3.9.51, tapi jumlah
    // per transaksi tetap, jadi pembelian tetap perlu di-seed).
    statsManager.recordPurchase(GUILD_ID, USER_ID, 10000);
    statsManager.recordPurchase(GUILD_ID, USER_ID, 10000);

    // 2 open tickets for this guild (tickets.json is scoped by meta.guildId).
    const { setTicketMeta } = require('../../src/data/ticketManager');
    setTicketMeta('test_guild_statsdisp_ch1', {
        userId: USER_ID,
        productName: 'Test Product A',
        price: 'Rp 10.000',
        guildId: GUILD_ID
    });
    setTicketMeta('test_guild_statsdisp_ch2', {
        userId: USER_ID,
        productName: 'Test Product B',
        price: 'Rp 10.000',
        guildId: GUILD_ID
    });
}

test('USER REPORT /stats: jumlah member live, boost, tiket + aktivitas terlacak', async () => {
    seedTestData();
    const statsCommand = require('../../src/commands/stats');

    const interaction = makeStubInteraction();
    await statsCommand(interaction);

    assert.strictEqual(interaction.__replies.length, 1, 'tepat satu reply');
    const embed = interaction.__replies[0].embeds[0];
    const fields = fieldMap(embed);

    // Data live langsung dari objek guild — bisa diverifikasi ke Discord.
    assert.strictEqual(fields['👥 Member'], '123');
    assert.strictEqual(fields['🎫 Tiket Terbuka'], '2');
    assert.strictEqual(fields['🚀 Boost Server'], 'Level 2 (5 boost)');

    // Aktivitas terlacak dari stats.json — di-seed di atas.
    assert.strictEqual(fields['💬 Total Pesan Terlacak'], '3');
    assert.strictEqual(fields['🛒 Total Transaksi'], '2');
    // v3.9.51 (permintaan user: "fitur total revenue di hapus saja"): baris
    // revenue agregat HILANG dari /stats — field-nya tidak boleh dirender
    // sama sekali (belanja pribadi tetap di /my-stats & /leaderboard).
    const fieldNames = (embed.data.fields || []).map(f => f.name);
    assert.ok(
        !fieldNames.some(n => /revenue/i.test(n)),
        `tidak boleh ada field yang menyebut revenue: ${fieldNames.join(' | ')}`
    );

    // v3.9.49 (laporan user: "member tracked & member live — kalau fungsinya
    // sama bikin satu aja"): TEPAT SATU field member (jumlah live) + rata-rata
    // dibagi jumlah member LIVE supaya angkanya konsisten.
    const names = (embed.data.fields || []).map(f => f.name);
    assert.strictEqual(names.filter(n => /member/i.test(n) && !/rata/i.test(n)).length, 1, `tepat satu field member: ${names.join(' | ')}`);
    assert.ok(!names.includes('👤 Member Terlacak'), 'field Member Terlacak yang dobel harus hilang');
    assert.strictEqual(fields['📈 Rata-rata Pesan/Member'], `${Math.round(3 / 123)}`);

    // Judul menyebut nama server; ikon terpasang kalau ada.
    assert.match(embed.data.title, /STATISTIK SERVER — Test Server/);
    assert.strictEqual(embed.data.thumbnail?.url, 'https://example.com/icon.png');
});

test('USER REPORT /stats: label "Pembelian VIP" yang menyesatkan sudah hilang', async () => {
    const statsCommand = require('../../src/commands/stats');
    const interaction = makeStubInteraction();
    await statsCommand(interaction);

    const embed = interaction.__replies[0].embeds[0];
    const names = (embed.data.fields || []).map(f => f.name);
    // Rename v3.9.47: ini menghitung SEMUA transaksi (order tiket + rekber),
    // jadi kata "VIP" tidak boleh muncul lagi.
    assert.ok(!names.some(n => /VIP/i.test(n)), `tidak ada field yang menyebut "VIP": ${names.join(' | ')}`);
    assert.ok(names.includes('🛒 Total Transaksi'));
});

test('/stats edge: tanpa boost → "Belum ada"; tanpa ikon → tanpa thumbnail', async () => {
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
    assert.strictEqual(fields['👥 Member'], '7');
    assert.strictEqual(embed.data.thumbnail, undefined, 'iconURL() null → tanpa thumbnail');
});

test('USER REPORT /my-stats: tanggal gabung ASLI + label transaksi', async () => {
    const statsCommand = require('../../src/commands/stats');
    const interaction = makeStubInteraction({ commandName: 'my-stats' });
    await statsCommand(interaction);

    const embed = interaction.__replies[0].embeds[0];
    const fields = fieldMap(embed);

    // Tanggal gabung asli dari objek member — BUKAN tracking v3.2
    // (stats.joinedAt null di sini: recordJoin tak pernah dipanggil untuk user ini).
    assert.strictEqual(fields['📅 Gabung Server Ini'], `<t:${Math.floor(REAL_JOINED_TS / 1000)}:R>`);
    assert.strictEqual(fields['💬 Pesan'], '3');
    assert.strictEqual(fields['🛒 Transaksi'], '2');
    assert.strictEqual(fields['💰 Total Belanja'], 'Rp 20.000');

    const names = (embed.data.fields || []).map(f => f.name);
    assert.ok(!names.some(n => /VIP/i.test(n)), 'my-stats juga tidak boleh menyebut "VIP"');
});

test('/my-stats edge: member partial (tanpa data gabung di mana pun) → "tidak diketahui"', async () => {
    const statsCommand = require('../../src/commands/stats');
    const interaction = makeStubInteraction({ commandName: 'my-stats', member: undefined });
    await statsCommand(interaction);

    const fields = fieldMap(interaction.__replies[0].embeds[0]);
    assert.strictEqual(fields['📅 Gabung Server Ini'], 'tidak diketahui');
});

test('ticketManager: getActiveTicketCount is guild-scoped (v3.9.47)', () => {
    const { getActiveTicketCount } = require('../../src/data/ticketManager');
    assert.strictEqual(getActiveTicketCount(GUILD_ID), 2);
    assert.strictEqual(getActiveTicketCount('test_guild_other'), 0);
    assert.strictEqual(getActiveTicketCount(''), 0);
});

// ============ CLEANUP (residue from seeding) ============

test('v3.9.47 cleanup: remove stats/tickets test residue', () => {
    const statsManager = require('../../src/data/statsManager');

    // 1) stats.json — drop every test_guild key.
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
    // Reset the in-memory cache + dirty flag so nothing flushes stale data back.
    statsManager.reload();

    // 2) tickets.json — remove the synthetic ticket channels.
    const { removeTicketMeta, getActiveTicketCount } = require('../../src/data/ticketManager');
    removeTicketMeta('test_guild_statsdisp_ch1');
    removeTicketMeta('test_guild_statsdisp_ch2');
    assert.strictEqual(getActiveTicketCount(GUILD_ID), 0, 'ticket residue removed');

    assert.ok(true, 'stats/tickets cleanup done');
});
