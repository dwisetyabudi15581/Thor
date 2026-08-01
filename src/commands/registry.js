/**
 * Command Definitions — semua slash command bot (P3-6 refactor).
 *
 * Dipakai oleh index.js saat bot ready untuk register ke Discord.
 * Tujuan: pisahkan definisi command dari logic bot supaya index.js lebih lean.
 */

const { PermissionFlagsBits } = require('discord.js');

function getCommands() {
    return [
        // === HELP ===
        {
            name: 'help',
            description: 'Lihat semua command & cara pakai bot',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === PANEL SETUP ===
        {
            name: 'setup-verify',
            description: 'Pasang panel verifikasi',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'setup-ticket',
            description: 'Pasang panel tiket & price list',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === SET ROLE ===
        {
            name: 'set-role',
            description: 'Atur role (verified / unverified / admin)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'tipe', description: 'Pilih tipe role', required: true, choices: [
                    { name: 'Verified', value: 'verified' },
                    { name: 'Unverified', value: 'unverified' },
                    { name: 'Admin', value: 'admin' }
                ]},
                { type: 8, name: 'role', description: 'Role yang akan dipakai', required: true }
            ]
        },

        // === SET CHANNEL ===
        {
            name: 'set-channel',
            description: 'Atur channel (invoice / welcome / goodbye / audit-log)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'tipe', description: 'Pilih tipe channel', required: true, choices: [
                    { name: 'Invoice', value: 'invoice' },
                    { name: 'Welcome', value: 'welcome' },
                    { name: 'Goodbye', value: 'goodbye' },
                    { name: 'Audit Log (catat admin action)', value: 'audit-log' }
                ]},
                { type: 7, name: 'channel', description: 'Channel text yang dipakai', required: true }
            ]
        },

        // === SET PESAN ===
        {
            name: 'set-message',
            description: 'Ubah teks embed welcome / goodbye / verify / ticket',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'tipe', description: 'Pilih pesan yang diubah', required: true, choices: [
                    { name: 'Welcome Title', value: 'welcomeTitle' },
                    { name: 'Welcome Body', value: 'welcomeBody' },
                    { name: 'Goodbye Title', value: 'goodbyeTitle' },
                    { name: 'Goodbye Body', value: 'goodbyeBody' },
                    { name: 'Verify Title', value: 'verifyTitle' },
                    { name: 'Verify Body', value: 'verifyBody' },
                    { name: 'Ticket Title', value: 'ticketTitle' },
                    { name: 'Ticket Body', value: 'ticketBody' }
                ]},
                { type: 3, name: 'teks', description: 'Teks baru. Pakai {user} {username} {server} {count} {action}', required: true }
            ]
        },

        // === MANAJEMEN PRODUK ===
        {
            name: 'add-product',
            description: 'Tambah produk baru ke price list',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'label', description: 'Nama produk (mis. 7 Days)', required: true },
                { type: 3, name: 'value', description: 'ID unik (mis. 7d)', required: true },
                { type: 3, name: 'price', description: 'Harga (mis. Rp. 50.000)', required: true },
                { type: 3, name: 'duration', description: 'Opsional. Keterangan durasi (mis. 7 Hari). Kosong = pakai label.', required: false }
            ]
        },
        {
            name: 'remove-product',
            description: 'Hapus produk dari price list',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'value', description: 'Value produk yang ingin dihapus (mis. 7d)', required: true }
            ]
        },
        {
            name: 'list-products',
            description: 'Lihat semua produk saat ini',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === CONFIG SHOW ===
        {
            name: 'config-show',
            description: 'Lihat semua konfigurasi bot saat ini',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === REMOVE ROLE (hapus role dari config) ===
        {
            name: 'remove-role',
            description: 'Hapus role dari config (verified / unverified / admin)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'tipe', description: 'Pilih tipe role yang dihapus', required: true, choices: [
                    { name: 'Verified', value: 'verified' },
                    { name: 'Unverified', value: 'unverified' },
                    { name: 'Admin', value: 'admin' }
                ]}
            ]
        },

        // === REMOVE CHANNEL (hapus channel dari config) ===
        {
            name: 'remove-channel',
            description: 'Hapus channel dari config (invoice / welcome / goodbye)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'tipe', description: 'Pilih tipe channel yang dihapus', required: true, choices: [
                    { name: 'Invoice', value: 'invoice' },
                    { name: 'Welcome', value: 'welcome' },
                    { name: 'Goodbye', value: 'goodbye' }
                ]}
            ]
        },

        // === LIST MESSAGES (lihat semua teks pesan) ===
        {
            name: 'list-messages',
            description: 'Lihat semua teks pesan embed saat ini',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === RESET MESSAGE (kembalikan pesan ke default) ===
        {
            name: 'reset-message',
            description: 'Reset teks pesan embed kembali ke default',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'tipe', description: 'Pilih pesan yang direset (atau ALL untuk semua)', required: true, choices: [
                    { name: 'Welcome Title', value: 'welcomeTitle' },
                    { name: 'Welcome Body', value: 'welcomeBody' },
                    { name: 'Goodbye Title', value: 'goodbyeTitle' },
                    { name: 'Goodbye Body', value: 'goodbyeBody' },
                    { name: 'Verify Title', value: 'verifyTitle' },
                    { name: 'Verify Body', value: 'verifyBody' },
                    { name: 'Ticket Title', value: 'ticketTitle' },
                    { name: 'Ticket Body', value: 'ticketBody' },
                    { name: '⚡ Reset SEMUA', value: 'ALL' }
                ]}
            ]
        },

        // === RESET CONFIG (reset semua setting ke kondisi kosong) ===
        {
            name: 'reset-config',
            description: '⚠️ Hapus SEMUA setting (role, channel, pesan) - tidak bisa di-undo!',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === AUTO-ROLE PRODUCT (VIP role per produk) ===
        {
            name: 'set-product-role',
            description: 'Set role & durasi auto-expire untuk produk tertentu',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'value', description: 'Value produk (mis. 30d)', required: true },
                { type: 8, name: 'role', description: 'Role yang akan diberikan saat pembeli sukses', required: true },
                { type: 4, name: 'days', description: 'Durasi hari sebelum role otomatis dihapus (0 = permanen)', required: true }
            ]
        },
        {
            name: 'remove-product-role',
            description: 'Hapus auto-role dari produk tertentu',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'value', description: 'Value produk (mis. 30d)', required: true }
            ]
        },
        {
            name: 'list-product-roles',
            description: 'Lihat semua mapping produk → role + durasi',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === KEY MANAGER (model key-driven) ===
        {
            name: 'set-key',
            description: 'Beri key ke user + grant role + extend schedule (MAX EXTEND)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 6, name: 'user', description: 'User penerima key', required: true },
                { type: 3, name: 'value', description: 'Value produk (mis. 30d)', required: true },
                { type: 3, name: 'key', description: 'Key yang akan dikirim ke user', required: true }
            ]
        },
        {
            name: 'list-keys',
            description: 'Lihat semua key (aktif & expired) milik user',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 6, name: 'user', description: 'User yang ingin dilihat key-nya', required: true }
            ]
        },
        {
            name: 'clear-schedule',
            description: 'Hapus semua schedule role user (+ opsional hapus semua key & lepas role VIP)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 6, name: 'user', description: 'User yang di-clear', required: true },
                { type: 5, name: 'clear_keys', description: 'True = hapus SEMUA key user + lepas role VIP (full reset). Default: false.', required: false }
            ]
        },

        // === SELF-ROLE FLEKSIBEL ===
        {
            name: 'setup-selfrole',
            description: 'Buat panel self-role baru (member bisa ambil/lepas role sendiri)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'title', description: 'Judul panel (mis. Pilih Role Notif)', required: true },
                { type: 3, name: 'description', description: 'Deskripsi panel', required: true },
                { type: 3, name: 'type', description: 'Tipe UI panel', required: true, choices: [
                    { name: 'Button (≤25 role, klik toggle)', value: 'button' },
                    { name: 'Select Menu (dropdown, ≤25 role)', value: 'select' }
                ]},
                { type: 5, name: 'exclusive', description: 'True = hanya boleh 1 role pada satu waktu (mis. color role). Default false.', required: false }
            ]
        },
        {
            name: 'selfrole-add',
            description: 'Tambah role ke panel self-role yang sudah ada',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'panel_id', description: 'Panel ID (lihat di /selfrole-list atau footer panel)', required: true },
                { type: 8, name: 'role', description: 'Role yang akan ditambahkan ke panel', required: true },
                { type: 3, name: 'label', description: 'Label tombol / option (maks 80 char)', required: true },
                { type: 3, name: 'emoji', description: 'Emoji (opsional, mis. 🔔)', required: false },
                { type: 3, name: 'description', description: 'Deskripsi (opsional, hanya untuk select menu)', required: false }
            ]
        },
        {
            name: 'selfrole-remove',
            description: 'Hapus role dari panel self-role',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'panel_id', description: 'Panel ID', required: true },
                { type: 8, name: 'role', description: 'Role yang akan dihapus dari panel', required: true }
            ]
        },
        {
            name: 'selfrole-list',
            description: 'Lihat semua panel self-role di guild ini',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'selfrole-delete',
            description: 'Hapus panel self-role (hapus pesan + config)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'panel_id', description: 'Panel ID yang akan dihapus', required: true }
            ]
        },

        // === ANNOUNCE & EMBED BUILDER ===
        {
            name: 'announce',
            description: 'Quick announce — kirim embed ke channel (1 command, 1 embed)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 7, name: 'channel', description: 'Channel tujuan announce', required: true },
                { type: 3, name: 'title', description: 'Judul announce', required: true },
                { type: 3, name: 'description', description: 'Isi announce (support newline \\n)', required: true },
                { type: 3, name: 'color', description: 'Warna hex (mis. #FF0000). Default: blurple', required: false },
                { type: 3, name: 'image', description: 'URL gambar besar (opsional)', required: false },
                { type: 3, name: 'thumbnail', description: 'URL gambar kecil pojok (opsional)', required: false },
                { type: 3, name: 'mention', description: 'Mention: @everyone, @here, atau <@&role_id>', required: false }
            ]
        },
        {
            name: 'embed-builder',
            description: 'Interactive embed builder dengan live preview (untuk embed kompleks)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'embed-list',
            description: 'Lihat semua session embed builder aktif kamu (+ link ke draft message)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'embed-cancel',
            description: 'Batalkan session embed builder berdasarkan ID (jika draft kehapus/bug)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'session_id', description: 'Session ID (lihat di /embed-list)', required: true }
            ]
        },

        // === BACKUP SYSTEM ===
        {
            name: 'backup-now',
            description: 'Buat backup manual sekarang (config, keys, scheduledRoles, selfRoles, dll)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'backup-list',
            description: 'Lihat semua backup yang tersimpan (maks 7 terbaru)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'restore-backup',
            description: 'Restore backup berdasarkan nama (auto-buat safety backup sebelum restore)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'name', description: 'Nama folder backup (lihat /backup-list, format: YYYY-MM-DD_HH-mm-ss)', required: true }
            ]
        },

        // === GIVEAWAY SYSTEM ===
        {
            name: 'giveaway',
            description: 'Kelola giveaway komunitas (create, list, end, reroll)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                {
                    type: 1, name: 'create', description: 'Buat giveaway baru', required: false,
                    options: [
                        { type: 7, name: 'channel', description: 'Channel untuk giveaway', required: true },
                        { type: 3, name: 'prize', description: 'Hadiah (mis. VIP 30 Hari)', required: true },
                        { type: 4, name: 'duration', description: 'Durasi dalam menit (min 1)', required: true },
                        { type: 4, name: 'winners', description: 'Jumlah pemenang (1-20, default 1)', required: false },
                        { type: 8, name: 'required_role', description: 'Role yang wajib dimiliki peserta (opsional)', required: false }
                    ]
                },
                {
                    type: 1, name: 'list', description: 'Lihat semua giveaway di guild ini', required: false
                },
                {
                    type: 1, name: 'end', description: 'Akhiri giveaway lebih awal + pick winners', required: false,
                    options: [
                        { type: 3, name: 'id', description: 'Giveaway ID (lihat /giveaway list)', required: true }
                    ]
                },
                {
                    type: 1, name: 'reroll', description: 'Reroll winner giveaway yang sudah berakhir', required: false,
                    options: [
                        { type: 3, name: 'id', description: 'Giveaway ID (lihat /giveaway list)', required: true }
                    ]
                }
            ]
        },

        // === SCHEDULED ANNOUNCEMENTS ===
        {
            name: 'announce-schedule',
            description: 'Jadwalkan announce ke channel pada waktu tertentu (one-shot atau recurring)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 7, name: 'channel', description: 'Channel tujuan', required: true },
                { type: 3, name: 'title', description: 'Judul announce', required: true },
                { type: 3, name: 'description', description: 'Isi announce (support \\n untuk newline)', required: true },
                { type: 3, name: 'at', description: 'Waktu kirim. Format: "30m", "2h", "1d", atau "2026-01-15 20:00"', required: true },
                { type: 3, name: 'color', description: 'Warna hex (mis. #FF0000). Default: blurple', required: false },
                { type: 3, name: 'image', description: 'URL gambar besar (opsional)', required: false },
                { type: 3, name: 'thumbnail', description: 'URL gambar kecil pojok (opsional)', required: false },
                { type: 3, name: 'mention', description: 'Mention: @everyone, @here, atau <@&role_id>', required: false },
                { type: 3, name: 'recurring', description: 'Ulangi (opsional)', required: false, choices: [
                    { name: 'Daily (tiap hari)', value: 'daily' },
                    { name: 'Weekly (tiap minggu)', value: 'weekly' },
                    { name: 'Monthly (tiap bulan)', value: 'monthly' }
                ]}
            ]
        },
        {
            name: 'announce-list',
            description: 'Lihat semua announce terjadwal yang pending',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'announce-cancel',
            description: 'Batalkan announce terjadwal berdasarkan ID',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'id', description: 'Announce ID (lihat di /announce-list)', required: true }
            ]
        },

        // === WARN SYSTEM ===
        // P2-3 FIX: defaultMemberPermissions disamakan dengan isAdmin check (ManageGuild).
        // Sebelumnya: ModerateMembers → moderator bisa lihat command tapi ditolak saat dijalankan.
        {
            name: 'warn',
            description: 'Beri warning ke member (auto-action: 3=mute 1h, 5=mute 1d, 7=kick)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 6, name: 'user', description: 'Member yang diwarn', required: true },
                { type: 3, name: 'reason', description: 'Alasan warning', required: true }
            ]
        },
        {
            name: 'warn-list',
            description: 'Lihat semua warning milik user',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 6, name: 'user', description: 'User yang ingin dicek', required: true }
            ]
        },
        {
            name: 'warn-remove',
            description: 'Hapus 1 warning berdasarkan ID',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 6, name: 'user', description: 'User pemilik warning', required: true },
                { type: 3, name: 'warn_id', description: 'Warn ID (lihat di /warn-list)', required: true }
            ]
        },
        {
            name: 'warn-clear',
            description: 'Hapus SEMUA warning milik user',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 6, name: 'user', description: 'User yang ingin di-clear warn-nya', required: true }
            ]
        },

        // === STATS & LEADERBOARD ===
        {
            name: 'stats',
            description: 'Lihat statistik agregat server (admin only)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'leaderboard',
            description: 'Lihat top 10 member (public — boleh dipakai member biasa)',
            options: [
                { type: 3, name: 'metric', description: 'Metric leaderboard', required: false, choices: [
                    { name: '💬 Pesan Terbanyak', value: 'messages' },
                    { name: '🛒 Top Buyer (transaksi)', value: 'vipPurchases' },
                    { name: '💰 Top Spender (belanja)', value: 'totalSpent' },
                    { name: '🎉 Top Winner (giveaway)', value: 'giveawaysWon' }
                ]}
            ]
        },
        {
            name: 'my-stats',
            description: 'Lihat statistik pribadi kamu (public — boleh dipakai member biasa)'
        },

        // === POLL SYSTEM ===
        {
            name: 'poll',
            description: 'Kelola poll komunitas (create, list, close)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                {
                    type: 1, name: 'create', description: 'Buat poll baru (modal input untuk options)', required: false,
                    options: [
                        { type: 7, name: 'channel', description: 'Channel untuk poll', required: true },
                        { type: 3, name: 'question', description: 'Pertanyaan poll', required: true },
                        { type: 5, name: 'multiple', description: 'True = member boleh pilih banyak. Default false (single)', required: false }
                    ]
                },
                {
                    type: 1, name: 'list', description: 'Lihat semua poll di guild ini', required: false
                },
                {
                    type: 1, name: 'close', description: 'Tutup poll + tampilkan hasil akhir', required: false,
                    options: [
                        { type: 3, name: 'id', description: 'Poll ID (lihat di /poll list)', required: true }
                    ]
                }
            ]
        },

        // === TEMP VOICE ===
        // v3.8.2: /setup-tempvoice tanpa parameter — bot auto-create kategori
        // berisi text channel (untuk panel) + voice channel (untuk trigger).
        {
            name: 'setup-tempvoice',
            description: 'Setup temp voice — auto buat kategori + channel panel + channel trigger',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'tempvoice-remove',
            description: 'Hapus setup temp voice dari guild (kategori + semua channel terkait dihapus)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === SEND MESSAGE (plain text ke channel) ===
        // v3.9.5: pelengkap /announce (yang kirim embed). /send-message kirim
        // plain text biasa — cocok untuk pengumuman kasual, chat bot, atau
        // teks yang tidak perlu styling embed.
        {
            name: 'send-message',
            description: 'Kirim plain text message ke text channel (support \\n & mention)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 7, name: 'channel', description: 'Channel tujuan (harus text channel)', required: true },
                { type: 3, name: 'message', description: 'Isi pesan (support \\n untuk newline). Maks 2000 char.', required: true },
                { type: 3, name: 'mention', description: 'Mention: @everyone, @here, atau <@&role_id> / <@user_id>', required: false }
            ]
        }
    ];
}

module.exports = { getCommands };
