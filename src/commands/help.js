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
        .setTitle('🤖 MLBB COMMUNITY BOT — HELP')
        .setDescription(
            `Halo ${interaction.user}! Anda terverifikasi sebagai **Admin/Staff**.\n` +
            `Berikut daftar lengkap command yang tersedia (v3.9.12).`
        )
        .setColor(0x5865F2)
        .addFields(
            { name: '📋 Informasi', value: [
                '• `/help` — tampilkan pesan bantuan ini',
                '• `/list-products` — lihat semua produk',
                '• `/list-categories` — lihat semua kategori tiket',
                '• `/list-messages` — lihat semua teks pesan embed',
                '• `/config-show` — lihat semua konfigurasi bot'
            ].join('\n'), inline: false },

            { name: '🏗️ Panel Setup (Verifikasi & Tiket)', value: [
                '• `/setup-verify` — pasang panel verifikasi (button customizable)',
                '• `/setup-ticket` — pasang panel tiket (auto-render tombol per kategori)',
                '• `/setup-ticket-panel title:... categories:cat1,cat2` — panel tiket dengan subset kategori (multi-panel)',
                '• `/set-verify-button label:"Saya Bukan Bot" emoji:🤖 style:Secondary` — kustomisasi tombol verifikasi'
            ].join('\n'), inline: false },

            { name: '🎫 Kategori Tiket (CRUD)', value: [
                '• `/add-category id:jasa label:"Jasa Joki" emoji:🎮 style:Success requires_key:false`',
                '• `/list-categories` — lihat semua kategori',
                '• `/remove-category id:jasa` — hapus kategori (default dilindungi)'
            ].join('\n'), inline: false },

            { name: '🎭 Atur Role', value: [
                '• `/set-role verified @role` — set role (verified/unverified/admin)',
                '• `/remove-role verified` — hapus role dari config'
            ].join('\n'), inline: false },

            { name: '📢 Atur Channel', value: [
                '• `/set-channel welcome #channel` — set channel (welcome/goodbye/invoice/audit-log/transcript)',
                '• `/set-transcript-channel #channel` — set channel untuk auto-save transcript tiket',
                '• `/remove-channel welcome` — hapus channel dari config'
            ].join('\n'), inline: false },

            { name: '✏️ Atur Pesan Embed (3 cara!)', value: [
                '**Cara 1 — `/set-message`** (cepat, 1-line):',
                '• `/set-message ticketBody teks...`',
                '• `/set-message ticketPriceHeader "💰 HARGA 💰"`',
                '**Cara 2 — `/edit-message`** (modal multi-line, lebih flexible):',
                '• `/edit-message tipe:"Ticket Body"` → buka modal editor',
                '**Cara 3 — `/reset-message`** (kembalikan ke default):',
                '• `/reset-message ticketBody` — reset 1 pesan',
                '• `/reset-message ALL` — reset semua pesan'
            ].join('\n'), inline: false },

            { name: '📝 Variabel Pesan (template)', value: [
                '**Welcome/Goodbye:** `{user}` `{username}` `{server}` `{count}` `{action}`',
                '**Ticket Body (v3.9.12):**',
                '• `{server}` — nama server',
                '• `{price_header}` — isi ticketPriceHeader',
                '• `{price_list}` — daftar SEMUA produk',
                '• `{price_list:mlbb_key}` — produk filter by kategori',
                '• `{categories_list}` — daftar kategori (untuk multi-panel)',
                '**Contoh ticketBody:**',
                '`Halo! Selamat datang di {server}\\n\\n{price_header}\\n{price_list}`'
            ].join('\n'), inline: false },

            { name: '📦 Manajemen Produk', value: [
                '• `/add-product label:"VIP 30 Hari" value:vip30 price:"Rp 50.000" duration:"30 Hari" category:mlbb_key requires_key:true`',
                '   ↳ `category` default: `mlbb_key` (lihat `/list-categories`)',
                '   ↳ `requires_key` default: sesuai kategori',
                '• `/remove-product value:vip30`',
                '• `/list-products`'
            ].join('\n'), inline: false },

            { name: '🎁 Auto-Role Produk (VIP role + auto-expire)', value: [
                '• `/set-product-role value:vip30 role:@VIP days:30`',
                '   ↳ `days:0` = permanen',
                '• `/remove-product-role value:vip30`',
                '• `/list-product-roles`',
                '💡 Role & key diberikan saat admin klik **🔑 Set Key** di tiket'
            ].join('\n'), inline: false },

            { name: '🔑 Key Manager', value: [
                '• `/set-key user:@user value:vip30 key:ABCDE-12345` — beri key + role',
                '• `/list-keys user:@user` — lihat semua key user (guild-scoped)',
                '• `/clear-schedule user:@user clear_keys:true` — reset total VIP'
            ].join('\n'), inline: false },

            { name: '🎭 Self-Role Panel (member ambil sendiri)', value: [
                '• `/setup-selfrole title:... type:button exclusive:false`',
                '• `/selfrole-add panel_id:sr_xxx role:@Gamer label:Gamer emoji:🎮 style:Primary`',
                '• `/selfrole-add panel_id:sr_xxx role:@Booster label:Booster style:Success requires_role:@Verified` — **conditional role**',
                '• `/selfrole-remove panel_id:sr_xxx role:@Booster`',
                '• `/selfrole-list`',
                '• `/selfrole-delete panel_id:sr_xxx`',
                '💡 `requires_role` = user harus punya role ini dulu sebelum bisa ambil'
            ].join('\n'), inline: false },

            { name: '🎤 Temp Voice', value: [
                '• `/setup-tempvoice` — setup kategori + trigger + control panel',
                '• `/tempvoice-remove` — hapus semua setup',
                '💡 Member join "🔊 Buat Voice" → otomatis bikin voice pribadi',
                '💡 Panel: Rename, Kick, Limit, Lock, Transfer, Delete, Info'
            ].join('\n'), inline: false },

            { name: '📢 Announce & Embed Builder', value: [
                '• `/announce channel:#ch title:... description:... color? image? mention?` — quick embed',
                '• `/send-message channel:#ch message:... mention?` — plain text',
                '• `/embed-builder` — interactive builder (live preview)',
                '• `/embed-list` — lihat session aktif',
                '• `/embed-cancel session_id:emb_xxx` — batalkan session'
            ].join('\n'), inline: false },

            { name: '💾 Backup System', value: [
                '• `/backup-now` — buat backup manual',
                '• `/backup-list` — lihat semua backup',
                '• `/restore-backup name:YYYY-MM-DD_HH-mm-ss` — restore (auto safety backup)',
                '💡 Auto-backup tiap 24 jam + saat bot start. Maks 7 backup.'
            ].join('\n'), inline: false },

            { name: '🎉 Giveaway System', value: [
                '• `/giveaway create channel:#ch prize:VIP winners:1 duration:60 required_role?:@VIP`',
                '• `/giveaway list`',
                '• `/giveaway end id:gw_xxx` — akhiri + pick winner',
                '• `/giveaway reroll id:gw_xxx` — reroll winner'
            ].join('\n'), inline: false },

            { name: '⏰ Scheduled Announcements', value: [
                '• `/announce-schedule channel:#ch title:... description:... at:30m recurring?:daily`',
                '• `/announce-list`',
                '• `/announce-cancel id:sa_xxx`',
                '💡 Format `at`: "30m", "2h", "1d", atau "2026-01-15 20:00"',
                '💡 Recurring: daily / weekly / monthly'
            ].join('\n'), inline: false },

            { name: '⚠️ Warn System (auto-action)', value: [
                '• `/warn user:@user reason:Spam`',
                '• `/warn-list user:@user`',
                '• `/warn-remove user:@user warn_id:warn_xxx`',
                '• `/warn-clear user:@user`',
                '💡 Threshold: 3=mute 1h, 5=mute 1d, 7=kick'
            ].join('\n'), inline: false },

            { name: '📊 Stats & Leaderboard', value: [
                '• `/stats` — statistik server (admin)',
                '• `/leaderboard metric:messages|vipPurchases|totalSpent|giveawaysWon` — top 10 (public)',
                '• `/my-stats` — statistik pribadi (public)'
            ].join('\n'), inline: false },

            { name: '📊 Poll System', value: [
                '• `/poll create channel:#ch question:... multiple?:false`',
                '• `/poll list`',
                '• `/poll close id:poll_xxx`'
            ].join('\n'), inline: false },

            { name: '🔧 Audit Log & Transcript', value: [
                '• `/set-channel audit-log #channel` — catat semua admin action',
                '• `/set-transcript-channel #channel` — auto-save chat tiket sebelum close',
                '💡 Transcript: embed summary + code-block chat history (chunked 1900 char)'
            ].join('\n'), inline: false },

            { name: '🧨 Reset Total', value: [
                '• `/reset-config` — ⚠️ **hapus SEMUA setting** (konfirmasi 2-step, tidak bisa di-undo!)'
            ].join('\n'), inline: false }
        )
        .setFooter({ text: `${interaction.client.user.username} v3.9.12 — All-in-One Community Bot`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    return interaction.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral });
};
