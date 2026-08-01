/**
 * Command Router — distribusi slash command ke handler per-domain.
 *
 * Arsitektur (v3.9.9 refactor):
 *   Slash command dipisah per file domain di src/commands/<domain>.js.
 *   Router ini cek permission (admin/public), lalu panggil handler domain.
 *
 * Domain mapping:
 *   - help                                → help.js
 *   - setup-verify, setup-ticket,
 *     set-role, set-channel, set-message,
 *     remove-role, remove-channel,
 *     list-messages, reset-message,
 *     reset-config, config-show          → config.js
 *   - add-product, remove-product,
 *     list-products, set-product-role,
 *     remove-product-role,
 *     list-product-roles                 → products.js
 *   - set-key, list-keys, clear-schedule → keys.js
 *   - setup-selfrole, selfrole-add,
 *     selfrole-remove, selfrole-list,
 *     selfrole-delete                    → selfrole.js
 *   - announce, announce-schedule,
 *     announce-list, announce-cancel     → announce.js
 *   - embed-builder, embed-list,
 *     embed-cancel                       → embed.js
 *   - backup-now, backup-list,
 *     restore-backup                     → backup.js
 *   - giveaway                           → giveaway.js
 *   - warn, warn-list, warn-remove,
 *     warn-clear                         → warn.js
 *   - stats, leaderboard, my-stats       → stats.js
 *   - poll                               → poll.js
 *   - setup-tempvoice, tempvoice-remove  → tempvoice.js
 *   - send-message                       → send-message.js
 *
 * Status: FULL SPLIT (v3.9.9). Semua command sudah di-domain-kan.
 * handlers/commandHandler.js di-deprecate — tidak dipakai router ini lagi.
 */

const { MessageFlags } = require('discord.js');
const { isAdmin: checkIsAdmin } = require('../infra/permissions');

// === Domain handlers ===
// Tiap file export satu async function (interaction) → void.
const helpHandler        = require('./help');
const configHandler      = require('./config');
const productsHandler    = require('./products');
const keysHandler        = require('./keys');
const selfroleHandler    = require('./selfrole');
const announceHandler    = require('./announce');
const embedHandler       = require('./embed');
const backupHandler      = require('./backup');
const giveawayHandler    = require('./giveaway');
const warnHandler        = require('./warn');
const statsHandler       = require('./stats');
const pollHandler        = require('./poll');
const tempvoiceHandler   = require('./tempvoice');
const sendMessageHandler = require('./send-message');
// v3.9.11 Phase 2 & 3: new domains
const categoriesHandler  = require('./categories');
const panelsHandler      = require('./panels');

const DOMAIN_HANDLERS = {
    help: helpHandler,
    config: configHandler,
    products: productsHandler,
    keys: keysHandler,
    selfrole: selfroleHandler,
    announce: announceHandler,
    embed: embedHandler,
    backup: backupHandler,
    giveaway: giveawayHandler,
    warn: warnHandler,
    stats: statsHandler,
    poll: pollHandler,
    tempvoice: tempvoiceHandler,
    'send-message': sendMessageHandler,
    // v3.9.11 Phase 2 & 3
    categories: categoriesHandler,
    panels: panelsHandler
};

// Mapping commandName → domain key (di DOMAIN_HANDLERS).
const COMMAND_TO_DOMAIN = {
    // help
    'help': 'help',

    // config
    'setup-verify': 'config',
    'setup-ticket': 'config',
    'set-role': 'config',
    'set-channel': 'config',
    'set-message': 'config',
    'remove-role': 'config',
    'remove-channel': 'config',
    'list-messages': 'config',
    'reset-message': 'config',
    'reset-config': 'config',
    'config-show': 'config',
    // v3.9.12: modal editor untuk message config
    'edit-message': 'config',

    // products
    'add-product': 'products',
    'remove-product': 'products',
    'list-products': 'products',
    'set-product-role': 'products',
    'remove-product-role': 'products',
    'list-product-roles': 'products',

    // keys
    'set-key': 'keys',
    'list-keys': 'keys',
    'clear-schedule': 'keys',

    // selfrole
    'setup-selfrole': 'selfrole',
    'selfrole-add': 'selfrole',
    'selfrole-remove': 'selfrole',
    'selfrole-list': 'selfrole',
    'selfrole-delete': 'selfrole',

    // announce
    'announce': 'announce',
    'announce-schedule': 'announce',
    'announce-list': 'announce',
    'announce-cancel': 'announce',

    // embed
    'embed-builder': 'embed',
    'embed-list': 'embed',
    'embed-cancel': 'embed',

    // backup
    'backup-now': 'backup',
    'backup-list': 'backup',
    'restore-backup': 'backup',

    // giveaway
    'giveaway': 'giveaway',

    // warn
    'warn': 'warn',
    'warn-list': 'warn',
    'warn-remove': 'warn',
    'warn-clear': 'warn',

    // stats
    'stats': 'stats',
    'leaderboard': 'stats',
    'my-stats': 'stats',

    // poll
    'poll': 'poll',

    // tempvoice
    'setup-tempvoice': 'tempvoice',
    'tempvoice-remove': 'tempvoice',

    // send-message
    'send-message': 'send-message',

    // v3.9.11 Phase 2: categories
    'add-category': 'categories',
    'list-categories': 'categories',
    'remove-category': 'categories',

    // v3.9.11 Phase 1 & 3: panels (verify button, multi-panel ticket, transcript)
    'set-verify-button': 'panels',
    'setup-ticket-panel': 'panels',
    'set-transcript-channel': 'panels'
};

// Command yang boleh dipakai member biasa (bukan admin).
const PUBLIC_COMMANDS = ['leaderboard', 'my-stats'];

/**
 * Router utama — dipanggil dari index.js saat InteractionCreate (chatInputCommand).
 */
async function routeCommand(interaction) {
    if (!interaction.isChatInputCommand()) return;

    // === PERMISSION CHECK ===
    if (!checkIsAdmin(interaction.member) && !PUBLIC_COMMANDS.includes(interaction.commandName)) {
        return interaction.reply({
            content: '🚫 **Akses Ditolak.**\n\nSlash command hanya bisa dipakai oleh **Admin/Staff**.\n\nKalau kamu merasa ini salah, hubungi server admin.',
            flags: MessageFlags.Ephemeral
        });
    }

    // === DOMAIN DISPATCH ===
    const domain = COMMAND_TO_DOMAIN[interaction.commandName];
    const handler = domain ? DOMAIN_HANDLERS[domain] : null;
    if (handler) {
        return handler(interaction);
    }

    // Unknown command — kirim ephemeral error supaya admin tahu command belum didukung.
    // (Sebelumnya fallback ke handlers/commandHandler.js — sekarang sudah FULL SPLIT,
    //  jadi gak ada command yang harusnya lewat sini kecuali ada command baru yang
    //  belum di-map di COMMAND_TO_DOMAIN.)
    console.warn(`[router] Unmapped command: ${interaction.commandName}`);
    if (interaction.deferred || interaction.replied) return;
    return interaction.reply({
        content: `⚠️ Command \`${interaction.commandName}\` belum didukung oleh router. Hubungi dev.`,
        flags: MessageFlags.Ephemeral
    });
}

module.exports = routeCommand;
