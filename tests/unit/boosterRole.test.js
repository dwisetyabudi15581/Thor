/**
 * Unit tests untuk v3.9.59 — AUTO ROLE BOOSTER.
 *
 * Permintaan user: "yang sudah boost server bakal dapet role" — member yang
 * boost server otomatis menerima role Booster yang di-set admin.
 *
 * Yang ditambahkan v3.9.59 (semua tercakup di sini):
 *   1. Registry: /set-role & /remove-role kini punya pilihan `booster`.
 *   2. boostHandler.applyBoostRole — beri/hapus role mengikuti status boost:
 *      add sehat, idempotent, remove, remove tanpa role, ghost ID, belum
 *      di-set, roles.add throw (tidak pernah reject), guard posisi role.
 *   3. boostHandler.syncBoostRoles — sinkronisasi STATE: booster live tanpa
 *      role → diberikan; boost-berakhir-saat-offline → dihapus; pemberian
 *      role MANUAL ke member biasa TIDAK PERNAH dicabut; bot di-skip.
 *   4. guildMemberUpdate — event live add/remove boost memanggil applyBoostRole.
 *   5. /set-role booster — config tersimpan + penerapan RETROAKTIF ke booster
 *      yang sudah ada (reply menyebut jumlahnya).
 *   6. /test-booster — diagnosis mata rantai role (set → ada → posisi →
 *      permission) TANPA pernah mengutak-atik role (simulasi tetap murni).
 *   7. Help catalog: booster terdokumentasi + budget Semua Command ≤ 5800.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
// v3.10.0: config per-guild — mock makeMember//set-role pakai guild 'g_br',
// mock /test-booster lokal pakai guild 'g_tb'. writeConfig menulis dua-duanya
// supaya kedua jalur handler membaca config yang sama.
const CONFIG_GUILD_IDS = ['g_br', 'g_tb'];
const configPaths = CONFIG_GUILD_IDS.map(g => path.join(DATA_DIR, 'config', `${g}.json`));
const boostsPath = path.join(DATA_DIR, 'boosts.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ====================================================
// === Sandbox: snapshot & restore config.json DAN    ===
// === boosts.json                                   ===
// ====================================================
const backups = [
    ...configPaths.map(p => ({ path: p, had: fs.existsSync(p) })),
    { path: boostsPath, had: fs.existsSync(boostsPath) }
];
for (const b of backups) {
    if (b.had) fs.copyFileSync(b.path, b.path + '.test-backup');
}
process.on('exit', () => {
    for (const b of backups) {
        try {
            if (b.had) {
                fs.copyFileSync(b.path + '.test-backup', b.path);
                fs.rmSync(b.path + '.test-backup', { force: true });
            } else if (fs.existsSync(b.path)) {
                fs.rmSync(b.path, { force: true });
            }
        } catch (_) {}
    }
});

// ====================================================
// === Helpers                                       ===
// ====================================================

/** Tulis config guild mock (roles + channels) — v3.10.0: per-guild path. */
function writeConfig({ roles = {}, channels = {} } = {}) {
    fs.mkdirSync(path.join(DATA_DIR, 'config'), { recursive: true });
    for (const p of configPaths) {
        fs.writeFileSync(p, JSON.stringify({ channels, roles, messages: {} }, null, 4));
    }
}

/** Role booster standar (position 3, di bawah role bot di posisi 10). */
const BOOSTER_ROLE = { id: 'r_boost', name: 'Booster', managed: false, position: 3 };

/** Salinan role segar — test yang mengubah position tidak mencemari test lain. */
function freshBoosterRole() {
    return { ...BOOSTER_ROLE };
}

/** Stub GuildMember dengan role-cache rekam add/remove. */
function makeMember({ hasRole = false, boosting = true, addThrows = null, removeThrows = null, bot = false } = {}) {
    const calls = { add: [], remove: [] };
    return {
        id: 'u_member',
        __calls: calls,
        user: { id: 'u_member', tag: 'Member#0001', bot },
        premiumSinceTimestamp: boosting ? 1700000000000 : null,
        guild: {
            id: 'g_br',
            roles: { cache: new Map([['r_boost', freshBoosterRole()]]) },
            members: { me: { roles: { highest: { position: 10 } } } }
        },
        roles: {
            cache: { has: id => id === 'r_boost' && hasRole },
            add: async r => {
                if (addThrows) throw new Error(addThrows);
                calls.add.push(r);
            },
            remove: async r => {
                if (removeThrows) throw new Error(removeThrows);
                calls.remove.push(r);
            }
        }
    };
}

// ====================================================
// === 1. Kontrak registry                          ===
// ====================================================

test('kontrak registry: /set-role & /remove-role punya pilihan booster', () => {
    const { getCommands } = require('../../src/commands/registry');
    const setRole = getCommands().find(c => c.name === 'set-role');
    assert.ok(setRole, 'set-role terdaftar');
    const tipe = setRole.options.find(o => o.name === 'tipe');
    assert.ok(
        tipe.choices.some(c => c.value === 'booster'),
        'pilihan booster ada di set-role'
    );
    const removeRole = getCommands().find(c => c.name === 'remove-role');
    assert.ok(removeRole, 'remove-role terdaftar');
    const tipeRm = removeRole.options.find(o => o.name === 'tipe');
    assert.ok(
        tipeRm.choices.some(c => c.value === 'booster'),
        'pilihan booster ada di remove-role'
    );
});

// ====================================================
// === 2. applyBoostRole — unit                       ===
// ====================================================

test('applyBoostRole add (sehat): role diberikan sekali, hasil ok/added', async () => {
    writeConfig({ roles: { booster: 'r_boost' } });
    const { applyBoostRole } = require('../../src/bot/boostHandler');
    const member = makeMember({ hasRole: false });

    const res = await applyBoostRole(member, 'add');

    assert.deepStrictEqual(res, { ok: true, reason: 'added' });
    assert.strictEqual(member.__calls.add.length, 1, 'roles.add dipanggil sekali');
    assert.strictEqual(member.__calls.add[0].id, 'r_boost', 'role yang tepat');
    assert.strictEqual(member.__calls.remove.length, 0, 'tidak ada remove');
});

test('applyBoostRole add idempotent: member yang sudah punya role tidak di-add ulang', async () => {
    writeConfig({ roles: { booster: 'r_boost' } });
    const { applyBoostRole } = require('../../src/bot/boostHandler');
    const member = makeMember({ hasRole: true });

    const res = await applyBoostRole(member, 'add');

    assert.deepStrictEqual(res, { ok: true, reason: 'already' });
    assert.strictEqual(member.__calls.add.length, 0, 'tidak ada pemanggilan roles.add');
});

test('applyBoostRole remove: role dicabut saat boost berakhir', async () => {
    writeConfig({ roles: { booster: 'r_boost' } });
    const { applyBoostRole } = require('../../src/bot/boostHandler');
    const member = makeMember({ hasRole: true, boosting: false });

    const res = await applyBoostRole(member, 'remove');

    assert.deepStrictEqual(res, { ok: true, reason: 'removed' });
    assert.strictEqual(member.__calls.remove.length, 1, 'roles.remove dipanggil');
});

test('applyBoostRole remove tanpa role: no-op bersih (tidak ada error)', async () => {
    writeConfig({ roles: { booster: 'r_boost' } });
    const { applyBoostRole } = require('../../src/bot/boostHandler');
    const member = makeMember({ hasRole: false, boosting: false });

    const res = await applyBoostRole(member, 'remove');

    assert.deepStrictEqual(res, { ok: true, reason: 'absent' });
    assert.strictEqual(member.__calls.remove.length, 0, 'tidak ada pemanggilan roles.remove');
});

test('applyBoostRole ghost ID: role terhapus dari server → tidak crash, tidak add', async () => {
    writeConfig({ roles: { booster: 'r_ghost' } });
    const { applyBoostRole } = require('../../src/bot/boostHandler');
    const member = makeMember({ hasRole: false });

    const res = await applyBoostRole(member, 'add');

    assert.deepStrictEqual(res, { ok: false, reason: 'ghost' });
    assert.strictEqual(member.__calls.add.length, 0);
});

test('applyBoostRole role belum di-set: no-op (fitur opsional belum dinyalakan)', async () => {
    writeConfig({ roles: {} });
    const { applyBoostRole } = require('../../src/bot/boostHandler');
    const member = makeMember({ hasRole: false });

    const res = await applyBoostRole(member, 'add');

    assert.deepStrictEqual(res, { ok: false, reason: 'not-set' });
    assert.strictEqual(member.__calls.add.length, 0);
});

test('applyBoostRole roles.add throw: TIDAK reject — dikembalikan sebagai {ok:false,reason:"error"}', async () => {
    writeConfig({ roles: { booster: 'r_boost' } });
    const { applyBoostRole } = require('../../src/bot/boostHandler');
    const member = makeMember({ hasRole: false, addThrows: 'Missing Permissions' });

    const res = await applyBoostRole(member, 'add');

    assert.deepStrictEqual(res, { ok: false, reason: 'error' });
});

test('applyBoostRole guard posisi: role DI ATAS role bot → tidak di-add, reason "position"', async () => {
    writeConfig({ roles: { booster: 'r_boost' } });
    const { applyBoostRole } = require('../../src/bot/boostHandler');
    const member = makeMember({ hasRole: false });
    // Role booster dipindah ke posisi 10 = sama tinggi dengan role bot (10).
    member.guild.roles.cache.get('r_boost').position = 10;

    const res = await applyBoostRole(member, 'add');

    assert.deepStrictEqual(res, { ok: false, reason: 'position' });
    assert.strictEqual(member.__calls.add.length, 0, 'roles.add tidak boleh dipanggil');
});

// ====================================================
// === 3. syncBoostRoles — sinkronisasi state        ===
// ====================================================

test('syncBoostRoles: booster live tanpa role diberikan; grant manual member biasa TIDAK dicabut; removed dihapus; bot di-skip', async () => {
    writeConfig({ roles: { booster: 'r_boost' } });
    const { syncBoostRoles } = require('../../src/bot/boostHandler');

    const boosterNoRole = makeMember({ hasRole: false, boosting: true }); // → harus di-add
    const boosterHasRole = makeMember({ hasRole: true, boosting: true }); // → sudah benar, tak tersentuh
    const plainWithRole = makeMember({ hasRole: true, boosting: false }); // grant manual → JANGAN dicabut
    const botBooster = makeMember({ hasRole: false, boosting: true, bot: true }); // bot → skip
    const lapsedBooster = makeMember({ hasRole: true, boosting: false }); // boost berakhir offline → dihapus

    // Beri id unik supaya cache.get(userId) menemukan yang tepat.
    boosterNoRole.user.id = 'u_booster_new';
    boosterHasRole.user.id = 'u_booster_ok';
    plainWithRole.user.id = 'u_plain';
    botBooster.user.id = 'u_bot';
    lapsedBooster.user.id = 'u_lapsed';

    const members = new Map([
        ['u_booster_new', boosterNoRole],
        ['u_booster_ok', boosterHasRole],
        ['u_plain', plainWithRole],
        ['u_bot', botBooster],
        ['u_lapsed', lapsedBooster]
    ]);
    const guild = {
        id: 'g_br',
        roles: { cache: new Map([['r_boost', freshBoosterRole()]]) },
        members: { cache: members, me: { roles: { highest: { position: 10 } } } }
    };

    const out = await syncBoostRoles(guild, ['u_lapsed']);

    assert.deepStrictEqual(out, { applied: 1, removed: 1 });
    assert.strictEqual(boosterNoRole.__calls.add.length, 1, 'booster baru di-add');
    assert.strictEqual(boosterHasRole.__calls.add.length, 0, 'booster yang sudah punya role tak tersentuh');
    assert.strictEqual(plainWithRole.__calls.remove.length, 0, 'grant manual TIDAK dicabut');
    assert.strictEqual(botBooster.__calls.add.length, 0, 'bot di-skip');
    assert.strictEqual(lapsedBooster.__calls.remove.length, 1, 'boost berakhir offline → role dihapus');
});

test('syncBoostRoles: role belum di-set → no-op senyap, {applied:0, removed:0}', async () => {
    writeConfig({ roles: {} });
    const { syncBoostRoles } = require('../../src/bot/boostHandler');
    const member = makeMember({ hasRole: false, boosting: true });
    const guild = {
        id: 'g_br',
        roles: { cache: new Map() },
        members: { cache: new Map([['u_member', member]]) }
    };
    const out = await syncBoostRoles(guild, []);
    assert.deepStrictEqual(out, { applied: 0, removed: 0 });
    assert.strictEqual(member.__calls.add.length, 0);
});

// ====================================================
// === 4. guildMemberUpdate — event live             ===
// ====================================================

test('guildMemberUpdate: boost MULAI (premium_since null → tanggal) → role booster di-add', async () => {
    writeConfig({ roles: { booster: 'r_boost' } });
    // Reset store boostManager agar bersih antar-test (file sandbox di-restore saat exit).
    if (fs.existsSync(boostsPath)) fs.rmSync(boostsPath, { force: true });
    require('../../src/data/boostManager').reload();

    const member = makeMember({ hasRole: false, boosting: true });
    const oldMember = {
        ...member,
        premiumSinceTimestamp: null,
        roles: member.roles // referensi sama — cache lama "belum ada role"
    };
    const event = require('../../src/bot/events/guildMemberUpdate');

    await event.execute(oldMember, member);

    assert.strictEqual(member.__calls.add.length, 1, 'applyBoostRole jalan lewat event live');
    // Riwayat boost tetap tercatat (onBoostChange jalan SEBELUM role).
    const boosts = JSON.parse(fs.readFileSync(boostsPath, 'utf8'));
    assert.ok(boosts['g_br:u_member'], 'riwayat boost tercatat');
});

test('guildMemberUpdate: boost BERAKHIR (premium_since tanggal → null) → role booster dicabut', async () => {
    writeConfig({ roles: { booster: 'r_boost' } });
    if (fs.existsSync(boostsPath)) fs.rmSync(boostsPath, { force: true });
    require('../../src/data/boostManager').reload();

    const member = makeMember({ hasRole: true, boosting: false });
    const oldMember = {
        ...member,
        premiumSinceTimestamp: 1700000000000,
        roles: member.roles
    };
    const event = require('../../src/bot/events/guildMemberUpdate');

    await event.execute(oldMember, member);

    assert.strictEqual(member.__calls.remove.length, 1, 'role dicabut saat boost berakhir');
});

// ====================================================
// === 5. /set-role booster — retroaktif             ===
// ====================================================

test('/set-role booster: config tersimpan + retroaktif ke booster yang ada + reply menyebut jumlahnya', async () => {
    writeConfig({ roles: {} });
    if (fs.existsSync(boostsPath)) fs.rmSync(boostsPath, { force: true });
    require('../../src/data/boostManager').reload();

    const booster = makeMember({ hasRole: false, boosting: true });
    booster.user.id = 'u_booster_live';
    const roleOption = { id: 'r_boost', name: 'Booster', managed: false, position: 3 };

    const replies = [];
    const interaction = {
        commandName: 'set-role',
        client: { user: { username: 'TestBot', displayAvatarURL: () => 'http://x/a.png' } },
        user: { id: 'admin1', tag: 'Admin#0001' },
        guild: {
            id: 'g_br',
            roles: { cache: new Map([['r_boost', freshBoosterRole()]]) },
            members: {
                me: { roles: { highest: { position: 10 } } },
                fetch: async () => {},
                cache: new Map([['u_booster_live', booster]])
            }
        },
        options: {
            getString: () => 'booster',
            getRole: () => roleOption
        },
        deferReply: async () => {},
        editReply: async opts => {
            replies.push(opts);
            return {};
        }
    };

    await require('../../src/commands/config')(interaction);

    // Config tersimpan (v3.10.0: /set-role menulis config guild 'g_br').
    const saved = JSON.parse(fs.readFileSync(configPaths[0], 'utf8'));
    assert.strictEqual(saved.roles.booster, 'r_boost', 'roles.booster tersimpan');
    // Retroaktif: booster yang sedang boost langsung dapat role.
    assert.strictEqual(booster.__calls.add.length, 1, 'booster live langsung di-add');
    // Reply admin menyebut jumlah penerapan.
    assert.match(replies[0].content, /Role \*\*booster\*\* diatur/);
    assert.match(replies[0].content, /1 member yang sedang boost/);
});

// ====================================================
// === 6. /test-booster — diagnosis role (murni)     ===
// ====================================================

/** Stub interaction /test-booster ala testBooster.test.js + roles. */
function makeTestBoosterInteraction({ configRoles = {} } = {}) {
    const sent = [];
    const currentCh = { id: 'ch_cur', name: 'cur', send: async p => sent.push(p) };
    const boosterRole = { id: 'r_boost', name: 'Booster', position: 3 };
    // Cache selalu memuat role ASLI ('r_boost') — kalau config menunjuk ID lain
    // (ghost), guild.roles.cache.get() tidak menemukannya.
    const roleCache = new Map([['r_boost', boosterRole]]);
    const roleCalls = { add: [], remove: [] };
    const guild = {
        id: 'g_tb',
        name: 'ServerTes',
        iconURL: () => null,
        premiumTier: 1,
        premiumSubscriptionCount: 3,
        channels: { cache: new Map() },
        roles: { cache: roleCache },
        members: {
            me: { id: 'bot_me', roles: { highest: { position: 10 } }, permissions: { has: () => true } }
        }
    };
    const member = {
        guild,
        premiumSinceTimestamp: null,
        roles: {
            cache: { has: () => false },
            add: async r => roleCalls.add.push(r),
            remove: async r => roleCalls.remove.push(r)
        },
        user: { id: 'user_admin', bot: false, tag: 'Admin#0001', displayAvatarURL: () => 'https://cdn.example/a.png' }
    };
    const replies = [];
    const interaction = {
        commandName: 'test-booster',
        client: {},
        deferReply: async () => {},
        editReply: async opts => {
            replies.push(opts);
            return {};
        },
        guild,
        member,
        user: member.user,
        channel: currentCh,
        options: { getString: () => 'add', getBoolean: () => null }
    };
    interaction.__replies = replies;
    interaction.__roleCalls = roleCalls;
    return interaction;
}

test('/test-booster (role di-set & sehat): baris ✅ role booster + semantik add/remove', async () => {
    writeConfig({ roles: { booster: 'r_boost' }, channels: {} });
    const interaction = makeTestBoosterInteraction({ configRoles: { booster: 'r_boost' } });

    await require('../../src/commands/stats')(interaction);

    const reply = interaction.__replies[0].content;
    assert.match(reply, /role booster:/);
    assert.match(reply, /otomatis diberikan saat member boost, dihapus saat boost berakhir/);
    // Simulasi murni: role admin TIDAK pernah diutak-atik.
    assert.strictEqual(interaction.__roleCalls.add.length, 0, 'tidak ada roles.add');
    assert.strictEqual(interaction.__roleCalls.remove.length, 0, 'tidak ada roles.remove');
    assert.match(reply, /role booster tidak diutak-atik/);
});

test('/test-booster (role ghost): baris ❌ + command perbaikannya', async () => {
    writeConfig({ roles: { booster: 'r_ghost' }, channels: {} });
    const interaction = makeTestBoosterInteraction({ configRoles: { booster: 'r_ghost' } }); // tidak ter-cache

    await require('../../src/commands/stats')(interaction);

    const reply = interaction.__replies[0].content;
    assert.match(reply, /role booster: tidak ditemukan/);
    assert.match(reply, /\/set-role booster @role/);
});

test('/test-booster (role belum di-set): baris ℹ️ opsional — tidak error', async () => {
    writeConfig({ roles: {}, channels: {} });
    const interaction = makeTestBoosterInteraction({});

    await require('../../src/commands/stats')(interaction);

    const reply = interaction.__replies[0].content;
    assert.match(reply, /Role booster: belum di-set \(opsional\)/);
    assert.match(reply, /\/set-role booster @role/);
});

// ====================================================
// === 7. Help catalog — dokumentasi + budget        ===
// ====================================================

test('help catalog: role booster terdokumentasi (roles + stats) + budget aman', () => {
    const { HELP_CATEGORIES, buildAllEmbeds, embedTotalChars, searchHelp } = require('../../src/ui/helpCatalog');
    const rolesCat = HELP_CATEGORIES.find(c => c.id === 'roles');
    assert.ok(rolesCat.lines.some(l => l.includes('booster')), 'baris kompak set-role memuat booster');
    assert.match(rolesCat.detail.join('\n'), /tipe:booster/, 'panduan roles menjelaskan tipe:booster');

    const statsCat = HELP_CATEGORIES.find(c => c.id === 'stats');
    assert.match(statsCat.detail.join('\n'), /role itu diberikan\/dihapus otomatis/, 'panduan boost menyebut auto-role');

    // Budget Semua Command tetap terpenuhi.
    const all = buildAllEmbeds();
    const total = all.reduce((s, e) => s + embedTotalChars(e), 0);
    assert.ok(total <= 5800, `total Semua Command ${total} ≤ 5800`);

    // set-role booster bisa ditemukan lewat pencarian.
    const result = searchHelp('booster');
    assert.ok(result.totalBlocks >= 1, 'mencari "booster" menemukan kategori terkait');
});
