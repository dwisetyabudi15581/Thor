/**
 * Unit tests untuk dashServer (v3.16.0) — HTTP API untuk dashboard web.
 *
 * Verify:
 *   - Auth: tanpa token 401; token salah 401; token benar lolos
 *   - GET /health tanpa auth — ok
 *   - GET /guilds — daftar guild dari cache client (mock)
 *   - GET /guilds/:id/meta — channels + roles terurut
 *   - GET /guilds/:id/dashboard — payload semua modul
 *   - PUT /guilds/:id/config — valid, invalid (422), prototype pollution ditolak,
 *     section tak dikenal ditolak, array utuh (ticketCategories) tervalidasi
 *   - PUT /guilds/:id/automod — merge patch tervalidasi; field tak dikenal 422
 *   - POST/DELETE responders — CRUD + duplikat 409
 *   - POST/DELETE announce — jadwal valid; waktu lampau 400
 *   - POST selfroles — panel dibuat + message terkirim (channel mock); rollback
 *     kalau channel fetch gagal
 *
 * Server test jalan di ephemeral port (listen(0)) dengan client mock —
 * tidak menyentuh Discord. File data produksi di-snapshot & restore.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

// === Snapshot & restore file data yang disentuh test ===
const dataDir = path.join(__dirname, '..', '..', 'data');
const configDir = path.join(dataDir, 'config');
const TOUCHED = [
    'automod.json', 'responders.json', 'selfRoles.json', 'scheduledAnnouncements.json',
    // v3.19.0: file yang disentuh modul baru (giveaway/poll/keys/schedule)
    'giveaways.json', 'polls.json', 'keys.json', 'scheduledRoles.json'
];
const backups = {}; // path -> konten lama (null = belum ada)
let configDirBackup = null; // nama file lama di data/config/

for (const f of TOUCHED) {
    const p = path.join(dataDir, f);
    backups[p] = fs.existsSync(p) ? fs.readFileSync(p) : null;
    if (backups[p] === null) fs.writeFileSync(p, '[]');
}
if (fs.existsSync(configDir)) {
    configDirBackup = fs.readdirSync(configDir).map((f) => ({
        name: f,
        content: fs.readFileSync(path.join(configDir, f))
    }));
    for (const f of configDirBackup) {
        if (f.name.startsWith('999')) fs.unlinkSync(path.join(configDir, f.name)); // bersihkan sisa test lama
    }
}
process.on('exit', () => {
    try {
        for (const [p, content] of Object.entries(backups)) {
            if (content === null) {
                if (fs.existsSync(p)) fs.unlinkSync(p);
            } else {
                fs.writeFileSync(p, content);
            }
        }
        if (configDirBackup !== null) {
            const now = fs.existsSync(configDir) ? fs.readdirSync(configDir) : [];
            for (const f of now) {
                if (!configDirBackup.some((b) => b.name === f)) fs.unlinkSync(path.join(configDir, f));
            }
        }
    } catch (_) {}
});

const { createDashHandler } = require('../../src/infra/dashServer');

const TOKEN = 'unit-test-token-abc123';
const GUILD_ID = '999111222333444555';

// === Mock client discord.js ===
function makeMockClient({ failChannelFetch = false } = {}) {
    const guild = {
        id: GUILD_ID,
        name: 'Server Uji',
        icon: 'abc123',
        memberCount: 42,
        ownerId: '111000111000111000',
        channels: {
            cache: new Map([
                ['777000111222333444', { id: '777000111222333444', name: 'umum', type: 0, rawPosition: 1 }],
                ['777000111222333555', { id: '777000111222333555', name: 'vc-zone', type: 2, rawPosition: 0 }]
            ])
        },
        roles: {
            cache: new Map([
                ['888000111222333444', { id: '888000111222333444', name: 'Member', color: 0, position: 1 }],
                ['888000111222333555', { id: '888000111222333555', name: 'Admin', color: 0xff0000, position: 5 }]
            ])
        },
        // v3.19.0: modul keys perlu member fetch (role add/remove best-effort).
        members: {
            fetch: async (id) => ({
                id,
                user: { id, tag: 'Tester#0001' },
                roles: {
                    cache: new Map(),
                    add: async () => {},
                    remove: async () => {}
                }
            })
        }
    };
    return {
        isReady: () => true,
        guilds: { cache: new Map([[GUILD_ID, guild]]) },
        channels: {
            fetch: async (id) => {
                if (failChannelFetch) throw new Error('channel hilang');
                return {
                    id,
                    type: 0, // v3.19.0: GuildText — endpoint giveaway/poll/embed cek tipe
                    send: async (opts) => ({ id: `msg_${Date.now()}`, opts, url: 'https://discord.com/channels/x/y' }),
                    messages: {
                        fetch: async () => ({ edit: async () => {}, delete: async () => {} })
                    }
                };
            }
        }
    };
}

let server;
let baseUrl;

test.before(async () => {
    server = http.createServer(createDashHandler({ client: makeMockClient(), token: TOKEN }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

function api(method, pathname, { token = TOKEN, body } = {}) {
    return fetch(baseUrl + pathname, {
        method,
        headers: {
            ...(token ? { 'x-dash-token': token } : {}),
            ...(body ? { 'content-type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
}

// ====================================================
// === Auth & health ===
// ====================================================

test('dash: /health tanpa token tetap 200', async () => {
    const res = await api('GET', '/health', { token: null });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.guildCount, 1);
});

test('dash: endpoint lain tanpa token → 401', async () => {
    const res = await api('GET', '/guilds', { token: null });
    assert.strictEqual(res.status, 401);
});

test('dash: token salah → 401', async () => {
    const res = await api('GET', '/guilds', { token: 'salah' });
    assert.strictEqual(res.status, 401);
});

// ====================================================
// === Guilds & meta ===
// ====================================================

test('dash: GET /guilds — daftar guild dari cache', async () => {
    const res = await api('GET', '/guilds');
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.guilds.length, 1);
    assert.strictEqual(data.guilds[0].id, GUILD_ID);
    assert.strictEqual(data.guilds[0].name, 'Server Uji');
});

test('dash: GET /guilds/:id/meta — channels + roles', async () => {
    const res = await api('GET', `/guilds/${GUILD_ID}/meta`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.channels.length, 2);
    assert.strictEqual(data.roles.length, 2);
    // Roles terurut posisi DESC (Admin dulu)
    assert.strictEqual(data.roles[0].name, 'Admin');
});

test('dash: GET /guilds/:id/meta guild asing → 404', async () => {
    const res = await api('GET', '/guilds/123456789123456789/meta');
    assert.strictEqual(res.status, 404);
});

// ====================================================
// === Dashboard payload ===
// ====================================================

test('dash: GET /guilds/:id/dashboard — semua modul hadir', async () => {
    const res = await api('GET', `/guilds/${GUILD_ID}/dashboard`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    for (const key of ['config', 'automod', 'responders', 'selfroles', 'tempvoice', 'announces', 'serverstats']) {
        assert.ok(key in data, `payload.${key} harus ada`);
    }
    // Config ter-merge dengan DEFAULTS (pola getConfig)
    assert.ok(Array.isArray(data.config.ticketCategories));
    assert.strictEqual(typeof data.config.messages.welcomeTitle, 'string');
});

// ====================================================
// === PUT config ===
// ====================================================

test('dash: PUT config valid — tersimpan & terbaca kembali', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/config`, {
        body: {
            actor: { id: '42', tag: 'tester' },
            updates: {
                'roles.verified': '888000111222333444',
                'channels.welcome': '777000111222333444',
                'messages.welcomeTitle': 'HALO DARI DASH',
                'leveling.enabled': true,
                'leveling.xpPerMessage': 25
            }
        }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.ok);
    assert.strictEqual(data.applied.length, 5);

    // Baca ulang via dashboard — nilai menetap
    const dash = await (await api('GET', `/guilds/${GUILD_ID}/dashboard`)).json();
    assert.strictEqual(dash.config.roles.verified, '888000111222333444');
    assert.strictEqual(dash.config.channels.welcome, '777000111222333444');
    assert.strictEqual(dash.config.messages.welcomeTitle, 'HALO DARI DASH');
    assert.strictEqual(dash.config.leveling.enabled, true);
    assert.strictEqual(dash.config.leveling.xpPerMessage, 25);

    // File fisik juga berubah (sumber kebenaran slash command)
    const raw = JSON.parse(fs.readFileSync(path.join(configDir, `${GUILD_ID}.json`), 'utf8'));
    assert.strictEqual(raw.messages.welcomeTitle, 'HALO DARI DASH');
});

test('dash: PUT config nilai invalid → 422 dengan detail per field', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/config`, {
        body: {
            updates: {
                'channels.welcome': 'bukan-id', // bukan snowflake
                'leveling.xpPerMessage': 99999 // di atas range
            }
        }
    });
    assert.strictEqual(res.status, 422);
    const data = await res.json();
    assert.strictEqual(data.details.length, 2);
});

test('dash: PUT config prototype pollution ditolak', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/config`, {
        body: { updates: { '__proto__.polluted': 'ya' } }
    });
    assert.strictEqual(res.status, 422);
    assert.strictEqual(({}).polluted, undefined, 'Object.prototype tidak boleh terkotori');
});

test('dash: PUT config section tak dikenal ditolak', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/config`, {
        body: { updates: { 'hacker.field': 'x' } }
    });
    assert.strictEqual(res.status, 422);
});

test('dash: PUT config ticketCategories array utuh tervalidasi', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/config`, {
        body: {
            updates: {
                ticketCategories: [
                    { id: 'beli', label: 'Beli', emoji: '🛒', style: 'Success', requiresKey: false },
                    { id: 'help', label: 'Bantuan', emoji: '📞', style: 'Secondary', requiresKey: false }
                ]
            }
        }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.config.ticketCategories.length, 2);
    assert.strictEqual(data.config.ticketCategories[0].id, 'beli');

    // Kategori duplikat → 422
    const bad = await api('PUT', `/guilds/${GUILD_ID}/config`, {
        body: {
            updates: {
                ticketCategories: [
                    { id: 'sama', label: 'A', style: 'Primary' },
                    { id: 'sama', label: 'B', style: 'Primary' }
                ]
            }
        }
    });
    assert.strictEqual(bad.status, 422);
});

test('dash: PUT config null channel — clear value', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/config`, {
        body: { updates: { 'channels.welcome': null } }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.config.channels.welcome, null);
});

// ====================================================
// === PUT automod ===
// ====================================================

test('dash: PUT automod patch tervalidasi & ter-merge', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/automod`, {
        body: { enabled: true, spamThreshold: 7, spamAction: 'mute_10m', blockLinks: true }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.automod.enabled, true);
    assert.strictEqual(data.automod.spamThreshold, 7);
    assert.strictEqual(data.automod.spamAction, 'mute_10m');

    // Patch kedua tidak menghapus field pertama (merge, bukan replace)
    const res2 = await api('PUT', `/guilds/${GUILD_ID}/automod`, {
        body: { blockLinks: false }
    });
    const data2 = await res2.json();
    assert.strictEqual(data2.automod.spamThreshold, 7, 'merge mempertahankan field lama');
    assert.strictEqual(data2.automod.blockLinks, false);
});

test('dash: PUT automod field tak dikenal / nilai salah → 422', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/automod`, {
        body: { fieldNgawur: 1, spamThreshold: 'abc' }
    });
    assert.strictEqual(res.status, 422);
    const data = await res.json();
    assert.strictEqual(data.details.length, 2);
});

test('dash: PUT automod wordRules array utuh ternormalisasi', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/automod`, {
        body: { wordRules: [{ word: 'Spam', action: 'delete_only' }, { word: 'scam' }] }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.automod.wordRules.length, 2);
    assert.strictEqual(data.automod.wordRules[0].word, 'spam', 'kata di-lowercase');
});

// ====================================================
// === Responders CRUD ===
// ====================================================

test('dash: POST responder + DELETE by trigger', async () => {
    const post = await api('POST', `/guilds/${GUILD_ID}/responders`, {
        body: { trigger: 'harga', reply: 'Cek #harga ya!', matchMode: 'contains', replyType: 'text', cooldownMs: 3000 }
    });
    assert.strictEqual(post.status, 201);
    let data = await post.json();
    assert.strictEqual(data.responders.length, 1);
    assert.strictEqual(data.responders[0].trigger, 'harga');

    // Duplikat → 409
    const dup = await api('POST', `/guilds/${GUILD_ID}/responders`, {
        body: { trigger: 'HARGA', reply: 'duplikat' }
    });
    assert.strictEqual(dup.status, 409);

    const del = await api('DELETE', `/guilds/${GUILD_ID}/responders?trigger=harga`);
    assert.strictEqual(del.status, 200);
    data = await del.json();
    assert.strictEqual(data.responders.length, 0);
});

test('dash: DELETE responder yang tidak ada → 404', async () => {
    const res = await api('DELETE', `/guilds/${GUILD_ID}/responders?trigger=tidakada`);
    assert.strictEqual(res.status, 404);
});

// ====================================================
// === Announce CRUD ===
// ====================================================

test('dash: POST announce valid + DELETE', async () => {
    const sendAt = Date.now() + 60 * 60 * 1000; // 1 jam ke depan
    const post = await api('POST', `/guilds/${GUILD_ID}/announce`, {
        body: {
            channelId: '777000111222333444',
            sendAt,
            title: 'Pengumuman Tes',
            description: 'Halo dari dashboard',
            recurring: 'daily',
            actor: { id: '42', tag: 'tester' }
        }
    });
    assert.strictEqual(post.status, 201);
    const { announcement } = await post.json();
    assert.strictEqual(announcement.data.title, 'Pengumuman Tes');
    assert.strictEqual(announcement.recurring, 'daily');

    const del = await api('DELETE', `/guilds/${GUILD_ID}/announce/${announcement.id}`);
    assert.strictEqual(del.status, 200);
});

test('dash: POST announce waktu lampau → 400', async () => {
    const res = await api('POST', `/guilds/${GUILD_ID}/announce`, {
        body: { channelId: '777000111222333444', sendAt: Date.now() - 86400000, title: 'T', description: 'D' }
    });
    assert.strictEqual(res.status, 400);
});

// ====================================================
// === Self-role panel (channel mock) ===
// ====================================================

test('dash: POST selfroles — panel dibuat + message terkirim', async () => {
    const res = await api('POST', `/guilds/${GUILD_ID}/selfroles`, {
        body: {
            channelId: '777000111222333444',
            title: '🎭 Ambil Role',
            description: 'Klik tombol di bawah',
            type: 'button',
            exclusive: false,
            roles: [{ roleId: '888000111222333444', label: 'Notif', emoji: '🔔', style: 'Secondary' }]
        }
    });
    assert.strictEqual(res.status, 201);
    const { panel } = await res.json();
    assert.ok(panel.id);
    assert.strictEqual(panel.messageId, panel.messageId); // terisi oleh mock send
    assert.strictEqual(panel.roles.length, 1);

    // Tambah role → re-render best-effort (mock) + role nempel
    const add = await api('POST', `/guilds/${GUILD_ID}/selfroles/${panel.id}/roles`, {
        body: { roleId: '888000111222333555', label: 'Warna', style: 'Success' }
    });
    assert.strictEqual(add.status, 200);
    const added = await add.json();
    assert.strictEqual(added.panel.roles.length, 2);

    // Hapus panel → ok
    const del = await api('DELETE', `/guilds/${GUILD_ID}/selfroles/${panel.id}`);
    assert.strictEqual(del.status, 200);
});

test('dash: POST selfroles gagal kirim → rollback entry', async () => {
    // Server khusus dengan client yang selalu gagal fetch channel.
    const failServer = http.createServer(
        createDashHandler({ client: makeMockClient({ failChannelFetch: true }), token: TOKEN })
    );
    await new Promise((resolve) => failServer.listen(0, '127.0.0.1', resolve));
    const failBase = `http://127.0.0.1:${failServer.address().port}`;
    try {
        const res = await fetch(`${failBase}/guilds/${GUILD_ID}/selfroles`, {
            method: 'POST',
            headers: { 'x-dash-token': TOKEN, 'content-type': 'application/json' },
            body: JSON.stringify({
                channelId: '777000111222333444',
                roles: [{ roleId: '888000111222333444', label: 'X' }]
            })
        });
        assert.strictEqual(res.status, 502);
        // Rollback: tidak ada panel tertinggal untuk guild ini
        const dash = await (
            await fetch(`${failBase}/guilds/${GUILD_ID}/dashboard`, { headers: { 'x-dash-token': TOKEN } })
        ).json();
        assert.strictEqual(dash.selfroles.filter((p) => p.guildId === GUILD_ID && p.title === '🎭 Self Role' && p.roles.length === 0).length, 0);
    } finally {
        await new Promise((resolve) => failServer.close(resolve));
    }
});

// ====================================================
// === Endpoint tak dikenal ===
// ====================================================

test('dash: endpoint tak dikenal → 404', async () => {
    const res = await api('GET', '/tidak-ada');
    assert.strictEqual(res.status, 404);
});

// ====================================================
// === v3.19.0: Command Manager ===
// ====================================================

test('dash: payload dashboard memuat commands (list + disabled + protected)', async () => {
    const res = await api('GET', `/guilds/${GUILD_ID}/dashboard`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.commands.list.length, 93, 'semua command dari registry');
    assert.ok(Array.isArray(data.commands.disabled), 'disabled selalu array');
    assert.ok(data.commands.protected.includes('commands'), '/commands kebal disable');
    // Setiap command punya domain yang valid (untuk grouping UI ala Dyno)
    const domains = new Set(data.commands.list.map((c) => c.domain));
    assert.ok(domains.has('config') && domains.has('moderation') && domains.has('leveling'));
});

test('dash: PUT /commands — simpan daftar disabled', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/commands`, {
        body: { disabled: ['giveaway', 'poll', 'giveaway'] } // duplikat harus didedupe
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.deepStrictEqual(data.disabled, ['giveaway', 'poll']);
    assert.strictEqual(data.total, 93);

    // Terbaca balik di payload
    const dash = await (await api('GET', `/guilds/${GUILD_ID}/dashboard`)).json();
    assert.deepStrictEqual(dash.commands.disabled, ['giveaway', 'poll']);
});

test('dash: PUT /commands — command tak dikenal → 422', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/commands`, {
        body: { disabled: ['giveaway', 'command-palsu'] }
    });
    assert.strictEqual(res.status, 422);
});

test('dash: PUT /commands — /commands (protected) tidak bisa didisable → 422', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/commands`, {
        body: { disabled: ['commands'] }
    });
    assert.strictEqual(res.status, 422);
});

test('dash: PUT /commands — non-array → 422', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/commands`, {
        body: { disabled: 'giveaway' }
    });
    assert.strictEqual(res.status, 422);
});

test('dash: PUT /commands — reset ke kosong (aktifkan semua)', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/commands`, { body: { disabled: [] } });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual((await res.json()).disabled, []);
});

// ====================================================
// === v3.19.0: Giveaway dari web ===
// ====================================================

test('dash: POST /giveaway — valid → 201 + entry tersimpan', async () => {
    const res = await api('POST', `/guilds/${GUILD_ID}/giveaway`, {
        body: {
            channelId: '777000111222333444',
            prize: 'VIP 30 Hari',
            durationMin: 60,
            winners: 2
        }
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.giveaway.prize, 'VIP 30 Hari');
    assert.strictEqual(data.giveaway.winnersCount, 2);
    assert.ok(data.giveaway.messageId, 'messageId tersimpan setelah kirim');
});

test('dash: POST /giveaway — durasi tidak valid → 400', async () => {
    const res = await api('POST', `/guilds/${GUILD_ID}/giveaway`, {
        body: { channelId: '777000111222333444', prize: 'X', durationMin: 0, winners: 1 }
    });
    assert.strictEqual(res.status, 400);
});

test('dash: POST /giveaway — prize kosong → 400', async () => {
    const res = await api('POST', `/guilds/${GUILD_ID}/giveaway`, {
        body: { channelId: '777000111222333444', prize: '', durationMin: 10, winners: 1 }
    });
    assert.strictEqual(res.status, 400);
});

// ====================================================
// === v3.19.0: Poll dari web ===
// ====================================================

test('dash: POST /poll — valid → 201', async () => {
    const res = await api('POST', `/guilds/${GUILD_ID}/poll`, {
        body: {
            channelId: '777000111222333444',
            question: 'Makan siang apa hari ini?',
            multiple: false,
            options: [{ label: 'Nasi goreng' }, { label: 'Mie ayam' }, { label: 'Bakso' }]
        }
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.poll.options.length, 3);
    assert.ok(data.poll.messageId);
});

test('dash: POST /poll — kurang dari 2 opsi → 400', async () => {
    const res = await api('POST', `/guilds/${GUILD_ID}/poll`, {
        body: { channelId: '777000111222333444', question: 'Q?', options: [{ label: 'satu saja' }] }
    });
    assert.strictEqual(res.status, 400);
});

// ====================================================
// === v3.19.0: Embed dari web ===
// ====================================================

test('dash: POST /embed — valid → 201', async () => {
    const res = await api('POST', `/guilds/${GUILD_ID}/embed`, {
        body: {
            channelId: '777000111222333444',
            title: 'Pengumuman',
            description: 'Halo **semua**!',
            color: 0xf1c40f,
            footer: 'Dari web dashboard'
        }
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.messageId);
});

test('dash: POST /embed — tanpa title & description → 400', async () => {
    const res = await api('POST', `/guilds/${GUILD_ID}/embed`, {
        body: { channelId: '777000111222333444', title: '', description: '' }
    });
    assert.strictEqual(res.status, 400);
});

// ====================================================
// === v3.19.0: Backup (restore nama invalid aman) ===
// ====================================================

test('dash: POST /backups/:name/restore — nama invalid → 422 (tanpa efek samping)', async () => {
    const res = await api('POST', `/guilds/${GUILD_ID}/backups/bukan-format-valid/restore`, { body: {} });
    assert.strictEqual(res.status, 422);
});

// ====================================================
// === v3.19.0: Keys dari web ===
// ====================================================

test('dash: POST /keys — produk tanpa role → 422', async () => {
    // Set produk TANPA roleId dulu
    const put = await api('PUT', `/guilds/${GUILD_ID}/config`, {
        body: { updates: { products: [{ label: 'VIP 30 Hari', value: 'vip30', price: '25000' }] } }
    });
    assert.strictEqual(put.status, 200, 'setup produk via config');

    const res = await api('POST', `/guilds/${GUILD_ID}/keys`, {
        body: { userId: '111222333444555666', value: 'vip30' }
    });
    assert.strictEqual(res.status, 422);
});

test('dash: POST /keys — produk dengan role → 201 + key terbaca di payload', async () => {
    // Produk dengan roleId + days (v3.19.0: roleId kini dipertahankan validator)
    const put = await api('PUT', `/guilds/${GUILD_ID}/config`, {
        body: {
            updates: {
                products: [
                    { label: 'VIP 30 Hari', value: 'vip30', price: '25000', roleId: '888000111222333444', days: 30 }
                ]
            }
        }
    });
    assert.strictEqual(put.status, 200, 'setup produk + role');

    const res = await api('POST', `/guilds/${GUILD_ID}/keys`, {
        body: { userId: '111222333444555666', value: 'vip30', key: 'TESTK-EY001-ABCDE' }
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.key, 'TESTK-EY001-ABCDE');
    assert.ok(data.expireAt > Date.now(), 'expireAt dihitung dari days produk');

    // Terbaca di payload dashboard
    const dash = await (await api('GET', `/guilds/${GUILD_ID}/dashboard`)).json();
    assert.strictEqual(dash.keys.length, 1);
    assert.strictEqual(dash.keys[0].key, 'TESTK-EY001-ABCDE');
});

test('dash: DELETE /keys?userId — hapus key + schedule → 200', async () => {
    const res = await api('DELETE', `/guilds/${GUILD_ID}/keys?userId=111222333444555666`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.removedKeys, 1);

    const dash = await (await api('GET', `/guilds/${GUILD_ID}/dashboard`)).json();
    assert.strictEqual(dash.keys.length, 0, 'key hilang dari payload');
});

// ====================================================
// === v3.19.0: Validator products pertahankan roleId ===
// ====================================================

test('dash: PUT config products — roleId & days dipertahankan (fix data loss v3.19.0)', async () => {
    const put = await api('PUT', `/guilds/${GUILD_ID}/config`, {
        body: {
            updates: {
                products: [
                    { label: 'VIP', value: 'vip1', price: '10000', roleId: '888000111222333444', days: 7 }
                ]
            }
        }
    });
    assert.strictEqual(put.status, 200);
    const data = await put.json();
    assert.strictEqual(data.config.products[0].roleId, '888000111222333444', 'roleId tidak hilang');
    assert.strictEqual(data.config.products[0].days, 7, 'days tidak hilang');
});

test('dash: PUT config products — roleId tidak valid → 422', async () => {
    const res = await api('PUT', `/guilds/${GUILD_ID}/config`, {
        body: {
            updates: { products: [{ label: 'VIP', value: 'vip2', price: '10000', roleId: 'bukan-id' }] }
        }
    });
    assert.strictEqual(res.status, 422);
});
