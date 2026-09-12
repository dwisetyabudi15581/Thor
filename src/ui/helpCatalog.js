/**
 * Help Catalog — single source of truth untuk isi /help (v3.9.44).
 *
 * v3.9.44 REDESIGN (user request: "/warn kok masuk kategori Scheduled
 * Announce — tolong baca & sync semua fitur, susun ulang biar mudah
 * dipahami"):
 *   - /warn* PINDAH ke kategori Moderasi (dulu nyangkut di "Scheduled
 *     Announce & Warn" — janggal). Moderasi kini satu pintu: warn →
 *     timeout → kick → ban + purge.
 *   - 20 kategori diurut dari yang paling sering dipakai: 🚀 Panduan Cepat
 *     (BARU — urutan setup server baru) → Moderasi → jualan (produk, key,
 *     panel, kategori, rekber) → pengawasan (log, auto-mod) → engagement
 *     (giveaway, leveling, role) → utility (pesan, backup, stats).
 *   - Kategori lama yang amburadul dirapikan: "Scheduled Announce & Warn"
 *     → murni Pengumuman; "Announce, Embed & Backup" → dipecah jadi
 *     "Pesan & Embed Builder" + "Backup & Maintenance"; "Stats & Lainnya"
 *     → murni Statistik (audit-log pindah ke Log & Channel, reset-config
 *     pindah ke Backup); set-channel (tadinya tersebar di 3 kategori) kini
 *     satu pintu di Log & Channel.
 *   - Setiap command diberi penjelasan 1 frasa — admin baru tidak perlu
 *     menebak fungsi dari nama command saja.
 *
 * Arsitektur navigator (tidak berubah dari v3.9.39):
 *   - 🏠 Home   : ringkasan kategori + tugas populer + dropdown 📂 + tombol
 *   - 📂 Kategori: detail command per kategori (embed kecil, gampang dibaca)
 *   - 🔍 Search : modal kata kunci ATAU /help search:<keyword> → hasil instan
 *   - 📖 All    : daftar lengkap (dengan guard budget — lihat buildAllEmbeds)
 * Semua view di-render ke SATU pesan ephemeral (interaction.update) — tidak
 * ada spam pesan baru tiap kali ganti kategori.
 *
 * Modul ini dipakai bersama oleh:
 *   - src/commands/help.js      (slash /help + opsi search)
 *   - src/interactions/help.js  (dropdown/tombol/modal navigation)
 *
 * Kontrak Discord yang dijaga (di-unit-test di tests/unit/helpNav.test.js):
 *   - StringSelectMenu max 25 opsi (saat ini 20 kategori — ada guard test).
 *   - Opsi select: label ≤ 100, description ≤ 100, value ≤ 100.
 *   - Embed description ≤ 4096; total semua embed dalam 1 pesan ≤ 6000.
 */

const {
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} = require('discord.js');
const { EMBED_LIMITS, DISCORD_LIMITS } = require('../infra/constants');
const { truncateUtf8Safe } = require('../infra/text');

// v3.9.37: versi diambil dinamis dari package.json (single source of truth)
// supaya /help gak pernah stale lagi.
const { version: BOT_VERSION } = require('../../package.json');

// === Custom IDs (stabil — pesan help lama tetap bisa diklik setelah restart) ===
const HELP_IDS = {
    SELECT: 'help_cat',
    SEARCH_BUTTON: 'help_search',
    SEARCH_MODAL: 'help_search_modal',
    SEARCH_INPUT: 'help_search_input',
    HOME_BUTTON: 'help_home',
    ALL_BUTTON: 'help_all'
};

const EMBED_COLOR = 0x5865f2;
const FOOTER_TEXT = `Community Bot v${BOT_VERSION} — All-in-One`;

// Batas aman hasil pencarian yang ditampilkan sebelum "+N lainnya".
const SEARCH_MAX_LINES = 20;

/**
 * Katalog kategori help (v3.9.44 — urutan = prioritas pemakaian).
 * `lines` = isi detail kategori (baris command).
 * `short` = deskripsi singkat untuk opsi dropdown (≤100 char, di-guard test).
 */
const HELP_CATEGORIES = [
    {
        id: 'quickstart',
        emoji: '🚀',
        name: 'Panduan Cepat',
        short: 'Baru pakai bot? Urutan setup server dari nol',
        lines: [
            '**Baru pakai bot? Ikuti urutan ini:**',
            '1️⃣ `/set-role verified @Verified` — role member terverifikasi',
            '2️⃣ `/add-category` + `/add-product` — siapkan katalog',
            '3️⃣ `/setup-ticket-panel` — pasang panel tiket',
            '4️⃣ `/setup-verify` — verifikasi member baru',
            '5️⃣ `/set-channel server-log #log` — aktifkan log',
            '💡 Lanjut eksplor kategori lain lewat dropdown 📂.'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Baru pakai bot ini? Setup server dengan urutan ini (sekali saja):**',
            '1️⃣ `/set-role tipe:verified role:@Verified` — role yang didapat member setelah verifikasi',
            '2️⃣ `/add-category` + `/add-product` — siapkan produk jualan (lihat kategori Produk)',
            '3️⃣ `/setup-ticket-panel` — pasang panel order yang diklik member untuk beli',
            '4️⃣ `/setup-verify` — gerbang verifikasi: member baru klik tombol untuk dapat role verified',
            '5️⃣ `/set-channel tipe:server-log channel:#log` — catat join/left, pesan dihapus, ban',
            '',
            '**Tambahan bagus setelah dasarnya jalan (semuanya opsional):**',
            '• `/serverstats setup` — counter member/boost live di paling atas daftar channel (pilih counter mana yang mau ditampilkan)',
            '• `/set-channel tipe:server-booster channel:#boost` — embed pink tiap ada yang boost',
            '• `/setup-leveling` — XP per pesan + role per level',
            '• `/setup-tempvoice` — voice pribadi yang dibuat sendiri oleh member',
            '• `/add-responder` — auto-reply untuk pertanyaan yang sering ditanya',
            '',
            '💡 Semua langkah ini tidak destruktif, dan **tidak ada apa pun yang dikirim ke member** sampai kamu memasang panel — aman untuk dieksplor. Setiap command dijelaskan lengkap di kategorinya lewat dropdown 📂.'
        ]
    },
    {
        id: 'moderation',
        emoji: '🛡️',
        name: 'Moderasi',
        short: 'Warn, timeout, kick, ban, purge — satu pintu',
        lines: [
            '**Riwayat pelanggaran:**',
            '• `/warn user reason` — peringatan (3=mute 1j, 5=mute 1h, 7=kick)',
            '• `/warn-list user` — riwayat warn + sanksi · `/warn-remove` `/warn-clear`',
            '**Tindakan langsung:**',
            '• `/timeout user menit reason` — mute (maks 40320 = 28 hari) · `/untimeout`',
            '• `/kick` keluarkan · `/ban` blokir · `/unban` buka blokir',
            '• `/purge amount:100 user?` — hapus massal pesan (1-100)',
            '💡 Tercatat otomatis di `/warn-list` + log server. Role lebih tinggi kebal tindakan.'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Warn & riwayat**',
            '• `/warn user reason` — beri peringatan. Sanksi jalan OTOMATIS: 3 warn = mute 1 jam · 5 = mute 1 hari · 7 = kick. Member di-DM saat memungkinkan.',
            '• `/warn-list user` — satu halaman: warn aktif + semua sanksi lampau (mute/kick/ban dengan tanggal + alasan).',
            '• `/warn-remove user warn_id` — hapus satu warn (warn yang tidak adil hilang dari hitungan). `/warn-clear user` — hapus semuanya.',
            '',
            '**Tindakan langsung**',
            '• `/timeout user duration reason` — mute 1–40320 menit (maks 28 hari); `/untimeout user` untuk buka lebih awal.',
            '• `/kick user reason` — keluarkan dari server (bisa join lagi dengan invite baru).',
            '• `/ban user reason` — blokir permanen, bisa sekalian hapus pesan terakhirnya (`delete_days` 0–7). `/unban user_id` — buka blokir via ID (tetap bisa walau orangnya sudah keluar).',
            '• `/purge amount user?` — hapus massal 1–100 pesan terbaru di channel SEKARANG; tambah `user` untuk hapus pesan member itu saja.',
            '',
            '❓ **Kenapa member itu tidak bisa dimoderasi?** Role-nya LEBIH TINGGI dari role bot — naikkan role bot di Server Settings → Roles.',
            '❓ **Semua tindakan tercatat di mana?** Di channel server-log + riwayat warn member — tidak ada yang senyap.'
        ]
    },
    {
        id: 'products',
        emoji: '📦',
        name: 'Produk & Auto-Role',
        short: 'CRUD produk + role otomatis saat beli',
        lines: [
            '• `/add-product value:vip30 label:"VIP 30 Hari" price:"Rp 30.000"` — produk key',
            '• `/add-product ... requires_key:false` — jasa/akun (detail dikirim DM pembeli)',
            '• `/update-product value:vip30 label:"..."` — edit · `/remove-product` · `/list-products`',
            '• `/set-product-role` — role otomatis saat beli (+ expire) · `/remove-product-role` `/list-product-roles`'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Produk = barang yang kamu jual. Tiap produk punya `value` (ID unik), `label` (yang dilihat pembeli) dan `price`.**',
            '• `/add-product label value price` — tambah produk, mis. `/add-product value:vip30 label:"VIP 30 Hari" price:"Rp 30.000"`. Opsional `duration` (hari), `category`, `requires_key`.',
            '• `requires_key:true` (default) — pembeli menerima KEY produk yang diserahkan ke staf, staf menjalankan `/set-key` untuk kasih role. Cocok untuk produk role VIP.',
            '• `requires_key:false` — produk teks/DM: panel mengumpulkan catatan pembeli, detail dikirim manual (akun, jasa, hadiah).',
            '• `/update-product value` — edit label/price/duration/category/requires_key tanpa hapus+tambah ulang. Konfirmasinya menampilkan nominal yang tercatat di stats per penjualan.',
            '• `/remove-product value` · `/list-products` — hapus / lihat katalog.',
            '',
            '**Auto-role saat beli**',
            '• `/set-product-role value role days` — role pembeli diberikan OTOMATIS saat deal selesai, dan dihapus otomatis setelah `days` hari (kosong = permanen).',
            '• `/remove-product-role value` — berhenti memberikan · `/list-product-roles` — lihat semua.',
            '',
            '❓ **Format harga?** Mata uang APA SAJA: `30000`, `30.000`, `$3`, `€25`, `¥1000`, `Rp 30.000`, `30rb`, `3jt`. Dua mata uang juga bisa (`3$ USD | Rp 25.000` — nominal Rp yang tercatat). Stats mencatat ANGKANYA (currency-agnostic) — pakai SATU mata uang yang konsisten.',
            '❓ **Desimal?** Bisa — `$2.5`, `5.88`, `9.99`, `€9,99` tercatat lengkap dengan cents (stats menampilkan `2.5` / `5.88` / `9.99`; tanpa penanda mata uang pun sah). Grup dot 3 digit tetap ribuan: `50.000` → 50.000. Nominal deal rekber wajib angka bulat.',
            '❓ **Pembeli lihat harganya?** Ya — daftar harga di panel tiket memakai `label` + `price` persis seperti yang kamu tulis.'
        ]
    },
    {
        id: 'keys',
        emoji: '🔑',
        name: 'Key Manager',
        short: 'Stok key produk & jadwal expire member',
        lines: [
            '• `/set-key user:@user value:vip30 key:ABCDE-12345` — set key produk',
            '• `/list-keys user:@user` — key member · `/clear-schedule user clear_keys:true` — bersihkan'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Key = bukti pembelian. Pembeli tunjukkan key, staf verifikasi SEKALI, role + jadwal expire urus sendiri.**',
            '• `/set-key user value key` — daftarkan key, mis. `/set-key value:vip30 key:ABCDE-12345`. Pembeli langsung dapat role produknya, dan jadwal expire diperpanjang sesuai durasi produk (tidak pernah dobel — MAX EXTEND).',
            '• `/list-keys user` — semua key milik member, aktif MAUPUN expired, lengkap dengan tanggalnya.',
            '• `/clear-schedule user` — hapus semua jadwal expire role member; `clear_keys:true` sekalian hapus key-nya + lepas role VIP — bersih total untuk refund/chargeback.',
            '',
            '❓ **Key sudah terpakai?** Tiap key hanya bisa dipakai SEKALI — statusnya kelihatan di `/list-keys`.',
            '❓ **Pembeli kehilangan key?** `/list-keys user` menunjukkan key-nya — tidak perlu cari-cari di DM.'
        ]
    },
    {
        id: 'panels',
        emoji: '🎫',
        name: 'Panel Tiket & Verifikasi',
        short: 'Pasang panel tiket & verifikasi member',
        lines: [
            '• `/setup-ticket-panel` — panel multi-kategori (opsi: `title` `body` `categories` `color` `image` `footer` `channel` `use_dropdown`)',
            '• `/list-panels` `/update-panel` `/refresh-panel` `/delete-panel` — kelola panel',
            '• `/setup-verify` — verifikasi member baru · `/set-verify-button` — kustom tombol',
            '• `/setup-ticket` — panel legacy 1 kategori'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Panel = etalase toko: satu embed dengan tombol — member klik, tiket pribadi dibuka.**',
            '• `/setup-ticket-panel` — pasang. Kustom penuh: `title`, `body`, `categories` (kategori tiket mana yang tampil), `color`, `image`, `thumbnail`, `footer`, `channel`, `use_dropdown:true` (dropdown ringkas pengganti tombol).',
            '• `/list-panels` — semua panel + ID-nya · `/update-panel id field` — edit title/body/color/image/footer lewat modal (tanpa setup ulang).',
            '• `/refresh-panel id` — render ulang dengan kategori/produk TERBARU (jalankan ini setelah tambah produk — kalau tidak, embed masih memakai daftar lama).',
            '• `/delete-panel id` — hapus panel (pesan + config).',
            '',
            '**Verifikasi member baru**',
            '• `/setup-verify` — pasang panel verifikasi: member yang join klik tombol untuk dapat role verified (dan lepas role unverified).',
            '• `/set-verify-button label emoji style` — kustom tampilan tombolnya.',
            '• `/setup-ticket` — panel legacy 1 kategori (dipertahankan untuk setup lama; utamakan `/setup-ticket-panel`).',
            '',
            '❓ **Panel masih menampilkan harga lama?** Jalankan `/refresh-panel id` — atau `/update-panel` untuk teksnya.',
            '❓ **Tidak terjadi apa-apa saat member klik?** Cek permission bot untuk bikin channel + melihat channel di kategori tiket.'
        ]
    },
    {
        id: 'categories',
        emoji: '🗂️',
        name: 'Kategori Tiket',
        short: 'CRUD kategori + auto-split 3 kategori',
        lines: [
            '• `/add-category id:jasa label:"Jasa" emoji:🎮 style:Success requires_key:false`',
            '• `/update-category id:jasa label:...` — edit · `/remove-category` · `/list-categories`',
            '💡 Berproduk → dropdown; tanpa produk → langsung buat tiket.',
            '**Auto-Split** 3 kategori: 🎫 TRANSAKSI (produk) · 🎫 BANTUAN (help/report) · 🤝 REKBER (deal). Nama custom: `ticketCategoryKey` `ticketCategoryNoKey` `midman.category`'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Kategori = pintu di panel. Tiap kategori punya `id`, `label` (yang dilihat member), `emoji` dan `style` tombol (warna).**',
            '• `/add-category id label emoji style requires_key` — mis. `/add-category id:jasa label:"Jasa" emoji:🎮 style:Success requires_key:false`.',
            '• `requires_key:true` — kategori ini jualan produk: member dapat dropdown produk + daftar harga. `requires_key:false` — tiket bantuan/report biasa.',
            '• `/update-category id` — edit label/emoji/style/requires_key tanpa hapus+tambah ulang · `/remove-category id` · `/list-categories`.',
            '💡 Kategori BERPRODUK menampilkan dropdown; TANPA produk, klik langsung membuka tiket.',
            '',
            '**Auto-Split (default): tiket terorganisir ke 3 kategori** — 🎫 TRANSAKSI (order produk) · 🎫 BANTUAN (help/report) · 🤝 REKBER (deal midman). Ganti namanya lewat tipe `/edit-message` `ticketCategoryKey`, `ticketCategoryNoKey`, `midman.category`.',
            '❓ **Sudah tambah produk tapi dropdown-nya tidak muncul?** Jalankan `/refresh-panel id` — embed panel di-render ulang dengan daftar baru.'
        ]
    },
    {
        id: 'midman',
        emoji: '🤝',
        name: 'Midman / Rekber (Escrow)',
        short: 'Deal escrow 3-pihak + fee otomatis',
        lines: [
            '• `/set-role midman @role` — WAJIB di-set sebelum deal dibuka',
            '• `/set-midman-fee mode:Persen value:5` — fee per deal (persen/flat, 0=gratis)',
            '• `/midman-deals` — semua deal aktif',
            '💡 Escrow 3-pihak: pembeli ⇄ penjual, midman pegang dana. Buka lewat tombol **🤝 Rekber** di panel — 3 langkah sampai kedua pihak **Setuju Deal**.'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Rekber = bot jadi wasit dealnya: pembeli & penjual konfirmasi masing-masing, midman lepaskan dana, fee tercatat otomatis.**',
            '**Setup (sekali):**',
            '• `/set-role tipe:midman role:@Midman` — WAJIB sebelum deal bisa dibuka. Staf yang punya role ini jadi petugas rekber.',
            '• `/set-midman-fee mode value` — fee-nya: `mode:Persen value:5` (5%) atau `mode:Flat value:5000` (flat 5.000). `0` = gratis.',
            '• `/midman-deals` — semua deal aktif dalam satu halaman (pembeli, penjual, midman, nominal, status).',
            '',
            '**Alur deal**',
            '1️⃣ Member klik **🤝 Rekber** di panel tiket lalu isi pembeli/penjual/harga → channel deal dibuat berisi ketiganya.',
            '2️⃣ Pembeli & penjual masing-masing tekan **Setuju** — bot mengunci edit setelah keduanya setuju (total 3 langkah).',
            '3️⃣ Midman menyelesaikan: **Complete** (dana dilepas + fee tercatat) atau **Cancel** (semua dibebaskan).',
            '❓ **Deal macet?** `/midman-deals` menunjukkan statusnya; deal yang channelnya terhapus direkonsiliasi otomatis saat startup + harian.',
            '❓ **Format nominal deal?** Wajib angka bulat (`$25,000`, `€2.500`, `Rp 150.000`) — desimal seperti `$2.5` ditolak karena ambigu SENGAJA (keamanan deal). Harga produk boleh pakai cents; nominal rekber tidak.',
            '❓ **Fee masuk stats?** Deal yang selesai tercatat di stats transaksi (nominal deal — mata uang apapun bisa).'
        ]
    },
    {
        id: 'logging',
        emoji: '📜',
        name: 'Log & Channel',
        short: 'Aktifkan server-log, audit, transcript, welcome',
        lines: [
            '• `/set-channel server-log #ch` — log pesan hapus/edit, join/leave, ban',
            '• `audit-log #ch` — aksi admin · `transcript #ch` — arsip tiket',
            '• `/set-channel welcome/goodbye/invoice/server-booster #ch`',
            '• `/test-welcome` — diagnosis kenapa welcome tidak muncul + preview',
            '• `/remove-channel tipe` — matikan salah satu',
            'ℹ️ Tanpa `server-log`, event server tidak dicatat.'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Semua channel opsional — set yang kamu perlukan saja. Satu command untuk semua tipe: `/set-channel tipe:... channel:#ch`.**',
            '• `tipe:server-log` — pesan dihapus/diedit, join/leave, ban, event boost — kotak hitam server.',
            '• `tipe:audit-log` — aksi admin (perubahan config, produk, moderasi).',
            '• `tipe:transcript` — tiket yang ditutup diarsipkan ke sini sebagai file teks.',
            '• `tipe:welcome` / `tipe:goodbye` — embed join/leave. Tes + diagnosa dengan `/test-welcome tipe:welcome` (cek config, channel, permission, dan kirim preview live).',
            '• `tipe:invoice` — invoice pembelian (satu per order selesai).',
            '• `tipe:server-booster` — 🚀 boost mulai/berhenti diumumkan otomatis sebagai embed pink, dan SELALU tercatat di log server + riwayat boost walau channel ini belum diatur.',
            '• `/remove-channel tipe` — matikan salah satu (event yang relevan tetap mengalir ke server log).',
            '❓ **Sudah di-set tapi tidak ada yang masuk?** Jalankan `/test-welcome` untuk welcome/goodbye, `/test-booster` untuk boost, atau cek permission View + Send + Embed bot di channel itu.',
            '❓ **Channelnya terhapus?** Set ulang dengan `/set-channel` — ID channel mati terdeteksi dan dilaporkan saat startup.'
        ]
    },
    {
        id: 'automod',
        emoji: '🤖',
        name: 'Anti-Spam & Auto-Mod',
        short: 'Blocklist kata, whitelist link, action otomatis',
        lines: [
            '• `/set-automod` `/automod-show` `/automod-toggle` — aktifkan & lihat',
            '• `/add-word words:kata1,kata2 action:Mute_10_menit` — kata + sanksinya',
            '• `/remove-word` `/list-words` · `/add-word tipe:Exempt_(kata)` — whitelist',
            '• `/add-link-whitelist` `/remove-link-whitelist` — link diizinkan',
            '💡 Whole-word: "asu" tidak match "asus"'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Auto-mod mengawasi setiap pesan dan langsung bertindak — kamu yang menentukan aturannya.**',
            '**Konfigurasi:**',
            '• `/set-automod` — induk pengaturnya: `spam_threshold` (pesan/ledakan), `spam_action`, `block_links`, `block_words`, `word_action`, `max_mentions`, `mention_action`.',
            '• `/automod-show` — lihat aturan saat ini · `/automod-toggle enabled:false|true` — on/off sekali klik.',
            '',
            '**Blocklist kata:**',
            '• `/add-word words:kata1,kata2 action:Mute_10_menit` — tambah kata (pisah koma, DITAMBAHKAN — tidak mengganti) + sanksinya. `tipe:Exempt_(kata)` malah meng-whitelist kata tersebut.',
            '• `/remove-word word tipe` — hapus satu · `/list-words` — lihat blocklist, whitelist + sanksi per kata.',
            '',
            '**Link & pengecualian:**',
            '• `/add-link-whitelist channel|#ch role|@role` — siapa yang boleh kirim link (channel atau role).',
            '• Pencocokan WHOLE-WORD: "asu" tidak match "asus" — tidak ada alarm palsu karena kata yang lebih panjang.',
            '❓ **Terpicu tapi tidak ada tindakan?** Cek `/automod-show` — apakah aturannya aktif, dan apakah role bot di atas role member itu?'
        ]
    },
    {
        id: 'responder',
        emoji: '💬',
        name: 'Auto-Responder',
        short: 'Auto-reply FAQ saat pesan mengandung trigger',
        lines: [
            '• `/add-responder trigger:beli reply:...` — auto-reply ke pesan yang mengandung "beli"',
            '• `match_mode:contains|exact` — kata di mana saja, atau awal pesan saja',
            '• `/list-responder` · `/remove-responder` — lihat & hapus'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Auto-responder = mesin FAQ: pesan mengandung trigger → bot langsung balas.**',
            '• `/add-responder trigger reply` — mis. `/add-responder trigger:beli reply:"Silakan buka tiket 🎫"` — aktif saat pesan MENGANDUNG "beli" sebagai kata utuh, di mana pun posisinya.',
            '• `match_mode:contains` (default) — kata utuh di mana saja: "cara beli gimana" memicu "beli" — tapi "belian" tidak. `match_mode:exact` — hanya saat pesan DIAWALI trigger (gaya `!sosmed` lama).',
            '• `reply_type` — balasan biasa atau embed · `cooldown` — detik jeda sebelum trigger yang sama bisa aktif lagi (`0` = selalu).',
            '• `/list-responder` — semua trigger + balasan + modenya · `/remove-responder trigger` — hapus satu.',
            '❓ **Dua trigger dalam satu pesan?** Keduanya dibalas — trigger yang cooldown TIDAK memblokir scan (trigger kedua yang match tetap dijawab).',
            '❓ **Tidak aktif?** Trigger multi-kata bisa ("cara beli"); spasi dobel dirapikan; karakter regex di-escape (tidak error).'
        ]
    },
    {
        id: 'roles',
        emoji: '🎭',
        name: 'Role & Self-Role',
        short: 'Role sistem + panel role pilihan member',
        lines: [
            '• `/set-role verified @role` — role sistem (verified/unverified/admin/midman/**booster**) · `/remove-role`',
            '• `/setup-selfrole title:... type:button` — panel role pilihan member',
            '• `/selfrole-add` `/selfrole-remove` — kelola daftar · `/selfrole-list` `/selfrole-delete`',
            '💡 `requires_role:@Verified` — role terkunci syarat'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Role sistem (logika bot)** — `/set-role tipe role`:',
            '• `tipe:verified` — diberikan setelah verifikasi · `tipe:unverified` — disandang sebelum verifikasi · `tipe:admin` — siapa yang boleh pakai command admin · `tipe:midman` — petugas rekber. `/remove-role tipe` menghapus satu.',
            '• `tipe:booster` (v3.9.59) — role Booster: **otomatis** diberikan saat member boost & dihapus saat boost berakhir; saat di-set langsung diterapkan ke booster yang ada. Tes rantainya: `/test-booster`.',
            '',
            '**Panel self-role (pilihan member)** — member klik sendiri untuk ambil/lepas role:',
            '• `/setup-selfrole title description type:button|dropdown exclusive` — pasang panelnya. `exclusive:true` = cuma SATU role dari panel itu dalam satu waktu.',
            '• `/selfrole-add panel_id role label emoji style requires_role` — tambah role ke panel (tampilan tombol + emoji opsional). `requires_role:@Verified` — hanya member yang sudah punya role itu bisa mengambilnya (perk terbatas).',
            '• `/selfrole-remove panel_id role` — keluarkan satu role · `/selfrole-list` — panel + role · `/selfrole-delete panel_id` — hapus satu panel.',
            '❓ **Member tidak bisa ambil role?** Cek `requires_role` di entry itu + posisi role bot (harus DI ATAS role yang dikelolanya).'
        ]
    },
    {
        id: 'leveling',
        emoji: '📊',
        name: 'Leveling',
        short: 'XP per pesan + role otomatis saat level up',
        lines: [
            '• `/setup-leveling` — aktifkan XP per pesan',
            '• `/add-level-role level:5 role:@VIP` — role saat naik level · `/list-level-roles` `/remove-level-role`',
            '• `/rank` — XP sendiri · `/leaderboard-level` — top member'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Leveling = XP aktivitas: member dapat XP per pesan, role terbuka di level tertentu.**',
            '• `/setup-leveling enabled:true` — aktifkan. Penyetelan: `xp_per_message`, `cooldown` (detik antar pesan ber-XP — anti-spam), `announce_levelup` (umumkan level-up atau tidak).',
            '• `/add-level-role level role` — mis. `/add-level-role level:5 role:@Aktif` — diberikan OTOMATIS saat naik level. `/list-level-roles` — semua reward · `/remove-level-role level` — hapus satu.',
            '• `/rank user?` — level + XP kamu (atau member lain) — command publik.',
            '• `/leaderboard-level` — top-10 member berdasarkan level (publik).',
            '❓ **XP tidak dihitung?** Cooldown berlaku — pesan beruntun dalam jendela waktu yang sama tidak mendapat XP (anti-farming).',
            '❓ **Role tidak diberikan saat naik level?** Role bot harus DI ATAS role reward-nya.'
        ]
    },
    {
        id: 'afk',
        emoji: '💤',
        name: 'AFK System',
        short: 'Auto-reply saat user AFK di-mention',
        lines: [
            '• `/afk alasan:...` — set AFK (bot auto-reply saat di-mention)',
            '• `/afk-clear` — kembali aktif · `/afk-list` — siapa saja AFK'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**AFK = "jangan ganggu": selama kamu AFK, siapa pun yang mention kamu langsung dapat auto-reply berisi alasannya.**',
            '• `/afk alasan` — set AFK, mis. `/afk alasan:"belajar, balik jam 8"`. Bisa dipakai admin MAUPUN member (command publik).',
            '• `/afk-clear` — kamu kembali; mention tidak dibalas lagi.',
            '• `/afk-list` — semua yang sedang AFK + alasannya.',
            '❓ **Pulang otomatis?** Tidak — bersihkan dengan `/afk-clear`, statusnya tidak hangus sendiri.'
        ]
    },
    {
        id: 'giveaway',
        emoji: '🎉',
        name: 'Giveaway & Poll',
        short: 'Buat / kelola giveaway & polling',
        lines: [
            '• `/giveaway create channel:#ch prize:... winners:1 duration:60` — mulai',
            '• `/giveaway list` `/giveaway end` `/giveaway reroll` — kelola',
            '• `/poll create` `/poll list` `/poll close` — polling'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Giveaway**',
            '• `/giveaway create channel prize duration winners required_role` — mis. `/giveaway create channel:#event prize:"VIP 30 Hari" winners:1 duration:60` (menit). `required_role` — hanya member yang punya role itu yang boleh ikut.',
            '• `/giveaway list` — giveaway berjalan + ID · `/giveaway end id` — akhiri sekarang (pemenang diundi + diumumkan) · `/giveaway reroll id` — undi pemenang baru untuk yang sudah selesai.',
            '• Peserta = klik reaksi 🎉 — bot mencatat pesertanya sendiri, mencegah dobel-entry, dan me-render ulang embednya di akhir.',
            '',
            '**Poll**',
            '• `/poll create channel question multiple` — mis. `/poll create channel:#umum question:"Nonton bareng?" multiple:true` (member boleh pilih beberapa opsi). Opsinya diketik di modal (2–10).',
            '• `/poll list` — poll berjalan + ID · `/poll close id` — kunci voting + tampilkan hasilnya.',
            '❓ **Jumlah pemenang salah?** Set `winners` saat create; reroll mengundi tepat sebanyak itu lagi.'
        ]
    },
    {
        id: 'announce',
        emoji: '📢',
        name: 'Pengumuman Terjadwal',
        short: 'Kirim pengumuman sekarang / terjadwal',
        lines: [
            '• `/announce channel:#ch title:... description:...` — kirim pengumuman',
            '• `/announce-schedule at:30m recurring:daily` — terjadwal (sekali/berulang)',
            '• `/announce-list` `/announce-cancel` — lihat & batalkan jadwal'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Dua cara mengumumkan: sekarang, atau terjadwal.**',
            '• `/announce channel title description color image thumbnail mention` — kirim satu embed rapi langsung sekarang. `mention` — ping role/@everyone bersamanya.',
            '• `/announce-schedule at recurring` — jadwalkan: `at:30m` (30 menit lagi) atau `at:2026-12-25 09:00`, `recurring:daily|weekly|monthly` atau sekali saja. Pengumuman berulang mengirim sendiri.',
            '• `/announce-list` — semua jadwal tertunda + ID-nya · `/announce-cancel id` — hapus sebelum jalan.',
            '❓ **Zona waktu?** Bot memakai offset TZ yang ter-config — coba jadwalkan beberapa menit ke depan dulu untuk memastikan.',
            '❓ **Edit jadwal?** Batalkan + buat ulang — `/announce-list` menampilkan argumen persisnya untuk dipakai lagi.'
        ]
    },
    {
        id: 'messages',
        emoji: '✏️',
        name: 'Pesan & Embed Builder',
        short: 'Edit teks sistem + kirim embed custom',
        lines: [
            '**Teks sistem:** `/set-message ticketBody teks...` · `/edit-message` (modal) · `/reset-message` · `/list-messages`',
            '**Embed custom:** `/send-message` (form) · `/embed-builder` · `/embed-list` `/embed-cancel`',
            '💡 Vars: `{server}` `{price_header}` `{price_list}` `{price_list:cat}` `{categories_list}`'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Teks sistem — semua embed yang dikirim bot (body panel, pembuka tiket, welcome…) bisa diganti kata-katanya.**',
            '• `/edit-message tipe` — pilih teksnya + edit lewat modal (ramah multi-baris). `/list-messages` — lihat semua teks yang bisa dikustom + isinya sekarang.',
            '• `/reset-message tipe` — kembalikan satu ke default. `/set-message` — varian satu baris.',
            '• Variabel template terisi otomatis: `{server}` (nama server), `{price_header}` + `{price_list}` / `{price_list:cat}` (daftar harga live), `{categories_list}`.',
            '',
            '**Pesan & embed custom**',
            '• `/send-message channel message mention` — teks biasa (dukung \n + mention) — untuk rules, ping, catatan cepat.',
            '• `/announce` — satu embed rapi lewat form (title/description/color/image/thumbnail/mention).',
            '• `/embed-builder` — builder interaktif dengan preview LIVE untuk embed kompleks (banyak field, author, footer). `/embed-list` — sesi kamu · `/embed-cancel session_id` — buang sesi yang macet.',
            '❓ **Daftar harga kosong di teks?** Variabel hanya terisi kalau produknya ada — tambah produk dulu, lalu `/refresh-panel`.'
        ]
    },
    {
        id: 'tempvoice',
        emoji: '🎤',
        name: 'Voice Pribadi',
        short: 'Voice otomatis saat member join trigger',
        lines: [
            '• `/setup-tempvoice` — pasang trigger channel · `/tempvoice-remove` — matikan',
            '💡 Join trigger → otomatis bikin voice pribadi + panel kontrol (rename, lock, transfer)'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Voice pribadi = member dapat voice channel-nya sendiri sesuai permintaan.**',
            '• `/setup-tempvoice` — membuat kategori + channel trigger **Join untuk membuat**. Member join ke situ → voice channel miliknya langsung dibuat dengan panel kontrol di dalamnya.',
            '• Tombol panel kontrol: **rename** channel, **lock/unlock**, **transfer** kepemilikan, **claim** saat pemiliknya pergi, dan auto-delete saat orang terakhir keluar (tidak ada channel zombie).',
            '• `/tempvoice-remove` — matikan fiturnya (kategori + channel terkait ikut dihapus).',
            '❓ **Channel tidak dibuat saat join?** Cek permission Manage Channels bot + pastikan trigger channel-nya tidak dihapus orang.',
            '❓ **Batas?** Discord membatasi jumlah channel per server; server super besar mungkin butuh beberapa trigger channel.'
        ]
    },
    {
        id: 'backup',
        emoji: '💾',
        name: 'Backup & Maintenance',
        short: 'Backup data, restore, reset konfigurasi',
        lines: [
            '• `/backup-now` — backup sekarang (auto 24 jam, maks 7 slot)',
            '• `/backup-list` `/restore-backup` — lihat & pulihkan',
            '• `/reset-config` — ⚠️ HAPUS SEMUA konfigurasi (2-step)'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**Backup melindungi seluruh konfigurasi kamu: produk, key, panel, role, channel, stats, counter server stats, riwayat boost…**',
            '• `/backup-now` — satu backup manual sekarang. Backup keamanan juga jalan OTOMATIS tiap 24 jam.',
            '• `/backup-list` — slot backup (maks 7, terlama terdorong keluar) dengan nama + waktunya.',
            '• `/restore-backup name` — pulihkan semuanya dari satu slot. Backup keamanan baru dibuat DULU sebelum restore — selalu bisa mundur.',
            '• `/reset-config` — ⚠️ kembalikan SEMUA pengaturan ke awal (role, channel, produk, pesan). Konfirmasi 2 langkah — jalankan `/backup-now` dulu!',
            '❓ **Cache langsung bersih setelah restore** — bot memuat ulang data yang dipulihkan saat itu juga, tanpa restart.',
            '❓ **Filennya di mana?** `data/backups/` — jangan diedit manual; pakai command-nya.'
        ]
    },
    {
        id: 'stats',
        emoji: '📈',
        name: 'Statistik',
        short: 'Statistik live, channel counter, booster, leaderboard',
        // v3.9.51: + /serverstats (channel counter live). Baris dikompak supaya
        // embed Semua Command tetap dalam budget 5800 dengan 20 kategori utuh
        // (diukur ulang setiap kali baris berubah).
        // v3.9.58: + /test-booster — baris stats dikompak lagi supaya muat.
        lines: [
            '• `/stats` — statistik server live',
            '• `/serverstats` — channel counter live',
            '• `/boosters` — booster + riwayat',
            '• `/test-booster` — tes notifikasi boost + preview',
            '• `/leaderboard` — peringkat top-10',
            '• `/my-stats` — pesan & transaksi kamu'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja) —
        // kini mendokumentasikan opsi pemilihan counter di setup.
        detail: [
            '**Channel counter live (kayak bot ServerStats):**',
            '• `/serverstats setup` — bikin kategori "📊 STATISTIK SERVER" di PALING ATAS daftar channel. Voice channel yang NAMANYA counter live — member lihat angkanya sekilas, tidak ada yang bisa join.',
            '• **Pilih counter mana yang mau ditampilkan** (v3.9.53): `members bots boosts roles channels` — semuanya AKTIF default; set ke **False** untuk melewatinya, mis. `/serverstats setup bots:false channels:false` hanya membuat 👥 · 🚀 · 🎭. Minimal satu harus tetap aktif.',
            '• `/serverstats remove` — hapus semuanya · `/serverstats refresh` — paksa update sekarang. Untuk GANTI pilihan: `remove` dulu lalu `setup` lagi.',
            '• Update otomatis: member join/left, boost mulai/berhenti, channel & role dibuat/dihapus. Aman rate limit (Discord izinkan 2 rename per channel / 10 menit — update di-throttle + self-heal tiap ±5 menit). Counter terhapus dikasih peringatan; semua hilang → mati otomatis.',
            '',
            '**Notifikasi boost:** member mulai/berhenti boost → embed pink dikirim otomatis ke channel server-booster (`/set-channel tipe:server-booster #ch`), selalu tercatat di log server + riwayat `/boosters`. Kalau role booster di-set (`/set-role tipe:booster @role`), role itu diberikan/dihapus otomatis bersama boost-nya.',
            '• **Tes sendiri (v3.9.58):** `/test-booster tipe:add` (atau `tipe:remove`) — cek seluruh rantainya (channel di-set → ada → izin bot, plus role booster kalau di-set), preview embed PERSIS di sini, dan dengan `live:true` sekalian kirim ke channel aslinya. Simulasi murni — tidak ada yang dicatat.',
            '',
            '**Angka & peringkat**',
            '• `/stats` — ringkasan server: member live, boost, tiket terbuka + aktivitas terlacak (pesan, transaksi). Tanpa baris revenue — belanja bersifat pribadi.',
            '• `/boosters` — daftar booster live + riwayat terbaru (publik).',
            '• `/leaderboard metric` — top 10 berdasarkan pesan / belanja / kemenangan giveaway (publik).',
            '• `/my-stats` — pesan, transaksi + total belanja kamu (publik — halamanmu cuma kamu yang lihat).'
        ]
    },
    {
        id: 'info',
        emoji: '📋',
        name: 'Informasi Bot',
        short: 'Pusat bantuan & lihat semua konfigurasi',
        lines: [
            '• `/help` — pusat bantuan (atau `/help search:kata kunci`)',
            '• `/config-show` — lihat semua konfigurasi bot sekaligus'
        ],
        // v3.9.53: panduan lengkap mandiri (tampilan kategori = detail saja).
        detail: [
            '**/help — pusat kendali**',
            '• `/help` — navigator ini: pilih kategori di dropdown 📂 (semua command dijelaskan), 🔍 **Cari Command** dengan kata kunci, 📖 **Semua Command** untuk daftar lengkap ringkas, atau langsung jalankan `/help search:kata kunci`.',
            '• Tiap tampilan kategori ADALAH panduan lengkapnya — sintaks, perilaku, dan jawaban pertanyaan yang paling sering ditanya.',
            '',
            '**/config-show — satu halaman, semua pengaturan**',
            '• Role, channel, produk, responder, auto-mod, leveling… seluruh konfigurasi dalam satu embed — cek setelah perubahan besar untuk memastikan semuanya beres.',
            '❓ **Command tidak muncul?** Slash command terdaftar ke server saat startup — restart bot kalau baru saja update.',
            '❓ **Permission?** Command admin butuh permission Manage Server; command publik (`/rank`, `/leaderboard`, `/my-stats`, `/boosters`, `/afk`) bisa dipakai siapa saja.'
        ]
    }
];

// === Helpers ===

function findCategory(id) {
    return HELP_CATEGORIES.find(c => c.id === id) || null;
}

function baseEmbed() {
    return new EmbedBuilder().setColor(EMBED_COLOR).setFooter({ text: FOOTER_TEXT }).setTimestamp();
}

/**
 * Hitung total karakter embed seperti cara Discord menghitung limit 6000
 * (title + description + field name/value + footer + author).
 */
function embedTotalChars(embed) {
    const data = embed.data;
    let total = 0;
    if (data.title) total += data.title.length;
    if (data.description) total += data.description.length;
    for (const f of data.fields || []) {
        total += (f.name?.length || 0) + (f.value?.length || 0);
    }
    if (data.footer?.text) total += data.footer.text.length;
    if (data.author?.name) total += data.author.name.length;
    return total;
}

// === Embed builders ===

/**
 * 🏠 Home — index kategori + tugas populer (ringkas, tanpa daftar command).
 */
function buildHomeEmbed(client, user) {
    const mention = user ? `${user}` : 'Admin';
    // Index kategori dipadatkan 3 per baris biar satu layar (tanpa scroll panjang).
    const names = HELP_CATEGORIES.map(c => `${c.emoji} ${c.name}`);
    const rows = [];
    for (let i = 0; i < names.length; i += 3) {
        rows.push(names.slice(i, i + 3).join(' · '));
    }
    return baseEmbed()
        .setTitle('🤖 COMMUNITY BOT — HELP')
        .setDescription(
            `Halo ${mention}! Anda masuk sebagai **Admin/Staff** — ini pusat kendali bot (v${BOT_VERSION}), **${HELP_CATEGORIES.length} kategori command**.\n\n` +
                `**Butuh apa sekarang?**\n` +
                `> 🛡️ Ada member nakal? → **Moderasi** (warn/timeout/kick/ban)\n` +
                `> 🛒 Mau mulai jualan? → **Panduan Cepat** · **Produk** · **Midman/Rekber**\n` +
                `> 👀 Mau pantau server? → **Log & Channel**\n` +
                `> 🎉 Server sepi? → **Giveaway & Poll** · **Leveling**\n\n` +
                `**Cara pakai:**\n` +
                `> 1️⃣ Pilih kategori di dropdown **📂** di bawah\n` +
                `> 2️⃣ Klik **🔍 Cari Command** — ketik kata kunci (mis. \`key\`, \`rekber\`)\n` +
                `> 3️⃣ Atau langsung \`/help search:panel\` tanpa buka menu\n` +
                `> 4️⃣ Klik **📖 Semua Command** untuk daftar lengkap`
        )
        .addFields({ name: `📚 Kategori (${HELP_CATEGORIES.length})`, value: rows.join('\n') });
}

/**
 * 📂 Kategori — detail command satu kategori (embed kecil).
 * Return `null` kalau id tidak dikenal (mis. pesan lama pasca-update bot).
 */
function buildCategoryEmbed(client, categoryId) {
    const cat = findCategory(categoryId);
    if (!cat) return null;
    // v3.9.53 (permintaan user: "tulis ulang /help jadi setiap kategori
    // perintah slash command kasih penjelasan biar member tidak bertanya
    // tanya"): kalau kategori punya panduan `detail`, ITU-lah tampilan
    // kategorinya — penjelasan per-command yang lengkap dan mandiri. Baris
    // `lines` yang ringkas tetap jadi konten embed 📖 Semua Command yang
    // budget-critical (5776/5800 — slack cuma 24 karakter) dan indeks 🔍
    // Pencarian; kategori tanpa `detail` fallback ke `lines` (perilaku
    // sama dengan sebelum v3.9.52).
    const description = (cat.detail || cat.lines).join('\n');
    return baseEmbed()
        .setTitle(`${cat.emoji} ${cat.name}`)
        .setDescription(description)
        .addFields({
            name: '↩️ Navigasi',
            value: 'Ganti kategori lewat dropdown 📂 · Klik **🏠 Menu Utama** untuk kembali · **🔍 Cari Command** untuk pencarian.'
        });
}

/**
 * 📖 All — daftar lengkap SEMUA command (tampilan klasik).
 * Return array 1 EmbedBuilder (kontrak array dipertahankan).
 *
 * v3.9.40 REWRITE: dalam SATU pesan, TOTAL semua embed = 6000 char —
 * "auto-split 2 embed" v3.9.39 TIDAK menambah budget sama sekali (jalur itu
 * dead code — konten saat ini 5.4K < 5.800 — dan kalau katalog tumbuh, split
 * justru bisa bikin total overshoot + embed 1/2 kebagian deskripsi "Lanjutan"
 * yang salah). Sekarang 1 embed dengan GUARANTEE muat selalu:
 *   - Guard 1: setiap field value di-cap 1024 (truncate surrogate-safe + note).
 *   - Guard 2: max 25 field (Discord; saat ini 20 kategori).
 *   - Guard 3: kalau total > budget (5.800), kategori paling belakang di-drop
 *     bergantian + note pengganti yang mengarah ke 📂 dropdown / 🔍 Cari —
 *     total pesan TIDAK PERNAH lewat 6.000, untuk ukuran kategori apa pun.
 */
function buildAllEmbeds() {
    // Guard 1: field value ≤ 1024 — sisakan ruang utk note truncation.
    const capField = lines => {
        const text = lines.join('\n');
        if (text.length <= EMBED_LIMITS.FIELD_VALUE) return text;
        return truncateUtf8Safe(text, EMBED_LIMITS.FIELD_VALUE - 45) + '\n… +baris lainnya tidak ditampilkan.';
    };
    // Guard 2: slice 25 — kategori ke-26+ tidak pernah masuk addFields.
    // (const: hanya di-mutate via pop, tidak pernah di-reassign.)
    const fields = HELP_CATEGORIES.slice(0, EMBED_LIMITS.FIELDS_COUNT).map(c => ({
        name: `${c.emoji} ${c.name}`,
        value: capField(c.lines),
        inline: false
    }));

    const droppedNote = n =>
        `\n\n… +${n} kategori lainnya tidak dimuat (batas ukuran 1 pesan) — pakai 📂 dropdown atau 🔍 Cari Command.`;
    const build = (fs, extra) =>
        baseEmbed()
            .setTitle('🤖 SEMUA COMMAND')
            .setDescription(`_Daftar lengkap semua command (v${BOT_VERSION})._${extra || ''}`)
            .addFields(fs);

    // Budget total SEMUA embed dalam 1 pesan = 6.000 — slack 200 utk overhead
    // note + hitungan embedTotalChars (title/footer ikut dihitung).
    const BUDGET = EMBED_LIMITS.TOTAL_CHARS - 200;
    let dropped = 0;
    let embed = build(fields, '');
    // Guard 3: drop kategori paling belakang sampai total muat (min 1 field).
    while (fields.length > 1 && embedTotalChars(embed) > BUDGET) {
        fields.pop();
        dropped++;
        embed = build(fields, droppedNote(dropped));
    }
    return [embed];
}

// === Search ===

/**
 * Pecah baris kategori jadi "blok": baris bullet (•) + baris lanjutannya
 * (opsi/indent) supaya kalau command match, opsi-opsinya ikut tampil.
 */
function buildBlocks(lines) {
    const blocks = [];
    let current = null;
    for (const line of lines) {
        const isBullet = line.trimStart().startsWith('•');
        if (isBullet || !current) {
            current = [line];
            blocks.push(current);
        } else {
            current.push(line);
        }
    }
    return blocks;
}

/**
 * Cari command di semua kategori. Match: substring case-insensitive di baris
 * command, atau nama/id/deskripsi kategori (kalau nama kategori match, SEMUA
 * isi kategori ditampilkan).
 * Return { query, groups: [{ cat, blocks }], totalBlocks, truncated, emptyQuery }
 */
function searchHelp(rawQuery) {
    // v3.9.40 FIX: cap input 100 char sebelum diproses. Registry slash option
    // kini juga max_length:100, tapi builder ini dipakai DUA pintu (slash + modal)
    // dan modal lama/pesan lama masih bisa lewat — defensive di satu titik ini
    // menutup semua jalur. Tanpa cap, query ribuan char di-echo ke embed hasil
    // → description > 4096 → EmbedBuilder.setDescription throw (uncaught).
    const query = String(rawQuery || '')
        .slice(0, 100)
        .trim()
        .toLowerCase();
    if (!query) return { query: '', groups: [], totalBlocks: 0, truncated: false, emptyQuery: true };

    const groups = [];
    let totalBlocks = 0;
    for (const cat of HELP_CATEGORIES) {
        const catText = `${cat.name} ${cat.short} ${cat.id}`.toLowerCase();
        const wholeCat = catText.includes(query);
        let blocks;
        if (wholeCat) {
            blocks = buildBlocks(cat.lines);
        } else {
            blocks = buildBlocks(cat.lines).filter(block => block.join('\n').toLowerCase().includes(query));
        }
        if (blocks.length > 0) {
            groups.push({ cat, blocks });
            totalBlocks += blocks.length;
        }
    }
    return { query, groups, totalBlocks, truncated: false, emptyQuery: false };
}

/**
 * 🔍 Hasil pencarian.
 */
function buildSearchEmbed(rawQuery) {
    const result = searchHelp(rawQuery);
    const embed = baseEmbed().setTitle('🔍 Hasil Pencarian');

    if (result.emptyQuery) {
        return embed.setDescription(
            'Kata kunci kosong. Klik **🔍 Cari Command** lagi lalu ketik kata kunci (mis. `panel`, `key`, `rekber`).'
        );
    }

    // Cap jumlah baris hasil biar embed tetap kecil & scannable.
    const sections = [];
    let shown = 0;
    let truncated = false;
    for (const group of result.groups) {
        if (shown >= SEARCH_MAX_LINES) {
            truncated = true;
            break;
        }
        const lines = [];
        for (const block of group.blocks) {
            if (shown >= SEARCH_MAX_LINES) {
                truncated = true;
                break;
            }
            lines.push(block.join('\n'));
            shown++;
        }
        sections.push(`**${group.cat.emoji} ${group.cat.name}**\n${lines.join('\n')}`);
    }

    // v3.9.40 FIX: backtick di query bisa menutup inline-code header dan
    // merusak styling sisa embed — sanitize untuk display (match tetap pakai
    // query mentah, hasil identik).
    const safeQuery = result.query.replace(/`/g, "'");
    const header =
        `Kata kunci: \`${safeQuery}\` — ` +
        (result.totalBlocks > 0
            ? `**${result.totalBlocks}** hasil ditemukan`
            : 'tidak ada yang cocok') +
        `\n_Ganti kata kunci lewat tombol 🔍 · 🏠 Menu Utama untuk kembali._`;

    let body;
    if (sections.length === 0) {
        body =
            'Tidak ada command yang cocok. Coba kata kunci lain — mis. `tiket`, `produk`, `role`, `announce`, `warn`, `giveaway`.';
    } else {
        body = sections.join('\n\n');
        if (truncated) {
            body += `\n\n… +hasil lainnya tidak ditampilkan. Coba kata kunci lebih spesifik.`;
        }
    }
    return embed.setDescription(`${header}\n\n${body}`);
}

// === Components ===

/**
 * Baris dropdown kategori — selalu tampil di semua view (navigasi utama).
 */
function buildSelectRow() {
    const select = new StringSelectMenuBuilder()
        .setCustomId(HELP_IDS.SELECT)
        .setPlaceholder('📂 Pilih kategori command…')
        .addOptions(
            // Guard: Discord max 25 opsi per select (20 kategori saat ini —
            // kalau katalog tumbuh > 25, test helpNav gagal duluan).
            HELP_CATEGORIES.slice(0, DISCORD_LIMITS.SELECT_MENU_MAX_OPTIONS).map(
                c =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(c.name)
                        .setValue(c.id)
                        .setDescription(c.short)
                        .setEmoji(c.emoji)
            )
        );
    return new ActionRowBuilder().addComponents(select);
}

/**
 * Baris tombol aksi. `view`: 'home' | kategori/search/all (lainnya).
 * Home: 🔍 Cari + 📖 Semua. View lain: + 🏠 Menu Utama.
 */
function buildButtonRow(view) {
    const buttons = [
        new ButtonBuilder().setCustomId(HELP_IDS.SEARCH_BUTTON).setLabel('🔍 Cari Command').setStyle(ButtonStyle.Primary)
    ];
    if (view !== 'home') {
        buttons.push(new ButtonBuilder().setCustomId(HELP_IDS.HOME_BUTTON).setLabel('🏠 Menu Utama').setStyle(ButtonStyle.Secondary));
    }
    buttons.push(new ButtonBuilder().setCustomId(HELP_IDS.ALL_BUTTON).setLabel('📖 Semua Command').setStyle(ButtonStyle.Secondary));
    return new ActionRowBuilder().addComponents(buttons);
}

/**
 * Komponen lengkap untuk satu view /help.
 */
function buildHelpComponents(view = 'home') {
    return [buildSelectRow(), buildButtonRow(view)];
}

module.exports = {
    HELP_CATEGORIES,
    HELP_IDS,
    SEARCH_MAX_LINES,
    buildHomeEmbed,
    buildCategoryEmbed,
    buildAllEmbeds,
    buildSearchEmbed,
    searchHelp,
    buildHelpComponents,
    buildSelectRow,
    buildButtonRow,
    embedTotalChars
};
