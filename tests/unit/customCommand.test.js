/**
 * Unit tests untuk Custom Commands v3.20.0 (dibuat dari web → slash command
 * asli di Discord).
 *
 * Verify:
 *   - embedPayload.normalizeEmbedDef: caps Discord (title/desc/footer/fields),
 *     URL validation, total 6000, hex color, bentuk kosong
 *   - embedPayload.isEmbedEmpty + buildEmbedFromDef (builder menghormati
 *     semua properti: author, footer, fields inline, timestamp)
 *   - customCommandManager.validateDefinition: nama valid/invalid, bentrok
 *     command bawaan, deskripsi, minimal content ATAU embed
 *   - upsertCommand: create baru, update (nama sama), cap 20 per guild,
 *     aktor tercatat
 *   - deleteCommand: sukses + tidak ketemu
 *   - toApplicationCommands: bentuk registrasi Discord { name, description }
 *   - Paritas Command Manager: normalizeDisabledList menerima custom command
 *     guild itu (extraNames) — aturan identik web ↔ Discord
 *
 * File data/customCommands/<guildId>.json test di-snapshot & restore
 * (pola commandManager.test.js).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', '..', 'data', 'customCommands');
const GUILD_ID = '999777999777999777';
const GUILD_FILE = path.join(dataDir, `${GUILD_ID}.json`);
const OTHER_GUILD_ID = '999888999888999888';

// Snapshot & restore
const hadDir = fs.existsSync(dataDir);
const hadFile = fs.existsSync(GUILD_FILE);
const fileBackup = hadFile ? fs.readFileSync(GUILD_FILE) : null;
if (hadFile) fs.unlinkSync(GUILD_FILE);

process.on('exit', () => {
    try {
        if (hadFile) fs.writeFileSync(GUILD_FILE, fileBackup);
        else if (fs.existsSync(GUILD_FILE)) fs.unlinkSync(GUILD_FILE);
        if (!hadDir) return;
        // Bersihkan file guild test lain yang mungkin dibuat suite ini.
        for (const g of [GUILD_ID, OTHER_GUILD_ID]) {
            const p = path.join(dataDir, `${g}.json`);
            if (g === GUILD_ID) continue; // sudah ditangani di atas
            if (fs.existsSync(p) && !hadFile) fs.unlinkSync(p);
        }
    } catch (_) {}
});

const { CAPS, normalizeEmbedDef, buildEmbedFromDef, isEmbedEmpty, totalEmbedLength } = require('../../src/infra/embedPayload');
const customCommandManager = require('../../src/data/customCommandManager');
const { getCommands } = require('../../src/commands/registry');
const { normalizeDisabledList } = require('../../src/commands/commands');

function freshEmbed() {
    return {
        title: 'Judul',
        description: 'Isi embed',
        color: 0xff0000,
        fields: [{ name: 'A', value: '1', inline: true }]
    };
}

// ====================================================
// === embedPayload.normalizeEmbedDef ===
// ====================================================

test('embedPayload: bentuk kosong → ok + value kosong', () => {
    const res = normalizeEmbedDef(undefined);
    assert.ok(res.ok);
    assert.strictEqual(res.value.title, '');
    assert.strictEqual(res.value.fields.length, 0);
    assert.strictEqual(res.value.color, 0x5865f2);
});

test('embedPayload: semua properti valid dinormalisasi', () => {
    const res = normalizeEmbedDef({
        title: 'Hello',
        description: 'World',
        color: '#00ff00',
        authorName: 'Thor',
        authorIconURL: 'https://example.com/a.png',
        thumbnail: 'https://example.com/t.png',
        image: 'https://example.com/i.png',
        footerText: 'Bye',
        footerIconURL: 'https://example.com/f.png',
        timestamp: true,
        fields: [{ name: 'F1', value: 'V1', inline: false }, { name: '', value: '' }]
    });
    assert.ok(res.ok);
    assert.strictEqual(res.value.color, 0x00ff00);
    assert.strictEqual(res.value.authorName, 'Thor');
    assert.strictEqual(res.value.fields.length, 1); // field kosong dibuang
    assert.strictEqual(res.value.fields[0].inline, false);
    assert.strictEqual(res.value.timestamp, true);
});

test('embedPayload: caps Discord ditegakkan (title/desc/footer/field)', () => {
    assert.ok(!normalizeEmbedDef({ title: 'x'.repeat(257) }).ok);
    assert.ok(!normalizeEmbedDef({ description: 'x'.repeat(4097) }).ok);
    assert.ok(!normalizeEmbedDef({ footerText: 'x'.repeat(2049) }).ok);
    assert.ok(!normalizeEmbedDef({ authorName: 'x'.repeat(257) }).ok);
    assert.ok(!normalizeEmbedDef({ fields: [{ name: 'x'.repeat(257), value: 'v' }] }).ok);
    assert.ok(!normalizeEmbedDef({ fields: [{ name: 'n', value: 'x'.repeat(1025) }] }).ok);
});

test('embedPayload: maksimal 25 field', () => {
    const fields = Array.from({ length: 26 }, (_, i) => ({ name: `f${i}`, value: 'v' }));
    const res = normalizeEmbedDef({ fields });
    assert.ok(!res.ok);
    assert.match(res.error, /25/);
});

test('embedPayload: URL non-http ditolak', () => {
    assert.ok(!normalizeEmbedDef({ image: 'ftp://example.com/x.png' }).ok);
    assert.ok(!normalizeEmbedDef({ thumbnail: 'bukan-url' }).ok);
    assert.ok(normalizeEmbedDef({ image: 'https://example.com/x.png' }).ok);
});

test('embedPayload: total 6000 karakter ditegakkan', () => {
    // Tiap field valid (name+value ≤ caps) tapi total jauh di atas 6000.
    const fields = Array.from({ length: 8 }, () => ({ name: 'n'.repeat(200), value: 'v'.repeat(1000) }));
    const res = normalizeEmbedDef({ fields });
    assert.ok(!res.ok);
    assert.match(res.error, /6000/);
});

test('embedPayload: warna invalid ditolak, integer valid diterima', () => {
    assert.ok(!normalizeEmbedDef({ color: 'ijo' }).ok);
    assert.ok(!normalizeEmbedDef({ color: 0x1000000 }).ok);
    const ok = normalizeEmbedDef({ color: 3066993 });
    assert.ok(ok.ok);
    assert.strictEqual(ok.value.color, 3066993);
});

test('embedPayload: isEmbedEmpty + totalEmbedLength', () => {
    assert.ok(isEmbedEmpty({}));
    assert.ok(isEmbedEmpty({ title: '', description: '', fields: [{ name: '', value: '' }] }));
    assert.ok(!isEmbedEmpty({ title: 'x' }));
    assert.ok(!isEmbedEmpty({ image: 'https://example.com/i.png' }));
    assert.strictEqual(totalEmbedLength({ title: 'ab', description: 'cde', fields: [{ name: 'f', value: 'gh' }] }), 8);
});

test('embedPayload: buildEmbedFromDef menghormati semua properti', () => {
    class FakeEmbedBuilder {
        constructor() { this.data = {}; }
        setColor(c) { this.data.color = c; return this; }
        setTitle(t) { this.data.title = t; return this; }
        setDescription(d) { this.data.description = d; return this; }
        setAuthor(a) { this.data.author = a; return this; }
        setThumbnail(u) { this.data.thumbnail = u; return this; }
        setImage(u) { this.data.image = u; return this; }
        setFooter(f) { this.data.footer = f; return this; }
        setTimestamp() { this.data.timestamp = 'set'; return this; }
        addFields(...fs) { this.data.fields = fs; return this; }
    }
    const def = normalizeEmbedDef({
        title: 'T', description: 'D', color: 255,
        authorName: 'A', authorIconURL: 'https://e.com/a.png',
        thumbnail: 'https://e.com/t.png', image: 'https://e.com/i.png',
        footerText: 'F', footerIconURL: 'https://e.com/f.png',
        timestamp: true, fields: [{ name: 'N', value: 'V', inline: true }]
    }).value;
    const built = buildEmbedFromDef(def, FakeEmbedBuilder);
    assert.strictEqual(built.data.title, 'T');
    assert.strictEqual(built.data.author.name, 'A');
    assert.strictEqual(built.data.author.iconURL, 'https://e.com/a.png');
    assert.strictEqual(built.data.footer.text, 'F');
    assert.strictEqual(built.data.fields[0].inline, true);
    assert.strictEqual(built.data.timestamp, 'set');
});

// ====================================================
// === customCommandManager.validateDefinition ===
// ====================================================

test('custom: definisi valid → ok (content saja)', () => {
    const res = customCommandManager.validateDefinition(
        { name: 'sosmed', description: 'Link sosmed', content: 'IG: @thor' },
        []
    );
    assert.ok(res.ok);
    assert.strictEqual(res.value.name, 'sosmed');
    assert.strictEqual(res.value.ephemeral, false);
});

test('custom: nama dinormalisasi lowercase + validasi karakter', () => {
    assert.ok(customCommandManager.validateDefinition({ name: 'SOSMED', description: 'd', content: 'x' }, []).ok);
    assert.ok(!customCommandManager.validateDefinition({ name: 'Nama Spasi', description: 'd', content: 'x' }, []).ok);
    assert.ok(!customCommandManager.validateDefinition({ name: '', description: 'd', content: 'x' }, []).ok);
    assert.ok(!customCommandManager.validateDefinition({ name: 'a'.repeat(33), description: 'd', content: 'x' }, []).ok);
});

test('custom: bentrok nama command bawaan ditolak', () => {
    const builtin = getCommands().map((c) => c.name);
    assert.ok(builtin.includes('giveaway'));
    const res = customCommandManager.validateDefinition(
        { name: 'giveaway', description: 'd', content: 'x' },
        builtin
    );
    assert.ok(!res.ok);
    assert.match(res.error, /bawaan/);
});

test('custom: deskripsi wajib 1-100 + content ≤2000', () => {
    assert.ok(!customCommandManager.validateDefinition({ name: 'x', description: '', content: 'x' }, []).ok);
    assert.ok(!customCommandManager.validateDefinition({ name: 'x', description: 'd'.repeat(101), content: 'x' }, []).ok);
    assert.ok(!customCommandManager.validateDefinition({ name: 'x', description: 'd', content: 'x'.repeat(2001) }, []).ok);
});

test('custom: minimal content ATAU embed', () => {
    const res = customCommandManager.validateDefinition({ name: 'x', description: 'd', content: '', embed: {} }, []);
    assert.ok(!res.ok);
    assert.match(res.error, /Minimal/);
    // embed saja (tanpa content) juga sah
    assert.ok(customCommandManager.validateDefinition({ name: 'x', description: 'd', embed: freshEmbed() }, []).ok);
});

test('custom: embed invalid diteruskan errornya', () => {
    const res = customCommandManager.validateDefinition(
        { name: 'x', description: 'd', embed: { title: 'x'.repeat(300) } },
        []
    );
    assert.ok(!res.ok);
    assert.match(res.error, /Embed/);
});

// ====================================================
// === upsert / delete / toApplicationCommands ===
// ====================================================

const BUILTIN_NAMES = getCommands().map((c) => c.name);

test('custom: upsert create → persist → getCommand', () => {
    const res = customCommandManager.upsertCommand(
        GUILD_ID,
        { name: 'sosmed', description: 'Link sosial media', content: 'IG: @thor', embed: freshEmbed(), ephemeral: true },
        BUILTIN_NAMES,
        { id: 'user1', tag: 'Admin#1' }
    );
    assert.ok(res.ok);
    assert.strictEqual(res.created, true);
    assert.strictEqual(res.command.name, 'sosmed');
    assert.strictEqual(res.command.ephemeral, true);
    assert.strictEqual(res.command.createdBy, 'user1');

    customCommandManager.invalidateCache(); // simulasikan proses lain menulis
    const found = customCommandManager.getCommand(GUILD_ID, 'sosmed');
    assert.ok(found);
    assert.strictEqual(found.description, 'Link sosial media');
    assert.strictEqual(found.embed.title, 'Judul');
});

test('custom: upsert update (nama sama) → created=false, updatedAt maju', async () => {
    await new Promise((r) => setTimeout(r, 5)); // pastikan timestamp beda
    const res = customCommandManager.upsertCommand(
        GUILD_ID,
        { name: 'sosmed', description: 'Sosial media server', content: 'IG: @thor' },
        BUILTIN_NAMES,
        { id: 'user2', tag: 'Admin#2' }
    );
    assert.ok(res.ok);
    assert.strictEqual(res.created, false);
    assert.strictEqual(res.command.description, 'Sosial media server');
    assert.strictEqual(res.command.embed.title, ''); // embed diganti kosong = hilang
    assert.strictEqual(res.command.updatedByTag, 'Admin#2');
});

test('custom: toApplicationCommands → bentuk registrasi Discord', () => {
    const apps = customCommandManager.toApplicationCommands(GUILD_ID);
    assert.ok(Array.isArray(apps));
    assert.strictEqual(apps.length, 1);
    assert.strictEqual(apps[0].name, 'sosmed');
    assert.strictEqual(apps[0].description, 'Sosial media server');
    assert.ok(!('content' in apps[0])); // balasan TIDAK ikut diregistrasi
});

test('custom: cap maksimal command per guild ditegakkan', () => {
    const manager = customCommandManager;
    for (let i = 0; i < manager.MAX_CUSTOM_COMMANDS; i++) {
        const r = manager.upsertCommand(OTHER_GUILD_ID, { name: `cmd-${i}`, description: 'd', content: 'x' }, BUILTIN_NAMES);
        assert.ok(r.ok, `command ke-${i} harus sukses`);
    }
    const over = manager.upsertCommand(OTHER_GUILD_ID, { name: 'cmd-extra', description: 'd', content: 'x' }, BUILTIN_NAMES);
    assert.ok(!over.ok);
    assert.match(over.error, /Maksimal/);
    // update entri lama tetap boleh meski sudah cap
    const upd = manager.upsertCommand(OTHER_GUILD_ID, { name: 'cmd-0', description: 'baru', content: 'x' }, BUILTIN_NAMES);
    assert.ok(upd.ok);
});

test('custom: deleteCommand + tidak ketemu', () => {
    assert.ok(customCommandManager.deleteCommand(OTHER_GUILD_ID, 'cmd-0').ok);
    const miss = customCommandManager.deleteCommand(OTHER_GUILD_ID, 'cmd-0');
    assert.ok(!miss.ok);
    assert.match(miss.error, /tidak ditemukan/);
});

test('custom: guild terisolasi (guild lain tidak melihat command guild ini)', () => {
    assert.strictEqual(customCommandManager.getGuildCommands(GUILD_ID).length, 1);
    assert.strictEqual(customCommandManager.getCommand(GUILD_ID, 'sosmed') !== null, true);
    assert.strictEqual(customCommandManager.getCommand(OTHER_GUILD_ID, 'sosmed'), null);
});

// ====================================================
// === Paritas Command Manager (web ↔ Discord) ===
// ====================================================

test('custom: normalizeDisabledList menerima custom command guild itu', () => {
    const customNames = customCommandManager.getGuildCommands(GUILD_ID).map((c) => c.name);
    assert.ok(customNames.includes('sosmed'));
    const ok = normalizeDisabledList(['sosmed'], customNames);
    assert.ok(ok.ok);
    assert.deepStrictEqual(ok.value, ['sosmed']);
    // tanpa extraNames (aturan lama) → ditolak: bukti parameter bekerja
    const legacy = normalizeDisabledList(['sosmed']);
    assert.ok(!legacy.ok);
});

// ====================================================
// === Cleanup file guild test ===
// ====================================================

test('custom: cleanup file test', () => {
    fs.rmSync(path.join(dataDir, `${OTHER_GUILD_ID}.json`), { force: true });
    assert.ok(true);
});
