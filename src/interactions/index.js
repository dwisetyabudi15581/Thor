/**
 * Interaction Router — distribusi button/select-menu/modal ke handler per-domain.
 *
 * Arsitektur (v3.9.9 refactor):
 *   customId dipisah berdasarkan prefix → handler domain terpisah.
 *
 * Prefix mapping (semua prefix di sini SEKARANG punya handler aktif —
 * fallback ke legacy `handlers/interactionHandler.js` DIHAPUS):
 *   - btn_verify                              → verify.js      (exact match)
 *   - ticket_, select_product, modal_set_key: → ticket.js
 *   - sr_btn:, sr_sel:                        → selfrole.js
 *   - emb_edit:, emb_preview:, emb_send:,
 *     emb_cancel:, emb_modal_                 → embed.js
 *   - gw_join:, gw_leave:                     → giveaway.js
 *   - poll_vote:, poll_modal_create:          → poll.js
 *   - tv_, tv_modal_                          → tempvoice.js
 *   - reset_config_, restore_backup_          → backup.js
 *
 * Router meng-apply di sini (BUKAN di domain handler):
 *   1. Dedup interaction ID (checkAndMark) — pertahanan terhadap Discord retry.
 *   2. Guard `replied/deferred` — interaction yang sudah reply/defer tidak diproses ulang.
 *   3. Filter tipe interaction (button/select/modal only).
 *   4. Routing by customId prefix.
 */

const { checkAndMark } = require('./_dedup');

// Domain handlers — masing-masing export `async function(interaction)`.
const verifyDomain = require('./verify');
const ticketDomain = require('./ticket');
const selfroleDomain = require('./selfrole');
const embedDomain = require('./embed');
const giveawayDomain = require('./giveaway');
const pollDomain = require('./poll');
const tempvoiceDomain = require('./tempvoice');
const backupDomain = require('./backup');
const configDomain = require('./config');

// Mapping customId prefix → domain.
// Diurutkan dari paling spesifik ke paling umum (startsWith cocok dengan prefix
// pertama yang match). `select_product` ditaruh sebelum `ticket_` karena keduanya
// distinct prefix, tidak overlap — tapi tetap defensive untuk urutan.
//
// `btn_verify` di-handle exact-match (lihat helper `pickDomain`).
const PREFIX_TO_DOMAIN = [
    { prefix: 'btn_verify', domain: 'verify', exact: true },
    { prefix: 'select_product', domain: 'ticket' },
    { prefix: 'modal_set_key:', domain: 'ticket' },
    { prefix: 'modal_edit_message:', domain: 'config' },
    { prefix: 'ticket_', domain: 'ticket' },
    { prefix: 'sr_btn:', domain: 'selfrole' },
    { prefix: 'sr_sel:', domain: 'selfrole' },
    { prefix: 'emb_edit:', domain: 'embed' },
    { prefix: 'emb_preview:', domain: 'embed' },
    { prefix: 'emb_send:', domain: 'embed' },
    { prefix: 'emb_cancel:', domain: 'embed' },
    { prefix: 'emb_modal_', domain: 'embed' },
    { prefix: 'gw_join:', domain: 'giveaway' },
    { prefix: 'gw_leave:', domain: 'giveaway' },
    { prefix: 'poll_vote:', domain: 'poll' },
    { prefix: 'poll_modal_create:', domain: 'poll' },
    { prefix: 'tv_modal_', domain: 'tempvoice' },
    { prefix: 'tv_', domain: 'tempvoice' },
    { prefix: 'reset_config_', domain: 'backup' },
    { prefix: 'restore_backup_', domain: 'backup' },
];

const DOMAIN_HANDLERS = {
    verify: verifyDomain,
    ticket: ticketDomain,
    selfrole: selfroleDomain,
    embed: embedDomain,
    giveaway: giveawayDomain,
    poll: pollDomain,
    tempvoice: tempvoiceDomain,
    backup: backupDomain,
    config: configDomain,
};

/**
 * Pilih domain handler berdasarkan customId.
 * Mengembalikan function atau `null` kalau tidak ada match.
 */
function pickDomain(customId) {
    if (!customId) return null;
    for (const entry of PREFIX_TO_DOMAIN) {
        if (entry.exact) {
            if (customId === entry.prefix) return DOMAIN_HANDLERS[entry.domain];
        } else {
            if (customId.startsWith(entry.prefix)) return DOMAIN_HANDLERS[entry.domain];
        }
    }
    return null;
}

/**
 * Router utama — dipanggil dari src/bot/events/interactionCreate.js
 * saat InteractionCreate (button/select/modal).
 *
 * v3.9.8 FIX: dedup + replied/deferred guard di-apply DI SINI (bukan di
 * domain handler) supaya domain handler bisa fokus ke logic-nya saja dan
 * interaction selalu fresh saat di-dispatch.
 */
async function routeInteraction(interaction) {
    if (interaction.isChatInputCommand()) return; // slash command → command router
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

    // P1-6 FIX: cek duplikat interaction ID dulu (defense-in-depth).
    // Discord kadang fire event yang sama 2x kalau ada retry.
    // v3.9.8: kalau entry ada tapi udah lebih dari TTL, anggap belum diproses.
    if (checkAndMark(interaction.id)) {
        return;
    }

    // Guard: skip kalau interaction sudah replied/deferred.
    // Modal submit yang sudah replied = ANGGAP SUDAH DIPROSES, jangan lanjut.
    if (interaction.replied || interaction.deferred) {
        return;
    }

    // Cek domain berdasarkan customId prefix
    const handler = pickDomain(interaction.customId || '');
    if (handler) {
        return handler(interaction);
    }

    // v3.9.9 refactor: fallback ke legacy handler DIHAPUS. Semua customId yang
    // seharusnya tertangani sudah punya domain. Kalau sampai sini, berarti
    // interaction tidak dikenali — log warning supaya kelihatan kalau ada
    // customId baru yang belum di-route (defensive observability).
    console.warn(`[interactionRouter] customId tidak dikenali (no domain match): ${interaction.customId}`);
}

module.exports = routeInteraction;
