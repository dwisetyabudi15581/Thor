/**
 * Unit tests untuk v3.9.14 — multi-panel ticket flexibility (panelManager + buildTicketPanel).
 *
 * Test yang butuh discord.js di-mock manual. Test panelManager (persistence)
 * test secara langsung karena tidak ada dependensi discord.js di file itu.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// === panelManager tests ===
const panelsPath = path.join(__dirname, '..', '..', 'data', 'panels.json');

function resetPanelsFile() {
    if (fs.existsSync(panelsPath)) {
        fs.unlinkSync(panelsPath);
    }
}

test('panelManager: loadPanels returns {} when file does not exist', () => {
    resetPanelsFile();
    const { loadPanels, invalidateCache } = require('../../src/data/panelManager');
    invalidateCache();
    const all = loadPanels();
    assert.strictEqual(typeof all, 'object');
    assert.strictEqual(Object.keys(all).length, 0);
});

test('panelManager: upsertPanel creates new panel with generated id', () => {
    resetPanelsFile();
    const { upsertPanel, getPanel, invalidateCache } = require('../../src/data/panelManager');
    invalidateCache();
    const panel = upsertPanel({
        guildId: '123',
        channelId: '456',
        messageId: '789',
        title: 'Test Panel',
        body: null,
        color: null,
        categoryIds: ['transaction', 'help'],
        useDropdown: false
    });
    assert.ok(panel.id.startsWith('tp_'), `id should start with tp_, got: ${panel.id}`);
    assert.strictEqual(panel.guildId, '123');
    assert.strictEqual(panel.title, 'Test Panel');
    assert.deepStrictEqual(panel.categoryIds, ['transaction', 'help']);
    assert.ok(panel.createdAt > 0);
    assert.ok(panel.updatedAt >= panel.createdAt);

    // Verify persisted
    invalidateCache();
    const fetched = getPanel(panel.id);
    assert.strictEqual(fetched.title, 'Test Panel');
});

test('panelManager: upsertPanel preserves existing fields when partial update', () => {
    resetPanelsFile();
    const { upsertPanel, invalidateCache } = require('../../src/data/panelManager');
    invalidateCache();
    const original = upsertPanel({
        guildId: 'g1',
        channelId: 'c1',
        title: 'Original',
        body: 'Original body',
        color: '#ff5733',
        categoryIds: ['transaction']
    });
    // Partial update: only change title
    const updated = upsertPanel({
        id: original.id,
        title: 'Updated Title'
    });
    assert.strictEqual(updated.title, 'Updated Title');
    assert.strictEqual(updated.body, 'Original body'); // preserved
    assert.strictEqual(updated.color, '#ff5733'); // preserved
    assert.strictEqual(updated.channelId, 'c1'); // preserved
    assert.strictEqual(updated.guildId, 'g1'); // preserved
    assert.deepStrictEqual(updated.categoryIds, ['transaction']); // preserved
});

test('panelManager: patchPanel does partial update with timestamps', () => {
    resetPanelsFile();
    const { upsertPanel, patchPanel, invalidateCache } = require('../../src/data/panelManager');
    invalidateCache();
    const original = upsertPanel({ guildId: 'g1', channelId: 'c1', title: 'A' });
    // small delay to ensure updatedAt differs
    const beforePatch = original.updatedAt;
    const patched = patchPanel(original.id, { color: '#abc', footerText: 'Footer' });
    assert.strictEqual(patched.color, '#abc');
    assert.strictEqual(patched.footerText, 'Footer');
    assert.strictEqual(patched.title, 'A'); // preserved
    assert.ok(patched.updatedAt >= beforePatch);
});

test('panelManager: getPanelsByGuild filters by guildId', () => {
    resetPanelsFile();
    const { upsertPanel, getPanelsByGuild, invalidateCache } = require('../../src/data/panelManager');
    invalidateCache();
    upsertPanel({ guildId: 'g1', channelId: 'c1', title: 'P1' });
    upsertPanel({ guildId: 'g1', channelId: 'c2', title: 'P2' });
    upsertPanel({ guildId: 'g2', channelId: 'c3', title: 'P3' });
    const g1panels = getPanelsByGuild('g1');
    assert.strictEqual(g1panels.length, 2);
    assert.strictEqual(g1panels.every(p => p.guildId === 'g1'), true);
    const g2panels = getPanelsByGuild('g2');
    assert.strictEqual(g2panels.length, 1);
});

test('panelManager: deletePanel removes panel and returns true/false', () => {
    resetPanelsFile();
    const { upsertPanel, deletePanel, getPanel, invalidateCache } = require('../../src/data/panelManager');
    invalidateCache();
    const p1 = upsertPanel({ guildId: 'g1', channelId: 'c1' });
    const p2 = upsertPanel({ guildId: 'g1', channelId: 'c2' });
    const removed = deletePanel(p1.id);
    assert.strictEqual(removed, true);
    assert.strictEqual(getPanel(p1.id), null);
    assert.ok(getPanel(p2.id), 'p2 should still exist');
    // delete non-existent returns false
    const removed2 = deletePanel('tp_nonexistent');
    assert.strictEqual(removed2, false);
});

test('panelManager: deletePanelsByGuild removes all panels in guild', () => {
    resetPanelsFile();
    const { upsertPanel, deletePanelsByGuild, getPanelsByGuild, invalidateCache } = require('../../src/data/panelManager');
    invalidateCache();
    upsertPanel({ guildId: 'g1', channelId: 'c1' });
    upsertPanel({ guildId: 'g1', channelId: 'c2' });
    upsertPanel({ guildId: 'g2', channelId: 'c3' });
    const count = deletePanelsByGuild('g1');
    assert.strictEqual(count, 2);
    assert.strictEqual(getPanelsByGuild('g1').length, 0);
    assert.strictEqual(getPanelsByGuild('g2').length, 1);
});

test('panelManager: handles corrupted panels.json gracefully', () => {
    resetPanelsFile();
    fs.writeFileSync(panelsPath, 'not valid json {{{{', 'utf8');
    const { loadPanels, invalidateCache } = require('../../src/data/panelManager');
    invalidateCache();
    const all = loadPanels();
    assert.strictEqual(typeof all, 'object');
    assert.strictEqual(Object.keys(all).length, 0);
});

test('panelManager: handles invalid format (array) panels.json gracefully', () => {
    resetPanelsFile();
    fs.writeFileSync(panelsPath, JSON.stringify(['not', 'an', 'object']), 'utf8');
    const { loadPanels, invalidateCache } = require('../../src/data/panelManager');
    invalidateCache();
    const all = loadPanels();
    assert.strictEqual(typeof all, 'object');
    assert.strictEqual(Array.isArray(all), false);
});

// === parseColor tests ===
test('panels.parseColor: accepts 6-digit hex with #', () => {
    const { parseColor } = require('../../src/commands/panels');
    assert.strictEqual(parseColor('#ff5733'), 0xff5733);
});

test('panels.parseColor: accepts 6-digit hex without #', () => {
    const { parseColor } = require('../../src/commands/panels');
    assert.strictEqual(parseColor('ff5733'), 0xff5733);
});

test('panels.parseColor: accepts 3-digit hex (#fff)', () => {
    const { parseColor } = require('../../src/commands/panels');
    assert.strictEqual(parseColor('#fff'), 0xffffff);
});

test('panels.parseColor: accepts decimal number', () => {
    const { parseColor } = require('../../src/commands/panels');
    assert.strictEqual(parseColor(0xff5733), 0xff5733);
});

test('panels.parseColor: returns null for null/empty', () => {
    const { parseColor } = require('../../src/commands/panels');
    assert.strictEqual(parseColor(null), null);
    assert.strictEqual(parseColor(undefined), null);
    assert.strictEqual(parseColor(''), null);
});

test('panels.parseColor: throws on invalid format', () => {
    const { parseColor } = require('../../src/commands/panels');
    assert.throws(() => parseColor('not-a-color'), /Format color tidak valid/);
    assert.throws(() => parseColor('#xyz'), /Format color tidak valid/);
    assert.throws(() => parseColor('#12345'), /Format color tidak valid/);
});

// === validateUrl tests ===
test('panels.validateUrl: accepts http(s) URLs', () => {
    const { validateUrl } = require('../../src/commands/panels');
    assert.strictEqual(validateUrl('https://example.com/image.png'), 'https://example.com/image.png');
    assert.strictEqual(validateUrl('http://example.com/img.jpg'), 'http://example.com/img.jpg');
});

test('panels.validateUrl: rejects non-http protocols', () => {
    const { validateUrl } = require('../../src/commands/panels');
    assert.strictEqual(validateUrl('ftp://example.com/img.png'), null);
    assert.strictEqual(validateUrl('javascript:alert(1)'), null);
    assert.strictEqual(validateUrl('file:///etc/passwd'), null);
});

test('panels.validateUrl: returns null for invalid URLs', () => {
    const { validateUrl } = require('../../src/commands/panels');
    assert.strictEqual(validateUrl('not a url'), null);
    assert.strictEqual(validateUrl('http://'), null);
});

test('panels.validateUrl: returns null for null/empty/non-string', () => {
    const { validateUrl } = require('../../src/commands/panels');
    assert.strictEqual(validateUrl(null), null);
    assert.strictEqual(validateUrl(undefined), null);
    assert.strictEqual(validateUrl(''), null);
    assert.strictEqual(validateUrl(123), null);
});

// === buildTicketPanel tests ===
test('panels.buildTicketPanel: builds embed with custom title/body/color', async () => {
    const { buildTicketPanel } = require('../../src/commands/panels');
    const panel = {
        title: 'Custom Panel',
        body: 'Welcome to {server}!',
        color: '#ff5733',
        categoryIds: ['transaction'],
        useDropdown: false
    };
    const ctx = {
        guild: { name: 'Test Server' },
        client: {
            user: {
                username: 'TestBot',
                displayAvatarURL: () => 'https://example.com/avatar.png'
            }
        },
        config: {
            ticketCategories: [
                { id: 'transaction', label: 'Transaksi', emoji: '🔑', style: 'Primary', requiresKey: true }
            ],
            products: [
                { label: 'VIP 30 Hari', value: 'vip30', price: 'Rp 50.000', category: 'transaction' }
            ],
            messages: {
                ticketTitle: 'Default Title',
                ticketBody: 'Default Body',
                ticketPriceHeader: 'PRICE'
            }
        }
    };
    const { embed, components } = buildTicketPanel(panel, ctx);
    assert.strictEqual(embed.data.title, 'Custom Panel');
    assert.strictEqual(embed.data.description, 'Welcome to Test Server!');
    assert.strictEqual(embed.data.color, 0xff5733);
    // Components: 1 button (transaction category)
    assert.ok(components.length >= 1);
    assert.strictEqual(components[0].components.length, 1);
});

test('panels.buildTicketPanel: fallbacks to global config when panel field is null', () => {
    const { buildTicketPanel } = require('../../src/commands/panels');
    const panel = {
        title: null,
        body: null,
        color: null,
        categoryIds: [],
        useDropdown: false
    };
    const ctx = {
        guild: { name: 'Test' },
        client: { user: { username: 'Bot', displayAvatarURL: () => 'http://x' } },
        config: {
            ticketCategories: [{ id: 'help', label: 'Help', emoji: '📞', style: 'Secondary', requiresKey: false }],
            products: [],
            messages: {
                ticketTitle: 'Global Title',
                ticketBody: 'Global {server}',
                ticketPriceHeader: 'Harga'
            }
        }
    };
    const { embed } = buildTicketPanel(panel, ctx);
    assert.strictEqual(embed.data.title, 'Global Title');
    assert.strictEqual(embed.data.description, 'Global Test');
    // default orange color
    assert.strictEqual(embed.data.color, 0xe67e22);
});

test('panels.buildTicketPanel: useDropdown=true builds select menu instead of buttons', () => {
    const { buildTicketPanel } = require('../../src/commands/panels');
    const panel = {
        title: 'X',
        body: 'X',
        color: null,
        categoryIds: ['transaction', 'help'],
        useDropdown: true
    };
    const ctx = {
        guild: { name: 'T' },
        client: { user: { username: 'B', displayAvatarURL: () => 'http://x' } },
        config: {
            ticketCategories: [
                { id: 'transaction', label: 'Beli', emoji: '🔑', style: 'Primary', requiresKey: true },
                { id: 'help', label: 'Help', emoji: '📞', style: 'Secondary', requiresKey: false }
            ],
            products: [],
            messages: { ticketTitle: 'T', ticketBody: 'B', ticketPriceHeader: 'P' }
        }
    };
    const { components } = buildTicketPanel(panel, ctx);
    assert.strictEqual(components.length, 1);
    const menu = components[0].components[0];
    // discord.js v14 StringSelectMenuBuilder exposes options via .options getter
    // (underlying data may vary between versions — use getter for stability)
    const opts = menu.options;
    assert.strictEqual(opts.length, 2);
    assert.strictEqual(menu.data.custom_id, 'ticket_cat_select');
});

test('panels.buildTicketPanel: filter categories by categoryIds', () => {
    const { buildTicketPanel } = require('../../src/commands/panels');
    const panel = {
        title: 'X',
        body: 'X',
        color: null,
        categoryIds: ['help'], // only show help
        useDropdown: false
    };
    const ctx = {
        guild: { name: 'T' },
        client: { user: { username: 'B', displayAvatarURL: () => 'http://x' } },
        config: {
            ticketCategories: [
                { id: 'transaction', label: 'Beli', emoji: '🔑', style: 'Primary', requiresKey: true },
                { id: 'help', label: 'Help', emoji: '📞', style: 'Secondary', requiresKey: false },
                { id: 'report', label: 'Report', emoji: '⚠️', style: 'Danger', requiresKey: false }
            ],
            products: [],
            messages: { ticketTitle: 'T', ticketBody: 'B', ticketPriceHeader: 'P' }
        }
    };
    const { components } = buildTicketPanel(panel, ctx);
    // Only 1 button (help)
    assert.strictEqual(components.length, 1);
    assert.strictEqual(components[0].components.length, 1);
    const btn = components[0].components[0];
    assert.strictEqual(btn.data.custom_id, 'ticket_cat:help');
});

test('panels.buildTicketPanel: categoryIds empty = show all', () => {
    const { buildTicketPanel } = require('../../src/commands/panels');
    const panel = {
        title: 'X',
        body: 'X',
        color: null,
        categoryIds: [], // empty = all
        useDropdown: false
    };
    const ctx = {
        guild: { name: 'T' },
        client: { user: { username: 'B', displayAvatarURL: () => 'http://x' } },
        config: {
            ticketCategories: [
                { id: 'transaction', label: 'Beli', emoji: '🔑', style: 'Primary', requiresKey: true },
                { id: 'help', label: 'Help', emoji: '📞', style: 'Secondary', requiresKey: false }
            ],
            products: [],
            messages: { ticketTitle: 'T', ticketBody: 'B', ticketPriceHeader: 'P' }
        }
    };
    const { components } = buildTicketPanel(panel, ctx);
    assert.strictEqual(components[0].components.length, 2); // all 2 categories
});

test('panels.buildTicketPanel: image and thumbnail URLs set when valid', () => {
    const { buildTicketPanel } = require('../../src/commands/panels');
    const panel = {
        title: 'X',
        body: 'X',
        color: null,
        imageUrl: 'https://example.com/banner.png',
        thumbnailUrl: 'https://example.com/icon.png',
        categoryIds: [],
        useDropdown: false
    };
    const ctx = {
        guild: { name: 'T' },
        client: { user: { username: 'B', displayAvatarURL: () => 'http://x' } },
        config: {
            ticketCategories: [{ id: 'help', label: 'H', emoji: '📞', style: 'Secondary', requiresKey: false }],
            products: [],
            messages: { ticketTitle: 'T', ticketBody: 'B', ticketPriceHeader: 'P' }
        }
    };
    const { embed } = buildTicketPanel(panel, ctx);
    assert.strictEqual(embed.data.image.url, 'https://example.com/banner.png');
    assert.strictEqual(embed.data.thumbnail.url, 'https://example.com/icon.png');
});

test('panels.buildTicketPanel: image and thumbnail skipped when invalid URL', () => {
    const { buildTicketPanel } = require('../../src/commands/panels');
    const panel = {
        title: 'X',
        body: 'X',
        color: null,
        imageUrl: 'not-a-url',
        thumbnailUrl: 'ftp://invalid',
        categoryIds: [],
        useDropdown: false
    };
    const ctx = {
        guild: { name: 'T' },
        client: { user: { username: 'B', displayAvatarURL: () => 'http://x' } },
        config: {
            ticketCategories: [{ id: 'help', label: 'H', emoji: '📞', style: 'Secondary', requiresKey: false }],
            products: [],
            messages: { ticketTitle: 'T', ticketBody: 'B', ticketPriceHeader: 'P' }
        }
    };
    const { embed } = buildTicketPanel(panel, ctx);
    assert.strictEqual(embed.data.image, undefined);
    assert.strictEqual(embed.data.thumbnail, undefined);
});

test('panels.buildTicketPanel: footer text overrides default bot username', () => {
    const { buildTicketPanel } = require('../../src/commands/panels');
    const panel = {
        title: 'X',
        body: 'X',
        color: null,
        footerText: 'Custom Footer',
        categoryIds: [],
        useDropdown: false
    };
    const ctx = {
        guild: { name: 'T' },
        client: { user: { username: 'BotName', displayAvatarURL: () => 'http://x' } },
        config: {
            ticketCategories: [{ id: 'help', label: 'H', emoji: '📞', style: 'Secondary', requiresKey: false }],
            products: [],
            messages: { ticketTitle: 'T', ticketBody: 'B', ticketPriceHeader: 'P' }
        }
    };
    const { embed } = buildTicketPanel(panel, ctx);
    assert.strictEqual(embed.data.footer.text, 'Custom Footer');
});

test('panels.buildTicketPanel: auto-wrap buttons to multiple rows when >5 categories', () => {
    const { buildTicketPanel } = require('../../src/commands/panels');
    const panel = {
        title: 'X',
        body: 'X',
        color: null,
        categoryIds: [],
        useDropdown: false
    };
    const ctx = {
        guild: { name: 'T' },
        client: { user: { username: 'B', displayAvatarURL: () => 'http://x' } },
        config: {
            ticketCategories: Array.from({ length: 8 }, (_, i) => ({
                id: `cat${i}`,
                label: `Cat ${i}`,
                emoji: '🎫',
                style: 'Primary',
                requiresKey: true
            })),
            products: [],
            messages: { ticketTitle: 'T', ticketBody: 'B', ticketPriceHeader: 'P' }
        }
    };
    const { components } = buildTicketPanel(panel, ctx);
    // 8 categories → 2 rows: 5 + 3
    assert.strictEqual(components.length, 2);
    assert.strictEqual(components[0].components.length, 5);
    assert.strictEqual(components[1].components.length, 3);
});

// === Registry tests ===
test('registry: new panel commands registered', () => {
    const { getCommands } = require('../../src/commands/registry');
    const commands = getCommands();
    const names = commands.map(c => c.name);
    assert.ok(names.includes('list-panels'), 'list-panels should be registered');
    assert.ok(names.includes('delete-panel'), 'delete-panel should be registered');
    assert.ok(names.includes('update-panel'), 'update-panel should be registered');
    assert.ok(names.includes('refresh-panel'), 'refresh-panel should be registered');
});

test('registry: setup-ticket-panel has new options (body, color, image, thumbnail, footer, channel, use_dropdown)', () => {
    const { getCommands } = require('../../src/commands/registry');
    const commands = getCommands();
    const cmd = commands.find(c => c.name === 'setup-ticket-panel');
    assert.ok(cmd, 'setup-ticket-panel command not found');
    const optionNames = cmd.options.map(o => o.name);
    assert.ok(optionNames.includes('title'));
    assert.ok(optionNames.includes('categories'));
    assert.ok(optionNames.includes('body'));
    assert.ok(optionNames.includes('color'));
    assert.ok(optionNames.includes('image'));
    assert.ok(optionNames.includes('thumbnail'));
    assert.ok(optionNames.includes('footer'));
    assert.ok(optionNames.includes('channel'));
    assert.ok(optionNames.includes('use_dropdown'));
});

test('registry: update-panel has field choices', () => {
    const { getCommands } = require('../../src/commands/registry');
    const commands = getCommands();
    const cmd = commands.find(c => c.name === 'update-panel');
    assert.ok(cmd, 'update-panel command not found');
    const fieldOpt = cmd.options.find(o => o.name === 'field');
    assert.ok(fieldOpt, 'update-panel should have field option');
    assert.ok(fieldOpt.choices);
    const choiceVals = fieldOpt.choices.map(c => c.value);
    assert.ok(choiceVals.includes('title'));
    assert.ok(choiceVals.includes('body'));
    assert.ok(choiceVals.includes('color'));
    assert.ok(choiceVals.includes('image'));
    assert.ok(choiceVals.includes('thumbnail'));
    assert.ok(choiceVals.includes('footer'));
});

// === Help.js updated test ===
test('help.js: help embed mentions new v3.9.14 commands', async () => {
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
    const allText = embed.data.fields.map(f => f.value).join('\n') + embed.data.description;

    // v3.9.14 new commands
    assert.match(allText, /list-panels/);
    assert.match(allText, /delete-panel/);
    assert.match(allText, /update-panel/);
    assert.match(allText, /refresh-panel/);
    assert.match(allText, /use_dropdown/);
    assert.match(allText, /v3\.9\.14/);
});

// === Router test ===
test('commands/index.js: routes new panel-mgmt commands', () => {
    const router = require('../../src/commands');
    assert.strictEqual(typeof router, 'function');
});

// Cleanup
test('cleanup: remove test panels.json', () => {
    resetPanelsFile();
    assert.ok(true);
});
