/**
 * Unit test v3.9.51 — channel counter SERVER STATS live + penghapusan
 * Total Revenue dari /stats.
 *
 * Permintaan user: "saya mau tambahan fitur untuk fitur stats server secara
 * live yang mirip seperti bot server stats" (nama channel = counter yang
 * ter-update otomatis) — plus "fitur total revenue di hapus saja".
 *
 * Dicover end-to-end lewat modul ASLI dengan stub:
 *   1. serverstatsManager: builder murni (nama counter, nilai live),
 *      persistensi round-trip, refresh change-detection, cooldown rename
 *      per-channel (+ bypass force), warning channel hilang + auto-disable
 *      saat SEMUA counter hilang, scheduler tick dirty-driven + catch-up
 *      5 menit.
 *   2. /serverstats setup: bikin kategori + 5 channel counter dengan nilai
 *      LIVE, @everyone denied Connect, kategori paling atas, config
 *      tersimpan; menolak saat sudah di-setup; auto-heal saat semua channel
 *      lama hilang; menolak rapi tanpa permission bot.
 *   3. /serverstats remove: menghapus semua channel + kategori, membersihkan
 *      config.
 *   4. /serverstats refresh: memaksa satu update langsung.
 *   5. Wiring event: guildMemberAdd menandai stats dirty; channelCreate
 *      menandai dirty.
 *   6. Kontrak: registry (91 command, 3 subcommand), mapping router + TIDAK
 *      public, FILES_TO_BACKUP, baris help catalog + budget 5800, index.js
 *      meregistrasi 4 file event baru.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SERVERSTATS_PATH = path.join(DATA_DIR, 'serverstats.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const GUILD_ID = 'test_guild_serverstats';

const manager = require('../../src/data/serverstatsManager');
const serverstatsCommand = require('../../src/commands/serverstats');

/** Bersihkan config terpersist + semua state in-memory. */
function resetManager(cleanFile = true) {
    manager._resetForTests();
    if (cleanFile && fs.existsSync(SERVERSTATS_PATH)) {
        try {
            fs.unlinkSync(SERVERSTATS_PATH);
        } catch (_) {}
    }
    manager._resetForTests();
}

/**
 * Stub channel counter — merekam panggilan setName + delete (seperti
 * GuildChannel asli).
 */
function makeCounterChannel(id, name) {
    const calls = [];
    const ch = {
        id,
        name,
        setName: async (newName, reason) => {
            calls.push({ newName, reason });
            ch.name = newName;
            return ch;
        },
        delete: async () => {
            ch.__deleted = true;
            return ch;
        }
    };
    ch.__calls = calls;
    return ch;
}

/**
 * Stub guild sesuai yang disentuh manager + command.
 * Nilai live tetap: memberCount 5, 2 bot, 2 boost, 9 role, 7 channel.
 */
function makeStubGuild({ withCounters = false, botPermissions = true } = {}) {
    let idSeq = 0;
    const channelsCache = new Map();
    // 7 channel yang sudah ada (counter "Channel" menghitung ukuran cache).
    for (let i = 0; i < 7; i++) {
        channelsCache.set(`pre_${i}`, makeCounterChannel(`pre_${i}`, `pre-${i}`));
    }
    const rolesCache = new Map();
    for (let i = 0; i < 9; i++) {
        rolesCache.set(`role_${i}`, { id: `role_${i}`, name: `Role${i}` });
    }
    const membersCache = new Map();
    for (let i = 0; i < 3; i++) {
        membersCache.set(`human_${i}`, { id: `human_${i}`, user: { id: `human_${i}`, bot: false } });
    }
    for (let i = 0; i < 2; i++) {
        membersCache.set(`bot_${i}`, { id: `bot_${i}`, user: { id: `bot_${i}`, bot: true } });
    }

    const created = [];
    const guild = {
        id: GUILD_ID,
        name: 'Counter Test Server',
        memberCount: 5,
        premiumSubscriptionCount: 2,
        channels: {
            cache: channelsCache,
            create: async opts => {
                const ch = makeCounterChannel(`ss_${++idSeq}`, opts.name);
                Object.assign(ch, { __opts: opts });
                created.push(ch);
                channelsCache.set(ch.id, ch);
                return ch;
            }
        },
        roles: {
            cache: rolesCache,
            everyone: { id: 'everyone_role' }
        },
        members: {
            cache: membersCache,
            me: { permissions: { has: () => botPermissions } }
        }
    };
    guild.__created = created;

    if (withCounters) {
        // Kategori palsu di cache supaya /serverstats remove bisa menghapusnya.
        const category = makeCounterChannel('cat_1', '📊 STATISTIK SERVER');
        channelsCache.set(category.id, category);

        const counters = {};
        for (const def of manager.COUNTER_DEFS) {
            const ch = makeCounterChannel(`cnt_${def.type}`, 'placeholder');
            channelsCache.set(ch.id, ch);
            counters[def.type] = ch.id;
        }
        // Nama counter memakai state cache FINAL (semua channel didaftarkan
        // dulu — mencerminkan ekspektasi change-detection saat refresh).
        for (const def of manager.COUNTER_DEFS) {
            const ch = channelsCache.get(counters[def.type]);
            ch.name = manager.buildCounterName(def.type, manager.computeCounterValue(guild, def.type));
        }
        guild.__counterChannels = manager.COUNTER_DEFS.map(d => channelsCache.get(counters[d.type]));
        guild.__categoryChannel = category;
        manager.saveConfig({
            guildId: GUILD_ID,
            categoryId: category.id,
            counters,
            enabled: true,
            updatedAt: Date.now()
        });
    }
    return guild;
}

/** Stub interaction untuk command /serverstats. `booleanOptions` mengisi
 *  getBoolean (flag pemilihan counter v3.9.53 — undefined = default aktif). */
function makeStubInteraction(sub, guild, booleanOptions = {}) {
    const replies = [];
    const interaction = {
        commandName: 'serverstats',
        options: {
            getSubcommand: () => sub,
            getBoolean: name => booleanOptions[name]
        },
        deferReply: async () => {},
        editReply: async opts => {
            replies.push(opts);
            return {};
        },
        guild,
        user: { id: 'admin_user', tag: 'Admin#0001' },
        client: { channels: { cache: new Map() } }
    };
    interaction.__replies = replies;
    return interaction;
}

test('builder murni: nama counter + nilai live dari objek guild', () => {
    resetManager();
    const guild = makeStubGuild();

    assert.deepStrictEqual(
        manager.COUNTER_DEFS.map(d => manager.buildCounterName(d.type, manager.computeCounterValue(guild, d.type))),
        ['👥 Member: 5', '🤖 Bot: 2', '🚀 Boost: 2', '🎭 Role: 9', '📺 Channel: 7']
    );
    // Tipe tak dikenal → angka polos (defensif).
    assert.strictEqual(manager.buildCounterName('nonsense', 3), '3');
    // Guild null → nol (tidak pernah throw).
    assert.strictEqual(manager.computeCounterValue(null, 'members'), 0);
    assert.strictEqual(manager.computeCounterValue(guild, 'unknown'), 0);
});

test('persistensi: saveConfig → getConfig round-trip, isEnabled, clearConfig, reload', () => {
    resetManager();
    assert.strictEqual(manager.isEnabled(), false, 'awalnya belum di-setup');

    manager.saveConfig({ guildId: GUILD_ID, categoryId: 'cat_1', counters: { members: 'ch_1' }, enabled: true, updatedAt: 1 });
    assert.strictEqual(manager.isEnabled(), true);
    assert.strictEqual(manager.getConfig().counters.members, 'ch_1');
    assert.ok(fs.existsSync(SERVERSTATS_PATH), 'config terpersist ke data/serverstats.json');

    // reload() baca ulang dari disk (fix basi restore-backup).
    fs.writeFileSync(SERVERSTATS_PATH, JSON.stringify({ guildId: GUILD_ID, categoryId: 'cat_2', counters: { members: 'ch_9' }, enabled: true }));
    const cfg = manager.reload();
    assert.strictEqual(cfg.counters.members, 'ch_9', 'reload membuang cache in-memory');

    manager.clearConfig();
    assert.strictEqual(manager.isEnabled(), false);
    assert.ok(!fs.existsSync(SERVERSTATS_PATH), 'clearConfig menghapus file-nya');
});

test('refresh: change detection — nama sama = NOL panggilan setName', async () => {
    resetManager();
    const guild = makeStubGuild({ withCounters: true });
    // Channel counter dibuat dengan nilai live SAAT INI → tidak ada yang di-rename.
    const result = await manager.refreshServerStats(guild);
    assert.strictEqual(result.updated, 0);
    assert.strictEqual(result.deferred, 0);
    assert.strictEqual(result.missing, 0);
    for (const ch of guild.__counterChannels) {
        assert.strictEqual(ch.__calls.length, 0, `tidak ada rename untuk counter yang tidak berubah: ${ch.name}`);
    }
});

test('refresh: nilai berubah → SATU rename dengan nama baru (force melewati cooldown)', async () => {
    resetManager();
    const guild = makeStubGuild({ withCounters: true });
    guild.memberCount = 6; // ada member join.

    // Pertama TANPA force → diblokir cooldown (ini edit pertama — belum ada
    // cooldown terpasang, jadi lolos).
    let result = await manager.refreshServerStats(guild);
    assert.strictEqual(result.updated, 1);
    const membersCh = guild.__counterChannels.find(c => c.id === 'cnt_members');
    assert.strictEqual(membersCh.__calls.length, 1);
    assert.strictEqual(membersCh.__calls[0].newName, '👥 Member: 6');
    assert.match(membersCh.__calls[0].reason, /server stats/i);

    // Sekarang DENGAN force → melewati cooldown yang baru terpasang dan rename lagi.
    guild.memberCount = 7;
    result = await manager.refreshServerStats(guild, { force: true });
    assert.strictEqual(result.updated, 1);
    assert.strictEqual(membersCh.__calls.length, 2);
    assert.strictEqual(membersCh.__calls[0].newName, '👥 Member: 6');
    assert.strictEqual(membersCh.__calls[1].newName, '👥 Member: 7');
});

test('refresh: cooldown per-channel MENUNDA rename non-force (limit Discord 2/10 menit)', async () => {
    resetManager();
    const guild = makeStubGuild({ withCounters: true });

    // Edit 1 (belum ada cooldown) lolos.
    guild.premiumSubscriptionCount = 3;
    let result = await manager.refreshServerStats(guild);
    assert.strictEqual(result.updated, 1);
    const boostsCh = guild.__counterChannels.find(c => c.id === 'cnt_boosts');
    assert.strictEqual(boostsCh.__calls[0].newName, '🚀 Boost: 3');

    // Edit 2 dalam COOLDOWN_MS → ditunda, TIDAK di-rename.
    guild.premiumSubscriptionCount = 4;
    result = await manager.refreshServerStats(guild);
    assert.strictEqual(result.updated, 0);
    assert.strictEqual(result.deferred, 1);
    assert.strictEqual(boostsCh.__calls.length, 1, 'cooldown memblokir rename kedua');
    assert.strictEqual(boostsCh.name, '🚀 Boost: 3');
});

test('refresh: setName gagal → error terhitung, tidak pernah throw', async () => {
    resetManager();
    const guild = makeStubGuild({ withCounters: true });
    const membersCh = guild.__counterChannels.find(c => c.id === 'cnt_members');
    membersCh.setName = async () => {
        throw new Error('rate limit hit');
    };
    guild.memberCount = 8;
    const result = await manager.refreshServerStats(guild);
    assert.strictEqual(result.errors, 1);
    assert.strictEqual(result.updated, 0);
});

test('refresh: channel dihapus → missing + warning; SEMUA hilang → auto-disable', async () => {
    resetManager();
    const guild = makeStubGuild({ withCounters: true });
    // Hapus 3 dari 5 channel counter (pembersihan admin).
    for (const type of ['members', 'bots', 'boosts']) {
        guild.channels.cache.delete(manager.getConfig().counters[type]);
    }
    const warnings = [];
    const origWarn = console.warn;
    console.warn = msg => warnings.push(msg);
    try {
        const result = await manager.refreshServerStats(guild);
        assert.strictEqual(result.missing, 3);
        assert.strictEqual(manager.isEnabled(), true, 'tetap enabled selama 2 counter masih hidup');
        assert.ok(warnings.some(w => /counter server stats/i.test(w)), 'channel hilang mengeluarkan warning + solusi');
    } finally {
        console.warn = origWarn;
    }

    // Hapus sisanya → fitur auto-disable (scheduler tidak kerja sia-sia).
    warnings.length = 0;
    console.warn = msg => warnings.push(msg);
    try {
        for (const type of ['roles', 'channels']) {
            guild.channels.cache.delete(manager.getConfig().counters[type]);
        }
        const result = await manager.refreshServerStats(guild);
        assert.strictEqual(result.disabled, true);
        assert.strictEqual(manager.isEnabled(), false, 'auto-disable saat semua counter hilang');
        assert.ok(!fs.existsSync(SERVERSTATS_PATH), 'config mati dibersihkan');
    } finally {
        console.warn = origWarn;
    }
});

test('scheduler tick: refresh dirty-driven + catch-up 5 tick + no-op saat disabled', async () => {
    resetManager();

    // Belum di-setup → skipped, walau dirty.
    manager.markStatsDirty(GUILD_ID);
    assert.strictEqual(manager.isDirty(), false, 'markStatsDirty no-op saat disabled');
    let result = await manager.processSchedulerTick({ guilds: { cache: new Map() } });
    assert.strictEqual(result.skipped, true);

    // Di-setup → event menandai dirty → tick BERIKUTNYA langsung refresh.
    const guild = makeStubGuild({ withCounters: true });
    manager.markStatsDirty(GUILD_ID);
    assert.strictEqual(manager.isDirty(), true);
    const client = { guilds: { cache: new Map([[GUILD_ID, guild]]) } };
    guild.memberCount = 6;
    result = await manager.processSchedulerTick(client);
    assert.strictEqual(result.updated, 1, 'flag dirty memicu refresh');
    assert.strictEqual(manager.isDirty(), false, 'flag dirty direset setelah refresh');

    // Tidak dirty + bukan tick ke-5 → skipped.
    result = await manager.processSchedulerTick(client);
    assert.strictEqual(result.skipped, true);

    // Tick 3-4 skipped, tick 5 = refresh catch-up (nilai berubah).
    // Cooldown per-channel baru terpasang tick 1 — mock jam 6 menit ke depan
    // supaya cooldown sudah lewat saat tick 5.
    await manager.processSchedulerTick(client); // 3
    await manager.processSchedulerTick(client); // 4
    guild.memberCount = 7;
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try {
        result = await manager.processSchedulerTick(client); // 5
    } finally {
        Date.now = realNow;
    }
    assert.strictEqual(result.updated, 1, 'tick ke-5 adalah refresh catch-up');

    // markStatsDirty untuk guild LAIN diabaikan (hardening single-guild).
    manager.markStatsDirty('other_guild');
    assert.strictEqual(manager.isDirty(), false);
});

test('/serverstats setup: bikin kategori + 5 counter dengan nilai live, @everyone terkunci, config tersimpan', async () => {
    resetManager();
    const guild = makeStubGuild();
    const interaction = makeStubInteraction('setup', guild);

    await serverstatsCommand(interaction);

    assert.strictEqual(interaction.__replies.length, 1, 'tepat satu balasan');
    const embed = interaction.__replies[0].embeds[0];
    assert.match(embed.data.title, /counter live berhasil dibuat/);
    // v3.9.53: 5 field counter + 1 field "Tidak dibuat" (= semua aktif).
    assert.strictEqual(embed.data.fields.length, 6);
    const notCreated = embed.data.fields[5];
    assert.match(notCreated.name, /Tidak dibuat/);
    assert.match(notCreated.value, /semua counter aktif/);

    // 6 pembuatan: 1 kategori + 5 counter.
    assert.strictEqual(guild.__created.length, 6);
    const [category, ...counters] = guild.__created;

    // Kategori: paling atas daftar channel, @everyone denied Connect.
    assert.strictEqual(category.__opts.name, '📊 STATISTIK SERVER');
    assert.strictEqual(category.__opts.type, ChannelType.GuildCategory);
    assert.strictEqual(category.__opts.position, 0);
    assert.ok(
        category.__opts.permissionOverwrites.some(o => o.id === 'everyone_role' && o.deny.includes(PermissionFlagsBits.Connect)),
        '@everyone tidak bisa join kategori counter'
    );

    // 5 counter: channel voice di bawah kategori, nama live, terkunci.
    assert.deepStrictEqual(
        counters.map(c => c.__opts.name),
        ['👥 Member: 5', '🤖 Bot: 2', '🚀 Boost: 2', '🎭 Role: 9', '📺 Channel: 7']
    );
    for (const c of counters) {
        assert.strictEqual(c.__opts.type, ChannelType.GuildVoice);
        assert.strictEqual(c.__opts.parent, category.id);
        assert.ok(
            c.__opts.permissionOverwrites.some(o => o.id === 'everyone_role' && o.deny.includes(PermissionFlagsBits.Connect)),
            `@everyone tidak bisa join ${c.__opts.name}`
        );
    }

    // Config menunjuk channel yang dibuat.
    assert.strictEqual(manager.isEnabled(), true);
    const cfg = manager.getConfig();
    assert.strictEqual(cfg.guildId, GUILD_ID);
    assert.strictEqual(cfg.categoryId, category.id);
    assert.strictEqual(Object.keys(cfg.counters).length, 5);
    for (const c of counters) {
        assert.ok(Object.values(cfg.counters).includes(c.id));
    }
});

test('/serverstats setup: PEMILIHAN COUNTER (v3.9.53) — opsi False dilewati, config + embed mengikuti pilihan', async () => {
    resetManager();
    const guild = makeStubGuild();
    // Hanya boost/role/channel — members + bots dimatikan.
    const interaction = makeStubInteraction('setup', guild, { members: false, bots: false });

    await serverstatsCommand(interaction);

    assert.strictEqual(guild.__created.length, 4, '1 kategori + 3 counter terpilih');
    const [category, ...counters] = guild.__created;
    assert.deepStrictEqual(
        counters.map(c => c.__opts.name),
        ['🚀 Boost: 2', '🎭 Role: 9', '📺 Channel: 7']
    );

    // Config hanya menyimpan counter TERPILIH — refresh iterasi itu saja.
    const cfg = manager.getConfig();
    assert.deepStrictEqual(Object.keys(cfg.counters).sort(), ['boosts', 'channels', 'roles']);

    // Konfirmasi mencantumkan counter yang dilewati.
    const embed = interaction.__replies[0].embeds[0];
    const notCreated = embed.data.fields.find(f => /Tidak dibuat/.test(f.name));
    assert.ok(notCreated, 'field "Tidak dibuat" harus ada');
    assert.match(notCreated.value, /Member/);
    assert.match(notCreated.value, /Bot/);
    assert.ok(!notCreated.value.includes('Boost'), 'counter terpilih tidak boleh muncul sebagai dilewati');
});

test('/serverstats setup: SEMUA counter False → penolakan ramah, tidak ada yang dibuat', async () => {
    resetManager();
    const guild = makeStubGuild();
    const interaction = makeStubInteraction('setup', guild, {
        members: false, bots: false, boosts: false, roles: false, channels: false
    });

    await serverstatsCommand(interaction);

    assert.strictEqual(guild.__created.length, 0, 'tidak ada yang dibuat');
    assert.strictEqual(manager.isEnabled(), false, 'config tidak tersimpan');
    const reply = interaction.__replies[0];
    assert.match(reply.content, /mematikan SEMUA counter/);
    assert.match(reply.content, /minimal satu/i);
});

test('/serverstats refresh: hanya mencantumkan counter yang ter-config saat pilihannya parsial', async () => {
    resetManager();
    const guild = makeStubGuild();
    // Setup parsial (3 counter, seperti /serverstats setup members:false bots:false).
    const interaction = makeStubInteraction('setup', guild, { members: false, bots: false });
    await serverstatsCommand(interaction);

    const refreshInteraction = makeStubInteraction('refresh', guild);
    await serverstatsCommand(refreshInteraction);

    const desc = refreshInteraction.__replies[0].embeds[0].data.description;
    assert.match(desc, /Boost/);
    assert.match(desc, /Role/);
    assert.ok(!/Member: /.test(desc), 'counter tidak terpilih tidak boleh dicantumkan');
    assert.ok(!/Bot: /.test(desc), 'counter tidak terpilih tidak boleh dicantumkan');
});

test('/serverstats setup: menolak saat sudah di-setup; auto-heal saat semua channel lama hilang', async () => {
    // Kasus 1 — sudah di-setup + channel masih ada → penolakan dengan perintah solusi.
    resetManager();
    const guild = makeStubGuild({ withCounters: true });
    let interaction = makeStubInteraction('setup', guild);
    await serverstatsCommand(interaction);
    assert.strictEqual(guild.__created.length, 0, 'tidak ada yang dibuat saat penolakan');
    assert.match(interaction.__replies[0].content, /sudah di-setup/);
    assert.match(interaction.__replies[0].content, /\/serverstats refresh/);
    assert.match(interaction.__replies[0].content, /\/serverstats remove/);

    // Kasus 2 — enabled tapi SEMUA channel terhapus → auto-heal ke setup baru.
    resetManager();
    const guild2 = makeStubGuild({ withCounters: true });
    for (const ch of guild2.__counterChannels) {
        guild2.channels.cache.delete(ch.id);
    }
    interaction = makeStubInteraction('setup', guild2);
    await serverstatsCommand(interaction);
    assert.strictEqual(guild2.__created.length, 6, 'setup baru dibuat');
    assert.match(interaction.__replies[0].embeds[0].data.title, /counter live berhasil dibuat/);
});

test('/serverstats setup: menolak rapi tanpa Manage Channels/Manage Roles', async () => {
    resetManager();
    const guild = makeStubGuild({ botPermissions: false });
    const interaction = makeStubInteraction('setup', guild);
    await serverstatsCommand(interaction);
    assert.strictEqual(guild.__created.length, 0, 'tidak ada yang dibuat tanpa permission');
    assert.match(interaction.__replies[0].content, /Manage Channels/);
    assert.match(interaction.__replies[0].content, /Manage Roles/);
});

test('/serverstats setup: gagal sebagian → ROLLBACK (tanpa channel zombie)', async () => {
    resetManager();
    const guild = makeStubGuild();
    // Pembuatan counter ke-3 gagal (mis. limit channel tercapai).
    let created = 0;
    const realCreate = guild.channels.create;
    guild.channels.create = async opts => {
        created++;
        if (created === 4) throw new Error('Maximum channels reached');
        return realCreate(opts);
    };
    const interaction = makeStubInteraction('setup', guild);
    await serverstatsCommand(interaction);

    // Semua yang dibuat sebelum kegagalan dihapus (rollback).
    const rollbackDeletes = guild.__created.filter(c => c.__deleted).length;
    assert.ok(rollbackDeletes >= 3, `channel di-rollback: ${rollbackDeletes}`);
    assert.strictEqual(manager.isEnabled(), false, 'config tidak tersimpan saat gagal');
    assert.match(interaction.__replies[0].content, /rollback/);
});

test('/serverstats remove: menghapus channel + kategori dan membersihkan config', async () => {
    resetManager();
    const guild = makeStubGuild({ withCounters: true });
    // Lacak penghapusan.
    const deleted = [];
    for (const ch of guild.channels.cache.values()) {
        ch.delete = async () => {
            deleted.push(ch.id);
            return ch;
        };
    }
    const interaction = makeStubInteraction('remove', guild);
    await serverstatsCommand(interaction);

    // 5 counter + kategori (diresolve lewat ID dari config).
    assert.ok(deleted.length >= 6, `semua counter + kategori dihapus: ${deleted.length}`);
    assert.strictEqual(manager.isEnabled(), false);
    assert.ok(!fs.existsSync(SERVERSTATS_PATH));
    assert.match(interaction.__replies[0].content, /dihapus/);
});

test('/serverstats refresh: memaksa update langsung + laporan hasil per counter', async () => {
    resetManager();
    const guild = makeStubGuild({ withCounters: true });
    guild.memberCount = 6;
    const interaction = makeStubInteraction('refresh', guild);
    await serverstatsCommand(interaction);

    const embed = interaction.__replies[0].embeds[0];
    assert.match(embed.data.title, /counter di-refresh/);
    assert.match(embed.data.description, /👥 Member: \*\*6\*\*/);
    assert.match(embed.data.description, /Di-update: \*\*1\*\*/);
    assert.match(embed.data.description, /Tertunda cooldown: \*\*0\*\*/);
});

test('/serverstats remove & refresh: error ramah saat belum di-setup', async () => {
    resetManager();
    const guild = makeStubGuild();
    for (const sub of ['remove', 'refresh']) {
        const interaction = makeStubInteraction(sub, guild);
        await serverstatsCommand(interaction);
        assert.match(interaction.__replies[0].content, /belum di-setup/);
        assert.match(interaction.__replies[0].content, /\/serverstats setup/);
    }
});

test('wiring event: guildMemberAdd + channelCreate menandai stats dirty', async () => {
    resetManager();
    const guild = makeStubGuild({ withCounters: true });

    // guildMemberAdd — member BOT (onMemberAdd langsung return untuk bot,
    // tapi markStatsDirty tetap harus jalan: memberCount termasuk bot).
    const savedGuildId = process.env.GUILD_ID;
    process.env.GUILD_ID = '';
    try {
        const memberEvent = require('../../src/bot/events/guildMemberAdd');
        await memberEvent.execute({
            guild,
            user: { id: 'bot_new', tag: 'Bot#0001', bot: true, createdTimestamp: Date.now() },
            client: { channels: { cache: new Map() } }
        });
        assert.strictEqual(manager.isDirty(), true, 'join menandai stats dirty');
    } finally {
        process.env.GUILD_ID = savedGuildId;
    }

    // channelCreate — ada channel dibuat (counter Channel berubah).
    manager._resetForTests(); // reset flag dirty, file tetap ada
    assert.strictEqual(manager.isDirty(), false);
    const channelCreateEvent = require('../../src/bot/events/channelCreate');
    channelCreateEvent.execute({ guild: { id: GUILD_ID } });
    assert.strictEqual(manager.isDirty(), true, 'channel dibuat menandai stats dirty');

    // markStatsDirty mengabaikan guild lain (hardening single-guild).
    manager._resetForTests();
    channelCreateEvent.execute({ guild: { id: 'other_guild' } });
    assert.strictEqual(manager.isDirty(), false);
});

test('KONTRAK registry/router: /serverstats terdaftar dengan 3 subcommand, admin-gated, ter-route, TIDAK public', () => {
    resetManager();
    const { getCommands } = require('../../src/commands/registry');
    const cmds = getCommands();
    assert.strictEqual(cmds.length, 91, '91 command (90 + /serverstats)');

    const cmd = cmds.find(c => c.name === 'serverstats');
    assert.ok(cmd, '/serverstats ada di registry');
    assert.ok(cmd.defaultMemberPermissions, '/serverstats admin-gated (ManageGuild)');
    const subNames = cmd.options.map(o => o.name);
    assert.deepStrictEqual(subNames, ['setup', 'remove', 'refresh']);
    for (const o of cmd.options) {
        assert.strictEqual(o.type, 1, 'opsi subcommand');
        assert.ok(o.description.length <= 100, 'deskripsi subcommand ≤ 100');
    }

    // v3.9.53: setup membawa 5 boolean pemilihan counter (default aktif).
    const setup = cmd.options.find(o => o.name === 'setup');
    const selOpts = setup.options || [];
    assert.deepStrictEqual(
        selOpts.map(o => o.name),
        ['members', 'bots', 'boosts', 'roles', 'channels'],
        'setup memaparkan satu boolean per counter'
    );
    for (const o of selOpts) {
        assert.strictEqual(o.type, 5, 'opsi pemilihan counter adalah boolean');
        assert.strictEqual(o.required, false, 'opsi pemilihan opsional (default aktif)');
        assert.ok(o.description.length <= 100, 'deskripsi opsi ≤ 100');
    }

    const routeCommand = require('../../src/commands/index');
    assert.strictEqual(routeCommand.COMMAND_TO_DOMAIN.serverstats, 'serverstats', 'ter-route ke domain serverstats');
    assert.ok(!routeCommand.PUBLIC_COMMANDS.includes('serverstats'), '/serverstats TIDAK public');

    // 4 file event baru teregistrasi di index.js (kontrak level source).
    const indexSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');
    for (const evt of ['channelCreate', 'channelDelete', 'guildRoleCreate', 'guildRoleDelete']) {
        assert.ok(
            indexSrc.includes(`src/bot/events/${evt}`),
            `index.js meregistrasi event ${evt}`
        );
    }

    // serverstats.json di-backup (selamat dari /restore-backup).
    const { FILES_TO_BACKUP } = require('../../src/data/backupManager');
    assert.ok(FILES_TO_BACKUP.includes('serverstats.json'), 'serverstats.json ada di FILES_TO_BACKUP');

    // Help catalog mendokumentasikan /serverstats + budget terjaga.
    const { HELP_CATEGORIES, buildAllEmbeds, embedTotalChars } = require('../../src/ui/helpCatalog');
    const statsCat = HELP_CATEGORIES.find(c => c.id === 'stats');
    assert.ok(statsCat.lines.some(l => l.includes('/serverstats')), 'help catalog menyebut /serverstats');
    const all = buildAllEmbeds();
    const total = all.reduce((s, e) => s + embedTotalChars(e), 0);
    assert.strictEqual(all[0].data.fields.length, HELP_CATEGORIES.length, 'semua kategori tetap di tampilan Semua');
    assert.ok(total <= 5800, `embed Semua Command tetap dalam budget: ${total}`);

    // Manager mengekspor konstanta rate-limit (guard terhadap perubahan tak
    // sengaja yang melanggar limit Discord 2-rename-per-10-menit).
    assert.strictEqual(manager.COOLDOWN_MS, 5 * 60 * 1000, 'cooldown per-channel 5 menit');
    assert.strictEqual(manager.REFRESH_EVERY_TICKS, 5, 'catch-up 5 menit (tick 60 detik)');
});

// === Cleanup: jangan tinggalkan config test untuk file test lain ===
test('cleanup: hapus serverstats.json test', () => {
    resetManager();
    assert.ok(!fs.existsSync(SERVERSTATS_PATH));
});
