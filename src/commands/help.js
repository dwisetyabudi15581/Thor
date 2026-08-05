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
                `Berikut daftar lengkap command yang tersedia (v3.9.13).`
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
                name: '🏗️ Panel Setup (Verifikasi & Tiket)',
                value: [
                    '• `/setup-verify` — pasang panel verifikasi (button customizable)',
                    '• `/setup-ticket` — pasang panel tiket (auto-render tombol per kategori)',
                    '• `/setup-ticket-panel title:... categories:cat1,cat2` — panel tiket dengan subset kategori (multi-panel)',
                    '• `/set-verify-button label:"Saya Bukan Bot" emoji:🤖 style:Secondary` — kustomisasi tombol verifikasi'
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
                name: '💬 Auto-Responder (v3.9.13 BARU)',
                value: [
                    '• `/add-responder trigger:"!sosmed" reply:"IG: @server\nTikTok: @server"`',
                    '• `/list-responder` — lihat semua responder',
                    '• `/remove-responder trigger:"!sosmed"` — hapus responder',
                    '💡 Member kirim pesan diawali trigger → bot auto-reply. Cocok untuk FAQ.'
                ].join('\n'),
                inline: false
            },

            {
                name: '🛡️ Anti-Spam & Auto-Mod (v3.9.13 BARU)',
                value: [
                    '• `/set-automod spam_threshold:5 spam_action:mute_10m block_links:true block_words:"kata1,kata2"`',
                    '• `/automod-show` — lihat config saat ini',
                    '• `/automod-toggle enabled:true` — enable/disable',
                    '• `/add-link-whitelist channel:#spam-role` — whitelist channel/role untuk link',
                    '💡 Auto-detect: spam, link, kata kasar, mass-mention → auto-action'
                ].join('\n'),
                inline: false
            },

            {
                name: '💤 AFK System (v3.9.13 BARU)',
                value: [
                    '• `/afk reason:"Makan dulu, 30 menit"` — set AFK',
                    '• `/afk-clear` — clear AFK status',
                    '• `/afk-list` — lihat semua member AFK (admin)',
                    '💡 Bot auto-reply saat ada yang mention user AFK. Auto-clear saat user chat lagi.'
                ].join('\n'),
                inline: false
            },

            {
                name: '📊 Leveling System (v3.9.13 BARU)',
                value: [
                    '• `/setup-leveling enabled:true xp_per_message:15 cooldown:60`',
                    '• `/add-level-role level:10 role:@Active` — role reward untuk level tertentu',
                    '• `/list-level-roles` — lihat semua level role',
                    '• `/remove-level-role level:10` — hapus level role',
                    '• `/rank` — lihat level & XP kamu (public)',
                    '• `/leaderboard-level` — top 10 member (public)',
                    '💡 XP per message (cooldown anti-spam). Level up → announce + auto-assign role.'
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
                name: '📢 Atur Channel & Kategori Tiket',
                value: [
                    '• `/set-channel welcome #channel` — set channel (welcome/goodbye/invoice/audit-log/transcript)',
                    '• `/set-transcript-channel #channel` — auto-save transcript tiket sebelum close',
                    '• `/remove-channel welcome` — hapus channel dari config',
                    '',
                    '**🎫 Auto-Split Tiket:** Bot otomatis pisah channel tiket jadi 2 kategori:',
                    '• **`🎫 TRANSAKSI`** — tiket yang pakai key (ada tombol Set Key)',
                    '• **`🎫 BANTUAN`** — tiket help/report (tanpa tombol Set Key)',
                    'Kategori dibuat otomatis. Mau custom nama? Edit `data/config.json`:',
                    '```',
                    '"ticketCategoryKey": "🎫 JUALAN",',
                    '"ticketCategoryNoKey": "🎫 SUPPORT"',
                    '```'
                ].join('\n'),
                inline: false
            },

            {
                name: '✏️ Atur Pesan Embed (3 cara!)',
                value: [
                    '**Cara 1 — `/set-message`** (cepat, 1-line):',
                    '• `/set-message ticketBody teks...`',
                    '**Cara 2 — `/edit-message`** (modal multi-line, lebih flexible):',
                    '• `/edit-message tipe:"Ticket Body"` → buka modal editor',
                    '**Cara 3 — `/reset-message`** (kembalikan ke default):',
                    '• `/reset-message ticketBody` — reset 1 pesan',
                    '• `/reset-message ALL` — reset semua pesan'
                ].join('\n'),
                inline: false
            },

            {
                name: '📝 Variabel Pesan (template)',
                value: [
                    '**Welcome/Goodbye:** `{user}` `{username}` `{server}` `{count}` `{action}`',
                    '**Ticket Body:**',
                    '• `{server}` `{price_header}` `{price_list}` `{price_list:transaction}` `{categories_list}`'
                ].join('\n'),
                inline: false
            },

            {
                name: '📦 Manajemen Produk',
                value: [
                    '• `/add-product label:"VIP 30 Hari" value:vip30 price:"Rp 50.000" category:transaction requires_key:true`',
                    '• `/remove-product value:vip30`',
                    '• `/list-products`'
                ].join('\n'),
                inline: false
            },

            {
                name: '🎁 Auto-Role Produk (VIP role + auto-expire)',
                value: [
                    '• `/set-product-role value:vip30 role:@VIP days:30`',
                    '• `/remove-product-role value:vip30`',
                    '• `/list-product-roles`'
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
                    '• `/selfrole-add panel_id:sr_xxx role:@Gamer label:Gamer style:Primary`',
                    '• `/selfrole-add panel_id:sr_xxx role:@Booster label:Booster requires_role:@Verified` — **conditional**',
                    '• `/selfrole-remove` / `/selfrole-list` / `/selfrole-delete`'
                ].join('\n'),
                inline: false
            },

            {
                name: '🎤 Temp Voice',
                value: [
                    '• `/setup-tempvoice` / `/tempvoice-remove`',
                    '💡 Member join "🔊 Buat Voice" → otomatis bikin voice pribadi'
                ].join('\n'),
                inline: false
            },

            {
                name: '📢 Announce & Embed Builder',
                value: [
                    '• `/announce channel:#ch title:... description:...`',
                    '• `/send-message channel:#ch message:...`',
                    '• `/embed-builder` / `/embed-list` / `/embed-cancel`'
                ].join('\n'),
                inline: false
            },

            {
                name: '💾 Backup System',
                value: [
                    '• `/backup-now` / `/backup-list` / `/restore-backup`',
                    '💡 Auto-backup tiap 24 jam. Maks 7 backup.'
                ].join('\n'),
                inline: false
            },

            {
                name: '🎉 Giveaway System',
                value: [
                    '• `/giveaway create channel:#ch prize:... winners:1 duration:60`',
                    '• `/giveaway list` / `/giveaway end` / `/giveaway reroll`'
                ].join('\n'),
                inline: false
            },

            {
                name: '⏰ Scheduled Announcements',
                value: [
                    '• `/announce-schedule channel:#ch at:30m recurring?:daily`',
                    '• `/announce-list` / `/announce-cancel`'
                ].join('\n'),
                inline: false
            },

            {
                name: '⚠️ Warn System',
                value: [
                    '• `/warn user:@user reason:...` / `/warn-list` / `/warn-remove` / `/warn-clear`',
                    '💡 Threshold: 3=mute 1h, 5=mute 1d, 7=kick'
                ].join('\n'),
                inline: false
            },

            {
                name: '📊 Stats & Leaderboard',
                value: [
                    '• `/stats` — statistik server (admin)',
                    '• `/leaderboard metric:messages|vipPurchases|totalSpent|giveawaysWon` (public)',
                    '• `/my-stats` (public)'
                ].join('\n'),
                inline: false
            },

            {
                name: '📊 Poll System',
                value: ['• `/poll create` / `/poll list` / `/poll close`'].join('\n'),
                inline: false
            },

            {
                name: '🔧 Audit Log & Transcript',
                value: [
                    '• `/set-channel audit-log #channel` — catat semua admin action',
                    '• `/set-transcript-channel #channel` — auto-save chat tiket sebelum close'
                ].join('\n'),
                inline: false
            },

            {
                name: '🧨 Reset Total',
                value: ['• `/reset-config` — ⚠️ **hapus SEMUA setting** (konfirmasi 2-step)'].join('\n'),
                inline: false
            }
        )
        .setFooter({
            text: `${interaction.client.user.username} v3.9.13 — All-in-One Community Bot`,
            iconURL: interaction.client.user.displayAvatarURL({ dynamic: true })
        })
        .setTimestamp();

    return interaction.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral });
};
