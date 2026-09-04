/**
 * Unit tests v3.9.40 — hardening hasil audit menyeluruh pasca-v3.9.39
 * (audit "cek keseluruhan kode untuk menyesuaikan docs + debug menyeluruh").
 *
 * Yang diuji (semuanya bug terverifikasi dari review 3 domain):
 *   (1) /help search: query panjang (≤6000 char dari Discord) tidak lagi
 *       membuat EmbedBuilder.setDescription throw — di-cap 100 di searchHelp
 *       + max_length:100 di registry; backtick di query di-sanitize utk display.
 *   (2) buildAllEmbeds: guard Discord SELALU terjaga untuk katalog sebesar
 *       apa pun — field value ≤1024, fields ≤25, total 1 pesan ≤6000,
 *       truncation dengan note (pengganti split 2-embed v3.9.39 yang dead code).
 *   (3) processGiveawayEnd jalur manual (skipPick) dengan 0 peserta:
 *       message tetap di-edit + announce "berakhir tanpa pemenang" (dulu
 *       senyap — tombol Join masih hidup, admin dibilang sukses).
 *   (4) findActiveTicketFor transient → createTicket ABORT (bukan tiket dobel)
 *       + 3 call-site midman (pick buyer/seller) menolak dengan pesan retry.
 *   (5) Race close-vs-complete: tombol tutup tiket saat completionLocks
 *       dipegang → ditolak dengan pesan "sedang diproses admin lain".
 *   (6) Dedup router in-flight: replay gateway PARALEL (datang saat handler
 *       pertama masih jalan) di-drop — handler cuma jalan 1x.
 *   (7) reconcileZombieDeals skip deal yang sedang dipegang transitionLocks
 *       (anti zombie-resurrect oleh setDeal handler).
 *   (8) Transcript: konten user ber-``` tidak menutup code fence chunk.
 *   (9) /help unknown customId → interaction di-ack (reply), bukan warn-only.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', '..', 'data');

// ====================================================
// === Sandbox: file data produksi di-snapshot & restore ===
// === (pola hardeningV38*.test.js) ===
// ====================================================
const SANDBOX_FILES = ['giveaways.json', 'tickets.json', 'config.json', 'deals.json', 'polls.json'];
const backups = [];
for (const f of SANDBOX_FILES) {
    const p = path.join(dataDir, f);
    if (fs.existsSync(p)) {
        const b = p + '.v3940-backup';
        fs.copyFileSync(p, b);
        backups.push({ orig: p, backup: b });
    }
}
process.on('exit', () => {
    for (const { orig, backup } of backups) {
        try {
            fs.copyFileSync(backup, orig);
            fs.rmSync(backup, { force: true });
        } catch (_) {}
    }
});

/** Reset file data ke isi deterministik (mirror pola v3.9.38). */
function resetDataFile(name, content) {
    fs.writeFileSync(path.join(dataDir, name), JSON.stringify(content, null, 2));
}

// ====================================================
// === (1) /help search — query panjang & backtick ===
// ====================================================

const {
    HELP_CATEGORIES,
    buildSearchEmbed,
    searchHelp,
    buildAllEmbeds,
    embedTotalChars
} = require('../../src/ui/helpCatalog');
const { EMBED_LIMITS } = require('../../src/infra/constants');

test('v3.9.40 FIX: /help search query 4000 char → TIDAK throw, description ≤ 4096', () => {
    // Sebelum fix: query > ~3.875 char → description > 4096 →
    // EmbedBuilder.setDescription throw (uncaught) → /help search error.
    const long = 'a'.repeat(4000);
    let embed;
    assert.doesNotThrow(() => {
        embed = buildSearchEmbed(long);
    }, 'query panjang tidak boleh membuat builder throw');
    assert.ok(
        (embed.data.description?.length || 0) <= EMBED_LIMITS.DESCRIPTION,
        `desc ≤ 4096 (aktual: ${embed.data.description.length})`
    );
});

test('v3.9.40 FIX: searchHelp memotong query ke 100 char (dua pintu: slash + modal)', () => {
    const result = searchHelp('x'.repeat(400));
    assert.ok(result.query.length <= 100, `query di-cap 100 (aktual: ${result.query.length})`);
    assert.strictEqual(result.emptyQuery, false);
});

test('v3.9.40 FIX: registry opsi /help search punya max_length 100', () => {
    const { getCommands } = require('../../src/commands/registry');
    const help = getCommands().find(c => c.name === 'help');
    assert.ok(help, 'command /help ada di registry');
    const opt = help.options.find(o => o.name === 'search');
    assert.ok(opt, 'opsi search ada');
    assert.strictEqual(opt.max_length, 100, 'max_length 100 (Discord default string option 6000)');
});

test('v3.9.40 FIX: query ber-backtick → header display di-sanitize (fence inline-code utuh)', () => {
    const embed = buildSearchEmbed('ab`cd');
    assert.doesNotThrow(() => embed); // builder tidak throw
    const desc = embed.data.description || '';
    // Backtick mentah tidak boleh muncul di dalam echo query (bakal nutup inline-code).
    assert.ok(!desc.includes('`ab`cd'), 'backtick query di-escape utk display');
    assert.ok(desc.includes("ab'cd"), 'query tetap terbaca (backtick → apostrof)');
});

// ====================================================
// === (2) buildAllEmbeds — guard limit utk katalog raksasa ===
// ====================================================

test('v3.9.40 FIX: buildAllEmbeds — 49 kategori × 40 baris panjang → 1 embed, semua guard terjaga', () => {
    const orig = HELP_CATEGORIES.slice();
    try {
        for (let i = 0; i < 30; i++) {
            HELP_CATEGORIES.push({
                id: `extra_v40_${i}`,
                emoji: '🧪',
                name: `Kategori Extra ${i}`,
                short: 'kategori uji stress v3.9.40',
                lines: Array.from({ length: 40 }, (_, j) => `• \`/cmd-extra-${i}-${j}\` — command stress test yang panjang sekali barisnya aaaaaaaaaaaaaaaaaaaa`)
            });
        }
        const embeds = buildAllEmbeds();
        assert.strictEqual(embeds.length, 1, 'selalu 1 embed (split 2-embed dihapus)');
        const embed = embeds[0];
        const total = embedTotalChars(embed);
        assert.ok(total <= EMBED_LIMITS.TOTAL_CHARS, `total pesan ≤ 6000 (aktual: ${total})`);
        const fields = embed.data.fields || [];
        assert.ok(fields.length <= 25, `fields ≤ 25 (aktual: ${fields.length})`);
        for (const f of fields) {
            assert.ok(f.value.length <= EMBED_LIMITS.FIELD_VALUE, `field value ≤ 1024 (aktual: ${f.value.length})`);
        }
        // Truncation note mengarahkan ke dropdown/search (bukan senyap).
        assert.match(
            embed.data.description,
            /\+\d+ kategori lainnya tidak dimuat/,
            'note truncation kategori muncul'
        );
    } finally {
        HELP_CATEGORIES.length = 0;
        orig.forEach(c => HELP_CATEGORIES.push(c));
    }
});

test('v3.9.40 FIX: buildAllEmbeds — satu kategori dengan baris raksasa → field di-cap ≤ 1024 + note', () => {
    const orig = HELP_CATEGORIES.slice();
    try {
        // unshift (bukan push) supaya kategori stress TIDAK kena drop-loop
        // truncation (drop bekerja dari belakang) — field-nya harus lolos dan
        // terlihat di-cap ke 1024 oleh Guard 1.
        HELP_CATEGORIES.unshift({
            id: 'stress_field_v40',
            emoji: '🧪',
            name: 'Kategori Stress Field',
            short: 'stress field value',
            lines: Array.from({ length: 80 }, (_, j) => `• \`/cmd-stress-${j}\` — baris panjang untuk uji cap field value bbbbbbbbbbbbbbbbbbbbbb`)
        });
        const embeds = buildAllEmbeds();
        const fields = embeds[0].data.fields || [];
        const stress = fields.find(f => f.name.includes('Stress Field'));
        assert.ok(stress, 'kategori stress muncul sebagai field');
        assert.ok(stress.value.length <= EMBED_LIMITS.FIELD_VALUE, `value di-cap ≤ 1024 (aktual: ${stress.value.length})`);
        assert.match(stress.value, /\+baris lainnya tidak ditampilkan/, 'note cap baris muncul');
    } finally {
        HELP_CATEGORIES.length = 0;
        orig.forEach(c => HELP_CATEGORIES.push(c));
    }
});

test('v3.9.40: buildAllEmbeds katalog normal (19 kategori) → tanpa note truncation, total ≤ 6000', () => {
    const embeds = buildAllEmbeds();
    assert.strictEqual(embeds.length, 1);
    assert.ok(embedTotalChars(embeds[0]) <= EMBED_LIMITS.TOTAL_CHARS);
    assert.doesNotMatch(embeds[0].data.description, /kategori lainnya tidak dimuat/, 'katalog normal: tidak ada note');
});

// ====================================================
// === (3) processGiveawayEnd — manual end 0 peserta ===
// ====================================================

const { processGiveawayEnd, reconcileZombieDeals } = require('../../src/services/schedulerTasks');

test('v3.9.40 FIX: manual end 0 peserta → message di-edit + announce tanpa pemenang (tidak senyap)', async () => {
    resetDataFile('giveaways.json', []);
    const gwm = require('../../src/data/giveawayManager');
    const gw = gwm.create({
        guildId: 'g_gw_v40',
        channelId: 'c_gw_v40',
        prize: 'Hadiah Sepi',
        winnersCount: 1,
        endsAt: Date.now() - 1000,
        hostId: 'host1',
        hostTag: 'Host#0001'
    });
    // TANPA participant — manual /giveaway end mempick [] (legitimate).

    const stale = JSON.parse(JSON.stringify(gwm.get(gw.id))); // snapshot pre-end
    gwm.end(gw.id, []); // manual: persist ended + winnerIds kosong

    const edited = [];
    const announcements = [];
    const channel = {
        id: 'c_gw_v40',
        messages: {
            fetch: async () => ({ edit: async opts => edited.push(opts) })
        },
        send: async opts => {
            announcements.push(opts.content);
            return {};
        }
    };
    const guild = {
        id: 'g_gw_v40',
        name: 'Guild Test',
        channels: { cache: new Map([['c_gw_v40', channel]]) }
    };
    const client = {
        guilds: { fetch: async () => guild },
        users: { fetch: async () => null }
    };

    // Sebelum v3.9.40: isManualAnnounce butuh winnerIds.length > 0 → early
    // return senyap (pesan tidak di-edit, tidak ada announce).
    await processGiveawayEnd(client, stale, { skipPick: true });

    assert.strictEqual(announcements.length, 1, 'announce "berakhir tanpa pemenang" terkirim');
    assert.match(announcements[0], /tanpa pemenang/, 'isi announce menyebut tanpa pemenang');
    assert.strictEqual(edited.length, 1, 'pesan giveaway di-edit (tombol Join tidak dibiarkan hidup)');
    const embed = edited[0].embeds[0];
    assert.match(embed.data.title, /BERAKHIR/, 'embed judul berakhir');
});

// ====================================================
// === (4) findActiveTicketFor transient → caller abort ===
// ====================================================

const { findActiveTicketFor, createTicket } = require('../../src/data/ticketManager');

function makeFetchGuildThrow({ code, cachedEntries = [] }) {
    const err = new Error(code === 429 ? 'Too many requests' : 'Server error');
    err.code = code;
    return {
        id: 'g_v40',
        channels: {
            cache: new Map(cachedEntries),
            fetch: async () => {
                throw err;
            }
        }
    };
}

test('v3.9.40 FIX: findActiveTicketFor 429 → throw TICKET_VERIFY_TRANSIENT (bukan null)', async () => {
    resetDataFile('tickets.json', {
        'ch-live-429': { userId: 'u-v40', guildId: 'g_v40', productName: 'VIP 30 Hari', productValue: 'vip30' }
    });
    const guild = makeFetchGuildThrow({ code: 429 });
    await assert.rejects(
        () => findActiveTicketFor(guild, 'u-v40'),
        err => err.code === 'TICKET_VERIFY_TRANSIENT'
    );
    // Meta live tetap ada (invariant v3.9.38 terjaga).
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'tickets.json'), 'utf8'));
    assert.ok(raw['ch-live-429'], 'meta tiket live tidak terhapus');
});

test('v3.9.40 FIX: createTicket saat verifikasi transient → ABORT dengan pesan retry (bukan tiket dobel)', async () => {
    resetDataFile('tickets.json', {
        'ch-live-2': { userId: 'buyer-v40', guildId: 'g_v40', productName: 'VIP 30 Hari', productValue: 'vip30' }
    });
    resetDataFile('config.json', {
        roles: { admin: 'role-admin' },
        categories: [{ id: 'transaction', label: 'Transaksi' }],
        products: [
            { label: 'VIP 30 Hari', value: 'vip30', price: 'Rp 30.000', category: 'transaction', requiresKey: true }
        ]
    });

    const guild = makeFetchGuildThrow({ code: 429 });
    const replies = [];
    const interaction = {
        guild,
        user: { id: 'buyer-v40', tag: 'Buyer#0001' },
        member: { roles: { cache: new Map() } },
        replied: true,
        deferred: true,
        editReply: async opts => {
            replies.push(opts.content);
            return {};
        }
    };

    await createTicket(interaction, {
        label: 'VIP 30 Hari',
        value: 'vip30',
        price: 'Rp 30.000',
        requiresKey: true
    });

    assert.strictEqual(replies.length, 1, 'satu balasan abort');
    assert.match(replies[0], /Gagal memverifikasi tiket aktif/i, 'pesan verifikasi gagal');
    // Inti: TIDAK ada channel baru dibuat → meta user tetap SATU.
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'tickets.json'), 'utf8'));
    const metas = Object.values(raw).filter(m => m.userId === 'buyer-v40');
    assert.strictEqual(metas.length, 1, 'tidak ada tiket kedua yang dibuat (invariant 1-tiket-aktif terjaga)');
});

// ====================================================
// === (5) Race close-vs-complete (completionLocks) ===
// ====================================================

const ticketDomain = require('../../src/interactions/ticket');
const { setTicketMeta, getTicketMeta } = require('../../src/data/ticketManager');

const ADMIN_MEMBER = { permissions: { has: () => true }, roles: { cache: new Map() } };

function makeTicketInteraction({ customId, channelId }) {
    const replies = [];
    const interaction = {
        id: `v3940-${customId}-${Date.now()}-${Math.random()}`,
        customId,
        replied: false,
        deferred: false,
        isRepliable: () => true,
        isChatInputCommand: () => false,
        isButton: () => true,
        isStringSelectMenu: () => false,
        isUserSelectMenu: () => false,
        isModalSubmit: () => false,
        member: ADMIN_MEMBER,
        user: { id: 'admin_v40', tag: 'Admin#0001' },
        channel: { id: channelId, topic: `Ticket UserID: buyer-v40 | ${channelId}` },
        client: { user: { username: 'BotTest', displayAvatarURL: () => 'http://x' } },
        reply: async opts => {
            replies.push(opts.content);
            interaction.replied = true;
            return {};
        },
        followUp: async opts => {
            replies.push(opts.content);
            return {};
        },
        update: async opts => {
            replies.push(opts.content);
            interaction.replied = true;
            return {};
        },
        deferUpdate: async () => {
            interaction.deferred = true;
            return {};
        },
        deferReply: async () => {
            interaction.deferred = true;
            return {};
        },
        editReply: async opts => {
            replies.push(opts.content);
            return {};
        },
        _replies: replies
    };
    return interaction;
}

test('v3.9.40 FIX: tombol tutup (✅ Selesai) saat completionLocks dipegang → DITOLAK, channel tidak dihapus', async () => {
    resetDataFile('config.json', {
        roles: { admin: 'role-admin' },
        products: [{ label: 'VIP 30 Hari', value: 'vip30', price: 'Rp 30.000', category: 'transaction', requiresKey: true }]
    });
    resetDataFile('tickets.json', {
        'ch-race-1': { userId: 'buyer-v40', guildId: 'g_v40', productName: 'VIP 30 Hari', productValue: 'vip30', category: 'transaction', isCompleted: false }
    });

    // Simulasikan admin A sedang memegang lock (set key / kirim pesanan jalan).
    const locks = ticketDomain.completionLocks;
    locks.add('ch-race-1');
    try {
        const i = makeTicketInteraction({ customId: 'ticket_close_success', channelId: 'ch-race-1' });
        await ticketDomain(i);
        assert.strictEqual(i._replies.length, 1, 'satu balasan penolakan');
        assert.match(i._replies[0], /sedang diproses admin lain/i, 'pesan busy');
        // Meta TIDAK dihapus (closeTicket tidak jalan).
        assert.ok(getTicketMeta('ch-race-1', ''), 'meta tiket masih ada — channel belum ditutup');
    } finally {
        locks.delete('ch-race-1');
    }
});

test('v3.9.40 FIX: tombol tutup (❌ Tidak Jadi Beli) saat completionLocks dipegang → DITOLAK', async () => {
    resetDataFile('config.json', {
        roles: { admin: 'role-admin' },
        products: [{ label: 'VIP 30 Hari', value: 'vip30', price: 'Rp 30.000', category: 'transaction', requiresKey: true }]
    });
    resetDataFile('tickets.json', {
        'ch-race-2': { userId: 'buyer-v40', guildId: 'g_v40', productName: 'VIP 30 Hari', productValue: 'vip30', category: 'transaction', isCompleted: false }
    });

    const locks = ticketDomain.completionLocks;
    locks.add('ch-race-2');
    try {
        const i = makeTicketInteraction({ customId: 'ticket_close_cancel_trans', channelId: 'ch-race-2' });
        await ticketDomain(i);
        assert.match(i._replies[0], /sedang diproses admin lain/i, 'pesan busy');
        assert.ok(getTicketMeta('ch-race-2', ''), 'meta tiket masih ada');
    } finally {
        locks.delete('ch-race-2');
    }
});

// ====================================================
// === (6) Dedup router — guard in-flight (replay PARALEL) ===
// ====================================================

test('v3.9.40 FIX: replay gateway PARALEL saat handler masih jalan → di-drop, handler cuma 1x', async () => {
    const { processedInteractions } = require('../../src/interactions/_dedup');
    const routeInteraction = require('../../src/interactions');
    const id = `v3940-inflight-${Date.now()}-${Math.random()}`;

    let release;
    const gate = new Promise(res => {
        release = res;
    });
    let replyCalls = 0;
    const makeInteraction = () => ({
        id,
        customId: 'btn_verify',
        replied: false,
        deferred: false,
        isRepliable: () => true,
        isChatInputCommand: () => false,
        isButton: () => true,
        isStringSelectMenu: () => false,
        isUserSelectMenu: () => false,
        isModalSubmit: () => false,
        reply: async () => {
            replyCalls++;
            await gate; // reply lambat → handler pertama masih in-flight
            return {};
        },
        editReply: async () => ({})
    });

    const first = routeInteraction(makeInteraction()); // JANGAN await — biarkan jalan
    await new Promise(res => setImmediate(res)); // satu tick supaya masuk await gate

    // Replay paralel dengan interaction.id SAMA (Discord double-delivery):
    // v3.9.39: lolos check() (belum di-mark) + guard replied (instance baru) →
    // handler jalan 2x paralel. v3.9.40: di-drop senyap.
    const second = await routeInteraction(makeInteraction());
    assert.strictEqual(second, undefined, 'replay paralel di-drop (in-flight guard)');
    assert.strictEqual(replyCalls, 1, 'handler tidak dobel — reply cuma 1x');

    release();
    await first;
    assert.strictEqual(replyCalls, 1, 'setelah selesai pun tetap 1x');
    processedInteractions.delete(id);
});

test('v3.9.40: handler THROW → in-flight dilepas → retry Discord BERIKUTNYA tetap bisa masuk', async () => {
    const { processedInteractions } = require('../../src/interactions/_dedup');
    const routeInteraction = require('../../src/interactions');
    const id = `v3940-inflight-throw-${Date.now()}-${Math.random()}`;
    const makeInteraction = () => ({
        id,
        customId: 'mm_pick_seller',
        replied: false,
        deferred: false,
        isRepliable: () => true,
        isChatInputCommand: () => false,
        isButton: () => false,
        isStringSelectMenu: () => false,
        isUserSelectMenu: () => true,
        isModalSubmit: () => false,
        reply: async () => ({}),
        editReply: async () => ({})
    });

    // Crash pertama — in-flight HARUS sudah dilepas (finally).
    await assert.rejects(() => routeInteraction(makeInteraction()));
    // Retry berikutnya tetap diproses (semantik crash-retry v3.9.38 terjaga).
    await assert.rejects(() => routeInteraction(makeInteraction()), 'retry pasca-throw tetap masuk (bukan stuck in-flight)');
    processedInteractions.delete(id);
});

// ====================================================
// === (7) reconcileZombieDeals — skip deal terkunci ===
// ====================================================

test('v3.9.40 FIX: reconcile TIDAK menghapus meta deal yang sedang dipegang transitionLocks', async () => {
    resetDataFile('deals.json', {
        'ch-deal-locked': {
            channelId: 'ch-deal-locked',
            guildId: 'g_recon_v40',
            state: 'WAITING_PAYMENT',
            buyerId: 'b1',
            sellerId: 's1',
            priceNum: 100000,
            history: []
        }
    });
    const mm = require('../../src/data/midmanManager');

    // Channel deal tidak ada (fetch throw 10003) TAPI handler memegang lock.
    const unknownErr = new Error('Unknown Channel');
    unknownErr.code = 10003;
    const channelFetch = async () => {
        throw unknownErr;
    };
    const guild = {
        id: 'g_recon_v40',
        channels: {
            cache: new Map(),
            fetch: channelFetch
        }
    };
    const client = { guilds: { cache: new Map([['g_recon_v40', guild]]) } };

    mm.transitionLocks.add('ch-deal-locked');
    let removed;
    try {
        removed = await reconcileZombieDeals(client);
    } finally {
        mm.transitionLocks.delete('ch-deal-locked');
    }
    assert.strictEqual(removed, 0, 'deal terkunci TIDAK di-reconcile (zombie-resurrect dicegah)');
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'deals.json'), 'utf8'));
    assert.ok(raw['ch-deal-locked'], 'meta deal masih ada selama handler bekerja');

    // Setelah lock lepas → reconcile berikutnya boleh bersihkan.
    const removed2 = await reconcileZombieDeals(client);
    assert.strictEqual(removed2, 1, 'setelah lock lepas, zombie dibersihkan');
    const raw2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'deals.json'), 'utf8'));
    assert.ok(!raw2['ch-deal-locked'], 'meta deal zombie terhapus setelah handler selesai');
});

// ====================================================
// === (8) Transcript — konten ``` tidak menutup fence ===
// ====================================================

const { saveTranscript } = require('../../src/data/ticketManager');

test('v3.9.40 FIX: pesan user berisi ``` → code fence transcript tetap utuh', async () => {
    resetDataFile('config.json', { channels: { transcript: 'ch-trans-v40' } });

    const evil = '```\nscript jahat\n```';
    const msgs = [
        { id: '900', createdTimestamp: 1700000000000, author: { bot: false, tag: 'user#0001' }, embeds: [], content: evil },
        { id: '901', createdTimestamp: 1700000001000, author: { bot: false, tag: 'user#0001' }, embeds: [], content: 'pesan-normal' }
    ];
    const sent = [];
    const transcriptChannel = { send: async opts => sent.push(opts) };
    const ticketChannel = {
        id: 'ch-t40',
        name: 'ticket-t40',
        guild: { channels: { cache: new Map([['ch-trans-v40', transcriptChannel]]) } },
        messages: {
            fetch: async opts => {
                const sorted = [...msgs].sort((a, b) => Number(b.id) - Number(a.id));
                const page = opts.before ? sorted.filter(m => Number(m.id) < Number(opts.before)) : sorted;
                return new Map(page.map(m => [m.id, m]));
            }
        }
    };

    const ok = await saveTranscript(
        ticketChannel,
        { userId: 'u-v40', productName: 'VIP 30 Hari', price: 'Rp 30.000', category: 'transaction', createdAt: Date.now() },
        { tag: 'Admin#0001', id: 'admin-v40' },
        true
    );
    assert.strictEqual(ok, true, 'transcript sukses terkirim');

    // Semua chunk harus punya fence utuh: konten ``` di-escape zero-width space.
    const chunks = sent.filter(s => (s.content || '').includes('```'));
    assert.ok(chunks.length > 0, 'ada chunk code fence');
    for (const chunk of chunks) {
        const body = chunk.content;
        // Hitung fence pembuka/penutup: tepat 2 (satu pasang) per chunk —
        // konten ``` yang tidak di-escape bikin jumlah fence ganjil/lebih.
        const fenceCount = (body.match(/```/g) || []).length;
        assert.strictEqual(fenceCount, 2, `fence utuh 1 pasang (aktual: ${fenceCount})`);
    }
    // Konten jahat tetap terbaca (backtick diganti ZWSP — string asli tidak muncul mentah).
    assert.ok(sent.some(s => (s.content || '').includes('script jahat')), 'isi pesan tetap terarsip');
});

// ====================================================
// === (9) /help unknown customId → interaction di-ack ===
// ====================================================

test('v3.9.40 FIX: customId help_* asing → reply ephemeral (bukan "interaction failed")', async () => {
    const helpDomain = require('../../src/interactions/help');
    const replies = [];
    const interaction = {
        customId: 'help_tak_dikenal_v40',
        id: `v3940-help-${Date.now()}`,
        replied: false,
        deferred: false,
        client: { user: { username: 'BotTest', displayAvatarURL: () => 'http://x' } },
        user: { toString: () => '<@test>' },
        isButton: () => true,
        isStringSelectMenu: () => false,
        reply: async opts => {
            replies.push(opts.content);
            interaction.replied = true;
            return {};
        },
        update: async () => ({})
    };
    await helpDomain(interaction);
    assert.strictEqual(replies.length, 1, 'interaction di-ack');
    assert.match(replies[0], /tidak dikenal/i, 'pesan informatif');
});
