/**
 * Interaction Router — distribusi button/select-menu/modal ke handler per-domain.
 *
 * Arsitektur (v3.9.9 refactor):
 *   customId dipisah berdasarkan prefix → handler domain terpisah.
 *
 * Prefix mapping:
 *   - btn_verify                   → verify.js
 *   - ticket_trade, select_product, ticket_set_key, ticket_close, modal_set_key → ticket.js
 *   - sr_btn:, sr_sel:             → selfrole.js
 *   - emb_edit:, emb_preview:, emb_send:, emb_cancel, modal_emb_* → embed.js
 *   - gw_join:, gw_leave:          → giveaway.js
 *   - poll_vote:, modal_poll_create → poll.js
 *   - tv_*, modal_tv_*             → tempvoice.js
 *   - reset_config_confirm, restore_backup_confirm → backup.js
 *
 * Status: dalam proses migrasi. customId yang belum di-split fallback ke
 * handlers/interactionHandler.js (legacy).
 */

// Domain handlers — akan diisi satu per satu selama migrasi.
const DOMAIN_HANDLERS = {
    // 'verify': require('./verify'),
    // 'ticket': require('./ticket'),
    // 'selfrole': require('./selfrole'),
    // 'embed': require('./embed'),
    // 'giveaway': require('./giveaway'),
    // 'poll': require('./poll'),
    // 'tempvoice': require('./tempvoice'),
    // 'backup': require('./backup'),
};

// Mapping customId prefix → domain.
const PREFIX_TO_DOMAIN = [
    // { prefix: 'btn_verify', domain: 'verify' },
    // { prefix: 'ticket_', domain: 'ticket' },
    // { prefix: 'select_product', domain: 'ticket' },
    // { prefix: 'modal_set_key', domain: 'ticket' },
    // { prefix: 'sr_btn:', domain: 'selfrole' },
    // { prefix: 'sr_sel:', domain: 'selfrole' },
    // { prefix: 'emb_', domain: 'embed' },
    // { prefix: 'modal_emb_', domain: 'embed' },
    // { prefix: 'gw_join:', domain: 'giveaway' },
    // { prefix: 'gw_leave:', domain: 'giveaway' },
    // { prefix: 'poll_vote:', domain: 'poll' },
    // { prefix: 'modal_poll_create', domain: 'poll' },
    // { prefix: 'tv_', domain: 'tempvoice' },
    // { prefix: 'modal_tv_', domain: 'tempvoice' },
    // { prefix: 'reset_config_confirm', domain: 'backup' },
    // { prefix: 'restore_backup_confirm', domain: 'backup' },
];

/**
 * Router utama — dipanggil dari index.js saat InteractionCreate (button/select/modal).
 */
async function routeInteraction(interaction) {
    if (interaction.isChatInputCommand()) return; // slash command → command router
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

    // Cek domain berdasarkan customId prefix
    const customId = interaction.customId || '';
    for (const { prefix, domain } of PREFIX_TO_DOMAIN) {
        if (customId.startsWith(prefix) && DOMAIN_HANDLERS[domain]) {
            return DOMAIN_HANDLERS[domain](interaction);
        }
    }

    // === FALLBACK: legacy handler ===
    const legacyHandler = require('../../handlers/interactionHandler');
    return legacyHandler(interaction);
}

module.exports = routeInteraction;
