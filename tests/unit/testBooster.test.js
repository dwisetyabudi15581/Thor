/**
 * Unit tests untuk v3.9.58 — /test-booster (versi /test-welcome milik fitur boost).
 *
 * Permintaan user: "command test booster". Admin tidak bisa mensimulasikan boost
 * asli (bayar uang sungguhan), jadi /test-booster membuktikan seluruh rantai
 * notifikasi bekerja: config → channel ada → izin bot, plus PREVIEW LIVE dari
 * embed yang persis dikirim boost asli (builder yang sama dengan event live).
 *
 * Yang ditambahkan v3.9.58 (semua tercakup di sini):
 *   1. Registry: /test-booster dengan pilihan tipe:add|remove + opsi `live`
 *      boolean opsional, admin-gated (ManageGuild).
 *   2. Router: 'test-booster' → domain stats.
 *   3. Command-nya (modul stats.js asli, interaction stub):
 *      - semua sehat → diagnosis ✅ + preview BOOST SERVER BARU pink di channel
 *        SAAT INI (dengan konten <@mention>, seperti yang asli);
 *      - tipe:remove → embed BOOST BERAKHIR abu-abu, tanpa mention;
 *      - channel belum di-set / ID ghost / izin kurang → reply menyebut
 *        masalahnya DAN command perbaikannya (pola diagnosability v3.9.48);
 *      - live:true → SEKALIAN mengirim ke channel server-booster ASLI;
 *        live:true tanpa channel → dilewati dengan alasan jelas;
 *   4. SIMULASI MURNI: boosts.json harus tetap byte-identik — tidak ada entry
 *      riwayat, tidak ada tulisan server log (data layer tak tersentuh).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
// v3.10.0: config per-guild — mock /test-booster pakai guild 'guild_tb'.
const configPath = path.join(DATA_DIR, 'config', 'guild_tb.json');
const boostsPath = path.join(DATA_DIR, 'boosts.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ====================================================
// === Sandbox: snapshot & restore config.json DAN    ===
// === boosts.json (kemurnian data = inti di sini)   ===
// ====================================================
const backups = [
    { path: configPath, had: fs.existsSync(configPath) },
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

/** Tulis config guild mock — v3.10.0: per-guild path. */
function writeConfig(channels = {}) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ channels, roles: {}, messages: {} }, null, 4));
}

/** Byte boosts.json saat ini (untuk asersi kemurnian). */
function boostsSnapshot() {
    return fs.existsSync(boostsPath) ? fs.readFileSync(boostsPath, 'utf8') : null;
}

/** Stub channel yang merekam semua yang dikirim ke sana. */
function makeChannel(id, { fail } = {}) {
    const sent = [];
    return {
        id,
        name: `chan-${id}`,
        sent,
        send: async payload => {
            if (fail) throw new Error(fail);
            sent.push(payload);
            return { id: `msg_${id}_${sent.length}` };
        }
    };
}

/**
 * Stub interaction untuk src/commands/stats.js (jalur /test-booster).
 * `configChannels['server-booster']` mensimulasikan channel ter-config ada di
 * cache guild (hanya kalau ada, diagnosis menemukannya).
 */
function makeTestBoosterInteraction({ tipe = 'add', live = null, configChannels = {}, perms = {} } = {}) {
    const boosterCh = makeChannel('ch_sb');
    const currentCh = makeChannel('ch_cur');
    const me = { id: 'bot_me' };
    boosterCh.permissionsFor = () => ({
        has: bit => {
            const { PermissionFlagsBits } = require('discord.js');
            if (bit === PermissionFlagsBits.SendMessages) return perms.send !== false;
            if (bit === PermissionFlagsBits.EmbedLinks) return perms.embed !== false;
            if (bit === PermissionFlagsBits.ViewChannel) return perms.view !== false;
            return true;
        }
    });

    const cache = new Map();
    cache.set('ch_cur', currentCh);
    if (configChannels['server-booster']) cache.set('ch_sb', boosterCh); // hanya ter-cache kalau ID cocok

    const guild = {
        id: 'guild_tb',
        name: 'ServerTes',
        iconURL: () => null,
        premiumTier: 1,
        premiumSubscriptionCount: 3,
        channels: { cache },
        members: { me }
    };
    const member = {
        guild,
        premiumSinceTimestamp: null,
        user: {
            id: 'user_admin',
            bot: false,
            tag: 'Admin#0001',
            displayAvatarURL: () => 'https://cdn.example/avatar.png'
        }
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
        options: { getString: () => tipe, getBoolean: () => live }
    };
    interaction.__replies = replies;
    interaction.__currentChannel = currentCh;
    interaction.__boosterChannel = boosterCh;
    return interaction;
}

// ====================================================
// === 1. Kontrak registry + router                  ===
// ====================================================

test('kontrak registry: /test-booster ada dengan pilihan add|remove + ManageGuild + live opsional', () => {
    const { getCommands } = require('../../src/commands/registry');
    const cmd = getCommands().find(c => c.name === 'test-booster');
    assert.ok(cmd, 'command terdaftar');
    assert.ok(cmd.defaultMemberPermissions, 'admin-gated');
    const tipe = cmd.options.find(o => o.name === 'tipe');
    assert.ok(tipe.required, 'tipe wajib');
    assert.deepStrictEqual(
        tipe.choices.map(c => c.value).sort(),
        ['add', 'remove']
    );
    const live = cmd.options.find(o => o.name === 'live');
    assert.ok(live, 'opsi live ada');
    assert.strictEqual(live.type, 5, 'live adalah boolean');
    assert.ok(!live.required, 'live opsional (default: preview saja)');
});

test('kontrak router: test-booster di-route ke domain stats', () => {
    const { COMMAND_TO_DOMAIN } = require('../../src/commands/index');
    assert.strictEqual(COMMAND_TO_DOMAIN['test-booster'], 'stats');
});

// ====================================================
// === 2. Command-nya — diagnosis + preview live     ===
// ====================================================

test('/test-booster (add, semua sehat): diagnosis ✅ + preview pink di channel saat ini', async () => {
    writeConfig({ 'server-booster': 'ch_sb' });
    const interaction = makeTestBoosterInteraction({ tipe: 'add', configChannels: { 'server-booster': 'ch_sb' } });
    const before = boostsSnapshot();

    await require('../../src/commands/stats')(interaction);

    assert.strictEqual(interaction.__replies.length, 1, 'tepat satu reply ephemeral');
    const reply = interaction.__replies[0].content;
    assert.match(reply, /channel server-booster:/);
    assert.match(reply, /✅ Send Messages · ✅ Embed Links/);
    assert.match(reply, /GuildMembers/);
    assert.match(reply, /Simulasi saja/);

    // Preview-nya: embed yang PERSIS dikirim boost add asli.
    assert.strictEqual(interaction.__currentChannel.sent.length, 1, 'embed preview terkirim');
    assert.strictEqual(interaction.__currentChannel.sent[0].content, '<@user_admin>', 'konten mention seperti yang asli');
    const embed = interaction.__currentChannel.sent[0].embeds[0];
    assert.match(embed.data.title, /BOOST SERVER BARU/);
    assert.strictEqual(embed.data.color, 0xf472b6, 'pink boost');
    assert.match(reply, /Preview terkirim/);

    // Tidak ada kirim asli tanpa live:true.
    assert.strictEqual(interaction.__boosterChannel.sent.length, 0, 'channel asli tak tersentuh secara default');
    // SIMULASI MURNI — file riwayat byte-identik.
    assert.strictEqual(boostsSnapshot(), before, 'boosts.json tak tersentuh');
});

test('/test-booster tipe:remove — embed BOOST BERAKHIR abu-abu, tanpa konten mention', async () => {
    writeConfig({ 'server-booster': 'ch_sb' });
    const interaction = makeTestBoosterInteraction({ tipe: 'remove', configChannels: { 'server-booster': 'ch_sb' } });
    const before = boostsSnapshot();

    await require('../../src/commands/stats')(interaction);

    assert.strictEqual(interaction.__currentChannel.sent.length, 1, 'embed preview terkirim');
    assert.strictEqual(interaction.__currentChannel.sent[0].content, undefined, 'tanpa mention saat remove');
    const embed = interaction.__currentChannel.sent[0].embeds[0];
    assert.match(embed.data.title, /BOOST BERAKHIR/);
    assert.strictEqual(embed.data.color, 0x95a5a6, 'abu-abu boost');
    assert.match(embed.data.description, /sudah tidak lagi boost/);
    assert.strictEqual(boostsSnapshot(), before, 'boosts.json tak tersentuh');
});

test('/test-booster (channel server-booster belum di-set): reply menyebut command perbaikannya; preview tetap terkirim', async () => {
    writeConfig({}); // belum ada apa pun
    const interaction = makeTestBoosterInteraction({ tipe: 'add', configChannels: {} });

    await require('../../src/commands/stats')(interaction);

    const reply = interaction.__replies[0].content;
    assert.match(reply, /belum di-set/);
    assert.match(reply, /\/set-channel server-booster #channel/);
    // Preview tetap terkirim — admin melihat format embed-nya.
    assert.strictEqual(interaction.__currentChannel.sent.length, 1, 'preview tetap terkirim');
});

test('/test-booster (ID channel tidak dikenal): reply menjelaskan terhapus / server lain', async () => {
    writeConfig({ 'server-booster': 'ch_ghost' });
    const interaction = makeTestBoosterInteraction({ tipe: 'add', configChannels: {} }); // ghost → tidak ter-cache

    await require('../../src/commands/stats')(interaction);

    const reply = interaction.__replies[0].content;
    assert.match(reply, /tidak ditemukan/);
    assert.match(reply, /ch_ghost/);
    assert.match(reply, /\/set-channel server-booster #channel/);
});

test('/test-booster (bot tanpa Send Messages): baris izin berubah ❌ + petunjuk perbaikan', async () => {
    writeConfig({ 'server-booster': 'ch_sb' });
    const interaction = makeTestBoosterInteraction({
        tipe: 'add',
        configChannels: { 'server-booster': 'ch_sb' },
        perms: { send: false }
    });

    await require('../../src/commands/stats')(interaction);

    const reply = interaction.__replies[0].content;
    assert.match(reply, /❌ Send Messages/);
    assert.match(reply, /aktifkan \*\*Send Messages\*\*/);
});

// ====================================================
// === 3. live:true — tes pengiriman end-to-end     ===
// ====================================================

test('/test-booster live:true (sehat): preview SEKALIAN terkirim ke channel server-booster ASLI', async () => {
    writeConfig({ 'server-booster': 'ch_sb' });
    const interaction = makeTestBoosterInteraction({
        tipe: 'add',
        live: true,
        configChannels: { 'server-booster': 'ch_sb' }
    });
    const before = boostsSnapshot();

    await require('../../src/commands/stats')(interaction);

    assert.strictEqual(interaction.__currentChannel.sent.length, 1, 'preview di channel saat ini');
    assert.strictEqual(interaction.__boosterChannel.sent.length, 1, 'SEKALIAN terkirim ke channel asli');
    assert.match(interaction.__boosterChannel.sent[0].embeds[0].data.title, /BOOST SERVER BARU/);
    assert.match(interaction.__replies[0].content, /Kirim asli: ✅/);
    // Tetap simulasi — tidak ada entry riwayat.
    assert.strictEqual(boostsSnapshot(), before, 'boosts.json tak tersentuh meski kirim asli');
});

test('/test-booster live:true (channel belum di-set): kirim asli dilewati dengan alasan jelas, tanpa crash', async () => {
    writeConfig({});
    const interaction = makeTestBoosterInteraction({ tipe: 'remove', live: true, configChannels: {} });

    await require('../../src/commands/stats')(interaction);

    assert.strictEqual(interaction.__boosterChannel.sent.length, 0, 'tidak ada tujuan pengiriman');
    const reply = interaction.__replies[0].content;
    assert.match(reply, /Kirim asli: dilewati/);
    assert.strictEqual(interaction.__currentChannel.sent.length, 1, 'preview lokal tetap terkirim');
});

// ====================================================
// === 4. SIMULASI MURNI — kemurnian data layer     ===
// ====================================================

test('SIMULASI MURNI: menjalankan add + remove tidak pernah menulis boosts.json', async () => {
    writeConfig({ 'server-booster': 'ch_sb' });
    const before = boostsSnapshot();

    const add = makeTestBoosterInteraction({ tipe: 'add', configChannels: { 'server-booster': 'ch_sb' } });
    await require('../../src/commands/stats')(add);
    const remove = makeTestBoosterInteraction({ tipe: 'remove', live: true, configChannels: { 'server-booster': 'ch_sb' } });
    await require('../../src/commands/stats')(remove);

    assert.strictEqual(boostsSnapshot(), before, 'boosts.json byte-identik setelah kedua run');
    // Dan entry untuk booster palsu tidak pernah ada.
    if (before === null) {
        assert.ok(!fs.existsSync(boostsPath), 'tidak ada boosts.json yang dibuat');
    }
});

// ====================================================
// === 5. Kontrak help catalog                      ===
// ====================================================

test('help catalog: /test-booster terdokumentasi di baris stats + panduan (aman budget)', () => {
    const { HELP_CATEGORIES, buildAllEmbeds, embedTotalChars, searchHelp } = require('../../src/ui/helpCatalog');
    const statsCat = HELP_CATEGORIES.find(c => c.id === 'stats');
    assert.ok(statsCat.lines.some(l => l.includes('/test-booster')), 'baris kompak memuat /test-booster');
    assert.match(statsCat.detail.join('\n'), /\/test-booster/, 'panduan menjelaskan /test-booster');

    // Budget Semua Command tetap terpenuhi dengan baris baru.
    const all = buildAllEmbeds();
    const total = all.reduce((s, e) => s + embedTotalChars(e), 0);
    assert.ok(total <= 5800, `total Semua Command ${total} ≤ 5800`);

    // Bisa dicari lewat baris kompak.
    const result = searchHelp('test-booster');
    assert.ok(result.totalBlocks >= 1, 'mencari "test-booster" menemukan command-nya');
});
