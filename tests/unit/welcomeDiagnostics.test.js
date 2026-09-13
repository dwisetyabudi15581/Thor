/**
 * Unit test v3.9.48 — diagnostik welcome/goodbye.
 *
 * Laporan user: "ada bug — Welcome tidak muncul".
 * Hasil investigasi: jalur KODE terbukti jalan (simulasi end-to-end dengan
 * modul asli). Bug sebenarnya = SILENT FAILURE — saat channel welcome belum
 * di-set / terhapus / ID dari server lain, bot TIDAK mengeluarkan log apa pun
 * baik saat startup MAUPUN saat member benar-benar join. Admin tidak punya
 * petunjuk, dan tidak ada cara men-test welcome tanpa member join sungguhan.
 *
 * Yang dibuktikan test ini:
 *   1. memberHandler: builder embed diekstrak (buildWelcomeEmbed /
 *      buildGoodbyeEmbed — dipakai /test-welcome supaya preview === asli).
 *   2. memberHandler: setiap alasan skip meninggalkan log + solusi
 *      ("/set-channel welcome #channel").
 *   3. guildMemberAdd/Remove: event member dari guild lain (GUILD_ID beda)
 *      kini KELIHATAN (dulu return diam-diam).
 *   4. ready.js: cek konfigurasi welcome/goodbye saat startup (kontrak statis).
 *   5. BARU /test-welcome: diagnosis config → channel → permission bot + kirim
 *      preview embed (modul command asli, interaction stub).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
// v3.10.0: config per-guild — mock interaksi file ini pakai guild 'guild_w'.
const configPath = path.join(DATA_DIR, 'config', 'guild_w.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.dirname(configPath), { recursive: true });

// ====================================================
// === Sandbox: snapshot & restore config.json       ===
// === (pola setChannelMerge.test.js)                ===
// ====================================================
const hadConfig = fs.existsSync(configPath);
if (hadConfig) fs.copyFileSync(configPath, configPath + '.test-backup');
process.on('exit', () => {
    try {
        if (hadConfig) {
            fs.copyFileSync(configPath + '.test-backup', configPath);
            fs.rmSync(configPath + '.test-backup', { force: true });
        } else if (fs.existsSync(configPath)) {
            fs.rmSync(configPath, { force: true });
        }
    } catch (_) {}
});

// ====================================================
// === Helper                                        ===
// ====================================================

/** Tulis config.json dengan channels/roles tertentu. */
function writeConfig(partial = {}) {
    fs.writeFileSync(
        configPath,
        JSON.stringify(
            {
                channels: partial.channels || {},
                roles: partial.roles || {},
                messages: {
                    welcomeTitle: '👋 WELCOME!',
                    welcomeBody: 'Halo {user}! Selamat datang di **{server}** — member #{count}',
                    goodbyeTitle: '👋 FAREWELL',
                    goodbyeBody: '**{username}** sudah {action}. Sisa: {count}'
                }
            },
            null,
            4
        )
    );
}

/** Tangkap console.log/warn/error selama callback; kembalikan baris [level, teks]. */
async function captureConsole(fn) {
    const rows = [];
    const orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...a) => rows.push(['log', a.join(' ')]);
    console.warn = (...a) => rows.push(['warn', a.join(' ')]);
    console.error = (...a) => rows.push(['error', a.join(' ')]);
    try {
        await fn();
    } finally {
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
    }
    return rows;
}

/** Stub channel yang merekam semua yang dikirim kepadanya. */
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
 * Stub guild + member persis seperti yang disentuh memberHandler.
 * auditEntries mengisi fetchAuditLogs (discord.js asli mengembalikan
 * Collection — Array juga punya .find, itu satu-satunya yang dipakai handler).
 */
function makeWorld({ channels = {}, auditEntries = [] } = {}) {
    const cache = new Map();
    for (const ch of Object.values(channels)) cache.set(ch.id, ch);

    const guild = {
        id: 'guild_w',
        name: 'Chronos',
        memberCount: 42,
        iconURL: () => null,
        roles: { cache: new Map([['role_unverified', { id: 'role_unverified', name: 'Unverified' }]]) },
        channels: { cache },
        members: { me: null },
        fetchAuditLogs: async () => ({ entries: auditEntries })
    };

    const roleAdds = [];
    const member = {
        guild,
        user: {
            id: 'user_new',
            bot: false,
            tag: 'Newbie#0001',
            createdTimestamp: Date.now() - 90 * 86400000,
            displayAvatarURL: () => 'https://cdn.example/avatar.png'
        },
        roles: { add: async r => roleAdds.push(r.id) }
    };
    return { guild, member, roleAdds };
}

// ====================================================
// === 1. Builder embed murni (path preview bersama) ===
// ====================================================

test('buildWelcomeEmbed: variabel template terisi dari member (builder sama dengan preview /test-welcome)', () => {
    writeConfig({});
    const { buildWelcomeEmbed } = require('../../src/bot/memberHandler');
    const { member } = makeWorld();

    const embed = buildWelcomeEmbed(member, require('../../src/data/configManager').getConfig('guild_w'));
    assert.strictEqual(embed.data.title, '👋 WELCOME!');
    assert.strictEqual(embed.data.description, 'Halo <@user_new>! Selamat datang di **Chronos** — member #42');
    assert.strictEqual(embed.data.thumbnail.url, 'https://cdn.example/avatar.png');
});

test('buildGoodbyeEmbed: variabel action terisi (keluar/dikeluarkan)', () => {
    writeConfig({});
    const { buildGoodbyeEmbed } = require('../../src/bot/memberHandler');
    const { member } = makeWorld();
    const config = require('../../src/data/configManager').getConfig('guild_w');

    const keluar = buildGoodbyeEmbed(member, config, 'keluar');
    assert.match(keluar.data.description, /sudah keluar\./);
    const kick = buildGoodbyeEmbed(member, config, 'dikeluarkan (kick)');
    assert.match(kick.data.description, /sudah dikeluarkan \(kick\)\./);
});

// ====================================================
// === 2. Event asli: regression happy path          ===
// ====================================================

test('onMemberAdd end-to-end: welcome terkirim ke channel yang di-set', async () => {
    const welcome = makeChannel('ch_w');
    writeConfig({ channels: { welcome: 'ch_w' }, roles: { unverified: 'role_unverified' } });
    const world = makeWorld({ channels: { welcome } });

    const rows = await captureConsole(() => require('../../src/bot/memberHandler').onMemberAdd(world.member));

    assert.strictEqual(welcome.sent.length, 1, 'tepat satu pesan welcome');
    assert.strictEqual(welcome.sent[0].content, '<@user_new>');
    assert.match(welcome.sent[0].embeds[0].data.title, /WELCOME/);
    assert.deepStrictEqual(world.roleAdds, ['role_unverified'], 'role unverified diberikan');
    assert.ok(rows.some(r => r[0] === 'log' && /Welcome terkirim/.test(r[1])), 'sukses ter-log (kelihatan)');
});

test('onMemberRemove end-to-end: goodbye terkirim (kick terdeteksi via audit log)', async () => {
    const goodbye = makeChannel('ch_g');
    writeConfig({ channels: { goodbye: 'ch_g' } });
    const world = makeWorld({
        channels: { goodbye },
        auditEntries: [{ target: { id: 'user_new' }, executorId: 'mod_1', createdTimestamp: Date.now(), reason: 'spam' }]
    });

    const rows = await captureConsole(() => require('../../src/bot/memberHandler').onMemberRemove(world.member));

    assert.strictEqual(goodbye.sent.length, 1, 'tepat satu pesan goodbye');
    assert.ok(rows.some(r => r[0] === 'log' && /Goodbye terkirim/.test(r[1])));
});

// ====================================================
// === 3. BUG UTAMA: skip senyap kini bicara          ===
// ====================================================

test('LAPORAN USER — channel welcome BELUM di-set: warning + solusi, bukan diam', async () => {
    writeConfig({}); // tanpa channels sama sekali
    const world = makeWorld();

    const rows = await captureConsole(() => require('../../src/bot/memberHandler').onMemberAdd(world.member));

    assert.ok(
        rows.some(r => r[0] === 'warn' && /welcome BELUM di-set/.test(r[1]) && /\/set-channel welcome/.test(r[1])),
        'warning menyebut masalah DAN perintah solusinya'
    );
});

test('channel welcome di-set tapi tidak ada di cache (dihapus / server lain): warning + solusi', async () => {
    writeConfig({ channels: { welcome: 'ch_ghost' } });
    const world = makeWorld(); // cache kosong — ID tak dikenal

    const rows = await captureConsole(() => require('../../src/bot/memberHandler').onMemberAdd(world.member));

    assert.ok(
        rows.some(r => r[0] === 'warn' && /Channel welcome.*tidak ditemukan/.test(r[1]) && /\/set-channel welcome/.test(r[1])),
        'warning tidak-ditemukan + perintah solusi'
    );
});

test('gagal kirim welcome (permission): error menyebut channel + permission yang dicek', async () => {
    const welcome = makeChannel('ch_w', { fail: 'Missing Permissions' });
    writeConfig({ channels: { welcome: 'ch_w' } });
    const world = makeWorld({ channels: { welcome } });

    const rows = await captureConsole(() => require('../../src/bot/memberHandler').onMemberAdd(world.member));

    assert.ok(
        rows.some(r => r[0] === 'error' && /Gagal kirim welcome/.test(r[1]) && /Embed Links/.test(r[1])),
        'kegagalan kirim menjelaskan permission mana yang dicek'
    );
});

test('channel goodbye BELUM di-set: warning + solusi, bukan diam', async () => {
    writeConfig({});
    const world = makeWorld();

    const rows = await captureConsole(() => require('../../src/bot/memberHandler').onMemberRemove(world.member));

    assert.ok(
        rows.some(r => r[0] === 'warn' && /goodbye BELUM di-set/.test(r[1]) && /\/set-channel goodbye/.test(r[1]))
    );
});

// ====================================================
// === 4. Guard GUILD_ID kini kelihatan              ===
// ====================================================

test('event guildMemberAdd: join dari guild LAIN (GUILD_ID beda) ter-log kenapa diabaikan', async () => {
    const saved = process.env.GUILD_ID;
    process.env.GUILD_ID = 'guild_main';
    try {
        const welcome = makeChannel('ch_w');
        writeConfig({ channels: { welcome: 'ch_w' } });
        const world = makeWorld({ channels: { welcome } });

        const rows = await captureConsole(async () => {
            const ev = require('../../src/bot/events/guildMemberAdd');
            world.member.client = { channels: { cache: world.guild.channels.cache } };
            await ev.execute(world.member);
        });

        assert.strictEqual(welcome.sent.length, 0, 'tidak ada welcome untuk guild asing');
        assert.ok(
            rows.some(r => r[0] === 'warn' && /guild lain/.test(r[1]) && /GUILD_ID/.test(r[1])),
            'skip-nya kini kelihatan'
        );
    } finally {
        if (saved === undefined) delete process.env.GUILD_ID;
        else process.env.GUILD_ID = saved;
    }
});

// ====================================================
// === 5. /test-welcome — command diagnostik         ===
// ====================================================

/** Interaction stub persis untuk path /test-welcome di src/commands/config.js. */
function makeTestWelcomeInteraction({ tipe = 'welcome', configChannels = {}, perms = {} } = {}) {
    const welcomeCh = makeChannel('ch_w');
    const currentCh = makeChannel('ch_cur');
    const me = { id: 'bot_me' };
    for (const ch of [welcomeCh, currentCh]) {
        ch.permissionsFor = () => ({
            has: bit => {
                if (bit === require('discord.js').PermissionFlagsBits.SendMessages) return perms.send !== false;
                if (bit === require('discord.js').PermissionFlagsBits.EmbedLinks) return perms.embed !== false;
                if (bit === require('discord.js').PermissionFlagsBits.ViewChannel) return perms.view !== false;
                return true;
            }
        });
    }

    const cache = new Map();
    if (configChannels.welcome) cache.set('ch_w', welcomeCh); // hanya ter-cache kalau ID cocok
    cache.set('ch_cur', currentCh);

    const replies = [];
    const { guild, member } = makeWorld();
    guild.channels.cache = cache;
    guild.members.me = me;

    const interaction = {
        commandName: 'test-welcome',
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
        options: { getString: () => tipe }
    };
    interaction.__replies = replies;
    interaction.__currentChannel = currentCh;
    return interaction;
}

test('/test-welcome (welcome, semua sehat): status ✅ + preview terkirim ke channel sekarang', async () => {
    writeConfig({ channels: { welcome: 'ch_w' } });
    const interaction = makeTestWelcomeInteraction({ tipe: 'welcome', configChannels: { welcome: 'ch_w' } });

    await require('../../src/commands/config')(interaction);

    assert.strictEqual(interaction.__replies.length, 1, 'tepat satu balasan ephemeral');
    const reply = interaction.__replies[0].content;
    assert.match(reply, /Channel welcome:/);
    assert.match(reply, /✅ Kirim Pesan · ✅ Embed Links/);
    assert.match(reply, /intent GuildMembers/);
    assert.strictEqual(interaction.__currentChannel.sent.length, 1, 'embed preview terkirim');
    assert.strictEqual(interaction.__currentChannel.sent[0].content, '<@user_new>');
    assert.match(interaction.__currentChannel.sent[0].embeds[0].data.title, /WELCOME/);
    assert.match(reply, /Preview dikirim/);
});

test('/test-welcome (welcome, channel BELUM di-set): balisan menyebut perintah solusi', async () => {
    writeConfig({}); // belum di-set apa-apa
    const interaction = makeTestWelcomeInteraction({ tipe: 'welcome', configChannels: {} });

    await require('../../src/commands/config')(interaction);

    const reply = interaction.__replies[0].content;
    assert.match(reply, /belum di-set/);
    assert.match(reply, /\/set-channel welcome #channel/);
    // Preview tetap terkirim — admin melihat format embed-nya.
    assert.strictEqual(interaction.__currentChannel.sent.length, 1, 'preview tetap terkirim');
});

test('/test-welcome (ID channel tak dikenal): balisan menjelaskan dihapus / server lain', async () => {
    writeConfig({ channels: { welcome: 'ch_ghost' } });
    const interaction = makeTestWelcomeInteraction({ tipe: 'welcome', configChannels: {} }); // ghost → tak ter-cache

    await require('../../src/commands/config')(interaction);

    const reply = interaction.__replies[0].content;
    assert.match(reply, /tidak ditemukan/);
    assert.match(reply, /ch_ghost/);
    assert.match(reply, /\/set-channel welcome #channel/);
});

test('/test-welcome (bot tanpa Kirim Pesan): baris permission jadi ❌ + petunjuk solusi', async () => {
    writeConfig({ channels: { welcome: 'ch_w' } });
    const interaction = makeTestWelcomeInteraction({
        tipe: 'welcome',
        configChannels: { welcome: 'ch_w' },
        perms: { send: false }
    });

    await require('../../src/commands/config')(interaction);

    const reply = interaction.__replies[0].content;
    assert.match(reply, /❌ Kirim Pesan/);
});

test('/test-welcome tipe:goodbye — diagnosis yang sama untuk channel goodbye', async () => {
    writeConfig({ channels: { goodbye: 'ch_w' } });
    const interaction = makeTestWelcomeInteraction({ tipe: 'goodbye', configChannels: {} });

    await require('../../src/commands/config')(interaction);

    const reply = interaction.__replies[0].content;
    assert.match(reply, /Channel goodbye:/);
    assert.strictEqual(interaction.__currentChannel.sent[0].embeds[0].data.color, 0xe74c3c, 'embed goodbye merah');
});

// ====================================================
// === 6. Kontrak: registry + router + ready.js      ===
// ====================================================

test('kontrak registry: /test-welcome terdaftar dengan choice welcome|goodbye + ManageGuild', () => {
    const { getCommands } = require('../../src/commands/registry');
    const cmd = getCommands().find(c => c.name === 'test-welcome');
    assert.ok(cmd, 'command terdaftar');
    const tipe = cmd.options.find(o => o.name === 'tipe');
    assert.deepStrictEqual(
        tipe.choices.map(c => c.value).sort(),
        ['goodbye', 'welcome']
    );
    assert.ok(cmd.defaultMemberPermissions, 'gerbang admin');
});

test('kontrak router: test-welcome diarahkan ke domain config', () => {
    const { COMMAND_TO_DOMAIN } = require('../../src/commands/index');
    assert.strictEqual(COMMAND_TO_DOMAIN['test-welcome'], 'config');
});

test('kontrak ready.js: startup bicara saat channel welcome belum dikonfigurasi', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'bot', 'events', 'ready.js'), 'utf8');
    // Cek startup harus mencakup KEDUA key dan menyebut perintah solusinya.
    // v3.9.49: key pindah ke CHANNEL_LABELS (object key tanpa kutip) + channel
    // server-booster ikut dicek dengan pola yang sama.
    assert.match(src, /welcome:\s*'pesan welcome'/, 'welcome dicek saat startup');
    assert.match(src, /goodbye:\s*'pesan goodbye'/, 'goodbye dicek saat startup');
    assert.match(src, /'server-booster':\s*'notifikasi boost'/, 'server-booster dicek saat startup (v3.9.49)');
    assert.match(src, /\/set-channel \$\{key\} #channel/);
});
