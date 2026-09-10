/**
 * Unit tests untuk panduan `detail` kategori /help (v3.9.52 → v3.9.53).
 *
 * v3.9.52 menambah array `detail` opsional per kategori. v3.9.53 (permintaan
 * user: "tulis ulang /help jadi setiap kategori perintah slash command kasih
 * penjelasan biar member tidak bertanya tanya") menjadikan `detail` TAMPILAN
 * kategori itu sendiri: kalau ada, dialah deskripsinya (panduan per-command
 * mandiri dengan sintaks + perilaku + FAQ), sementara `lines` yang ringkas
 * tetap jadi konten embed 📖 Semua Command (5776/5800 — slack cuma 24
 * karakter; kebocoran panduan akan diam-diam meng-drop kategori terakhir)
 * dan indeks 🔍 Pencarian.
 *
 * Memverifikasi:
 *   - SEMUA kategori punya panduan `detail` tidak kosong (rewrite-nya).
 *   - Tampilan kategori merender panduan (bukan baris ringkas).
 *   - Panduan mendokumentasikan command nyata: tiap panduan menyebut
 *     minimal satu `/command` yang juga ada di `lines` kategori itu.
 *   - Embed Semua Command mengecualikan teks panduan, tetap dalam budget
 *     5800, dan mempertahankan SEMUA 20 kategori (tidak ada drop senyap).
 *   - Panduan Statistik mendokumentasikan opsi pemilihan counter v3.9.53.
 *   - Deskripsi tiap tampilan kategori tetap ≤ 4096 (limit Discord).
 *   - Pencarian hanya memindai `lines` (command ketemu; frasa khusus
 *     panduan tidak pernah bocor ke hasil).
 */

const test = require('node:test');
const assert = require('node:assert');

const {
    HELP_CATEGORIES,
    buildCategoryEmbed,
    buildAllEmbeds,
    searchHelp,
    embedTotalChars
} = require('../../src/ui/helpCatalog');

const { EMBED_LIMITS } = require('../../src/infra/constants');

function findCat(id) {
    return HELP_CATEGORIES.find(c => c.id === id);
}

// ====================================================
// === 1. Setiap kategori adalah panduan lengkap ===
// ====================================================

test('helpDetail: SEMUA kategori punya panduan detail tidak kosong (rewrite v3.9.53)', () => {
    assert.strictEqual(HELP_CATEGORIES.length, 20, 'katalog harus 20 kategori');
    for (const cat of HELP_CATEGORIES) {
        assert.ok(
            Array.isArray(cat.detail) && cat.detail.length >= 3,
            `kategori ${cat.id} butuh panduan detail lengkap (dapat ${cat.detail ? cat.detail.length : 'tidak ada'} baris)`
        );
    }
});

test('helpDetail: tampilan kategori merender panduan, bukan baris ringkas', () => {
    for (const cat of HELP_CATEGORIES) {
        const desc = buildCategoryEmbed(null, cat.id).toJSON().description;
        assert.strictEqual(desc, cat.detail.join('\n'), `tampilan kategori ${cat.id} harus persis panduannya`);
    }
});

test('helpDetail: tiap panduan mendokumentasikan command nyata yang juga ada di lines', () => {
    for (const cat of HELP_CATEGORIES) {
        const guide = cat.detail.join('\n');
        const commands = [...cat.lines.join('\n').matchAll(/`\/([a-z-]+)/g)].map(m => m[1]);
        const documented = commands.filter(cmd => guide.includes(`/${cmd}`));
        assert.ok(
            documented.length >= Math.min(1, commands.length),
            `panduan ${cat.id} harus menyebut minimal satu command nyata`
        );
    }
});

// ====================================================
// === 2. Embed Semua Command — panduan tidak boleh bocor ===
// ====================================================

test('helpDetail: embed Semua Command mengecualikan teks panduan dan mempertahankan 20 kategori', () => {
    const embeds = buildAllEmbeds();
    assert.strictEqual(embeds.length, 1, 'Semua Command adalah satu embed');
    const total = embedTotalChars(embeds[0]);
    const json = embeds[0].toJSON();

    // Kontrak budget — alasan persis panduan disimpan di `detail` (24 karakter!).
    assert.ok(total <= 5800, `total Semua Command ${total} melebihi budget 5800`);
    assert.strictEqual(json.fields.length, HELP_CATEGORIES.length, 'semua kategori harus tetap di daftar lengkap');

    // Frasa khusus panduan tidak boleh muncul di daftar lengkap.
    const all = JSON.stringify(json);
    assert.ok(!all.includes('Pilih counter'), 'panduan bocor ke Semua Command');
    assert.ok(!all.includes('self-heal'), 'panduan bocor ke Semua Command');
    assert.ok(!all.includes('Kenapa'), 'frasa FAQ bocor ke Semua Command');
});

// ====================================================
// === 3. Panduan Statistik — opsi v3.9.53 ===
// ====================================================

test('helpDetail: panduan stats mendokumentasikan opsi pemilihan counter', () => {
    const guide = findCat('stats').detail.join('\n');
    assert.match(guide, /\/serverstats setup/, 'harus mendokumentasikan setup');
    assert.match(guide, /\/serverstats remove/, 'harus mendokumentasikan remove');
    assert.match(guide, /\/serverstats refresh/, 'harus mendokumentasikan refresh');
    assert.match(guide, /bots/, 'harus menyebut opsi bots');
    assert.match(guide, /False/, 'harus menjelaskan False = lewati');
    assert.match(guide, /rate limit/i, 'harus menjelaskan keamanan rate limit');
    assert.match(guide, /server-booster/, 'harus menyebut channel boost');
});

// ====================================================
// === 4. Limit Discord + kontrak pencarian ===
// ====================================================

test('helpDetail: deskripsi tiap tampilan kategori tetap dalam 4096', () => {
    for (const cat of HELP_CATEGORIES) {
        const embed = buildCategoryEmbed(null, cat.id);
        assert.ok(embed, `kategori ${cat.id} harus terbentuk`);
        const desc = embed.toJSON().description;
        assert.ok(
            desc.length <= EMBED_LIMITS.DESCRIPTION,
            `deskripsi kategori ${cat.id} ${desc.length} > ${EMBED_LIMITS.DESCRIPTION}`
        );
    }
});

test('helpDetail: pencarian memindai lines saja — command ketemu, frasa panduan tidak', () => {
    // Nama command tetap ketemu di baris ringkas.
    const result = searchHelp('serverstats');
    assert.ok(result.totalBlocks >= 1, 'mencari "serverstats" harus menemukan command');
    const stats = result.groups.find(g => g.cat.id === 'stats');
    assert.ok(stats, 'kategori stats harus ada di hasil');
    assert.match(stats.blocks.map(b => b.join('\n')).join('\n'), /\/serverstats/);

    // Frasa khusus panduan TIDAK boleh bocor ke hasil pencarian.
    const leak = searchHelp('self-heal');
    assert.strictEqual(leak.totalBlocks, 0, 'frasa khusus panduan tidak boleh bisa dicari');
});
