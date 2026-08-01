/**
 * Command Router — distribusi slash command ke handler per-domain.
 *
 * Arsitektur (v3.9.9 refactor):
 *   Slash command dipisah per file domain di src/commands/<domain>.js.
 *   Router ini cek permission (admin/public), lalu panggil handler domain.
 *
 * Domain mapping:
 *   - help         → help.js
 *   - config-*     → config.js (set-role, set-channel, set-message, config-show, dll)
 *   - *-product*   → products.js
 *   - *-key*, *-schedule → keys.js
 *   - *-selfrole*  → selfrole.js
 *   - announce*    → announce.js
 *   - embed-*      → embed.js
 *   - backup-*     → backup.js
 *   - giveaway     → giveaway.js
 *   - warn*        → warn.js
 *   - stats, leaderboard, my-stats → stats.js
 *   - poll         → poll.js
 *   - *-tempvoice  → tempvoice.js
 *   - send-message → send-message.js
 *
 * Status: dalam proses migrasi. Selama migrasi, command yang belum di-split
 * akan fallback ke handlers/commandHandler.js (legacy). Setelah semua domain
 * di-split, fallback dihapus dan handlers/ di-deprecate.
 */

const { MessageFlags } = require('discord.js');
const { isAdmin: checkIsAdmin } = require('../infra/permissions');

// Domain handlers — akan diisi satu per satu selama migrasi.
// Untuk sekarang, semua belum ada → fallback ke handler lama.
const DOMAIN_HANDLERS = {
    // 'help': require('./help'),
    // 'config': require('./config'),
    // 'products': require('./products'),
    // 'keys': require('./keys'),
    // 'selfrole': require('./selfrole'),
    // 'announce': require('./announce'),
    // 'embed': require('./embed'),
    // 'backup': require('./backup'),
    // 'giveaway': require('./giveaway'),
    // 'warn': require('./warn'),
    // 'stats': require('./stats'),
    // 'poll': require('./poll'),
    // 'tempvoice': require('./tempvoice'),
    // 'send-message': require('./send-message'),
};

// Command yang boleh dipakai member biasa (bukan admin).
const PUBLIC_COMMANDS = ['leaderboard', 'my-stats'];

// Mapping commandName → domain (diisi saat domain handler dibuat).
const COMMAND_TO_DOMAIN = {
    // 'help': 'help',
    // 'setup-verify': 'config',
    // ...
};

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
    if (domain && DOMAIN_HANDLERS[domain]) {
        return DOMAIN_HANDLERS[domain](interaction);
    }

    // === FALLBACK: legacy handler ===
    // Selama migrasi, command yang belum di-split tetap pakai handler lama.
    const legacyHandler = require('../../handlers/commandHandler');
    return legacyHandler(interaction);
}

module.exports = routeCommand;
