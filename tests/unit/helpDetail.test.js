/**
 * Unit tests untuk blok `detail` kategori /help (v3.9.52).
 *
 * v3.9.52 (permintaan user: "Tolong update juga di /help biar sync semua")
 * menambah array `detail` opsional per kategori help: dokumentasi pakai yang
 * lebih kaya yang HANYA tampil di tampilan detail kategori 📂. Embed 📖 Semua
 * Command dan 🔍 Pencarian tetap merender `lines` yang ringkas — slack budget
 * Semua Command cuma ~24 karakter (5776/5800), jadi kebocoran detail akan
 * diam-diam meng-drop kategori terakhir dari daftar lengkap.
 *
 * Memverifikasi:
 *   - Detail kategori Statistik: cara pakai /serverstats setup/remove/refresh,
 *     penjelasan auto-update + rate limit, panduan notifikasi boost.
 *   - Blok detail Panduan Cepat + Log & Channel ada.
 *   - Embed Semua Command TIDAK berisi teks detail, tetap dalam budget 5800,
 *     dan mempertahankan SEMUA 20 kategori (tidak ada drop diam-diam).
 *   - Kategori tanpa `detail` render persis seperti sebelumnya (backward compat).
 *   - Deskripsi tiap tampilan kategori tetap ≤ 4096 (limit Discord).
 *   - Pencarian hanya memindai `lines`: nama command ketemu, frasa khusus
 *     detail ("self-heal") tidak pernah bocor ke hasil pencarian.
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
// === 1. Kategori Statistik — dokumentasi pakai ===
// ====================================================

test('helpDetail: kategori stats punya blok detail yang mendokumentasikan /serverstats', () => {
    const cat = findCat('stats');
    assert.ok(cat, 'kategori stats harus ada');
    assert.ok(Array.isArray(cat.detail) && cat.detail.length > 0, 'kategori stats butuh array detail');
    const text = cat.detail.join('\n');

    // Cara pakai /serverstats: setup + remove + refresh (3 subcommand).
    assert.match(text, /\/serverstats setup/, 'detail harus mendokumentasikan `setup`');
    assert.match(text, /\/serverstats remove/, 'detail harus mendokumentasikan `remove`');
    assert.match(text, /\/serverstats refresh/, 'detail harus mendokumentasikan `refresh`');

    // Janji counter live (permintaan user — kayak bot ServerStats).
    assert.match(text, /Member/, 'detail harus menyebut counter Member');
    assert.match(text, /Boost/, 'detail harus menyebut counter Boost');
    assert.match(text, /rate limit/i, 'detail harus menjelaskan keamanan rate limit');

    // Panduan notifikasi boost → channel server-booster.
    assert.match(text, /server-booster/, 'detail harus menyebut channel server-booster');
});

test('helpDetail: detail kategori stats tampil di tampilan kategori', () => {
    const embed = buildCategoryEmbed(null, 'stats');
    assert.ok(embed, 'embed kategori harus terbentuk');
    const desc = embed.toJSON().description;
    // Daftar command ringkas dulu…
    assert.match(desc, /• `\/stats` — statistik live server/);
    // …lalu detail lengkapnya.
    assert.match(desc, /\/serverstats setup/);
    assert.match(desc, /Notifikasi boost/);
});

// ====================================================
// === 2. Blok detail Panduan Cepat + Log & Channel ===
// ====================================================

test('helpDetail: detail quickstart menyarankan /serverstats setup sebagai opsional', () => {
    const cat = findCat('quickstart');
    const text = (cat.detail || []).join('\n');
    assert.match(text, /\/serverstats setup/, 'detail quickstart harus menunjuk counter live');
    // 5 langkah bernomor itu sendiri tidak boleh berubah (budget Semua Command).
    assert.strictEqual(
        cat.lines.length,
        7,
        'jumlah lines quickstart berubah — budget Semua Command kritis'
    );
});

test('helpDetail: detail logging menjelaskan pengumuman boost otomatis', () => {
    const cat = findCat('logging');
    const text = (cat.detail || []).join('\n');
    assert.match(text, /server-booster/, 'detail logging harus menyebut channel server-booster');
    assert.match(text, /BOOST_ADD/, 'detail logging harus menyebut tipe event log server');
});

// ====================================================
// === 3. Embed Semua Command — detail tidak boleh bocor ===
// ====================================================

test('helpDetail: embed Semua Command mengecualikan teks detail dan mempertahankan 20 kategori', () => {
    const embeds = buildAllEmbeds();
    assert.strictEqual(embeds.length, 1, 'Semua Command adalah satu embed');
    const total = embedTotalChars(embeds[0]);
    const json = embeds[0].toJSON();

    // Kontrak budget — alasan persis `detail` dibuat (slack ~24 karakter!).
    assert.ok(total <= 5800, `total Semua Command ${total} melebihi budget 5800`);
    assert.strictEqual(json.fields.length, HELP_CATEGORIES.length, 'semua kategori harus tetap di daftar lengkap');

    // Frasa khusus detail tidak boleh muncul di daftar lengkap.
    const all = JSON.stringify(json);
    assert.ok(!all.includes('/serverstats setup'), 'detail bocor ke Semua Command');
    assert.ok(!all.includes('Notifikasi boost'), 'detail bocor ke Semua Command');
    assert.ok(!all.includes('self-heal'), 'detail bocor ke Semua Command');
});

test('helpDetail: kategori tanpa detail render persis seperti sebelumnya', () => {
    for (const cat of HELP_CATEGORIES) {
        if (cat.detail) continue;
        const desc = buildCategoryEmbed(null, cat.id).toJSON().description;
        assert.strictEqual(desc, cat.lines.join('\n'), `kategori ${cat.id} tanpa detail harus render lines saja`);
    }
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

test('helpDetail: pencarian memindai lines saja — command ketemu, frasa detail tidak', () => {
    // Nama command tetap ketemu di baris ringkas.
    const result = searchHelp('serverstats');
    assert.ok(result.totalBlocks >= 1, 'mencari "serverstats" harus menemukan command');
    const stats = result.groups.find(g => g.cat.id === 'stats');
    assert.ok(stats, 'kategori stats harus ada di hasil');
    assert.match(stats.blocks.map(b => b.join('\n')).join('\n'), /\/serverstats/);

    // Frasa khusus detail TIDAK boleh bocor ke hasil pencarian.
    const leak = searchHelp('self-heal');
    assert.strictEqual(leak.totalBlocks, 0, 'frasa khusus detail tidak boleh bisa dicari');
});
