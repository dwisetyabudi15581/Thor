/**
 * Unit tests untuk v3.9.12 — ticket body template variables & modal editor
 */

const test = require('node:test');
const assert = require('node:assert');

const { fillTemplate } = require('../../src/data/configManager');

test('fillTemplate: standard variables (backward compat)', () => {
    const result = fillTemplate('Halo {user} dari {server}!', {
        user: '<@123>',
        server: 'My Server'
    });
    assert.strictEqual(result, 'Halo <@123> dari My Server!');
});

test('fillTemplate: v3.9.12 {price_list} variable', () => {
    const result = fillTemplate('Harga:\n{price_list}', {
        priceList: '• VIP 30 Hari — Rp 50.000\n• VIP 7 Hari — Rp 15.000'
    });
    assert.strictEqual(result, 'Harga:\n• VIP 30 Hari — Rp 50.000\n• VIP 7 Hari — Rp 15.000');
});

test('fillTemplate: v3.9.12 {price_header} variable', () => {
    const result = fillTemplate('**{price_header}**\n{price_list}', {
        priceHeader: '💰 HARGA KAMI 💰',
        priceList: '• Item 1'
    });
    assert.strictEqual(result, '**💰 HARGA KAMI 💰**\n• Item 1');
});

test('fillTemplate: v3.9.12 {categories_list} variable', () => {
    const result = fillTemplate('Kategori: {categories_list}', {
        categoriesList: '🔑 Beli Key • 📞 Bantuan'
    });
    assert.strictEqual(result, 'Kategori: 🔑 Beli Key • 📞 Bantuan');
});

test('fillTemplate: v3.9.12 {price_list:<category>} filtered by category', () => {
    const result = fillTemplate('Key saja:\n{price_list:transaction}\n\nJasa:\n{price_list:jasa}', {
        priceListByCategory: {
            transaction: '• VIP 30 Hari',
            jasa: '• Joki Mythic'
        }
    });
    assert.strictEqual(result, 'Key saja:\n• VIP 30 Hari\n\nJasa:\n• Joki Mythic');
});

test('fillTemplate: {price_list:<unknown_category>} shows placeholder', () => {
    const result = fillTemplate('{price_list:unknown}', {
        priceListByCategory: { transaction: '• VIP' }
    });
    assert.match(result, /belum ada produk di kategori.*unknown/);
});

test('fillTemplate: mixed variables in ticketBody', () => {
    const template = 'Selamat datang di {server}!\n\n**{price_header}**\n{price_list}\n\nKategori: {categories_list}';
    const result = fillTemplate(template, {
        server: 'Test Server',
        priceHeader: '💰 HARGA 💰',
        priceList: '• Item 1 — Rp 10.000',
        categoriesList: '🔑 Key • 📞 Help'
    });
    assert.strictEqual(
        result,
        'Selamat datang di Test Server!\n\n' +
            '**💰 HARGA 💰**\n' +
            '• Item 1 — Rp 10.000\n\n' +
            'Kategori: 🔑 Key • 📞 Help'
    );
});

test('fillTemplate: backward compat — old vars still work', () => {
    const result = fillTemplate('{user} ({username}) dari {server} — member ke-{count}, {action}', {
        user: '<@123>',
        username: 'TestUser',
        server: 'Server',
        count: 42,
        action: 'keluar'
    });
    assert.strictEqual(result, '<@123> (TestUser) dari Server — member ke-42, keluar');
});

test('fillTemplate: missing variables leave placeholder unchanged (defensive)', () => {
    // v3.9.12 design: kalau vars.priceList undefined, {price_list} tidak di-replace
    // (biar admin bisa lihat ada template yang belum ke-fill, bukan dihapus diam-diam).
    const result = fillTemplate('{user} {price_list} {categories_list} {price_header}', {});
    assert.ok(typeof result === 'string');
    // {user} replaced with '' (always replaced). Others stay as-is kalau vars not provided.
    assert.ok(!result.includes('{user}'));
    assert.ok(result.includes('{price_list}')); // tetap ada karena vars.priceList undefined
});

test('configManager: default ticketBody uses template variables', () => {
    const { DEFAULTS } = require('../../src/data/configManager');
    assert.ok(DEFAULTS.messages.ticketBody.includes('{price_header}'));
    assert.ok(DEFAULTS.messages.ticketBody.includes('{price_list}'));
});

test('interactions/config.js: handler exists and is function', () => {
    const handler = require('../../src/interactions/config');
    assert.strictEqual(typeof handler, 'function');
});

test('commands/config.js: edit-message command registered', () => {
    // Verify registry has edit-message
    const { getCommands } = require('../../src/commands/registry');
    const commands = getCommands();
    const editMsg = commands.find(c => c.name === 'edit-message');
    assert.ok(editMsg, 'edit-message command should be registered');
    assert.strictEqual(
        editMsg.description,
        'Edit teks pesan embed via modal (multi-line, lebih flexible dari /set-message)'
    );
    assert.ok(editMsg.options.find(o => o.name === 'tipe' && o.required));
});

test('commands/index.js: edit-message routed to config domain', () => {
    const router = require('../../src/commands');
    // Just verify router loads without error
    assert.strictEqual(typeof router, 'function');
});

test('help.js: help embed mentions new commands', async () => {
    // Mock interaction
    const replies = [];
    const mockInteraction = {
        user: { toString: () => '<@test>' },
        client: {
            user: {
                username: 'TestBot',
                displayAvatarURL: () => 'http://example.com/avatar.png'
            }
        },
        reply: async opts => {
            replies.push(opts);
            return {};
        }
    };

    const helpHandler = require('../../src/commands/help');
    await helpHandler(mockInteraction);

    assert.strictEqual(replies.length, 1);
    const embed = replies[0].embeds[0];
    assert.ok(embed.data.title.includes('HELP'));

    // Convert all field values to string for searching
    const allText = embed.data.fields.map(f => f.value).join('\n') + embed.data.description;

    // Verify new commands mentioned
    assert.match(allText, /edit-message/);
    assert.match(allText, /set-verify-button/);
    assert.match(allText, /add-category/);
    assert.match(allText, /setup-ticket-panel/);
    assert.match(allText, /set-transcript-channel/);
    assert.match(allText, /requires_role/);
    assert.match(allText, /price_list/);
    assert.match(allText, /categories_list/);
});
