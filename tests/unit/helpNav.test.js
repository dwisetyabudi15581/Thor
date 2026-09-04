/**
 * Unit tests untuk /help navigasi interaktif (v3.9.39).
 *
 * Verifikasi:
 *   - Integritas katalog: 19 kategori, id unik, semua opsi select menu
 *     within Discord limits (label/desc/value ≤ 100, opsi ≤ 25).
 *   - Semua view embed within limits (description ≤ 4096, total ≤ 6000 —
 *     termasuk view 📖 Semua Command yang bisa 2 embed dalam 1 pesan).
 *   - Search: substring case-insensitive, nama kategori → whole category,
 *     blok command (bullet + baris opsi lanjutan), empty query, no result.
 *   - Command handler: /help tanpa opsi → home + komponen; /help search:x →
 *     hasil pencarian langsung; mock tanpa interaction.options tetap aman.
 *   - Interaction handler: dropdown kategori (known/unknown), tombol search
 *     (showModal), submit modal, tombol home, tombol all (1-2 embed).
 *   - Router interaksi: prefix `help_` di-route ke domain help (bukan unknown).
 */

const test = require('node:test');
const assert = require('node:assert');

const {
    HELP_CATEGORIES,
    HELP_IDS,
    buildHomeEmbed,
    buildCategoryEmbed,
    buildAllEmbeds,
    buildSearchEmbed,
    searchHelp,
    buildHelpComponents,
    embedTotalChars
} = require('../../src/ui/helpCatalog');

const { version: PKG_VERSION } = require('../../package.json');
const { EMBED_LIMITS, DISCORD_LIMITS } = require('../../src/infra/constants');

function makeClient() {
    return {
        user: {
            username: 'TestBot',
            displayAvatarURL: () => 'http://example.com/avatar.png'
        }
    };
}

function catalogAllText() {
    return HELP_CATEGORIES.map(c => c.lines.join('\n')).join('\n');
}

// ====================================================
// === 1. Integritas katalog ===
// ====================================================

test('helpNav: katalog — id unik, semua field non-kosong', () => {
    assert.ok(HELP_CATEGORIES.length >= 15, `kategori terlalu sedikit: ${HELP_CATEGORIES.length}`);
    const ids = new Set(HELP_CATEGORIES.map(c => c.id));
    assert.strictEqual(ids.size, HELP_CATEGORIES.length, 'id kategori harus unik');
    for (const c of HELP_CATEGORIES) {
        assert.match(c.id, /^[a-z0-9_]+$/, `id harus ascii-safe: ${c.id}`);
        assert.ok(c.emoji && typeof c.emoji === 'string', `emoji wajib: ${c.id}`);
        assert.ok(c.name && c.name.length <= 100, `name ≤100: ${c.id}`);
        assert.ok(c.short && c.short.length > 0, `short wajib: ${c.id}`);
        assert.ok(Array.isArray(c.lines) && c.lines.length > 0, `lines wajib: ${c.id}`);
    }
});

test('helpNav: guard 25 opsi select menu (Discord limit)', () => {
    assert.ok(
        HELP_CATEGORIES.length <= DISCORD_LIMITS.SELECT_MENU_MAX_OPTIONS,
        `kategori (${HELP_CATEGORIES.length}) melebihi max select options (${DISCORD_LIMITS.SELECT_MENU_MAX_OPTIONS}) — pecah dropdown jadi 2 halaman`
    );
});

test('helpNav: opsi select — label/description/value ≤ 100 char', () => {
    for (const c of HELP_CATEGORIES) {
        assert.ok(c.name.length <= 100, `label ≤100: ${c.id}`);
        assert.ok(c.short.length <= 100, `description ≤100: ${c.id} (${c.short.length})`);
        assert.ok(c.id.length <= 100, `value ≤100: ${c.id}`);
    }
});

test('helpNav: semua view embed — description ≤ 4096 & total ≤ 6000', () => {
    const client = makeClient();
    const user = { toString: () => '<@test>' };

    // Home.
    const home = buildHomeEmbed(client, user);
    assert.ok(embedTotalChars(home) <= EMBED_LIMITS.TOTAL_CHARS, 'home ≤ 6000');
    assert.ok((home.data.description?.length || 0) <= EMBED_LIMITS.DESCRIPTION, 'home desc ≤ 4096');

    // Setiap kategori.
    for (const c of HELP_CATEGORIES) {
        const embed = buildCategoryEmbed(client, c.id);
        assert.ok(embed, `kategori harus punya embed: ${c.id}`);
        assert.ok(embedTotalChars(embed) <= EMBED_LIMITS.TOTAL_CHARS, `total ≤ 6000: ${c.id}`);
        assert.ok(
            (embed.data.description?.length || 0) <= EMBED_LIMITS.DESCRIPTION,
            `desc ≤ 4096: ${c.id} (${embed.data.description.length})`
        );
        for (const f of embed.data.fields || []) {
            assert.ok(f.value.length <= EMBED_LIMITS.FIELD_VALUE, `field value ≤ 1024: ${c.id}`);
        }
    }

    // All (bisa 2 embed dalam SATU pesan — total gabungan wajib ≤ 6000).
    const all = buildAllEmbeds();
    assert.ok(all.length >= 1 && all.length <= 2, `all view 1-2 embed: ${all.length}`);
    const total = all.reduce((sum, e) => sum + embedTotalChars(e), 0);
    assert.ok(total <= EMBED_LIMITS.TOTAL_CHARS, `all view total ${total} ≤ 6000`);

    // Search (pakai query yang menghasilkan banyak match).
    const search = buildSearchEmbed('e');
    assert.ok(embedTotalChars(search) <= EMBED_LIMITS.TOTAL_CHARS, 'search ≤ 6000');
    assert.ok((search.data.description?.length || 0) <= EMBED_LIMITS.DESCRIPTION, 'search desc ≤ 4096');
});

// ====================================================
// === 2. Builders ===
// ====================================================

test('helpNav: buildHomeEmbed — index kategori + instruksi + versi dinamis', () => {
    const embed = buildHomeEmbed(makeClient(), { toString: () => '<@42>' });
    assert.match(embed.data.title, /HELP/);
    assert.match(embed.data.description, /<@42>/);
    assert.match(embed.data.description, /dropdown/i);
    assert.match(embed.data.description, /Cari Command/);
    assert.match(embed.data.description, /Semua Command/);
    assert.match(embed.data.footer.text, new RegExp(`v${PKG_VERSION.replace(/\./g, '\\.')}`));
    // Index kategori menyebut semua nama kategori.
    const indexField = embed.data.fields.find(f => /Kategori/.test(f.name));
    assert.ok(indexField, 'field index kategori wajib ada');
    for (const c of HELP_CATEGORIES) {
        assert.match(indexField.value, new RegExp(c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('helpNav: buildCategoryEmbed — known & unknown id', () => {
    const client = makeClient();
    const midman = buildCategoryEmbed(client, 'midman');
    assert.ok(midman);
    assert.match(midman.data.title, /Midman \/ Rekber/);
    assert.match(midman.data.description, /set-midman-fee/);
    // Unknown id (pesan lama pasca-update) → null, BUKAN crash.
    assert.strictEqual(buildCategoryEmbed(client, 'gak_ada'), null);
    assert.strictEqual(buildCategoryEmbed(client, undefined), null);
});

test('helpNav: buildHelpComponents — dropdown selalu ada + tombol per view', () => {
    const home = buildHelpComponents('home');
    assert.strictEqual(home.length, 2, '2 action rows (select + button)');
    const selectRow = home[0];
    const selectJSON = selectRow.components[0].toJSON();
    assert.strictEqual(selectJSON.custom_id, HELP_IDS.SELECT);
    assert.strictEqual(selectJSON.options.length, HELP_CATEGORIES.length);
    const homeButtons = home[1].components;
    assert.strictEqual(homeButtons.length, 2, 'home: 🔍 + 📖 (tanpa 🏠)');
    assert.ok(homeButtons.every(b => b.toJSON().custom_id !== HELP_IDS.HOME_BUTTON));

    const cat = buildHelpComponents('cat');
    const catButtons = cat[1].components;
    assert.strictEqual(catButtons.length, 3, 'view lain: 🔍 + 🏠 + 📖');
    assert.ok(catButtons.some(b => b.toJSON().custom_id === HELP_IDS.HOME_BUTTON));

    // Opsi select value = id kategori.
    const values = selectJSON.options.map(o => o.value);
    for (const c of HELP_CATEGORIES) {
        assert.ok(values.includes(c.id), `opsi select harus memuat: ${c.id}`);
    }
});

// ====================================================
// === 3. Search ===
// ====================================================

test('helpNav: searchHelp — substring case-insensitive', () => {
    const r1 = searchHelp('set-key');
    assert.ok(r1.groups.some(g => g.cat.id === 'keys'), 'set-key → kategori keys');
    const r2 = searchHelp('SET-KEY');
    assert.strictEqual(r2.totalBlocks, r1.totalBlocks, 'case-insensitive hasil sama');
});

test('helpNav: searchHelp — nama kategori match → seluruh kategori', () => {
    const r = searchHelp('rekber');
    assert.ok(r.totalBlocks > 0);
    const midmanGroup = r.groups.find(g => g.cat.id === 'midman');
    assert.ok(midmanGroup, 'rekber → kategori midman');
    // Whole-category: semua blok midman ikut (termasuk midman-deals).
    const flat = midmanGroup.blocks.map(b => b.join('\n')).join('\n');
    assert.match(flat, /midman-deals/);
});

test('helpNav: searchHelp — blok bullet membawa baris opsi lanjutan', () => {
    // "use_dropdown" ada di baris opsi lanjutan dari /setup-ticket-panel.
    const r = searchHelp('use_dropdown');
    const panelGroup = r.groups.find(g => g.cat.id === 'panels');
    assert.ok(panelGroup, 'use_dropdown → kategori panels');
    const flat = panelGroup.blocks.map(b => b.join('\n')).join('\n');
    assert.match(flat, /setup-ticket-panel/, 'blok match harus berisi bullet command-nya');
});

test('helpNav: searchHelp — empty query & no result', () => {
    const empty = searchHelp('');
    assert.strictEqual(empty.emptyQuery, true);
    assert.strictEqual(empty.groups.length, 0);
    const spaces = searchHelp('   ');
    assert.strictEqual(spaces.emptyQuery, true);
    const none = searchHelp('zzzz-tidak-ada');
    assert.strictEqual(none.groups.length, 0);
    assert.strictEqual(none.totalBlocks, 0);
    assert.strictEqual(none.emptyQuery, false);
});

test('helpNav: buildSearchEmbed — hasil, kosong, & no-result path', () => {
    const hit = buildSearchEmbed('panel');
    assert.match(hit.data.title, /Hasil Pencarian/);
    assert.match(hit.data.description, /panel/);
    assert.match(hit.data.description, /ditemukan/);

    const empty = buildSearchEmbed('');
    assert.match(empty.data.description, /kosong/i);

    const none = buildSearchEmbed('zzzz-tidak-ada');
    assert.match(none.data.description, /Tidak ada command yang cocok/);
});

test('helpNav: buildSearchEmbed — hasil di-cap supaya embed tetap kecil', () => {
    // Query 1 huruf super-lebar → harus ada indikator truncation, bukan embed raksasa.
    const wide = buildSearchEmbed('e');
    assert.ok((wide.data.description?.length || 0) <= EMBED_LIMITS.DESCRIPTION, 'desc ≤ 4096 walau match lebar');
    assert.match(wide.data.description, /tidak ditampilkan|lebih spesifik/);
});

// ====================================================
// === 4. Command handler (/help) ===
// ====================================================

test('helpNav: /help tanpa opsi → home view + komponen + ephemeral', async () => {
    const replies = [];
    const mock = {
        user: { toString: () => '<@test>' },
        client: makeClient(),
        reply: async opts => {
            replies.push(opts);
            return {};
        }
    };
    const helpHandler = require('../../src/commands/help');
    await helpHandler(mock);
    assert.strictEqual(replies.length, 1);
    const { embeds, components, flags } = replies[0];
    assert.ok(embeds[0], 'embed wajib');
    assert.match(embeds[0].data.title, /HELP/);
    assert.strictEqual(components.length, 2, 'select row + button row');
    assert.strictEqual(components[0].components[0].data.custom_id, HELP_IDS.SELECT);
    assert.strictEqual(flags, 64, 'ephemeral (MessageFlags.Ephemeral)');
});

test('helpNav: /help search:key → hasil pencarian langsung', async () => {
    const replies = [];
    const mock = {
        user: { toString: () => '<@test>' },
        client: makeClient(),
        options: { getString: name => (name === 'search' ? 'key' : null) },
        reply: async opts => {
            replies.push(opts);
            return {};
        }
    };
    const helpHandler = require('../../src/commands/help');
    await helpHandler(mock);
    assert.match(replies[0].embeds[0].data.title, /Hasil Pencarian/);
    assert.match(replies[0].embeds[0].data.description, /key/);
    assert.strictEqual(replies[0].components.length, 2);
});

test('helpNav: /help search whitespace-only → dianggap tanpa query (home)', async () => {
    const replies = [];
    const mock = {
        user: { toString: () => '<@test>' },
        client: makeClient(),
        options: { getString: () => '   ' },
        reply: async opts => {
            replies.push(opts);
            return {};
        }
    };
    const helpHandler = require('../../src/commands/help');
    await helpHandler(mock);
    assert.match(replies[0].embeds[0].data.title, /HELP/);
});

// ====================================================
// === 5. Interaction handler (navigasi) ===
// ====================================================

function makeComponentInteraction(overrides = {}) {
    const updates = [];
    const shown = [];
    return {
        i: {
            customId: 'help_cat',
            id: `helpnav-${Date.now()}-${Math.random()}`,
            replied: false,
            deferred: false,
            isRepliable: () => true,
            isChatInputCommand: () => false,
            isButton: () => false,
            isStringSelectMenu: () => true,
            isUserSelectMenu: () => false,
            isModalSubmit: () => false,
            client: makeClient(),
            user: { toString: () => '<@test>' },
            values: ['midman'],
            update: async opts => {
                updates.push(opts);
                return {};
            },
            showModal: async modal => {
                shown.push(modal);
                return {};
            },
            fields: { getTextInputValue: () => 'panel' },
            ...overrides
        },
        updates,
        shown
    };
}

test('helpNav: dropdown pilih kategori → update embed kategori', async () => {
    const { i, updates } = makeComponentInteraction();
    const handler = require('../../src/interactions/help');
    await handler(i);
    assert.strictEqual(updates.length, 1);
    assert.match(updates[0].embeds[0].data.title, /Midman \/ Rekber/);
    assert.ok(updates[0].components[1].components.some(b => b.data.custom_id === HELP_IDS.HOME_BUTTON));
});

test('helpNav: dropdown value unknown (pesan lama) → fallback home, bukan crash', async () => {
    const { i, updates } = makeComponentInteraction({ values: ['kategori_sudah_dihapus'] });
    const handler = require('../../src/interactions/help');
    await handler(i);
    assert.strictEqual(updates.length, 1);
    assert.match(updates[0].embeds[0].data.title, /HELP/);
});

test('helpNav: tombol 🔍 → showModal dengan input required', async () => {
    const { i, shown } = makeComponentInteraction({ customId: 'help_search', isButton: () => true, isStringSelectMenu: () => false });
    const handler = require('../../src/interactions/help');
    await handler(i);
    assert.strictEqual(shown.length, 1);
    const modalJSON = shown[0].toJSON();
    assert.strictEqual(modalJSON.custom_id, HELP_IDS.SEARCH_MODAL);
    const input = modalJSON.components[0].components[0];
    assert.strictEqual(input.custom_id, HELP_IDS.SEARCH_INPUT);
    assert.strictEqual(input.required, true);
});

test('helpNav: submit modal → update hasil pencarian', async () => {
    const { i, updates } = makeComponentInteraction({
        customId: 'help_search_modal',
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true
    });
    const handler = require('../../src/interactions/help');
    await handler(i);
    assert.strictEqual(updates.length, 1);
    assert.match(updates[0].embeds[0].data.title, /Hasil Pencarian/);
    assert.match(updates[0].embeds[0].data.description, /panel/);
});

test('helpNav: tombol 🏠 → update home', async () => {
    const { i, updates } = makeComponentInteraction({
        customId: 'help_home',
        isButton: () => true,
        isStringSelectMenu: () => false
    });
    const handler = require('../../src/interactions/help');
    await handler(i);
    assert.strictEqual(updates.length, 1);
    assert.match(updates[0].embeds[0].data.title, /HELP/);
    assert.ok(!updates[0].components[1].components.some(b => b.data.custom_id === HELP_IDS.HOME_BUTTON));
});

test('helpNav: tombol 📖 → update daftar lengkap (1-2 embed, total ≤ 6000)', async () => {
    const { i, updates } = makeComponentInteraction({
        customId: 'help_all',
        isButton: () => true,
        isStringSelectMenu: () => false
    });
    const handler = require('../../src/interactions/help');
    await handler(i);
    assert.strictEqual(updates.length, 1);
    const embeds = updates[0].embeds;
    assert.ok(embeds.length >= 1 && embeds.length <= 2);
    const total = embeds.reduce((sum, e) => sum + embedTotalChars(e), 0);
    assert.ok(total <= EMBED_LIMITS.TOTAL_CHARS, `total ${total} ≤ 6000`);
});

test('helpNav: customId help_* asing → warning, no crash', async () => {
    const { i } = makeComponentInteraction({
        customId: 'help_misterius',
        isButton: () => true,
        isStringSelectMenu: () => false
    });
    const handler = require('../../src/interactions/help');
    await handler(i); // tidak boleh throw
    assert.ok(true);
});

// ====================================================
// === 6. Router interaksi — prefix help_ ===
// ====================================================

test('helpNav: router — select help_cat di-dispatch ke domain help (update dipanggil)', async () => {
    const routeInteraction = require('../../src/interactions');
    const { i, updates } = makeComponentInteraction();
    await routeInteraction(i);
    assert.strictEqual(updates.length, 1, 'harus ter-dispatch & handler jalan (bukan warning unknown)');
});

test('helpNav: router — button help_search di-dispatch (showModal dipanggil)', async () => {
    const routeInteraction = require('../../src/interactions');
    const { i, shown } = makeComponentInteraction({
        customId: 'help_search',
        isButton: () => true,
        isStringSelectMenu: () => false
    });
    await routeInteraction(i);
    assert.strictEqual(shown.length, 1);
});

test('helpNav: konten lama tetap utuh di katalog (regression v3.9.37/v3.9.38)', () => {
    const allText = catalogAllText();
    // Auto-Split 3 kategori + midman (dulu di embed raksasa — kini di katalog).
    assert.match(allText, /3 kategori/);
    assert.doesNotMatch(allText, /2 kategori/);
    assert.match(allText, /REKBER/);
    assert.match(allText, /midman\.category/);
    assert.match(allText, /set-midman-fee/);
    assert.match(allText, /midman-deals/);
    assert.match(allText, /set-role midman/);
    assert.match(allText, /verified\/unverified\/admin\/\*\*midman\*\*/);
    // Panel & commands populer.
    assert.match(allText, /list-panels/);
    assert.match(allText, /update-panel/);
    assert.match(allText, /use_dropdown/);
    assert.match(allText, /update-category/);
    assert.match(allText, /update-product/);
});
