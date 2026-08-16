/**
 * Domain: help
 * Slash commands: /help
 *
 * v3.9.12: Update komprehensif — refleksikan semua command baru dari Phase 1+2+3
 * + modal editor untuk message config + ticket body template variables.
 */

const { EmbedBuilder, MessageFlags } = require('./_shared');

module.exports = async function (interaction) {
    const helpEmbed = new EmbedBuilder()
        .setTitle('🤖 COMMUNITY BOT — HELP')
        .setDescription(
            `Halo ${interaction.user}! Anda terverifikasi sebagai **Admin/Staff**.\n` +
                `Berikut daftar lengkap command yang tersedia (v3.9.18).`
        )
        .setColor(0x5865f2)
        .addFields(
            {
                name: '📋 Informasi',
                value: [
                    '• `/help` — tampilkan pesan bantuan ini',
                    '• `/list-products` — lihat semua produk',
                    '• `/list-categories` — lihat semua kategori tiket',
                    '• `/list-messages` — lihat semua teks pesan embed',
                    '• `/config-show` — lihat semua konfigurasi bot'
                ].join('\n'),
                inline: false
            },

            {
                name: '🏗️ Panel Tiket (Multi-Panel)',
                value: [
                    '• `/setup-verify` — pasang panel verifikasi',
                    '• `/setup-ticket` — pasang panel tiket (legacy)',
                    '• `/setup-ticket-panel` — panel multi-panel penuh:',
                    '   opsi: `title` `body` `color:#ff5733` `image` `thumbnail` `footer` `categories` `channel` `use_dropdown`',
                    '• `/list-panels` `/update-panel` `/refresh-panel` `/delete-panel`',
                    '• `/set-verify-button` — kustomisasi tombol verifikasi',
                    '💡 Multi-panel = tiap panel custom sendiri. Disimpan ke panels.json.'
                ].join('\n'),
                inline: false
            },

            {
                name: '🎫 Kategori Tiket (CRUD)',
                value: [
                    '• `/add-category id:jasa label:"Jasa" emoji:🎮 style:Success requires_key:false`',
                    '• `/list-categories` — lihat semua kategori',
                    '• `/remove-category id:jasa` — hapus kategori (default dilindungi)'
                ].join('\n'),
                inline: false
            },

            {
                name: '💬 Auto-Responder',
                value: [
                    '• `/add-responder` `/list-responder` `/remove-responder`',
                    '💡 Member kirim trigger → bot auto-reply. Cocok untuk FAQ.'
                ].join('\n'),
                inline: false
            },

            {
                name: '🛡️ Anti-Spam & Auto-Mod',
                value: [
                    '• `/set-automod` `/automod-show` `/automod-toggle` `/add-link-whitelist`',
                    '💡 Auto-detect: spam, link, kata kasar, mass-mention → auto-action'
                ].join('\n'),
                inline: false
            },

            {
                name: '💤 AFK System',
                value: [
                    '• `/afk` `/afk-clear` `/afk-list`',
                    '💡 Bot auto-reply saat user AFK di-mention.'
                ].join('\n'),
                inline: false
            },

            {
                name: '📊 Leveling System',
                value: [
                    '• `/setup-leveling` `/add-level-role` `/list-level-roles` `/remove-level-role`',
                    '• `/rank` `/leaderboard-level` (public)',
                    '💡 XP per message, level up → auto-assign role.'
                ].join('\n'),
                inline: false
            },

            {
                name: '🎭 Atur Role',
                value: [
                    '• `/set-role verified @role` — set role (verified/unverified/admin)',
                    '• `/remove-role verified` — hapus role dari config'
                ].join('\n'),
                inline: false
            },

            {
                name: '📢 Atur Channel & Auto-Split Tiket',
                value: [
                    '• `/set-channel welcome #ch` — set (welcome/goodbye/invoice/audit-log/transcript)',
                    '• `/set-transcript-channel #ch` — auto-save transcript tiket sebelum close',
                    '• `/remove-channel welcome` — hapus channel dari config',
                    '',
                    '**🎫 Auto-Split:** Bot pisah tiket jadi 2 kategori otomatis:',
                    '• **`🎫 TRANSAKSI`** — tiket pakai key (ada tombol Set Key)',
                    '• **`🎫 BANTUAN`** — tiket help/report/claim_giveaway/dll (requiresKey=false)',
                    'Custom nama? Edit `data/config.json`: `ticketCategoryKey`, `ticketCategoryNoKey`'
                ].join('\n'),
                inline: false
            },

            {
                name: '✏️ Atur Pesan Embed',
                value: [
                    '• `/set-message ticketBody teks...` (cepat, 1-line)',
                    '• `/edit-message tipe:"Ticket Body"` → buka modal editor multi-line',
                    '• `/reset-message ticketBody` / `/reset-message ALL`',
                    '',
                    '**Template vars:** `{server}` `{price_header}` `{price_list}` `{price_list:cat}` `{categories_list}`'
                ].join('\n'),
                inline: false
            },

            {
                name: '📦 Produk & Auto-Role',
                value: [
                    '• `/add-product` `/remove-product` `/list-products`',
                    '• `/set-product-role` `/remove-product-role` `/list-product-roles`',
                    '💡 VIP role + auto-expire (days)'
                ].join('\n'),
                inline: false
            },

            {
                name: '🔑 Key Manager',
                value: [
                    '• `/set-key user:@user value:vip30 key:ABCDE-12345`',
                    '• `/list-keys user:@user`',
                    '• `/clear-schedule user:@user clear_keys:true`'
                ].join('\n'),
                inline: false
            },

            {
                name: '🎭 Self-Role Panel',
                value: [
                    '• `/setup-selfrole title:... type:button exclusive:false`',
                    '• `/selfrole-add` `/selfrole-remove` `/selfrole-list` `/selfrole-delete`',
                    '💡 `requires_role:@Verified` — conditional role'
                ].join('\n'),
                inline: false
            },

            {
                name: '🎤 Temp Voice',
                value: [
                    '• `/setup-tempvoice` / `/tempvoice-remove`',
                    '💡 Member join trigger channel → otomatis bikin voice pribadi'
                ].join('\n'),
                inline: false
            },

            {
                name: '📢 Announce, Embed & Backup',
                value: [
                    '• `/announce channel:#ch title:... description:...`',
                    '• `/send-message` `/embed-builder` `/embed-list` `/embed-cancel`',
                    '• `/backup-now` `/backup-list` `/restore-backup` (auto 24h, max 7)'
                ].join('\n'),
                inline: false
            },

            {
                name: '🎉 Giveaway & Poll',
                value: [
                    '• `/giveaway create channel:#ch prize:... winners:1 duration:60`',
                    '• `/giveaway list` `/giveaway end` `/giveaway reroll`',
                    '• `/poll create` `/poll list` `/poll close`'
                ].join('\n'),
                inline: false
            },

            {
                name: '⏰ Scheduled Announce & Warn',
                value: [
                    '• `/announce-schedule channel:#ch at:30m recurring?:daily`',
                    '• `/announce-list` `/announce-cancel`',
                    '• `/warn` `/warn-list` `/warn-remove` `/warn-clear` (3=mute1h, 5=mute1d, 7=kick)'
                ].join('\n'),
                inline: false
            },

            {
                name: '📊 Stats & Lainnya',
                value: [
                    '• `/stats` `/leaderboard metric:messages|vipPurchases|totalSpent` `/my-stats`',
                    '• `/set-channel audit-log #ch` — catat admin action',
                    '• `/reset-config` — ⚠️ HAPUS SEMUA setting (konfirmasi 2-step)'
                ].join('\n'),
                inline: false
            }
        )
        .setFooter({
            text: `${interaction.client.user.username} v3.9.18 — All-in-One Community Bot`,
            iconURL: interaction.client.user.displayAvatarURL({ dynamic: true })
        })
        .setTimestamp();

    return interaction.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral });
};
