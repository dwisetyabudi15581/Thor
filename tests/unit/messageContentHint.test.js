/**
 * Unit tests v3.9.46 — hint intent-missing tidak boleh false alarm.
 *
 * Laporan produksi: hint "Message Content Intent is not enabled" muncul
 * padahal intent AKTIF dan bot online (kalau toggle portal OFF, bot justru
 * crash saat login: "Privileged intent provided is not enabled"). Pesan
 * pemicunya (dari thor064747) adalah tipe tanpa teks: poll native / GIF
 * picker Tenor / pesan sistem.
 *
 * Yang dijaga:
 *   A. isContentlessByDesign() (helper murni): true untuk poll / embeds(gifv) /
 *      pesan sistem (system/type) / attachment / sticker / components;
 *      false untuk pesan polos tanpa apa-apa.
 *   B. End-to-end (execute + console.warn di-stub): pesan tanpa teks dari
 *      sumber di atas → 0 warning; pesan polos kosong → warning muncul,
 *      tepat SEKALI per guild per 24 jam (dedup).
 */

const test = require('node:test');
const assert = require('node:assert');

// GUILD_ID guard (v3.9.26) harus mati selama test — save & restore.
const _savedGuildId = process.env.GUILD_ID;
if ('GUILD_ID' in process.env) delete process.env.GUILD_ID;

const messageCreate = require('../../src/bot/events/messageCreate');
const { isContentlessByDesign } = messageCreate;

test.after(() => {
    if (_savedGuildId !== undefined) process.env.GUILD_ID = _savedGuildId;
});

/** Mock Message — polos tanpa teks (default) + override per skenario. */
function makeEmptyMessage(guildId, extra = {}) {
    return Object.assign({
        author: { id: 'usr_hint', tag: 'tester_hint#0000', bot: false, displayAvatarURL: () => 'x' },
        webhookId: null,
        guild: { id: guildId, name: 'Guild Hint Test' },
        member: { permissions: { has: () => false }, roles: { cache: { has: () => false } } },
        content: '',
        channel: { id: 'ch_hint', send: async () => {} },
        mentions: { users: new Map(), roles: new Map(), everyone: false },
        attachments: { size: 0 },
        stickers: { size: 0 },
        components: [],
        embeds: [],
        poll: null,
        system: false,
        type: 0,
        reply: async () => ({ delete: async () => {} })
    }, extra);
}

/** execute() dengan console.warn di-stub → jumlah warning yang terpancing. */
async function countWarnings(guildId, extra = {}) {
    const orig = console.warn;
    let calls = 0;
    console.warn = () => { calls += 1; };
    try {
        await messageCreate.execute(makeEmptyMessage(guildId, extra));
    } finally {
        console.warn = orig;
    }
    return calls;
}

test('A. isContentlessByDesign: poll/gifv-embed/pesan-sistem/attachment/sticker/components = true; polos = false', () => {
    assert.strictEqual(isContentlessByDesign({ poll: {} }), true, 'poll native Discord tidak butuh teks');
    assert.strictEqual(isContentlessByDesign({ embeds: [{ provider: { name: 'Tenor' } }] }), true, 'GIF picker (gifv embed) tidak butuh teks');
    assert.strictEqual(isContentlessByDesign({ system: true }), true, 'pesan sistem (join/pin) tidak butuh teks');
    assert.strictEqual(isContentlessByDesign({ type: 7 }), true, 'type 7 (USER_JOIN) tidak butuh teks');
    assert.strictEqual(isContentlessByDesign({ attachments: { size: 1 } }), true, 'pesan hanya attachment (perilaku lama tetap)');
    assert.strictEqual(isContentlessByDesign({ stickers: { size: 1 } }), true, 'pesan hanya sticker (perilaku lama tetap)');
    assert.strictEqual(isContentlessByDesign({ components: [{}] }), true, 'pesan komponen UI (perilaku lama tetap)');
    assert.strictEqual(isContentlessByDesign({}), false, 'pesan polos tanpa apa-apa = mencurigakan → hint boleh muncul');
});

test('B. end-to-end: sumber tanpa-teks yang sah → hint TIDAK muncul (0 warning)', async () => {
    const cases = [
        ['poll native', { poll: { question: {} } }],
        ['gif Tenor', { embeds: [{ type: 'gifv' }] }],
        ['pesan sistem join', { system: true, type: 7 }],
        ['hanya attachment', { attachments: { size: 1 } }]
    ];
    for (const [label, extra] of cases) {
        const n = await countWarnings('test_guild_hint_' + label.replace(/\W+/g, '_'), extra);
        assert.strictEqual(n, 0, `${label} tidak boleh memancing hint intent-missing (false alarm v3.9.45)`);
    }
});

test('C. end-to-end: pesan polos kosong → hint muncul TEPAT SEKALI per guild per 24 jam', async () => {
    const gid = 'test_guild_hint_dedup';
    const first = await countWarnings(gid, {});
    assert.strictEqual(first, 1, 'pesan polos kosong tetap memancing hint (deteksi intent asli)');
    const second = await countWarnings(gid, {});
    assert.strictEqual(second, 0, 'pesan kedua di guild yang sama dalam 24 jam tidak mengulang hint (dedup)');
});
