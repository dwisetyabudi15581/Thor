/**
 * Domain: help
 * Slash commands: /help
 *
 * Dipisah dari handlers/commandHandler.js (v3.9.9 refactor).
 * Behavior: tampilkan daftar semua command yang tersedia (ephemeral embed).
 */

const { EmbedBuilder, MessageFlags } = require('./_shared');

module.exports = async function (interaction) {
    const helpEmbed = new EmbedBuilder()
        .setTitle('🤖 MLBB COMMUNITY BOT — HELP')
        .setDescription(
            `Halo ${interaction.user}! Anda terverifikasi sebagai **Admin/Staff**. Berikut daftar command yang tersedia.`
        )
        .setColor(0x5865F2)
        .addFields(
            { name: '📋 Informasi', value: [
                '• `/help` — tampilkan pesan bantuan ini',
                '• `/list-products` — lihat semua produk',
                '• `/list-messages` — lihat semua teks pesan embed',
                '• `/config-show` — lihat semua konfigurasi'
            ].join('\n'), inline: false },
            { name: '🏗️ Panel Setup', value: [
                '• `/setup-verify` — pasang panel verifikasi',
                '• `/setup-ticket` — pasang panel tiket & price list'
            ].join('\n'), inline: false },
            { name: '🎭 Atur Role (set & hapus)', value: [
                '• `/set-role verified @role` — set role',
                '• `/set-role unverified @role`',
                '• `/set-role admin @role`',
                '• `/remove-role verified` — **hapus role dari config**'
            ].join('\n'), inline: false },
            { name: '📢 Atur Channel (set & hapus)', value: [
                '• `/set-channel welcome #channel`',
                '• `/set-channel goodbye #channel`',
                '• `/set-channel invoice #channel`',
                '• `/remove-channel welcome` — **hapus channel dari config**'
            ].join('\n'), inline: false },
            { name: '✏️ Atur Pesan Embed (set & reset)', value: [
                '• `/set-message welcomeBody teks...`',
                '• `/set-message goodbyeBody teks...`',
                '• `/set-message verifyBody teks...`',
                '• `/set-message ticketBody teks...`',
                '• `/reset-message welcomeBody` — **reset ke default**',
                '• `/reset-message ALL` — **reset semua pesan**'
            ].join('\n'), inline: false },
            { name: '📦 Manajemen Produk (tambah & hapus)', value: [
                '• `/add-product label value price [duration]`',
                '   ↳ `duration` **opsional** — kalau kosong, TIDAK ADA duration',
                '• `/remove-product value` — **hapus produk**',
                '• `/list-products`'
            ].join('\n'), inline: false },
            { name: '🎁 Auto-Role Produk (VIP role + auto-expire)', value: [
                '• `/set-product-role value:@role days:30` — set role + durasi',
                '   ↳ `days:0` = role permanen (tidak auto-hapus)',
                '• `/remove-product-role value:` — **hapus auto-role**',
                '• `/list-product-roles` — lihat semua mapping',
                '💡 Role & key diberikan saat admin klik **🔑 Set Key** di tiket'
            ].join('\n'), inline: false },
            { name: '🔑 Key Manager (model key-driven)', value: [
                '• `/set-key user:@user value:30d key:ABCDE-...` — beri key + role + extend schedule',
                '• `/list-keys user:@user` — lihat semua key aktif user',
                '• `/clear-schedule user:@user clear_keys:true` — hapus schedule + key (reset VIP)'
            ].join('\n'), inline: false },
            { name: '🎭 Self-Role Fleksibel (member ambil sendiri)', value: [
                '• `/setup-selfrole title:... type:button exclusive:false` — bikin panel',
                '• `/selfrole-add panel_id:@role label:Notif emoji:🔔 description:...`',
                '• `/selfrole-remove panel_id:@role`',
                '• `/selfrole-list` — lihat semua panel',
                '• `/selfrole-delete panel_id:` — hapus panel'
            ].join('\n'), inline: false },
            { name: '🎤 Temp Voice', value: [
                '• `/setup-tempvoice` — setup kategori + trigger channel + control panel',
                '• `/tempvoice-remove` — hapus semua setup temp voice',
                '💡 Member join channel "🔊 Buat Voice" → otomatis buat voice channel pribadi',
                '💡 Panel kontrol: Rename, Kick, Limit, Lock, Transfer, Delete, Info Room',
                '💡 Channel otomatis dihapus saat kosong'
            ].join('\n'), inline: false },
            { name: '📢 Announce & Embed Builder', value: [
                '• `/announce channel:#ch title:... description:... color? image? thumbnail? mention?` — quick announce (embed)',
                '• `/send-message channel:#ch message:... mention?` — kirim **plain text** ke channel (bukan embed)',
                '• `/embed-builder` — interactive builder (live preview, edit bagian per bagian)',
                '• `/embed-list` — lihat semua session embed builder aktif + link ke draft',
                '• `/embed-cancel session_id:emb_xxx` — batalkan session tertentu (kalau draft kehapus)',
                '💡 `/announce` cocok untuk pengumuman ber-style embed',
                '💡 `/send-message` cocok untuk teks kasual / chat bot biasa tanpa embed',
                '💡 `/embed-builder` cocok untuk embed kompleks (multi-field, footer, author, image)',
                '💡 `/embed-builder` sekarang support **💬 Message (plain text)** — bisa kirim teks pengantar + @everyone ping + embed dalam 1 message',
                '💡 Bisa bikin banyak embed builder sekaligus — tiap draft independen, pakai `/embed-list` untuk kelola'
            ].join('\n'), inline: false },
            { name: '💾 Backup System (auto + manual)', value: [
                '• `/backup-now` — buat backup manual sekarang',
                '• `/backup-list` — lihat semua backup tersimpan',
                '• `/restore-backup name:YYYY-MM-DD_HH-mm-ss` — restore (auto safety backup)',
                '💡 Auto-backup saat bot start + tiap 24 jam. Maks 7 backup terbaru disimpan.'
            ].join('\n'), inline: false },
            { name: '🎉 Giveaway System', value: [
                '• `/giveaway create channel:#ch prize:VIP 30 Hari winners:1 duration:60 required_role?:@VIP`',
                '• `/giveaway list` — lihat semua giveaway',
                '• `/giveaway end id:gw_xxx` — akhiri lebih awal + pick winner',
                '• `/giveaway reroll id:gw_xxx` — reroll winner',
                '💡 Member klik tombol 🎉 Join / 🚪 Leave di message giveaway'
            ].join('\n'), inline: false },
            { name: '⏰ Scheduled Announcements', value: [
                '• `/announce-schedule channel:#ch title:... description:... at:30m recurring?:daily`',
                '• `/announce-list` — lihat semua pending',
                '• `/announce-cancel id:sa_xxx` — batalkan',
                '💡 Format `at`: "30m", "2h", "1d", atau "2026-01-15 20:00"',
                '💡 Recurring: daily / weekly / monthly (auto-bikin cycle baru)'
            ].join('\n'), inline: false },
            { name: '⚠️ Warn System (auto-action)', value: [
                '• `/warn user:@user reason:Spam` — beri warning',
                '• `/warn-list user:@user` — lihat history warning',
                '• `/warn-remove user:@user warn_id:warn_xxx` — hapus 1 warn',
                '• `/warn-clear user:@user` — hapus SEMUA warn',
                '💡 Threshold: 3 warn=mute 1h, 5 warn=mute 1d, 7 warn=kick'
            ].join('\n'), inline: false },
            { name: '📊 Stats & Leaderboard', value: [
                '• `/stats` — statistik agregat server (admin)',
                '• `/leaderboard metric:messages|vipPurchases|totalSpent|giveawaysWon` — top 10 (public)',
                '• `/my-stats` — statistik pribadi (public)',
                '💡 Tracking: pesan, pembelian VIP, total belanja, menang giveaway'
            ].join('\n'), inline: false },
            { name: '📊 Poll System', value: [
                '• `/poll create channel:#ch question:Event weekend ini? multiple?:false`',
                '• `/poll list` — lihat semua poll',
                '• `/poll close id:poll_xxx` — tutup poll + tampilkan hasil akhir',
                '💡 Member klik tombol option untuk vote (toggle). Live bar chart otomatis.'
            ].join('\n'), inline: false },
            { name: '🔧 Audit Log (otomatis)', value: [
                '• Set `/set-channel audit-log #channel` dulu',
                '💡 Bot otomatis catat: add/remove produk, set role/channel, set-key, giveaway, dll'
            ].join('\n'), inline: false },
            { name: '🧨 Reset Total', value: [
                '• `/reset-config` — ⚠️ **hapus SEMUA setting** (tidak bisa di-undo!)'
            ].join('\n'), inline: false },
            { name: '📝 Variabel Pesan', value: '`{user}` `{username}` `{server}` `{count}` `{action}` — bisa dipakai di teks welcome/goodbye', inline: false }
        )
        .setFooter({ text: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    return interaction.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral });
};
