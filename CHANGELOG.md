# Changelog

Semua perubahan penting pada project ini didokumentasikan di file ini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/).

Legend: 🔴 critical · 🟠 high · 🟡 medium · 🟢 improvement

## [3.12.0] — 2026-09-12

### Changed — 🎯 SATU GUILD ID + FASE 3: MODE PUBLIK (ala Dyno)

- 🟢 **`.env` kini hanya punya SATU variabel server: `GUILD_ID`** (permintaan admin: anti bingung). Allowlist `ALLOWED_GUILD_IDS` era v3.11.0 DIHAPUS total — daftar ID multi-server justru bikin bingung saat ganti server. Sekarang ganti server = ganti SATU baris `GUILD_ID` di `.env`, titik. Dua mode: **terisi = mode 1 server** (command instan, event server lain diabaikan) · **kosong = mode publik ala Dyno/MEE6** (command global, muncul otomatis di semua server yang meng-invite bot ±1 jam — tanpa memasukkan guild id manual di mana pun).
- 🟢 **`src/infra/guild.js` disederhanakan:** `getAllowedGuildIds()` (daftar) diganti `getPrimaryGuildId()` (GUILD_ID di-trim, atau null = publik). `isGuildAllowed()` tetap jadi guard SEMUA 11 event handler (kode guard tidak berubah — hanya sumbernya kini tunggal). Log skip join/leave guild asing kini menyebut `GUILD_ID .env` (tetap ter-log ala v3.9.48).
- 🟢 **Registrasi command (ready.js):** GUILD_ID terisi → daftar instan ke guild itu (guild tidak ter-cache → warning "cek ID-nya" + fallback global, tidak crash); GUILD_ID kosong → command GLOBAL — persis cara kerja bot publik besar (Dyno/MEE6): Discord mempropagasi command ke semua server ±1 jam, tanpa guild id manual.
- 🟢 **Gerbang klaim config legacy (configManager):** GUILD_ID terisi → hanya guild itu yang bisa klaim `config.json` lama; kosong → pemanggil pertama (perilaku v3.10.0 dipertahankan).
- 🟢 **Docs FASE 3 (ADMIN_GUIDE):** seksi baru **"Mode Publik ala Dyno + Developer Portal"** — penjelasan cara kerja bot publik (global commands + config per-server otomatis dari ID event), langkah Developer Portal (Public Bot ON, OAuth2 URL Generator dengan scope `bot` + `applications.commands`), aturan verifikasi Discord (wajib saat bot melewati 100 server), dan checklist keamanan sebelum membuka bot ke publik.
- 🟡 **Test suite:** `guildGuard.test.js` di-rewrite untuk kontrak v3.12.0 (18 test, dulu 15) — termasuk **3 PIN ANTI-BINGUNG**: (1) `ALLOWED_GUILD_IDS`/`getAllowedGuildIds` tidak boleh muncul lagi di `src/` manapun, (2) `.env.example` hanya punya satu variabel `GUILD_ID` + mendokumentasikan mode publik, (3) kontrak ekspor `guild.js` tepat 3 fungsi. Total **616**.
- 🟡 `serverLog.test.js`: kontrak guard statis v3.11.0 → v3.12.0 (masih `isGuildAllowed`, sumber kini GUILD_ID tunggal).

### Kompatibilitas

- **.env hanya memakai `GUILD_ID` (deployment umum): TIDAK ADA yang perlu diubah** — perilaku persis sama seperti v3.9.26/v3.11.0 single-guild.
- **.env memakai `ALLOWED_GUILD_IDS` (v3.11.0):** variabel itu kini diabaikan. Pindahkan ID server utama Anda ke `GUILD_ID` (satu server per deployment). Melayani banyak server? Kosongkan `GUILD_ID` → mode publik, config tiap server terisolasi otomatis.

## [3.11.0] — 2026-09-12

### Added — 🛡️ FASE 2 MULTI-GUILD: allowlist ALLOWED_GUILD_IDS

- 🟢 **Guard allowlist `ALLOWED_GUILD_IDS`** (`src/infra/guild.js` — `getAllowedGuildIds()` + `isGuildAllowed()`): daftar server yang boleh memakai bot, dipisah koma/spasi (contoh: `ALLOWED_GUILD_IDS=111...,222...`). Prioritas: `ALLOWED_GUILD_IDS` > `GUILD_ID` > keduanya kosong (mode terbuka = perilaku v3.10.0). Fase 1 (v3.10.0) membuat data per-server AMAN, tapi bot yang di-invite ke server mana pun langsung diproses penuh — fase 2 memberi admin PINTU: server di luar daftar diabaikan total (pesan, join, boost, tiket, voice, interaction).
- 🟢 **Semua 11 event handler bermigrasi ke guard allowlist** (messageCreate, messageUpdate, messageDelete, messageBulkDelete, interactionCreate, guildMemberAdd, guildMemberRemove, guildMemberUpdate, guildBanAdd, guildBanRemove, voiceStateUpdate) — pola `process.env.GUILD_ID && x !== process.env.GUILD_ID` diganti `!isGuildAllowed(x)`. Skip yang tadinya kelihatan (join/leave guild asing) tetap kelihatan, kini menyebut allowlist.
- 🟢 **Registrasi slash command per-guild untuk SEMUA server allowlist** (ready.js): daftar command ke TIAP guild di daftar — instan di semua server sekaligus, dan server di luar daftar bahkan tidak melihat command-nya (bukan cuma diblokir saat dipakai). Guild allowlist yang belum ter-cache (belum di-invite) → warning jelas + tidak crash; kalau TIDAK ADA yang terjangkau → fallback global command (perilaku lama dipertahankan).
- 🟢 **Startup kini per-guild untuk semua server allowlist:** cek channel welcome/goodbye/booster, catch-up boost offline, dan sinkronisasi counter server-stats berjalan untuk SETIAP guild allowlist (dulu cuma guild GUILD_ID / guild pertama yang dicek — guild kedua tidak pernah direkonsiliasi).
- 🟢 **Gerbang klaim config legacy (v3.10.0) ikut allowlist:** allowlist TUNGGAL → hanya guild itu yang bisa klaim `config.json` lama (server lain tidak bisa "mencuri"); allowlist kosong/multi → pemanggil pertama (perilaku v3.10.0).
- 🟢 **`.env.example`** didokumentasikan lengkap: prioritas 3 mode + contoh + cara menambah server baru (invite → tambah ID → restart).
- 🟢 **+15 unit test (total 613):** `guildGuard.test.js` — parsing daftar (koma/spasi/entri kosong/prioritas atas GUILD_ID), guard murni (mode terbuka/anggota/DM null), guard event handler (join guild asing diabaikan + ter-log; interaction asing tidak pernah di-route), gerbang klaim legacy (guild asing dapat DEFAULTS, guild allowlist tunggal klaim + `.migrated`), `startupGuilds` (allowlist/filter/skip guild belum ter-cache), dan kontrak statis ready.js.

### Kompatibilitas
- **.env lama tidak perlu diubah apa pun** — tanpa `ALLOWED_GUILD_IDS`, `GUILD_ID` lama otomatis jadi allowlist satu entri (perilaku persis v3.9.26/v3.10.0). Tanpa keduanya → mode terbuka (persis v3.10.0).
- Menambah server: invite bot → tambah ID ke `ALLOWED_GUILD_IDS` → restart.

## [3.10.0] — 2026-09-12

### Added — 🌍 FASE 1 MULTI-GUILD: config per-server

- 🟢 **Config sekarang PER-GUILD: `data/config/<guildId>.json`.** Sebelumnya satu file global `data/config.json` dipakai bersama SEMUA server yang meng-invite bot — admin server A menjalankan `/set-channel welcome`, server B ikut berubah (timpa-menimpa). Kini tiap server punya file config sendiri. Ini fondasi untuk membuka bot ke publik (hosted multi-server): data layer lain (key, warn, stats, ticket, deal rekber) memang sudah guild-scoped sejak awal — configManager adalah satu-satunya titik data global yang tersisa.
- 🟢 **Migrasi otomatis satu kali:** `data/config.json` lama (era single-guild) dipindah ke `data/config/<guildId>.json` saat guild yang sah pertama kali membaca config. File lama di-rename `config.json.migrated` sebagai jejak audit (tidak dihapus). Aturan klaim: kalau `GUILD_ID` di-set (mode single-guild v3.9.26), hanya guild itu yang boleh klaim — server lain dapat DEFAULTS murni.
- 🟢 **API baru `resolveGuildId(interaction)`** (`src/infra/guild.js`) — satu pintu resolusi ID guild dari interaction (cek `guildId` → fallback `guild.id`), dipakai semua domain command/interaction handler. `getConfig(guildId)` / `saveConfig(guildId, config)` / `setField(guildId, dotPath, value)` kini WAJIB menerima guildId — tanpa guildId langsung throw dengan pesan jelas (fail-fast: bug cross-guild ketahuan saat dev/test, bukan senyap di produksi).
- 🟢 **Cache admin-role permission kini PER-GUILD** (`src/infra/permissions.js`): sebelumnya satu variabel global 30 detik — role admin server A terbaca oleh server B. Sekarang Map per guild dengan TTL yang sama.
- 🟢 **backupManager mendukung direktori:** `FILES_TO_BACKUP` entri `'config'` di-copy recursive (semua `*.json` per-guild ikut). Backup lama (pre-3.10.0, `config.json` datar) tetap bisa di-restore — file legacy diletakkan kembali sebagai `data/config.json` dan diklaim migrasi saat dibaca (tidak menimpa config guild yang sudah aktif).
- 🟢 **`.gitignore`:** folder `data/config/` di-ignore (runtime per-guild).
- 🟡 **19 file test suite di-update** ke pola per-guild: sandbox menulis `data/config/<guildId>.json`, mock interaction membawa `guildId`, dan helper `resetDataFile`/`writeDataJSON` mendukung path bertingkat. Total tetap 598 test — semua hijau.

### Catatan perilaku

- **`GUILD_ID` kosong = mode multi-guild penuh** — event & command dari semua server diproses, slash command teregistrasi global. Kalau bot Anda saat ini single-server, TIDAK ADA yang berubah: set `GUILD_ID` seperti biasa, config lama otomatis dimigrasi saat bot start.
- Fase 2 (next): guard `ALLOWED_GUILD_IDS` (allowlist server publik) + persiapan verifikasi Discord (batas 100 server).

## [3.9.60] — 2026-09-12

### Fixed — 🧪 audit subsistem backup/restore (test merah di fresh clone)

- 🟡 **`modlogs.json` TIDAK PERNAH di-backup — /restore-backup senyap kehilangan seluruh riwayat moderasi.** modLogManager (v3.9.43) sudah 17 versi menulis data/modlogs.json (riwayat timeout/kick/ban per user yang ditampilkan /warn-list), tapi file itu tidak pernah ditambahkan ke FILES_TO_BACKUP — /backup-now melewatinya, snapshot pre-restore melewatinya, dan restore (mis. migrasi server) menjatuhkan semua catatan moderasi tanpa peringatan. Ini melanggar invarian v3.9.24 milik project ini sendiri ("semua file data layer live wajib ada di list"); GUARD file live tidak pernah menangkapnya karena di fresh clone data/ tidak berisi JSON runtime. Fix: 'modlogs.json' ditambahkan ke list + regression test khusus yang bebas environment mematenkan seluruh registry (20 file manager) supaya manager masa depan tanpa entri backup mematahkan CI dengan pasti.
- 🟡 **Penimpaan cache basi pasca-restore untuk boosts.json — store permanen in-memory boostManager tidak pernah di-invalidate.** boosts.json sudah di-restore sejak v3.9.49, tapi daftar invalidasi restore v3.9.26 (stats, serverstats, permissions, panels, automod/afk/responders/levels) tidak pernah diperpanjang saat boosts ditambahkan: boostManager.reload() ada tapi tidak pernah dipanggil. Setelah restore, event boost pertama (diff premium guildMemberUpdate) memutasi objek SEBELUM-restore yang basi dan save() menimpanya ke boosts.json hasil restore → riwayat boost hasil restore hilang senyap. Fix: reload() kini dipanggil di _restoreBackupImpl (pola guard yang sama dengan manager lain) + regression test yang mengisi cache, restore, lalu memastikan cache kini mencerminkan data hasil RESTORE.
- 🟡 **Landmine laten yang sama di modLogManager — jinakkan.** Dengan modlogs.json kini ikut di-restore, cache `store` permanen yang identik bakal menghidupkan kembali bug di atas untuk riwayat moderasi (addModLog() pertama pasca-restore menimpa file hasil restore dengan snapshot sebelum-restore). Fix: reload() publik ditambahkan ke modLogManager dan dipanggil di blok invalidasi restore, dicover regression test yang sama.
- 🟠 **npm test MERAH di setiap fresh clone / CI (asumsi environment GUARD test).** GUARD v3.9.24 men-assert data/ "seharusnya berisi minimal beberapa file JSON di repo dev ini" — benar di mesin dev (file runtime ada), salah di fresh clone atau runner GitHub Actions (semua data/*.json di-gitignore; cuma .gitkeep yang ter-commit di repo EN, dan di repo ini bahkan tidak ada sama sekali). Akibatnya: 1 test gagal di setiap checkout bersih, menutupi kegagalan asli di output suite. Fix: fresh checkout kini melewatkan (SKIP) scan file live (tidak ada di disk → tidak ada yang bisa bolong) dan jaminan kelengkapan registry dipindah ke regression test bebas environment di atas. Regression test juga membuat folder data/ sendiri kalau tidak ada (fresh clone repo ini tanpa .gitkeep) supaya tidak ENOENT.
- 🟢 **+3 unit test (total 598):** backupManager.test.js — modlogs.json di FILES_TO_BACKUP (bolong v3.9.43 dipaten), cross-check registry file manager lengkap (20 file), dan integration test invalidasi cache pasca-restore (isi cache → ubah file live → restore → pastikan file DAN cache kedua manager mencerminkan data hasil restore; membersihkan edit file live-nya sendiri). Hasil suite fresh clone: 598/598 hijau, npm run lint bersih.

## [3.9.59] — 2026-09-12

### Added — 💬 permintaan user: "auto role booster — yang sudah boost server bakal dapet role"

- 🟢 **BARU `tipe:booster` di `/set-role` — role Booster OTOMATIS mengikuti status boost.** `/set-role booster @Booster` mengaktifkan auto-role: member yang boost server langsung **diberi role** itu, dan saat boost berakhir role-nya **dihapus** — semantik yang sama dengan role "Server Booster" bawaan Discord (perk mengikuti boost AKTIF, bukan badge permanen — member yang berhenti bayar berhenti dapat akses). Discord tidak mengizinkan role bawaannya diurutan/diwarna ulang, jadi admin pakai role sendiri untuk perk yang terlihat (channel eksklusif, diskon, warna nama). Penugasan/dicabutnya role otomatis tercatat di server log sebagai entri ROLE_UPDATE biasa (event role-diff yang sama), jadi jejak auditnya utuh tanpa log ganda.
- 🟢 **Penerapan RETROAKTIF saat di-set.** `/set-role booster @role` SEKALIAN memberikan role ke semua member yang SEDANG boost saat itu juga (reply menyebut jumlahnya: "🚀 N member yang sedang boost langsung diberi role ini") — admin tidak perlu menunggu boost berikutnya. `/remove-role booster` hanya mematikan otomatisasinya; role yang sudah terpasang di member TIDAK dicabut (konsisten dengan tipe role lain).
- 🟢 **Sinkronisasi STATE saat startup (boost saat bot offline tidak lolos).** `syncBoostRoles` berjalan setelah reconcile boost di ready.js: setiap booster live yang belum punya role → diberikan (mencakup boost saat offline DAN penugasan live yang dulu gagal — mis. role sempat di atas role bot lalu diperbaiki), boost yang berakhir saat offline → role dihapus. **Pemberian role MANUAL admin ke member biasa tidak pernah disentuh** — sinkronisasi hanya menambah ke booster nyata, tidak pernah mencabut dari non-booster yang bukan mantan booster.
- 🟢 **Diagnosabilitas penuh (pola v3.9.48).** Setiap alasan skip/gagal meninggalkan log penyebab + solusinya: role belum di-set (hint per boost baru), role terhapus/ID ghost, role di atas role bot (pre-check posisi), permission Manage Roles hilang, atau error API saat assign — tidak pernah throw ke event. `/test-booster` ikut memeriksa mata rantai role-nya (set → ada → posisi vs role bot → permission Manage Roles) **tanpa pernah mengutak-atik role** — simulasi tetap murni; reply kini menegaskan "role booster tidak diutak-atik".
- 🟢 **`/help`, `/config-show`, `/remove-role` diperbarui:** baris kompak Role kini memuat booster (verified/unverified/admin/midman/**booster**), panduan Role menambah `tipe:booster` + semantiknya, panduan Statistik menjelaskan auto-role, `/remove-role` punya pilihan Booster, dan `/config-show` menampilkan "Booster (auto)" di daftar Roles. Embed Semua Command tetap aman budget (**5.774/5.800**).
- 🟢 **+18 unit test (total 595) — boosterRole.test.js:** kontrak registry (pilihan booster di set-role & remove-role), applyBoostRole (add sehat, idempotent, remove, remove-tanpa-role, ghost, belum-di-set, roles.add-throw tidak reject, guard posisi), syncBoostRoles (booster-tanpa-role diberikan, grant manual TIDAK dicabut, boost-berakhir dihapus, bot di-skip), event live guildMemberUpdate add/remove memanggil applyBoostRole + riwayat boost tetap tercatat, `/set-role booster` retroaktif (config + role + reply jumlah), diagnosis `/test-booster` (sehat/ghost/belum-di-set) + kemurnian role, dan dokumentasi help + budget. 2 pin regression (helpNav, hardeningV37) dipasang ulang ke baris set-role yang baru.

## [3.9.58] — 2026-09-12

### Added — 🧪 permintaan user: "command test booster"

- 🟢 **BARU `/test-booster` (command ke-92, admin) — versi `/test-welcome` milik fitur boost.** Admin tidak bisa mensimulasikan boost asli (bayar uang sungguhan), jadi sebelum ini seluruh rantai notifikasi tidak bisa dites sampai ada booster beneran. `/test-booster tipe:add` (atau `tipe:remove`) sekarang mendiagnosis **setiap mata rantai** — channel server-booster di-set → ada → izin View/Send/Embed bot — dan mengirim **preview live dari embed yang PERSIS** dikirim boost asli (builder `buildBoostAddEmbed`/`buildBoostRemoveEmbed` yang sama dengan event live — mustahil beda), dengan data kamu sendiri berperan sebagai "booster". Reply-nya juga menampilkan state boost live (level + jumlah) dan catatan intent (deteksi boost = diff premium_since guildMemberUpdate; bot yang online membuktikan intent GuildMembers menyala).
- 🟢 **Opsi `live:true` — tes pengiriman end-to-end penuh.** Sekalian mengirim preview ke **channel server-booster ASLI**, membuktikan embed-nya benar-benar sampai ke tujuan notifikasi asli. Tanpa opsi ini tidak ada yang dikirim ke sana; dengan channel rusak/hilang, kirim asli dilewati dengan alasan jelas (tidak pernah crash).
- 🟢 **SIMULASI MURNI — tidak ada yang dicatat.** Riwayat boost (`/boosters`), server log dan counter live tak tersentuh — command-nya aman dijalankan kapan saja, dan unit test mem-pin `boosts.json` byte-identik setelah run add + remove + live.
- 🟢 **`/help` diperbarui (aman budget):** daftar baris kompak Statistik kini memuat `/test-booster` (baris dikompak supaya embed Semua Command tetap **5.766/5.800** — 20 kategori utuh), panduan Statistik menjelaskan command-nya + `live:true`, dan FAQ Log & Channel kini mengarah ke `/test-booster` untuk channel boost.
- 🟢 **+11 unit test (total 577):** kontrak registry (pilihan, ManageGuild, boolean opsional), mapping router, diagnosis semua-sehat + preview pink dengan konten mention, remove → embed abu-abu tanpa mention, diagnosis channel-belum-di-set / ID-ghost / izin-kurang, pengiriman `live:true` + jalur dilewati, dan guard kemurnian boosts.json.

## [3.9.57] — 2026-09-12

### Fixed — 💬 permintaan user: "biar support harga desimal untuk add produk nya misal 5.88"

- 🟠 **Desimal POLOS kini didukung — "5.88" terbaca 5.88, bukan 588.** Aturan decimal v3.9.55 yang tadinya hanya berlaku kalau ada penanda mata uang (`$2.50`) kini berlaku untuk input polos juga: satu dot dengan **pecahan 1-2 digit = desimal** (`5.88` → 5.88, `9.99` → 9.99, `0.99` → 0.99, `12.99` → 12.99), dengan atau tanpa penanda — flag `intl` dihapus, satu aturan untuk semua input. Kenapa aman: penulisan RIBUAN Indonesia yang sah selalu **grup 3 digit** (`50.000`), jadi `5.88` tidak mungkin format Rupiah yang benar — paling masuk akal admin sedang menulis desimal (bot currency-agnostic sejak v3.9.54). Pecahan 3 digit (`50.000`, `5.880`) dan multi-dot (`1.234.567`) tetap RIBUAN; cabang Rp, harga dua mata uang, dan rekber tidak tersentuh.
- 🟡 **Perilaku yang berubah SENGAJA (input yang tak-valid-as-Rupiah):** `1.50` kini 1.5 (dulu 150), `100.00` kini 100 (dulu 10000), `2.50` kini 2.5 (dulu 250) — penulisan ribuan yang benar tetap `150` / `10.000` / `250`. Bonus: suffix+desimal yang dulu meledak 100x kini konsisten dengan versi komanya (`1.50rb` → 1500, dulu 150.000; `9.99jt` → 9.990.000, dulu 999.000.000).
- 🟢 **`/add-product` / `/update-product`:** daftar format yang diterima kini menampilkan contoh desimal polos (`5.88`), begitu juga deskripsi opsi slash (`Rp 50.000 / $3 / $2.50 / 5.88 / 25rb`). FAQ `/help` "❓ Desimal?" diperbarui — desimal polos sah, grup 3 digit tetap ribuan, nominal rekber tetap wajib angka bulat.
- 🟢 **+3 unit test (total 566):** parsePrice.test.js — matriks desimal polos (`5.88`/`5,88`/`0.99`/`2.50`/`1.50rb`/`1,50rb`/`9.99jt`/`$5.88`/`5.88 usd`) dan ribuan sah & multi-dot tidak berubah (`5.880`/`50.000`/`1.000.000`/`5.000rb` + rekber tetap menolak desimal); 3 pin lama era sentris-Rupiah dipasang ulang ke nilai desimal yang baru; priceValidationError menerima desimal polos. boosters.test.js — price-guard level-command `/add-product price:5.88` → konfirmasi `💰 Tercatat di stats: **5,88** per penjualan` (jalur command PENUH, bukan cuma parser).

## [3.9.56] — 2026-09-12

### Added — 🧪 permintaan user: "tambah untuk test booster sekalian"

- 🟢 **+6 unit test untuk fitur SERVER BOOSTER (v3.9.49) — total 563.** Lima jalur `boostManager.reconcileBoosters` yang belum pernah ter-pin kini diverifikasi: **streak putus & restart saat bot offline** (boostedAt di-refresh ke premium_since baru TANPA menggelembungkan totalBoosts — gap boost tidak teramati Discord, jadi tidak boleh dihitung sebagai event baru), **anggota bot di-skip** (premium_since milik bot tidak pernah dihitung sebagai booster), **guard guild null/rusak** (reconcile pulang kosong tanpa crash), **add saat offline mem-pin boostedAt ke premium_since ASLI** (durasi streak tetap akurat, bukan jam reconcile), dan **getRecentEvents** (limit dihormati, terbaru duluan, bentuk event `{userId, event, at, boostedAt}` lengkap). Plus satu test price-guard level-command untuk desimal internasional v3.9.55: `/add-product price:$5.88` → tersimpan + konfirmasi `💰 Tercatat di stats: **5,88** per penjualan` — memverifikasi jalur command PENUH, bukan cuma parser di parsePrice.test.js. Tanpa perubahan runtime: 563/563 test hijau terhadap perilaku yang sudah ada (prinsip: test mem-pin kontrak, bukan mengubahnya).

## [3.9.55] — 2026-09-11

### Fixed — 💬 pertanyaan user: "angka itu support desimal misal $2.5 USD?"

- 🟠 **Harga desimal internasional kini terbaca BENAR — kesalahan senyap 100x hilang.** Heuristic dot di `statsManager.parsePrice` ditulis di era Rupiah (integer currency, tanpa cents), jadi bahkan setelah v3.9.54 harga berpenanda seperti `$2.50` terbaca **250**, `$9.99` terbaca **999**, `$12.99` terbaca **1299** (dot = ribuan), dan `Math.round` di ekor membuang cents (`$2.5` → **3**, `$1,234.56` → **1235**). Sekarang, kalau ada penanda mata uang NON-Rp: satu dot dengan **pecahan 1-2 digit adalah DECIMAL** (`$2.5 USD` → 2.5, `$2.50` → 2.5, `$9.99` → 9.99, `$12.99` → 12.99, `$0.99` → 0.99, `£ 2.99` → 2.99, koma EU `€9,99` → 9.99, `$2.5k` → 2500), **pecahan 3 digit tetap grup ribuan** (`$50.000` gaya Jerman → 50000, `$1.234.567` → 1234567), dan **cents DIPERTAHANKAN** di nominal yang tercatat (dibulatkan maksimal 2 desimal). Input lama tanpa penanda tidak berubah (`50.000` → 50000, `1.50` → 150, `9.99` → 999); cabang Rp dan pencatatan dua mata uang (`$2.5 USD | Rp 25.000` → 25000) tidak tersentuh.
- 🟢 **`/add-product` & `/update-product` menerima harga desimal** (`$2.5 USD` → valid, `💰 Tercatat di stats: 2.5 per penjualan`) dan daftar format yang diterima kini menampilkan contoh desimal (`$2.50`). Deskripsi opsi slash (`/add-product price`, `/update-product price`) juga menampilkan `$2.50`.
- 🟢 **FAQ `/help` mendokumentasikan desimal (kategori Produk & Rekber):** baris baru "❓ Desimal?" — "Bisa — `$2.5`, `$2.50`, `€9.99` tercatat lengkap dengan cents; grup dot 3 digit tetap ribuan (`$50.000` → 50.000)" — plus FAQ rekber baru "Format nominal deal? Wajib angka bulat — desimal seperti `$2.5` ditolak karena ambigu SENGAJA (keamanan deal)."
- 🟢 **Rekber tetap ketat angka-bulat SENGAJA** (`$2.5` / `$2.50` / `€2,50` → tetap ditolak; `$25,000` / `€2.500` tidak berubah): desimal salah-ketik di deal yang menggerakkan uang sungguhan antar-user lebih mahal konsekuensinya daripada kenyamanannya. Harga produk boleh pakai cents; nominal deal rekber tidak.
- 🟢 Tests: 5 pin lama dipasang ulang ke nilai yang mempertahankan cents (`2.5` → 2.5 tadinya 3, `9.9` → 9.9 tadinya 10, `2,5` → 2.5 tadinya 3, `1,234.56` → 1234.56 tadinya 1235, `1.234,56` → 1234.56 tadinya 1235) + **5 test baru** (matriks cents desimal, grup 3 digit tetap ribuan, no-regression Rp/tanpa-penanda, rekber angka-bulat, `priceValidationError` desimal). Total **557**.

## [3.9.54] — 2026-09-10

### Changed — 🌍 permintaan user: "bot bakal dipakai orang di luar Indonesia juga — hapus saja yang Rupiah-only (atau pakai ide kamu)"

- 🟢 **Harga kini currency-AGNOSTIC: penanda mata uang APA SAJA diterima** — `$3`, `€25`, `£ 20`, `¥1000`, `₩25.000`, `₱500`, `₹99`, `25 usd`, `IDR 30.000`, `3 eur`, … plus semua format lama (`25000`, `25.000`, `25,000`, `Rp 30.000`, `30rb`, `3jt`). Bot mencatat **nominal angkanya** dalam mata uang apapun yang admin pakai untuk harga produknya — tanpa konversi, tanpa penolakan. Harga dua mata uang (`3$ USD | Rp 25.000`) tetap mencatat **bagian Rp** (perilaku v3.9.50 tidak berubah); kalau tidak ada bagian Rp, nominal PERTAMA yang menang (`$3 | €2` → 3). Berlaku untuk KEDUA parser harga: `statsManager.parsePrice` (produk/stats) dan `midmanManager.parsePriceNumber` (deal rekber — cabang v3.9.50 "USD-only → ditolak" dihapus). Pilihan desain (alih-alih menghapus harga total): menghapus sistem harga ikut mematikan stats 💰 Total Belanja / Top Spender — jadi dibuat currency-agnostic supaya semua fitur tetap jalan untuk semua negara.
- 🟢 **Harga USD-only tidak lagi ditolak /add-product & /update-product** — `priceValidationError` kini menerima mata uang apapun; pesan error (untuk string yang benar-benar tak terbaca) mencantumkan contoh internasional (`$3` · `€25` · `Rp 30.000` · `30rb`). Konfirmasi menampilkan `💰 Tercatat di stats: **25.000** per penjualan` — angka polos tanpa prefiks `Rp`.
- 🟢 **/my-stats "Total Belanja" dan /leaderboard "Top Spender" tampil sebagai angka locale polos** (tanpa prefiks `Rp` yang di-hardcode) — benar untuk server yang memakai mata uang APA PUN. Pembeli tetap melihat teks `label` + `price` persis seperti yang ditulis admin di panel tiket (sudah currency-agnostic sejak awal).
- 🟢 **Tampilan rekber currency-agnostic:** `midmanManager.formatRupiah` di-rename jadi **`formatMoney`** (angka locale polos, mis. `95.000` alih-alih `Rp95.000`) — semua ~20 situs tampilan (deal board, instruksi WAITING_PAYMENT, contoh fee, detail audit) diperbarui. Rekber tetap ketat soal angka bulat (`$2.5` → ditolak karena ambigu; `$25,000` / `€2.500` → sah).
- 🟢 **FAQ /help ditulis ulang (kategori Produk & Rekber):** "Format harga?" kini menjawab "mata uang APA SAJA bisa" dengan contoh internasional, bukan "USD-only ditolak: stats dalam Rupiah"; FAQ fee rekber tidak lagi bilang stats dalam Rupiah. Deskripsi opsi slash (`/add-product price`, `/update-product price`, `/set-midman-fee`) kini menampilkan contoh campuran mata uang.

## [3.9.53] — 2026-09-10

### Added — ⚙️ permintaan user: "fitur /serverstats kasih opsi apa saja yang mau di munculin"

- 🟢 **`/serverstats setup` kini punya 5 opsi boolean — `members`, `bots`, `boosts`, `roles`, `channels`.** Semua counter AKTIF default; set ke **False** untuk melewatinya (mis. `/serverstats setup bots:false channels:false` hanya membuat 👥 · 🚀 · 🎭). Mematikan SEMUA-nya ditolak dengan penjelasan ramah. Hanya counter terpilih yang dibuat, disimpan di `serverstats.json`, dan di-refresh — embed konfirmasi dapat field **"Tidak dibuat"** berisi daftar yang dilewati. `/serverstats refresh` kini menampilkan persis counter yang TER-CONFIG (bentuk yang sama dengan konfirmasi setup). Ganti pilihan: `remove` dulu lalu `setup` lagi (terdokumentasi di footer embed konfirmasi).

### Changed — 📖 permintaan user: "tulis ulang /help jadi setiap kategori perintah slash command kasih penjelasan biar member tidak bertanya tanya"

- 🟢 **SEMUA 20 kategori `/help` kini menjadi panduan lengkap mandiri.** Mekanisme `detail` v3.9.52 menjadi tampilan kategori itu sendiri: kalau kategori punya panduan, ITU yang dirender dropdown 📂 — sintaks per-command, perilaku, contoh, dan jawaban ❓ untuk pertanyaan yang paling sering (kenapa member itu tidak bisa dimoderasi, kenapa panel tidak update, kenapa XP tidak dihitung…). Baris `lines` ringkas tetap jadi konten embed 📖 Semua Command yang budget-critical (5.776/5.800 — tidak tersentuh) dan indeks 🔍 Pencarian — tidak ada kategori yang ter-drop, tidak ada yang overflow. Panduan terpanjang: Statistik 1.558/4.096 karakter.
- 🟢 +3 unit test (total **551**): `/serverstats setup` pemilihan counter end-to-end (opsi False dilewati — hanya channel terpilih yang dibuat, key config mengikuti pilihan, field "Tidak dibuat" mencantumkan yang dilewati), penolakan semua-False (tidak ada yang dibuat, config tidak tersimpan, pesan ramah), refresh dengan pilihan parsial hanya menampilkan counter ter-config; helpDetail.test.js re-pin untuk rewrite (semua kategori punya panduan, tampilan kategori merender panduan persis, panduan mendokumentasikan command nyata dari `lines`, embed Semua Command mengecualikan teks panduan + budget + 20 kategori, panduan stats mendokumentasikan opsi pemilihan baru); kontrak registry mem-pin 5 opsi boolean (nama, type 5, opsional, deskripsi ≤100).

## [3.9.52] — 2026-09-10

### Changed — 📖 permintaan user: "Tolong update juga di /help biar sync semua"

- 🟢 **`/help` sekarang mendokumentasikan fitur stats baru di tampilan detail kategori.** Sebuah kategori bisa punya blok `detail` opsional yang HANYA tampil di tampilan kategori 📂 — dokumentasi pakai yang lebih kaya tanpa menyentuh embed 📖 Semua Command (slack budget-nya cuma 24 karakter — 5.776/5.800 — kebocoran detail akan diam-diam meng-drop kategori terakhir dari daftar lengkap) maupun indeks 🔍 Pencarian (yang memindai `lines` ringkas). Kategori tanpa blok `detail` render identik byte-per-byte seperti sebelumnya.
- 🟢 **Kategori Statistik:** cara pakai counter live v3.9.51 — `/serverstats setup` (bikin kategori "📊 STATISTIK SERVER" di paling atas + 5 channel voice khusus tampilan), `remove` / `refresh`, pemicu update otomatis (join/left, boost mulai/berhenti, channel & role dibuat/dihapus), keamanan rate limit (2x ganti nama per channel per 10 menit — throttled + self-heal), peringatan counter terhapus + auto-disable, dan alur notifikasi boost (embed pink → `/set-channel tipe:server-booster #ch`, selalu tercatat di log server + riwayat `/boosters`).
- 🟢 **Panduan Cepat:** baris tambahan opsional menunjuk setup baru ke `/serverstats setup` dan channel notifikasi boost. **Log & Channel:** baris `server-booster` sekarang menjelaskan perilaku pengumuman otomatis.
- 🟢 +8 unit test (total **549**): `helpDetail.test.js` — detail stats mendokumentasikan setup/remove/refresh + counter + rate limit + panduan boost, detail quickstart/logging ada, embed Semua Command mengecualikan teks detail dan mempertahankan 20 kategori dalam budget 5800, kategori tanpa detail render persis seperti sebelumnya, deskripsi tiap kategori ≤ 4096, pencarian hanya memindai lines (command ketemu, frasa khusus detail tidak pernah bocor).

## [3.9.51] — 2026-09-10

### Added — ✨ permintaan user: "fitur stats server secara live yang mirip seperti bot server stats"

**Channel counter server stats live (baru):**

- 🟢 **Command BARU `/serverstats`** (total 91 command, admin): NAMA channel adalah counter live yang ter-update otomatis — pengalaman "bot ServerStats" tanpa bot lain. `setup` membuat kategori **`📊 STATISTIK SERVER`** di PALING ATAS daftar channel + 5 channel voice counter (`👥 Member`, `🤖 Bot`, `🚀 Boost`, `🎭 Role`, `📺 Channel`) dengan nilai live saat ini; `remove` menghapus semuanya + membersihkan config; `refresh` memaksa update langsung (melewati cooldown SEKALI — panggilan admin, jarang, aman).
- 🟢 **@everyone di-deny Connect** di setiap channel counter — display-only (member lihat angkanya, tidak ada yang bisa join). Nilai counter dibaca langsung dari objek guild: `memberCount` (eksak), cache member untuk bot, `premiumSubscriptionCount`, ukuran cache role & channel.
- 🟢 **Auto-update, aman rate-limit:** perubahan member join/leave/boost (`guildMemberAdd/Remove/Update`), pembuatan/penghapusan channel & role (4 file event baru, teregistrasi di index.js) menandai stats *dirty* → tick scheduler 60 detik me-refresh; setiap tick ke-5 (~5 menit) adalah catch-up supaya event terlewat self-heal. Tiga guard menjaga tetap dalam limit Discord **2 rename per channel per 10 menit**: (1) change detection — nama yang tidak berubah = NOL panggilan API, (2) cooldown 5 menit per-channel (rename yang tertunda dicoba ulang di tick berikutnya), (3) refresh dirty-driven — burst join = 1 refresh, bukan 1 rename per join.
- 🟢 **Self-healing:** channel counter dihapus → warning console menyebut perintah solusi; SEMUA counter hilang → fitur auto-disable (tanpa kerja scheduler sia-sia) — jalankan ulang `/serverstats setup`. Setup menolak sopan saat sudah terkonfigurasi (menunjuk `refresh`/`remove`), auto-heal ke setup baru saat semua channel lama hilang, dan me-rollback channel yang setengah dibuat saat gagal parsial (pola anti-orphan v3.9.8). Satu refresh paksa saat startup mensinkronkan perubahan offline.
- 🟢 `serverstats.json` di-backup oleh `/backup-now` & bisa di-restore (cache in-memory di-reload setelah restore — pola fix basi yang sama dengan stats.json). Tidak ada counter "member online" — sengaja: butuh intent privileged GuildPresences (tidak diaktifkan — mengaktifkannya tanpa toggle portal bikin login crash; tanpa itu angkanya akan bohong).

### Changed — ✂️ permintaan user: "fitur total revenue di hapus saja, saya ga terlalu memakai fitur itu"

- 🟢 **`/stats` tidak lagi menampilkan "Total Revenue":** angka revenue agregat bikin kebingungan berulang (v3.9.47/49/50 semuanya soal angkanya yang tidak cocok) dan user tidak memakainya — overview server kini menampilkan data live (member, tiket, boost) + aktivitas terlacak (pesan, rata-rata, kemenangan giveaway, jumlah transaksi) TANPA baris revenue. Belanja pribadi tetap ada di tempat yang per-user dan tidak ambigu: `/my-stats` "Total Belanja" dan `/leaderboard` "Top Spender".
- 🟢 +18 unit test (total **541**): `serverstats.test.js` — builder murni + nilai live, persistensi round-trip + reload, change detection (nol panggilan saat tidak berubah), rename + bypass force + cooldown per-channel, isolasi kegagalan setName, warning channel hilang + auto-disable, scheduler tick dirty-driven + catch-up 5 tick + hardening single-guild, `/serverstats setup` end-to-end (nama live, @everyone terkunci, kategori paling atas, config tersimpan, penolakan, auto-heal, penolakan tanpa permission, rollback gagal parsial), `remove` + `refresh` end-to-end + error ramah saat belum setup, wiring event (guildMemberAdd + channelCreate menandai dirty), kontrak registry 91 + router + TIDAK-public + FILES_TO_BACKUP + help-catalog + budget 5800 + registrasi event index.js; statsDisplay dipasang ulang: TIDAK boleh ada field yang menyebut revenue. Help catalog: baris Statistik dikompak supaya embed Semua Command tetap dalam budget (5.776 / 5.800, 20 kategori utuh).

## [3.9.50] — 2026-09-10

### Fixed — 🐛 laporan user: "saya kasih harga 3$ USD | Rp. 25.000" (revenue masih nyaris tak bergerak)

- 🔴 **Harga dua mata uang tercatat Rp 3 per penjualan:** format harga produk asli user (`3$ USD | Rp. 25.000`) membuat `parseFloat` berhenti di `$` — bagian Rupiah tidak pernah dibaca, jadi tiap penjualan hanya menambah jumlah nyaris tak terlihat dan revenue TETAP terlihat beku meski fix suffix v3.9.49 sudah terpasang. Kedua parser harga (`parsePrice` toko/tiket/key + `parsePriceNumber` rekber) kini membaca nominal yang menempel langsung ke penanda `Rp`: `3$ USD | Rp. 25.000` → **Rp 25.000** tercatat per penjualan — dengan/tanpa pipe, Rp duluan atau USD duluan, dengan/tanpa suffix `rb`/`jt`.
- 🟡 **Harga USD-only kini ditolak dengan penjelasan yang jelas:** `$3` / `3 usd` tidak bisa dikonversi ke Rupiah secara andal (dulu `3$` senyap tercatat Rp 3). `/add-product` & `/update-product` kini menjelaskan bahwa revenue dicatat dalam **Rupiah** dan meminta bagian Rp-nya, mis. `3$ USD | Rp 25.000` — daftar format yang diterima juga menampilkan contoh harga ganda itu.
- 🟢 **`/update-product` kini juga menampilkan nominal yang dicatat:** konfirmasi mencantumkan `💰 tercatat di stats: Rp 25.000 per penjualan` setiap kali harga diubah — visibilitas yang sama dengan `/add-product`, jadi salah ketik harga ganda langsung ketahuan saat update, bukan setelah N penjualan tak terlihat.
- 🟢 Strictness rekber tetap terjaga: kombinasi suffix + pemisah di bagian Rp (`3$ | Rp 1.5rb`) tetap ditolak — guard harga 10x tetap utuh.
- 🟢 +5 unit test (total **523**): format persis dari user + varian umum (pipe, tanpa pipe, Rp duluan, suffix), USD-only → 0, no-regression format Rp, rekber dua mata uang + strictness, dan kontrak `priceValidationError` (dual OK / hint USD-only / sampah ditolak).

## [3.9.49] — 2026-09-10

### Added — ✨ permintaan user: "server booster — biar tau siapa yang boost + dikirim ke channel server booster"

**Fitur Server Booster (baru):**

- 🟢 **Deteksi boost tambah/hilang:** Discord TIDAK punya event boost khusus — bot menurunkannya dari diff `premium_since` di `guildMemberUpdate` (null → tanggal = boost baru, tanggal → null = boost berakhir). Tiap boost mengirim embed perayaan pink (`🚀 BOOST SERVER BARU!` + mention + tanggal mulai + level server) dan tiap berhenti embed abu-abu (`💔 BOOST BERAKHIR`) ke **channel server-booster** — atur dengan `/set-channel tipe:server-booster #channel`.
- 🟢 **BARU `/boosters`** (total 90 command, public): daftar booster live langsung dari Discord (fetch roster lengkap — pendukung paling awal duluan, bot dikecualikan, tiap nama dengan tanggal boost-nya) + level & jumlah boost server + seksi terlacak "Aktivitas Boost Terbaru". Ada empty state ("belum punya booster aktif 🌱").
- 🟢 **`boostManager` (boosts.json):** riwayat booster persisten per user (streak saat ini, `totalBoosts` sepanjang waktu, event terakhir) — tahu siapa yang boost tetap awet melewati restart; **catch-up offline**: saat startup state live direkonsiliasi dengan riwayat (roster member di-fetch dulu), dan perubahan yang terlewat diumumkan dalam SATU embed catch-up gabungan (anti spam) + tercatat di server log (tipe event `BOOST_ADD` / `BOOST_REMOVE`) walau channel server-booster belum di-set.
- 🟢 Event boost juga masuk **server log** (independen dari channel booster) + `boosts.json` kini di-backup `/backup-now` & bisa di-restore.
- 🟢 Pola diagnosabilitas v3.9.48 diperluas: channel server-booster belum di-set / terhapus → warning console dengan perintah solusi persis; gagal kirim menyebut channel + permission yang dicek; cek startup `ready.js` kini mencakup `server-booster` bersama welcome/goodbye.

### Fixed — 🐛 laporan user: "stats server masih belum sesuai — total revenue gak ke update, member tracked vs member live: kalau fungsinya sama bikin satu aja"

- 🔴 **Total revenue nyaris tak bergerak — suffix harga Indonesia salah parse SENYAP:** `25rb` tercatat **Rp 25** bukannya **Rp 25.000** (si 'rb' di ekor tidak pernah di-strip, parseFloat cuma ambil angka depan) — tiap penjualan hanya menambah jumlah nyaris tak terlihat, jadi revenue terlihat beku. `parsePrice` (toko/tiket) dan `parsePriceNumber` (deal rekber) kini paham `rb`/`jt`/`juta` (`25rb` → 25.000, `2jt`/`2juta` → 2.000.000, `Rp 25 rb` → 25.000), suffix terpanjang duluan; format lama tidak berubah, dan ketatnya rekber tetap (suffix + pemisah seperti `1.5rb` tetap ditolak — guard harga 10x).
- 🟡 **Harga produk tidak pernah divalidasi:** `/add-product harga:murah` dulu diterima senyap, dan tiap penjualan berikutnya mencatat Rp 0 ke stats/leaderboard. `/add-product` dan `/update-product` kini menolak harga yang tak terparse beserta daftar format yang diterima, dan konfirmasi tambah menampilkan bagaimana harga dihitung (`💰 Tercatat di stats: Rp 25.000 per penjualan`) — salah format kelihatan saat setup, bukan setelah N penjualan tak terlihat.
- 🟢 **Satu field member, bukan dua:** "Member (live)" + "Member Terlacak" digabung jadi satu `👥 Member` (jumlah live dari Discord), dan "Rata-rata Pesan/Member" kini dibagi jumlah LIVE supaya angkanya cocok dengan yang embed tampilkan. Footer menjelaskan apa yang dihitung revenue (penjualan tiket + rekber).
- 🟢 `/config-show` seksi Channels: **server-log hilang sejak v3.9.43** (bisa di-set tapi tak terlihat) — kini tampil, bersama channel server-booster yang baru.
- 🟢 +15 unit test (total 518): `boosters.test.js` (11 — state boostManager/idempoten/rekonsiliasi dua arah, builder embed murni, event live end-to-end add/remove/senyap, warning channel-belum-di-set beserta perintah solusi, command `/boosters` end-to-end termasuk sorting/bot/empty state, kontrak registry + router + PUBLIC + server-log + help-catalog + backup) + kasus `parsePrice` rb/jt/juta dengan skenario laporan user + guard no-regression + ketatnya midman; statsDisplay diperbarui untuk field member yang digabung.

## [3.9.48] — 2026-09-09

### Changed — 🐛 laporan user: "ada bug — Welcome tidak muncul"

**Diagnostik Welcome & Goodbye (silent failure kini bicara):**

- 🟡 **Hasil investigasi:** jalur kode welcome terbukti JALAN (simulasi end-to-end dengan modul asli: join → role + embed + server log, leave → embed goodbye). Bug sebenarnya adalah **diagnosabilitas**: saat channel welcome belum di-set / terhapus / ID dari server lain, bot TIDAK mengeluarkan log apa pun saat startup MAUPUN saat member benar-benar join — admin tanpa petunjuk, dan tidak ada cara men-test tanpa ada member yang join sungguhan.
- 🟢 **`memberHandler`:** setiap alasan skip kini meninggalkan log + solusi — channel belum di-set → `Solusi: /set-channel welcome #channel`; channel tidak ditemukan → sama + "sudah dihapus, atau ID milik server lain"; gagal kirim → menyebut channel + permission yang harus dicek (Send Messages + Embed Links). Sukses juga di-log (`👋 Welcome terkirim untuk X di #channel`) supaya alurnya kelihatan.
- 🟢 **BARU command `/test-welcome`** (total 89 command): jawaban langsung untuk "kenapa tidak muncul?" — diagnosis setiap mata rantai (config → channel ada → permission bot Lihat/Kirim/Embed di channel itu), mencatat event Join/Leave aktif (bot yang online membuktikan intent GuildMembers NYALA — intent privileged yang mati justru bikin login crash), dan **mengirim embed preview** ke channel sekarang, dibangun builder yang SAMA dengan event asli (`buildWelcomeEmbed`/`buildGoodbyeEmbed` — preview tidak mungkin berbeda dari aslinya). `tipe:welcome|goodbye`.
- 🟢 **Cek startup di `ready.js`:** warning saat channel welcome/goodbye belum di-set atau ID-nya tidak ada di guild (plus perintah solusi); konfirmasi satu baris saat sudah terpasang — salah konfigurasi ketahuan saat boot, bukan saat join acak berikutnya.
- 🟢 **`guildMemberAdd`/`guildMemberRemove`:** event member dari guild lain (GUILD_ID beda) kini KELIHATAN (dulu return diam-diam — join di guild kedua tampak persis seperti "welcome-nya rusak").
- 🟢 Builder embed diekstrak (`buildWelcomeEmbed` / `buildGoodbyeEmbed`, diekspor) — satu sumber kebenaran untuk event asli dan preview `/test-welcome`.
- 🟢 Katalog `/help`: Log & Channel mendokumentasikan `/test-welcome`; embed Semua Command diukur ulang dalam budget 5.800 dengan 20 kategori utuh (5.758 terpakai).
- 🟢 +17 unit test (`welcomeDiagnostics.test.js`, total 503): builder murni, happy path join/leave end-to-end (modul asli + stub), semua warning silent-failure, visibilitas guard GUILD_ID, `/test-welcome` end-to-end lewat modul command asli (sehat / belum di-set / ID hantu / permission kurang / goodbye), kontrak registry + router + ready.js.

## [3.9.47] — 2026-09-09

### Changed — ✨ permintaan user: "trigger 'beli' harus juga menjawab 'bagaimana cara beli' — dan kasih setting pilih exact atau contains" + "stats-nya gak sesuai"

**Match mode Auto-Responder:**

- 🟡 **Laporan user:** trigger hanya aktif kalau pesan DIAWALI trigger — trigger `beli` tidak pernah cocok dengan `bagaimana cara beli`. Sekarang tiap responder punya `matchMode`, dan `/add-responder` punya opsi baru `match_mode`:
  - **Contains (default, juga diterapkan ke entri lama tanpa field ini):** trigger cocok sebagai **KATA UTUH di mana saja dalam pesan** — `beli` aktif pada `bagaimana cara beli` / `mau beli?` — tapi TIDAK pada `belian` / `membeli`. Batas kata sadar huruf/angka (`\p{L}\p{N}` lewat regex Unicode, semua karakter meta trigger di-escape), jadi kata panjang yang sekadar MENGANDUNG trigger sebagai substring tidak memicu alarm palsu. Trigger multi-kata (`cara beli`) didukung, dan whitespace pesan diratakan supaya spasi dobel tetap cocok.
  - **Awal pesan (exact):** perilaku prefix lama — `!sosmed` cocok `!sosmed halo` tapi tidak `oi !sosmed halo`.
- 🟢 Konfirmasi add/list kini menampilkan match mode per entri (dengan contoh `beli` di hint), dan `/list-responder` menampilkannya per baris.
- 🟢 Fix cooldown sekalian: responder yang sedang cooldown tidak lagi membatalkan seluruh scan (`return null`) — loop lanjut, jadi trigger kedua yang overlap (mis. `beli` + `cara beli` dalam satu pesan) tetap bisa membalas.

**Akurasi stats (laporan user: "stats-nya gak sesuai"):**

- 🟡 `/stats` dulu hanya menampilkan angka akumulasi `stats.json`: "Total Member Tracked" (hanya member yang tercatat bot — ≠ jumlah member asli) dan "Total Pembelian VIP" (label bilang VIP, padahal dihitung SEMUA transaksi: order tiket + deal rekber) — tanpa data live server sama sekali, jadi embed-nya jarang cocok dengan yang admin lihat di Discord. Sekarang `/stats` memimpin dengan **data live langsung dari objek guild** (jumlah member asli, tier + jumlah boost, tiket terbuka via helper baru `ticketManager.getActiveTicketCount()`) disusul aktivitas terlacak berlabel jelas, nama server di judul, dan ikon server sebagai thumbnail. "Pembelian VIP" di-rename jadi **Transaksi**.
- 🟡 `/my-stats` menampilkan "Joined Tracking: belum tercatat" untuk semua orang yang gabung sebelum v3.2 — embed kini menampilkan tanggal gabung ASLI dari `interaction.member.joinedTimestamp` (nilai terlacak jadi fallback untuk member partial).
- 🟢 Katalog `/help`: kategori Statistik + Auto-Responder kini menjelaskan apa yang command-nya KERJAKAN (kategori responder juga mendokumentasikan `match_mode`); embed Semua Command diukur ulang supaya tetap di bawah budget 5.800 char dengan 20 kategori utuh (5.709 terpakai).
- 🟢 +22 unit test (total **486**): `responderMatchMode.test.js` (14) — matcher murni (contains/batas-kata/exact/multi-kata/escape-regex/input invalid), default penyimpanan, migrasi entri lama, skenario persis user, interaksi cooldown termasuk fix continue-scan, kontrak registry; `statsDisplay.test.js` (8) — end-to-end `/stats` & `/my-stats` lewat modul command asli dengan interaction stub (field live, regression rename label transaksi, edge boost/tiket/tanggal-gabung, jumlah tiket ter-scope guild, pembersihan sisa test).

## [3.9.46] — 2026-09-09

### Fixed — 🟡 hint console "Message Content Intent" FALSE ALARM padahal intent aktif

- 🟡 **Laporan produksi:** `⚠️ [HINT] Pesan dari thor064747 ... isinya kosong` muncul saat startup padahal bot online dan intent aktif. Bukti intentnya ON: `index.js` meminta `GatewayIntentBits.MessageContent` di payload IDENTIFY — kalau toggle portal OFF, discord.js langsung crash saat login (`Privileged intent provided is not enabled or whitelisted`), jadi bot yang online = intent yang aktif.
- 🟡 **Root cause:** filter hint hanya mengecualikan attachment/sticker/components. Pesan yang memang tanpa teks lolos dan salah didiagnosis: **poll native Discord** (`message.poll`), **pesan GIF picker Tenor** (embed "gifv" tanpa content), dan **pesan sistem** (notifikasi join, pin — `message.type !== 0`). Satu pesan begitu dari member → admin disuruh "memperbaiki" setting portal yang sebenarnya sudah benar.
- 🟢 **Fix:** daftar pengecualian dipusatkan di helper murni yang diekspor `isContentlessByDesign(message)` (attachment, sticker, components, embeds, poll, system, type non-DEFAULT). Hint kini hanya muncul untuk pesan yang seharusnya ber-teks tapi datang kosong — masalah intent yang beneran.
- 🟢 +3 unit test regression (total **464**, `messageContentHint.test.js`): cek murni helper untuk 7 sumber; end-to-end `execute()` dengan `console.warn` di-stub (poll/gif/sistem/attachment → 0 warning); dan kontrak lama tetap — pesan polos kosong tetap memperingatkan tepat sekali per guild per 24 jam.

## [3.9.45] — 2026-09-07

### Fixed — 🔴 hotfix: semua command moderasi crash di cek permission pertama ("TypeError: Cannot read properties of undefined (reading 'ManageMessages')")

- 🔴 **Laporan error produksi:** `npm start` → `/purge` → `Interaction Error: TypeError: Cannot read properties of undefined (reading 'ManageMessages') at moderation.js:193` — ranjau yang sama juga terpasang di `/timeout` `/untimeout` `/kick` `/ban`.
- 🔴 **Root cause:** `src/commands/moderation.js` (baru di v3.9.43) mendestrukturisasi `PermissionFlagsBits` dari `./_shared` — padahal `_shared.js` tidak pernah mengimpor/mengekspornya. Destructuring export yang hilang itu *senyap*: variabelnya hanya menjadi `undefined` saat require, lalu meledak saat cek permission bot pertama membaca `.ManageMessages` / `.ModerateMembers` / `.KickMembers` / `.BanMembers`. Satu bug, enam command mati.
- 🔴 **Kenapa lolos semua gerbang QC (457 test hijau, ESLint 0):** export yang hilang bukan syntax error dan bukan variabel undefined (binding-nya ada), dan tidak ada unit test yang mengeksekusi path cek permission moderasi dengan grafik modul asli — test kontrak handler-nya statis.
- 🟢 **Fix (satu baris export):** `_shared.js` kini mengimpor & mengekspor ulang `PermissionFlagsBits` dari discord.js — pola satu pintu `_shared` tetap utuh, keenam command moderasi hidup lagi.
- 🟢 +2 unit test regression (total **461**, `sharedExports.test.js`): **(A)** `_shared` wajib mengekspor `PermissionFlagsBits` discord.js asli (referensi objek sama + 5 bit yang dipakai moderasi/rekber); **(B)** jaring pengaman kelas bug — semua identifier yang di-destructure dari `require(..._shared)` di mana pun di `src/**` dicocokkan saat test dengan exports runtime, jadi export yang hilang berikutnya gagal di CI, bukan crash di produksi saat user pertama kali menjalankan command-nya.

## [3.9.44] — 2026-09-06

### Changed — ✨ user request: "/warn kok masuk kategori Scheduled Announce — tolong baca sync semua fitur & susun ulang /help biar mudah dipahami"

**Redesign total katalog `/help` — 20 kategori diurut prioritas pemakaian:**

- 🟢 **Fix keluhan utama:** `/warn` `/warn-list` `/warn-remove` `/warn-clear` **pindah ke kategori Moderasi** (dulu nyangkut di "Scheduled Announce & Warn" — janggal). Moderasi kini satu pintu lengkap: warn → timeout → kick → ban + purge, dengan penjelasan tangga sanksi (3=mute 1j, 5=mute 1h, 7=kick).
- 🟢 **Kategori baru 🚀 Panduan Cepat** — urutan setup server baru dalam 5 langkah (`/set-role verified` → kategori & produk → panel tiket → verifikasi → server-log). Admin baru tidak perlu menebak harus mulai dari mana.
- 🟢 **Struktur diurut ulang dari yang paling sering dipakai:** Panduan Cepat → Moderasi → Produk → Key → Panel → Kategori → Rekber → Log & Channel → Auto-Mod → Responder → Role → Leveling → AFK → Giveaway → Pengumuman → Pesan & Embed → Voice → Backup → Stats → Info.
- 🟢 **Kategori amburadul dirapikan:**
  - "Scheduled Announce & Warn" → **Pengumuman Terjadwal** (murni announce, tanpa warn).
  - "Announce, Embed & Backup" → dipecah jadi **Pesan & Embed Builder** + **Backup & Maintenance** (backup & reset-config bukan sekadar "announce").
  - "Stats & Lainnya" → **Statistik** murni; `audit-log` pindah ke **Log & Channel**, `reset-config` pindah ke **Backup & Maintenance**.
  - **`/set-channel` tadinya tersebar di 3 kategori** → kini satu pintu di **Log & Channel** (server-log, audit-log, transcript, welcome, goodbye, invoice + penjelasan tiap tipe).
- 🟢 **Home 🏠 baru** — seksi "Butuh apa sekarang?" (member nakal? → Moderasi · mau jualan? → Panduan Cepat · mau pantau? → Log & Channel · server sepi? → Giveaway & Leveling) memandu admin langsung ke kategori yang tepat tanpa harus membaca semua.
- 🟢 Setiap command kini diberi **penjelasan 1 frasa** — admin baru tidak perlu menebak fungsi command dari namanya saja.
- 🟢 **Budget "📖 Semua Command" tetap aman** — seluruh 20 kategori tetap muat dalam 1 embed (5.579 dari budget 5.800 char; versi lama 5.752) — guard drop kategori tidak aktif, tidak ada kategori yang disembunyikan.
- 🟢 Pencarian otomatis ikut struktur baru — `search:warn` kini mendarat di **Moderasi**; kategori lama (id `schedule`/`selfrole`/`channels`/`announce` lama) di pesan ephemeral lama tetap aman diklik (fallback ke home, bukan crash — mekanisme yang sudah ada).
- 🟢 +2 unit test kontrak regression (total **459**): `/warn*` wajib di Moderation & kategori announce tidak boleh menyentuh warn; Panduan Cepat di urutan pertama + kategori baru (logging/backup/stats/info) wajib ada.

## [3.9.43] — 2026-09-06

### Added — 🛡️ user request: "paket moderation lengkap + log server untuk delete message edit message dan lain lain"

**Paket moderasi lengkap — 6 command baru (total 88):**

- 🟢 **`/timeout user duration reason`** — mute sementara; `duration` dalam **menit** (60 = 1 jam, 1440 = 1 hari, maks 40320 = 28 hari — limit Discord); DM alasan ke member (best-effort); tercatat di riwayat moderasi + audit log (`MOD_TIMEOUT`).
- 🟢 **`/untimeout user reason`** — lepas mute lebih awal; hanya jalan kalau user memang sedang di-mute (`isCommunicationDisabled()`), tidak menimpa timer orang lain.
- 🟢 **`/purge amount user?`** — hapus pesan massal 1–100; filter opsional per-user; pesan **>14 hari otomatis dilewati** (limit API bulk delete) dengan laporan jumlah yang dilewati; 1 pesan → delete tunggal (bulkDelete butuh ≥2); log audit `MOD_PURGE`.
- 🟢 **`/kick user reason`** — DM dikirim SEBELUM kick (konteks member masih ada, delivery paling pasti); tercatat + audit.
- 🟢 **`/ban user reason delete_days?`** — `delete_days` 0–7 (limit API `deleteMessageSeconds`); DM sebelum ban; tercatat + audit.
- 🟢 **`/unban user_id reason`** — pakai User ID string (user tidak ada di guild); validasi snowflake 17–20 digit; cek ban list dulu supaya pesan error-nya jelas; tercatat + audit.

**Guard & desain (unit-tested, `src/infra/moderationGuards.js`):**

- 🟢 **Hierarki dua arah**: role moderator *dan* role bot wajib lebih tinggi dari target — setingkat = ditolak (konsisten `/warn` v3.9.8); tolak self/bot/bot-target.
- 🟢 **Parity limit dua sisi**: batas opsi slash command (min/max value) = batas guard runtime (40320 menit, 100 purge, 7 hari) — tidak bisa bocor lewat salah satu sisi.
- 🟢 **Permission bot dicek awal** (ModerateMembers/KickMembers/BanMembers/ManageMessages) dengan pesan Indonesia yang jelas — bukan error mentah "Missing Permissions" dari API.
- 🟢 **`MODERATION_COMMANDS` gate di router**: moderator non-admin dengan Discord permission sesuai kini boleh pakai command moderasi — staff tidak perlu role admin bot (least privilege; guard hierarki tetap jalan di handler).
- 🟢 **modLogManager (`data/modlogs.json`)** — tindakan TIDAK dihitung sebagai warn (sanksi tidak ganda: 3x timeout tidak memicu auto-mute tambahan); tapi tampil di `/warn-list` seksi **"⚡ Catatan Moderasi"** — 0-warn user dengan riwayat moderasi tetap tampil (pull sebelum early-return); description di-guard `truncateUtf8Safe` 4096.

**Server Log — 8 event server ke channel baru `server-log` (terpisah dari `audit-log`):**

- 🟢 **Pesan dihapus** (`messageDelete`) — isi pesan + **siapa penghapusnya** (deteksi executor via audit log Discord, window 60 detik — menangkap penghapusan manual dari UI Discord, satu-satunya cara melihat isi pesan terhapus); partial → catatan "tidak di-cache".
- 🟢 **Pesan diedit** (`messageUpdate`) — before/after + link pesan (bukti seller ganti harga setelah deal); skip edit tanpa perubahan konten (pin/embed-only).
- 🟢 **Purge massal** (`messageBulkDelete`) — jumlah + executor; menangkap purge manual & AutoMod, bukan cuma `/purge` bot.
- 🟢 **Join/leave** (di `guildMemberAdd`/`Remove`) — umur akun (deteksi akun baru), total member; **kick manual dari UI Discord terdeteksi** via audit MemberKick (beda label dengan leave biasa).
- 🟢 **Ban/unban** (`guildBanAdd`/`Remove`) — termasuk ban manual dari UI Discord; executor + reason resmi dari audit log.
- 🟢 **Role & nickname berubah** (`guildMemberUpdate`) — deteksi penipu ganti identitas / role akses dadakan; partial old state → skip per-seksi.
- 🟢 Guard semua handler: single-guild `GUILD_ID` (pattern v3.9.26), skip bot (anti banjir log embed sendiri), fetch audit best-effort (tanpa ViewAudit Log tetap jalan), `logServerEvent` **tidak pernah throw** + truncate field 1024/25/6000 (event error tidak boleh crash bot); tanpa channel ter-set semua no-op.
- 🟡 **Intent `GuildBans` diaktifkan** di `index.js` — tanpa itu event ban/unban TIDAK pernah nyala (intent reguler, tanpa toggle Developer Portal). TANPA INI: fitur ban log mati senyap.
- 🟢 **`/set-channel` & `/remove-channel`** kini mengenal tipe `server-log`; label audit `MOD_*` (6) ditambahkan.

### Tests

- 🟢 +21 unit test (total **457**, dari 436): `tests/unit/moderation.test.js` (12) — guard hierarki/limit behavioral, modLogManager roundtrip + file korup karantina, parity registry↔guard, router mapping + gate moderator, kontrak handler (timeout dipanggil, DM best-effort, filterBulkDeletable, deleteMessageSeconds v14), integrasi /warn-list (urutan pull sebelum early-return, guard 4096), label audit; `tests/unit/serverLog.test.js` (9) — logServerEvent behavioral (channel belum di-set → false, embed judul/warna/field, truncate 1024 + 25 field, send throw → false tanpa re-throw), snip, findAuditExecutor (window/target/channel), registrasi event + intent GuildBans, guard per event file. Full suite 457/457 hijau, ESLint 0 warning.

## [3.9.42] — 2026-09-05

### Changed — 🔔 user request: "DM owner voice jangan lewat DM, cukup beritahu lewat chat voice saja"

Notifikasi **owner baru temp voice** tidak lagi dikirim via DM — sekarang dikirim ke **text chat voice channel itu sendiri** dengan mention owner baru (ping notifikasi tetap jalan). Berlaku untuk kedua jalur perpindahan ownership:

- 🟢 **Auto-transfer (owner keluar dari voice)** — sebelumnya DM ke member paling senior yang mewarisi channel; DM sering gagal senyap (DM user ditutup — `catch (_) {}` menelan error) atau tidak terbaca. Sekarang: pesan `🎁 <@ownerBaru> Kamu sekarang owner voice channel...` muncul di chat voice channel, terlihat semua member di dalamnya.
- 🟢 **Transfer manual via panel** — pola yang sama; plus `oldOwnerId` kini di-capture eksplisit **sebelum** `transferOwnership` menimpa registry, supaya pesan "Ownership dipindahkan ke kamu oleh <@ownerLama>" tidak bergantung pada objek in-memory yang bisa berubah kalau `load()` suatu saat di-cache.

### Tests

- 🟢 +3 unit test (total **436**, dari 433): `tests/unit/voiceNotify.test.js` — kontrak statis anti-regresi: (1) auto-transfer lewat `voiceChannel.send` bukan `newOwner.send` + mention owner baru, (2) transfer manual lewat `found.channel.send` + urutan capture `oldOwnerId` sebelum `transferOwnership`, (3) regression: domain temp voice bebas DM owner baru. Full suite 436/436 hijau, ESLint 0 warning.

## [3.9.41] — 2026-09-05

### Fixed — 🔍 Debug ulang atas laporan error produksi ("Interaction Error: ExpectedConstraintError — s.string().lengthLessThanOrEqual()")

Pemicu: user melaporkan spam error di log bot produksi setiap kali modal **kirim embed** dibuka. Akar masalah: `TextInputBuilder.setLabel` punya limit Discord **45 karakter** — label versi Inggris `'Message outside the embed (optional, supports @)'` (48 char) dan `'Message outside the embed (leave empty to remove)'` (49 char) **melebihi limit** → builder throw sebelum modal sempat tampil. Versi Indonesia kebetulan masih ≤ 45 (`Pesan di luar embed (opsional, support @)` = 40) — itulah kenapa bug ini hanya muncul di repo EN: fix batasan v3.9.27 sebelumnya hanya meng-cover alur tiket, dan file embed EN lolos dari audit karena dicek dari twin ID-nya.

- 🟠 **Modal "Kirim Embed ke Channel" mati total di repo EN** — label 48 char → `ExpectedConstraintError` SETIAP kali tombol kirim diklik → flow kirim embed tidak pernah bisa dipakai. Fix: label dipendekkan jadi `'Message outside the embed (optional)'` (36 char); hint @-mention tetap utuh di placeholder (limit 100).
- 🟠 **Modal "Set Message (Plain Text)" mati total di repo EN** — label 49 char → throw yang sama. Fix: label 36 char; hint "leave empty to remove" dipindah ke placeholder.

### Audit — 🛡️ sweep menyeluruh seluruh batasan komponen Discord (bukan cuma yang error)

Scan otomatis seluruh source kedua repo terhadap SEMUA limit builder: TextInput label ≤ 45 / placeholder ≤ 100 / `setMaxLength` ≤ 4000, Modal title ≤ 45, Button label ≤ 80, Select option label & description ≤ 100 (klasifikasi call-site via constructor terdekat). Hasil: **0 pelanggaran literal tersisa** di kedua repo; semua titik dynamic (template literal) terverifikasi sudah ter-guard fix v3.9.26/27 (`.slice(0,45)` modal tiket, `.slice(0,100)` placeholder select) atau ter-bounded oleh validasi input (label produk ≤ 80, question poll ≤ 250, field panel ≤ 9 char, tipe config ≤ 17 char).

### Tests

- 🟢 +4 unit test (total **433**, dari 429): `tests/unit/componentLimits.test.js` — (1) scan statis nol pelanggaran literal di seluruh src/ (**jaring pengaman permanen** — PR yang menambah label kepanjangan langsung merah dengan pesan file:baris), (2) kontrak runtime semua label/title modal di `embed.js` vs builder discord.js ASLI (bukan mock), (3) dokumentasi batasan (46 char throw / 45 lolos), (4) regression spesifik modal kirim embed. Full suite 433/433 hijau, ESLint 0 warning.

## [3.9.40] — 2026-09-04

### Fixed — 🛡️ Audit menyeluruh pasca-v3.9.39 ("cek keseluruhan kode + sinkron docs"): 6 bug nyata + hardening + docs sync

Review 3 domain paralel (escrow/scheduler, tiket/automod/data-layer, /help redesign) atas hasil v3.9.38 & v3.9.39 — **semua fix v3.9.38 terkonfirmasi benar** (transitionLocks, gate isCompleted, fresh re-read giveaway, dll.) dan **cross-check 82 command registry vs katalog help bersih** (0 command hilang/stale). Bug baru yang ditemukan & diperbaiki:

- 🟠 **`/help search:<query panjang>` crash** — opsi slash string Discord bisa sampai 6.000 char; query ≥ ±3.875 char di-echo ke embed hasil → description > 4096 → `EmbedBuilder.setDescription` THROW (uncaught) → fitur error diam-diam. Kini: `max_length: 100` di registry (konsisten dengan modal yang sudah 100) + cap 100 di `searchHelp` (defensive — nutup dua pintu sekaligus); backtick di query di-sanitize supaya tidak merusak styling header embed.
- 🟠 **`/giveaway end` manual dengan 0 peserta senyap** — `isManualAnnounce` mensyaratkan `winnerIds.length > 0`; giveaway sepi (tanpa peserta) di-skip TOTAL: pesan giveaway tidak di-edit (tombol 🎉 Join masih hidup & bisa diklik!), tidak ada announce "berakhir tanpa pemenang" — padahal admin melihat pesan sukses "pesan giveaway sudah diupdate + winner sudah di-DM + diumumkan". Kini penanda jalur manual yang benar: `skipPick && ended` → embed berakhir + tombol disabled + announce tanpa pemenang terkirim.
- 🟠 **Verifikasi tiket transient → tiket dobel** — `findActiveTicketFor` pada error 429/5xx tetap return `null` (meta aman di disk, tapi caller menganggap "tidak ada tiket aktif") → `createTicket` membuat channel KEDUA untuk user ber-tiket live (2 meta aktif, guard invoice/isCompleted terpecah). Kini: throw berkode `TICKET_VERIFY_TRANSIENT`; `createTicket` + 3 call-site rekber (pick buyer/seller) menangkapnya dan meminta retry — invariant 1-tiket-aktif-per-user terjaga.
- 🟠 **Race tutup-tiket vs completion** — admin B klik "❌ Tutup Tanpa Selesai" / "✅ Selesai" saat admin A masih memproses Set Key / Kirim Pesanan (memegang `completionLocks`) → channel + meta dihapus duluan → flow A menulis ke meta hilang → pembeli tetap dapat key/role/invoice tapi transcript terarsip "Dibatalkan" (record kontradiktif). Kini kedua tombol close menolak dengan "⏳ sedang diproses admin lain" selama lock dipegang.
- 🟠 **Replay interaction PARALEL dobel-eksekusi** — v3.9.38 memindahkan mark dedup ke SETELAH handler sukses (benar untuk crash-retry), tapi membuka window: replay gateway yang datang SELAMA handler masih jalan lolos check + guard replied → handler jalan 2x paralel (toggle selfrole bisa ter-revert). Kini: guard `inFlightInteractions` (drop senyap — instance pertama yang memegang token interaction); semantik crash-retry v3.9.38 tetap utuh.
- 🟡 **Reconcile deal zombie bisa kebangkit** — `reconcileZombieDeals` menghapus meta deal yang channel-nya sudah tidak ada TANPA cek `transitionLocks`; kalau handler sedang memproses transisi di channel yang sama, `setDeal`-nya menulis ulang meta yang barusan dihapus → zombie hidup lagi (buyer/seller terkunci `hasActiveDealFor` sampai 24 jam). Kini reconcile skip deal yang sedang di-lock.
- 🟢 **Hardening minor**: guard limit "📖 Semua Command" untuk katalog raksasa (field value ≤ 1024 + fields ≤ 25 + guarantee total ≤ 6.000 dengan note pengarah ke dropdown/search — menggantikan jalur split-2-embed v3.9.39 yang dead code & bisa overshoot); izin channel "ghost member" di-revoke saat fresh-check rekber gagal setelah grant; transcript escape ``` di konten user (fence code block tidak rusak); customId `help_*` asing di-ack dengan pesan ephemeral (bukan "interaction failed" merah); `require('discord.js')` di automodManager di-hoist keluar hot-path; log GC ">30h" → ">30 hari" (sesuai konstanta 30 hari).

### Docs — 📚 sinkronisasi dokumentasi ke kode aktual (temuan audit docs)

- 🟢 Versi dokumen stale dibenerin semuanya: `docs/ADMIN_GUIDE.md` header & footer (3.9.37 → 3.9.40), `docs/README.md` (3.9.30 → 3.9.40), jumlah unit test di ketiga dokumen (248/324/412 → **429**), "16 managers" → **18** (sesuai file aktual `src/data/`), "50 action types" → **63** (sesuai `ACTION_LABELS`).
- 🟢 Tip baru di ADMIN_GUIDE Section 1: cara pakai `/help` navigator interaktif (dropdown 19 kategori + Cari Command + `/help search:`) — sebelumnya fitur v3.9.39 tidak terdokumentasi di body panduan.

### Tests

- 🟢 +17 unit test (total **429**, dari 412): `tests/unit/hardeningV40.test.js` — query panjang/backtick (slash+modal), registry max_length, stress katalog 49 kategori & field raksasa (guard 1024/25/6000 + note), giveaway manual end 0 peserta, transient throw + createTicket abort (invariant 1-meta), race close-vs-completionLocks (2 tombol), replay paralel in-flight + retry pasca-throw, reconcile skip locked deal, transcript fence ``` , ack customId help asing; + update kontrak test transient v3.9.38 (null → throw `TICKET_VERIFY_TRANSIENT`). Full suite 429/429 hijau, ESLint 0 warning.

## [3.9.39] — 2026-09-04

### Changed — 🚀 /help redesign: navigator interaktif — cari command tanpa scroll (user-reported: "satu embed utuh, nyari harus scroll")

`/help` dulu mengirim SATU embed raksasa (±5.400 char, 18+ kategori di 1 halaman) → admin harus scroll jauh untuk mencari command. Sekarang `/help` menjadi **navigator interaktif** dalam satu pesan ephemeral yang bisa diklik-klik:

- 🟢 **🏠 Home (default)** — index 19 kategori dipadatkan (3 per baris) + instruksi pencarian. Embed hanya ±860 char — muat 1 layar.
- 🟢 **📂 Dropdown kategori (String Select Menu)** — pilih 1 dari 19 kategori (emoji + nama + deskripsi singkat) → detail command kategori itu saja ditampilkan (embed kecil). Dropdown tetap terpasang di semua view untuk lompat kategori tanpa balik ke home.
- 🟢 **🔍 Cari Command (tombol + modal)** — ketik kata kunci bebas (`key`, `rekber`, `vip`...) → hasil instan, dikelompokkan per kategori, match substring case-insensitive; kalau kata kunci mengenai NAMA kategori, seluruh isi kategori ditampilkan. Hasil di-cap 20 blok (dengan note "+hasil lainnya") supaya embed tetap kecil & scannable.
- 🟢 **`/help search:<kata kunci>` (opsi slash baru)** — pencarian langsung tanpa buka menu (autocomplete Discord membantu klien yang sudah hapal).
- 🟢 **📖 Semua Command (tombol)** — tampilan daftar lengkap lama tetap tersedia untuk yang prefer scroll; auto-split 2 embed jika > 5.800 char (total gabungan tetap ≤ 6.000 dalam 1 pesan).
- 🟢 Semua navigasi pakai `interaction.update()` → **satu pesan yang sama di-edit**, tidak spam pesan baru tiap ganti kategori; customId stabil (tanpa suffix id) → pesan `/help` lama yang masih terbuka tetap bisa diklik setelah bot restart.
- 🟢 **Arsitektur**: seluruh isi help kini single-source-of-truth di `src/ui/helpCatalog.js` (katalog 19 kategori + builder embed + engine pencarian + builder komponen) — dipakai bersama oleh slash command (`src/commands/help.js`) dan handler interaksi baru (`src/interactions/help.js`, prefix router `help_`). Tambah kategori baru = tambah 1 entry di katalog, dropdown/home/search/all otomatis ikut.
- 🟢 **Defensive**: value dropdown tidak dikenal (pesan lama pasca-update katalog) → fallback ke home dengan aman, bukan "interaction failed"; query kosong/modal kosong di-handle dengan pesan panduan.

### Tests

- 🟢 +26 unit test (total **412**, dari 386): `tests/unit/helpNav.test.js` — integritas katalog (id unik, ≤25 opsi select, label/desc ≤100 char, semua view ≤ 4096/6000 char), search engine (case-insensitive, whole-category match, blok bullet membawa baris opsi lanjutan, empty/no-result, cap hasil), slash command (home/search/whitespace), handler interaksi (dropdown known/unknown, showModal required, modal submit, tombol home/all, customId asing), routing prefix `help_`, regression konten lama (Auto-Split 3 kategori, midman, use_dropdown, update-category/product) — 3 test lama yang mengunci struktur embed raksasa di-update ke struktur navigator. Full suite 412/412 hijau, ESLint 0 warning.

## [3.9.38] — 2026-09-04

### Fixed — 🛡️ Audit menyeluruh v3: 34 bug/issue diperbaiki lintas seluruh domain (rekber, tiket, data layer, automod, router)

Audit penuh seluruh codebase (~23.400 baris) menemukan 34 issue nyata — semuanya diverifikasi dengan bukti kode sebelum diperbaiki. Dua di antaranya berdampak langsung ke alur uang escrow.

- 🔴 **Observer add/remove deal bypass `transitionLocks`** — handler 👥 Tambah Member / ➖ Keluarkan Member menulis snapshot deal STALE ke disk setelah await permission → transisi tervalidasi (mis. Dana Masuk) bisa TERREVERT: deal mundur state, history hilang, DISPUTE bisa unfreeze tanpa resolve admin. Kini: lock transisi di-acquire + deal di-RE-READ fresh setelah await sebelum ditulis.
- 🔴 (lanjutan) **Race dobel-submit formulir deal** — re-submit dropdown penjual saat window in-flight menciptakan 2 deal + 2 channel untuk pasangan buyer/seller sama. Kini: session pending dihapus SEBELUM await + re-check `hasActiveDealFor` tepat sebelum `setDeal`.
- 🟠 **Self-healing tiket hapus meta tiket AKTIF saat error transient** — `findActiveTicketFor` men-treat 429/5xx sebagai "channel hilang" → meta terhapus → user bisa buka tiket kedua + guard invoice/isCompleted hilang. Kini hanya error code 10003 (Unknown Channel) yang memicu cleanup (mirror pola rekber).
- 🟠 **Set Key tanpa gate `isCompleted`** → invoice dobel di channel testimoni + stats dobel + pembeli dapat 2 key. Kini: gate di tombol + re-check di modal + lock per-channel (`completionLocks`) yang juga melindungi Kirim Pesanan & tombol ✅ Pesanan Sukses (race 2 admin → recordPurchase dobel).
- 🟠 **Giveaway dobel-end** — scheduler pakai snapshot stale vs `/giveaway end` manual (namespace lock berbeda) → winner ditimpa + announce/DM 2×. Kini: re-load fresh dari disk setelah lock + `/giveaway end` cek `isGiveawayProcessing()` dulu.
- 🟠 **`linkAllowedRoles` = whitelist SEMUA automod** — role yang di-whitelist untuk link jadi bebas spam/kata terlarang/mass-mention. Kini: split `isUserWhitelisted` (admin-only) vs `isLinkAllowed` (khusus cek link).
- 🟡 **`parsePriceNumber("1.5m")` → 15.000.000** (desimal jadi digit ekstra, inflasi 10×) — kini separator hanya valid sebagai grup ribuan (`1.000.000` ✓, `1.5m` → ditolak).
- 🟡 **Meta tiket simpan label produk, bukan value** — rename produk mematikan Set Key di semua tiket terbuka (fix v3.9.26 tidak efektif); label dobal → role salah. Kini meta menyimpan `productValue` + helper `resolveProduct()` (value-first, label fallback untuk tiket lama).
- 🟡 **Poll multi-choice: unvote tidak pernah jalan** (klik opsi yang sudah di-vote = no-op senyap) — kini toggle beneran untuk single & multi.
- 🟡 **Cooldown 0 tidak bisa matikan responder** (`0 || 3000`) & **leveling** (`0 || 60000`) — kini `??` (nullish): 0 = off sesuai dokumentasi.
- 🟡 **`containsLink` miss domain polos** (`discord.gg/xxx`, `t.me/x`) — kini regex TLD kurasi match domain tanpa scheme/www.
- 🟡 **Kata exempt menutupi kata terlarang terpisah** (`"asus asu"` lolos) — kini exempt di-mask per-occurrence SEBELUM deteksi.
- 🟡 **`/setup-ticket` crash saat body + `{price_list}` > 4096** — kini di-validasi pre-send dengan pesan jelas.
- 🟡 **`/config-show` crash di ~12 produk** (field > 1024) & **`/announce-list` crash di ~27 entry** — kini di-cap dengan note "+N lainnya".
- 🟡 **`/announce-schedule` klaim WITA tapi parse timezone host** — VPS UTC = telat 8 jam. Kini offset eksplisit default +8, configurable via env `TZ_OFFSET_HOURS`.
- 🟢 **Transcript hanya 100 pesan terakhir** (bukti transfer di awal hilang) — kini paginasi sampai 1000 pesan + note truncation.
- 🟢 Key kosong (spasi) ditolak di 3 lapis; **raw key tidak lagi bocor ke console** (masking len-only, pesan error duplikat tanpa nilai key).
- 🟢 `endGiveaway` kini set `endedAt` (GC akurat); **AFK di-GC** (entry >30 hari di-prune oleh `pruneStaleData`); `parsePrice` tolak harga negatif.
- 🟢 Deal terminal zombie (channel gagal dihapus ≠ 10003) ikut di-reconcile; creator pihak ketiga masuk `observers` (bisa dikeluarkan lewat tombol); `handleEvent` deferReply duluan (tidak lagi "interaction failed" >3s).
- 🟢 Temp voice orphan saat music bot keluar terakhir — event bot kini tetap menjalankan cleanup channel kosong.
- 🟢 `/set-role` validasi role assignable (@everyone/managed/posisi di atas bot ditolak); `/announce` + `/announce-schedule` validasi tipe channel (kategori/forum ditolak); `/help` auto-split 2 embed saat > 5800 char; dedup router mark-AFTER-success (replay interaction yang crash bisa retry); whole-word boundary unicode-aware (Cyrillic/CJK); truncation surrogate-safe (`truncateUtf8Safe`).

### Tests

- 🟢 +62 unit test (total **386**, dari 324) di 5 file baru: `hardeningV38Midman` (12 — lock interleaving, TOCTOU, parse), `hardeningV38Ticket` (12 — transient fetch, race 2 admin, productValue, transcript 150 pesan), `hardeningV38Data` (12 — giveaway double-end, poll toggle, cooldown 0, AFK GC), `hardeningV38Automod` (14 — bare domain, exempt masking, whitelist split, unicode, bot voice cleanup), `hardeningV38Router` (12 — TZ offset, dedup retry, set-role validation, truncateUtf8Safe). Full suite: 386/386 hijau, ESLint 0 warning.

## [3.9.37] — 2026-09-02

### Fixed — 🐛 /help kedaluwarsa + audit menyeluruh v2: 5 bug/issue pasca-fitur rekber (user-reported: "auto split masih 2")

Permintaan user: kesalahan di `/help` (fitur middleman sudah ada tapi Auto-Split masih tertulis **2 kategori**) + baca keseluruhan kode & sync semuanya. Fix `/help` sekaligus audit kedua yang menemukan 5 issue nyata — dua di antaranya berdampak serius ke alur rekber.

- 🟠 **/help Auto-Split 2 → 3 kategori** (bug user-reported): sekarang menyebut **🎫 TRANSAKSI / 🎫 BANTUAN / 🤝 REKBER** + key custom `midman.category`; ditambah section **🤝 Midman / Rekber (Escrow)** (`/set-role midman`, `/set-midman-fee`, `/midman-deals` + ringkasan alur 3 langkah); daftar role kini menyebut `midman`; typo "TAU" → "ATAU".
- 🟢 **Versi embed /help kini dinamis** dari `package.json` (footer + description) — sebelumnya hardcode `v3.9.26` padahal bot sudah jauh lebih baru; tidak akan stale lagi.
- 🔴 **`deals.json` bolong dari FILES_TO_BACKUP** — `/backup-now` & `/restore-backup` TIDAK mem-backup data deal rekber (fitur v3.9.32). Konsekuensi: restore = semua deal escrow aktif **terputus** (meta hilang; pembeli/penjual terkunci selamanya). Ditemukan guard test "file live wajib di-backup" begitu deals.json ada di `data/`. Kini di-backup penuh.
- 🟠 **Deal zombie terkunci selamanya → self-healing** (paritas dengan tiket): deal non-terminal yang channel-nya dihapus manual dari UI Discord selama ini bikin pembeli/penjual **tidak bisa buka tiket reguler / dipilih di deal baru** selamanya, dan `/midman-deals` menampilkan link mati. Kini di-reconcile otomatis: saat **startup** (ready.js 6b) + **harian** oleh scheduler tick (guard per-hari). Transient error (5xx/network) TIDAK menghapus deal — hanya channel yang benar-benar hilang (null / error 10003) yang dibersihkan.
- 🟠 **Router `ticket_cat:midman` kini exact-match** — kategori custom yang id-nya diawali `midman` (mis. `midman_jual`, valid per CATEGORY_ID_REGEX) sebelumnya kena prefix-match → jatuh ke fallback domain midman → tombol **mati tanpa reply** ("interaction failed"). Kembali di-route benar ke domain ticket.
- 🟡 **Penjual deal kini juga dicek tiket aktifnya** — dulunya hanya pembeli yang dicek (asimetri kebijakan 1-channel-aktif-per-user): user dengan tiket terbuka bisa jadi penjual deal.
- 🟢 **Teks panel tidak lagi menyesatkan**: deskripsi dropdown kategori rekber "Bantuan / buka tiket langsung" → "Deal escrow rekber — 3 pihak"; warning `findEmptyCategoryWarnings` tidak lagi menyarankan "tambah produk ke kategori midman" (produk di kategori midman memang tidak pernah tampil — klik selalu buka deal); pesan `/list-categories` config kosong "Default 4 kategori" → **5** (termasuk midman); pesan console migration config kini menyebut midman; ADMIN_GUIDE "4 tombol default" → 5.
- 🟢 **Label audit log MIDMAN_xxx + SET_MIDMAN_FEE** — sebelumnya tampil sebagai raw action string di channel audit log (inkonsisten dengan konvensi label v3.9.4/v3.9.17).
- 🟢 **Hardening kecil**: guard `<@&undefined>` di pengumuman dispute saat role admin belum di-set (jadi fallback **Admin**); guard `deal.history` bukan-array di remove-member (mirror guard handler lain); transcript chunk kosong (code block blank saat sisa hard-split tepat 1900 char) tidak dikirim.

### Tests

- 🟢 +12 unit test (total **324**, dari 312): `tests/unit/hardeningV37.test.js` — router exact-match (kategori `midman_jual` → ticket domain, tombol `ticket_cat:midman` → midman domain), warning/deskripsi panel rekber, label audit, isi /help (3 kategori + section midman + versi dinamis), reconcile zombie deal (null/10003/transient/terminal + wrapper harian), formulir deal 3-langkah (penjual ber-tiket ditolak + happy-path regression), transcript tanpa chunk kosong, pin `deals.json` di FILES_TO_BACKUP.
- 🟢 Test lama yang mengunci literal `v3.9.26` di /help di-update: sekarang menyamakan dengan `package.json` (future-proof).

## [3.9.36] — 2026-09-02

### Changed — 🧹 Code cleanup: audit menyeluruh (37 lint warning → 0), dead code dihapus, typo pesan diperbaiki

Audit final menyeluruh seluruh kodebase (permintaan "cek keseluruhan lagi"): semua 37 warning ESLint dibersihkan jadi **0 error 0 warning**, code sampah (dead code, variabel/import tak terpakai, require redundan) dihapus, dan satu pesan warning yang terpotong diperbaiki. Tidak ada perubahan perilaku — 312 unit test tetap hijau tanpa perubahan test.

- 🟢 **Dead code dihapus** — fungsi yang tidak pernah dipanggil/di-export: `formatTimeLeft` duplikat di `giveawayManager.js` DAN di `scheduledAnnouncements.js` (keduanya tanpa pemanggil — sisa refactor v3.9.26), `findOwnerVoiceChannel` di `tempvoice.js` (komentarnya meng-claim "dipertahankan untuk backward compat / digunakan di beberapa handler" — ternyata tidak dipakai di mana pun), `save()` legacy di `statsManager.js` (tidak di-export, tak pernah dipanggil).
- 🟢 **Variabel/junk assignment dihapus** — `timeLeft` (announce), `newConfig` (automod-toggle), `found` + `newName` (tempvoice rename path), `prefix` (afkManager listGuildAFK), `total = 0` + `pct = 0` (poll create — template sudah hardcode "0 votes (0%)"), parameter `i`/`k` tak terpakai di map/filter.
- 🟢 **Import tak terpakai dibersihkan** — `ChannelType` (panels-mgmt, poll), `createPoll` (commands/poll), `ModalBuilder`/`TextInputBuilder`/`TextInputStyle`/`saveConfig`/`DEFAULTS`/`safeEditReply` (interactions/config), `getConfig`/`saveConfig` (responder), `path` (safeWrite).
- 🟢 **Require redundan disatukan** — `require('./_shared')` dobel di `leveling.js` di-merge; lazy `require('discord.js')` 2× di dalam fungsi `schedulerTasks.js` di-hoist ke top-level (discord.js selalu sudah ter-load saat bot start); alias `PFB` di `voiceStateUpdate.js` dihapus (menggunakan import `PermissionFlagsBits` yang sudah ada di atas); lazy `require('../data/statsManager')` 3× di `ticket.js` di-hoist ke import utama (`_shared` sudah memuat statsManager secara transitif — lazy require murni redundan).
- 🟡 **Typo pesan diperbaiki** — warning `completeNonKeyOrder` di `ticket.js`: `"produk X tidak ditemukan di config — auto-role & tidak diproses"` terpotong & janggal → `"auto-role tidak diproses"` (akurat: stats tetap tercatat, hanya auto-role yang dilewati).
- 🟢 `catch (err)` dengan `err` tak terpakai → `catch (_err)` di 8 lokasi (afk/automod/level/responderManager, levelManager, keys ×2, auditLog, permissions) — konsisten konvensi `^_` yang sudah dipakai codebase.
- 🟢 Escape tak perlu dihapus: `\`` di dalam single-quoted string (giveaway reroll hint).

## [3.9.35] — 2026-09-02

### Fixed — 🎫 Tiket: tombol "Tutup Tanpa Selesai" tidak berfungsi (kedua tombol sama-sama membatalkan penutupan)

Bug user-reported pada tiket non-transaksi (**bantuan / help / report / claim / giveaway**): saat admin klik 🔒 Tutup Tiket, konfirmasi ephemeral menampilkan 3 tombol — ✅ Selesai, ❌ Tutup Tanpa Selesai, ⏏️ Batal Tutup. Namun tombol **❌ Tutup Tanpa Selesai** salah wiring ke customId `ticket_close_abort` — **customId yang sama dengan ⏏️ Batal Tutup**. Akibatnya kedua tombol berperilaku identik (hanya membatalkan penutupan): tiket non-transaksi **tidak bisa ditutup tanpa diselesaikan** — satu-satunya jalan adalah ✅ Selesai (transcript tercatat sukses, padahal tidak) atau hapus channel manual dari UI Discord (tanpa transcript/meta cleanup).

- 🟠 **Tombol "❌ Tutup Tanpa Selesai" kini benar-benar menutup tiket** — memakai customId baru `ticket_close_cancel` yang di-handle bersama `ticket_close_cancel_trans` (satu perilaku: `closeTicket(channel, user, isSuccess=false)` — transcript tersimpan & ditandai **tidak selesai**, channel dihapus, metadata tickets.json dibersihkan, tanpa invoice). Dulu: keduanya cuma menampilkan "❌ Penutupan tiket dibatalkan."
- 🟢 **"⏏️ Batal Tutup" konsisten di semua skenario** — kini memakai `ticket_close_abort` juga di cabang help/report (dulunya `ticket_close_abort2`). CustomId `_abort2` **tetap di-handle** untuk ephemeral lama yang masih terbuka saat bot update (tidak ada dead button).
- 🟢 **Pesan konfirmasi help/report dirinci per tombol** (pola yang sama dengan cabang transaksi non-key): "✅ Selesai — selesai, transcript ditandai sukses / ❌ Tutup Tanpa Selesai — tutup tiket sekarang, transcript ditandai tidak selesai".
- 🟢 Defense-in-depth tetap berlaku untuk tombol baru: re-check admin (non-admin ditolak) + validasi channel adalah tiket terdaftar (forged customId tidak bisa menghapus channel sembarangan).

### Tests

- 🟢 +7 unit test (total **312**, dari 305): `tests/unit/ticketCloseButtons.test.js` — komposisi row konfirmasi tiket help & claim_giveaway (customId benar, unik, label benar), klik `ticket_close_cancel` di tiket help/report → channel terhapus + meta bersih, klik `ticket_close_abort` → tiket tetap hidup, non-admin ditolak, kompatibilitas customId `ticket_close_abort2` lama.

## [3.9.34] — 2026-09-02

### Changed — 🤝 Rekber: buat deal oleh siapa saja (formulir eksplisit) + persetujuan ganda + kelola member di dalam channel deal

Redesign alur buat deal berdasarkan arah pengguna: **siapa pun boleh open ticket rekber** (pembeli, penjual, atau pihak yang menolong) — yang penting **formulirnya jelas menyebut siapa pembeli & siapa penjual**, dan **member bisa ditambah/dikeluarkan di dalam channel deal**.

- 🟢 **Formulir 3 langkah (peran eksplisit)** — sebelumnya yang klik tombol 🤝 Rekber otomatis dianggap pembeli (seller tidak bisa membuka deal; kalau nekat, perannya terbalik dan arus uang bisa terbalik). Sekarang: (1) modal item + harga, (2) **pilih 🛒 PEMBELI** via dropdown member searchable (`mm_pick_buyer`), (3) **pilih 🏷️ PENJUAL** (`mm_pick_seller`) → channel deal dibuat dengan peran yang benar. Semua pilihan tetap cukup ketik nama — tanpa mention/copy ID. Validasi (member ada, bukan bot, tidak pegang deal/tiket aktif) dijalankan pada pihak yang dipilih; validasi gagal → dropdown dirender ulang di pesan ephemeral yang sama (tidak perlu isi ulang modal). Creator pihak ketiga (mis. midman yang menolong) tetap dapat akses channel deal-nya.
- 🟡 **Persetujuan ganda (state `WAITING_AGREE`)** — menggantikan `WAITING_SELLER`. Karena creator bisa siapa saja, terms (item+harga) terkunci HANYA setelah **pembeli & penjual dua-duanya** klik **🤝 Setuju Deal** (`applyAgreement()` pure — klik pertama = persetujuan parsial: tercatat di history, board update menampilkan ✅/⏳ per pihak, pihak yang belum di-ping; klik kedua = transisi `join` → `WAITING_PAYMENT`). Guard aktor join kini `buyer` + `seller`. Deal lama `WAITING_SELLER` **dimigrasi otomatis** saat load (buyerAgreed=true — pembeli lama = penulis terms, setuju implisit; sellerAgreed=false; field `observers` diisi `[]`).
- 🟢 **👥 Tambah Member / ➖ Keluarkan Member di dalam channel deal** — tombol baru di baris ke-2 Deal Board (semua state non-terminal, khusus midman/admin; observer & peserta ditolak dengan pesan jelas). Tambah: dropdown member searchable (`mm_pick_member`) → grant akses lihat/chat/attach (bukan peserta transaksi — `resolveActor` tidak mengakuinya, jadi tidak bisa menggerakkan deal; maks 10 per deal). Keluarkan: dropdown berisi observer saat ini (`mm_remove_pick`) → hapus akses. **Pembeli/penjual tidak bisa dikeluarkan** — urusan mereka lewat batal deal/dispute. Setiap add/remove tercatat di history deal + audit log (`MIDMAN_MEMBER_ADD`/`MIDMAN_MEMBER_REMOVE`) + field baru **👀 Member Tambahan** di Deal Board. Ini juga solusi resmi untuk "salah menambahkan member": keluarkan lewat tombol (tercatat), bukan edit permission manual di UI Discord (tidak tercatat).
- 🟢 Router: prefix `mm_` kini menangani user select (`mm_pick_buyer`, `mm_pick_member`) + string select (`mm_remove_pick`) — filter `isUserSelectMenu`/`isStringSelectMenu` sudah ada; hanya mapping domain yang dikonfirmasi.

### Security

- 🔴 Fix potensial saat build permissionOverwrites channel deal: overwrite creator pihak ketiga dibangun **kondisional** di array (bukan inline dengan `allow: undefined`) — pola lama pada percobaan awal berisiko menimpa deny `@everyone` dan membocorkan channel; versi final tidak menyentuh overwrite `@everyone`.

### Tests

- 🟢 +14 unit test (total **305**, dari 291): `applyAgreement` (parsial/both/double-click/non-peserta/urutan penjual-duluan), kontrak caller `applyAgreement`+`recordTransition`, observer (add/remove/principal/duplikat/limit 10/invalid), migration deal `WAITING_SELLER` (disk diverifikasi bentuk baru + idempotent + deal lain tak tersentuh), router dispatch `mm_pick_buyer`/`mm_pick_member`/`mm_remove_pick`, persistensi menyesuaikan field ternormalisasi.

## [3.9.33] — 2026-09-02

### Changed — 🤝 Rekber: pilih penjual via dropdown + fee ditambah di atas harga

Dua revisi desain atas fitur rekber v3.9.32, keduanya dari feedback penggunaan nyata:

- 🟢 **Pilih penjual lewat dropdown member (User Select Menu)** — sebelumnya pembeli harus mengetik mention/user ID penjual di modal (`parseSellerInput`), yang menyulitkan user dengan nama susah / yang tidak tahu cara copy ID. Sekarang buat deal jadi **2 langkah**: (1) modal item + harga, (2) **dropdown daftar member Discord** dengan kolom pencarian, avatar, dan nama — cukup ketik nama, tanpa mention, tanpa copy ID. Data langkah 1 disimpan sementara (in-memory, TTL 15 menit = umur ephemeral, auto-prune). Router kini juga menerima interaksi `isUserSelectMenu()` (`mm_pick_seller`). Validasi lengkap tetap dijalankan saat penjual dipilih (re-check deal/tiket aktif, anti-self, anti-bot, member harus ada).
- 🟢 **Fee model ADDITIVE — ditambah di atas harga, bukan dipotong dari dana penjual.** Contoh: harga 100.000 + fee 5% (5.000) → pembeli transfer **105.000**, penjual menerima **100.000 PENUH**, midman menyimpan 5.000. Implementasi: `calcTotals(price, fee)` (pure, di-unit-test) jadi sumber tunggal hitungan; cap `Math.min(fee, price)` di `calcFee` dihapus (tidak relevan untuk fee additive); `/set-midman-fee` tetap membatasi persen maks 90% sebagai sanity guard.
- 🟢 **Deal Board & messaging disesuaikan**: field baru `💳 Total Dibayar Pembeli` (harga + fee) dan `🏷️ Diterima Penjual` menampilkan harga penuh "tanpa potongan"; deskripsi state `WAITING_PAYMENT`/`WAITING_RELEASE` kini menampilkan nominal persis (total transfer / jumlah pencairan penuh + fee midman); pengumuman `fundin` menyebut nominal yang masuk; pengumuman `release` menyebut pencairan penuh + fee; mode & nilai fee di-snapshot ke record deal (`feeMode`, `feeValue`) supaya board deal berjalan tidak berubah saat config diubah admin.
- 🟢 **Invoice & stats mencatat pengeluaran nyata pembeli** (harga + fee), transcript merekam rincian `total (harga + fee)`.
- 🟢 `parseSellerInput` dihapus dari `midmanManager` (dead code — digantikan dropdown). `/midman-deals` kini menampilkan total (harga + fee) per deal.

### Fixed

- 🟡 Mock interaction di 4 file test (`interactionsRouter`, `ticketNonKey`, `panelEdit`, `hardeningV31`) ditambah method `isUserSelectMenu` — tanpa ini router baru melempar `TypeError: interaction.isUserSelectMenu is not a function` saat test lama jalan.

## [3.9.32] — 2026-09-02

### Added — 🤝 FITUR BARU: Midman / Rekber (Deal Escrow 3-Pihak)

Layanan rekber (jasa tengah) untuk transaksi antar-member: pembeli, penjual, dan midman dalam satu channel deal dengan **Deal Board** (embed bot) sebagai sumber kebenaran dan **state machine** yang menjaga urutan — uang jalan dulu → barang nyampe → baru uang cair, dan setiap perpindahan harus dikonfirmasi pihak yang berbeda.

- **State machine escrow** (`src/data/midmanManager.js`): `WAITING_SELLER → WAITING_PAYMENT → WAITING_DELIVERY → WAITING_RELEASE → COMPLETED`, plus `DISPUTE` (freeze, hanya admin resolve: cairkan/refund) dan `CANCELLED`/`REFUNDED`. Setiap klik tombol divalidasi ganda — (1) urutan state harus mengizinkan event (`canTransition`), (2) kliker harus berperan sebagai aktor yang diizinkan (`actorAllowed`). Bot menolak struktural skema fraud klasik: cairkan sebelum barang diterima, buyer klik "Dana Masuk" menyamar midman, aksi apa pun saat dispute.
- **Deal Board**: embed bot (item, harga, fee, diterima penjual, status, instruksi per state) yang di-edit otomatis tiap transisi — terms terkunci setelah seller setuju (ubah = batal & buat ulang). Board terhapus admin → self-healing (dikirim ulang). Tombol per state hanya merender aksi yang valid.
- **Channel deal 3-pihak**: kategori `🤝 REKBER`, overwrites untuk buyer, seller, role midman, role admin. History lengkap per klik (siapa, kapan, event apa) tersimpan di `data/deals.json` + dikirim sebagai ringkasan sebelum close (ikut ke transcript).
- **Integrasi ekosistem Thor**: invoice ke channel testimoni + `recordPurchase` stats saat deal COMPLETED (reuse `sendInvoice`), transcript otomatis (reuse `saveTranscript`), audit log setiap transisi (`MIDMAN_*`), lock per-channel anti double-click, cleanup meta hanya kalau channel benar-benar terhapus (pola v3.9.31).
- **Anti-bypass**: user dengan deal aktif (buyer/seller) tidak bisa buka tiket reguler; buyer dengan tiket aktif tidak bisa buat deal; 1 deal aktif per orang (sebagai buyer/seller). Loop cek tiket di `createTicket` diekstrak ke `findActiveTicketFor()` (dipakai ulang).
- **Commands**: `/set-role midman`, `/remove-role midman`, `/set-midman-fee` (persen 0–90% atau nominal flat; fee dihitung otomatis dari config — tidak bisa dipatok manual per deal), `/midman-deals` (list deal aktif), tampilan rekber di `/config-show`. Total **80 → 82 slash command**.
- **Kategori panel `🤝 Rekber / Middleman`** otomatis ditambahkan (migration sekali-jalan, pola claim_giveaway): tombol di-intercept router → domain midman; dropdown di-redirect dari handler tiket. Tidak mau fitur rekber? `/remove-category midman` — flag `midmanCategoryDismissed` mencegah kategori "hidup lagi".
- 31 unit test baru (`tests/unit/midman.test.js`): matriks state machine (happy path, gerbang ganda, dispute, terminal), matriks aktor, fee (persen/flat/cap/invalid), parser input modal, persistensi deals.json, migration kategori + flag dismissed, `findActiveTicketFor` (aktif/zombie-cleanup). Total **258 → 289 unit test**.

### Fixed

- 🟡 **`actorAllowed` key mismatch** (kelewat tanpa test): daftar aktor transisi memakai nama `buyer`/`seller`/... sementara pemanggil mengirim flags `isBuyer`/`isSeller`/... — mapping `ACTOR_KEY_MAP` menyatukan keduanya (tertangkap test aktor).

## [3.9.31] — 2026-09-01

### Fixed

- 🔴 **Orphan meta saat close tiket** — `removeTicketMeta` tetap dijalankan walau `channel.delete()` gagal karena alasan non-10003 (Missing Permissions / network). Channel masih hidup tapi meta hilang → close berikutnya jatuh ke fallback topic-parsing yang kehilangan flag `isCompleted`/`isInvoiceSent`/`isTransaction` → **invoice terkirim dobel** + skenario tombol close salah. Sekarang meta hanya dihapus kalau channel benar-benar sudah tidak ada; kalau delete gagal, admin cukup klik close lagi setelah permission dibereskan (self-healing).
- 🟠 **TypeError di `ticket_close` / `ticket_set_key` saat channel null** — `interaction.channel.id` tanpa guard (inconsistent dengan modal yang sudah punya guard P1-8). Kalau channel terhapus tepat sebelum admin klik tombol (partial/uncached), error ditelan handler global sebagai error generik. Sekarang ada guard + pesan ephemeral yang jelas.
- 🟠 **`/clear-schedule` heuristic role-removal terlalu broad** — kandidat role dikumpulkan dari SEMUA entry `scheduledRoles.json` (termasuk milik user lain) → role manual member yang kebetulan sama dengan role VIP terjadwal user lain ikut terlepas. Sekarang: snapshot roleId milik user target saja (schedule + key, diambil SEBELUM penghapusan).
- 🟡 **Layering violation di `/clear-schedule`** — blok lama membaca `data/scheduledRoles.json` langsung via `fs.readFileSync` + path hardcode, melewati API `roleScheduler` (gagal diam-diam kalau path/schema berubah). Sekarang via API `findAllSchedulesByUser` + snapshot key via `findAllByUser`; komentar stream-of-consciousness 45 baris diringkas.
- 🟡 **`getTopUsers` urutan spread menimpa fallback userId** — `{ userId: ..., ...stats }` bisa menghasilkan `userId: undefined` untuk entry dengan properti eksplisit undefined; urutan dibalik jadi `{ ...stats, userId: ..., value: ... }`.

### Changed

- 🟢 `getActiveKeysByUserAndRole` kini menerima optional `guildId` (param ke-4) — konsistensi pola dengan `findAllByUser`; key legacy tanpa guildId tetap dihitung (backward compat). Dipanggil dengan guild dari flow Set Key (command & modal).
- 🟢 Dead code `createContext()` dihapus dari `src/commands/_shared.js` (tidak pernah dipanggil handler mana pun).

### Added

- 10 unit test baru (`tests/unit/hardeningV31.test.js`): orphan-meta guard (delete gagal non-10003 / 10003 / sukses / self-healing), guard channel null via router interaksi, kontrak snapshot schedule (roleId milik user target saja), filter guildId + backward compat legacy, fallback userId leaderboard, eksport `_shared` tetap utuh. Total **258 unit test**.

## [3.9.30] — 2026-09-01

### Changed

- 🟢 **`/set-transcript-channel` digabung ke `/set-channel tipe:transcript`** — permintaan admin: dua command channel yang mirip bikin bingung. Kini **satu command `/set-channel`** mengatur semua channel: `invoice`, `welcome`, `goodbye`, `audit-log`, `transcript`. Command terpisah dihapus dari registry (total **81 → 80 slash command**); `ready.js` me-register ulang otomatis saat restart, jadi command lama hilang dari Discord tanpa langkah manual. Data tidak berubah (tetap `config.channels.transcript`).
- `/remove-channel` kini juga punya choice `transcript` — pola set/hapus konsisten untuk semua tipe channel.
- `/config-show` menampilkan Audit Log + Transcript Tiket di field Channels (sebelumnya hanya welcome/goodbye/invoice).
- `/set-channel` kini menolak channel non-text (voice/category) untuk **semua** tipe — guard yang dulu hanya ada di handler transcript.

### Added

- 10 unit test baru (`tests/unit/setChannelMerge.test.js`): registry (command lama hilang, total tepat 80, choice baru), router (command lama → "belum didukung"), handler (set transcript + tip khusus, tolak voice channel, regression tipe lain, remove transcript, roundtrip key yang dibaca `saveTranscript`).

## [3.9.29] — 2026-09-01

### Fixed

- 🔴 **`/update-panel` — URL gambar/thumbnail ditolak input**: batas panjang input modal `image`/`thumbnail` hanya 500 karakter, sementara URL CDN Discord yang signed umumnya 300–450 karakter — Discord menolak input sebelum sempat disubmit. Batas dinaikkan menjadi **2048 karakter** (limit URL embed Discord), ditambah guard 2048 dengan pesan error jelas di `/update-panel` (modal) dan `/setup-ticket-panel` (slash command).
- 🟠 **Audit log `/update-panel` menampilkan `undefined`** untuk field image/thumbnail/footer — pembacaan memakai `patch[field]` padahal data tersimpan di key `imageUrl`/`thumbnailUrl`/`footerText`.
- Catatan: bug key-mapping image/thumbnail (perubahan tersimpan tapi tidak pernah muncul di panel) sudah diperbaiki sejak v3.9.26 — pastikan bot berjalan dengan kode terbaru (restart bot).

### Added

- ✅ **Safety-net kategori kosong** — `/setup-ticket-panel` & `/refresh-panel` kini memberi peringatan jika ada kategori di panel yang belum punya produk ("klik tombol kategori kosong membuka tiket BANTUAN, bukan transaksi — tambahkan produk via `/add-product`"). Kategori `help`/`report` tidak diperingatkan (memang quick-action).
- 14 unit test baru (`tests/unit/panelEdit.test.js`): flow modal end-to-end (URL CDN tersimpan & dirender, guard 2048, clear, URL invalid, cross-guild guard), safety-net 5 skenario, regression guard panjang input.

## [3.9.28] — 2026-09-01

### Added

- ✅ **`classifyProduct()`** — pure function hasil ekstraksi dari `createTicket`. Rule klasifikasi: hanya kategori `help`/`report`/produk ber-flag `isHelp` yang masuk **BANTUAN**; **semua id kategori lain apa pun (`akun_ml`, `lisensi_key`, `jasa`, `topup`, custom...) otomatis TRANSAKSI**. Menambah kategori baru tidak memerlukan perubahan kode sama sekali.
- 14 unit test baru (`tests/unit/newCategorySafety.test.js`): skenario akun_ml non-key (📦 Kirim Pesanan), lisensi_key (🔑 Set Key), roundtrip meta → resolveTicketType → matriks tombol, pewarisan `requires_key` kategori→produk di `/add-product`, deskripsi dropdown.

### Fixed

- 🟠 **Deskripsi dropdown panel untuk kategori campur** — sebelumnya memakai flag `requiresKey` kategori (menyesatkan jika kategori berisi campuran produk key & non-key). Sekarang dihitung dari produk aktual: semua key → "pakai key", semua non-key → "tanpa key", campur → "N tanpa key / M pakai key".

### Documented

- Gotcha: produk transaksi **tanpa** flag `requires_key` dianggap pakai key (tombol Set Key). Untuk produk akun/jasa: set `requires_key:false` di **kategori** — produk baru mewarisi otomatis.

## [3.9.27] — 2026-09-01

### Fixed

- 🔴 **Produk non-key (jual akun/jasa) dianggap tiket BANTUAN** — sistem lama mengacaukan `requiresKey` (produk pakai key?) dengan `isTransaction` (tiket jual-beli?). Diperbaiki dengan flag `isTransaction` eksplisit via `resolveTicketType()` (satu sumber kebenaran, 5 skenario tombol close).
- 🔴 **Tombol close produk non-key memakai gaya help** — "✅ Pesanan Sukses / ❌ Tidak Jadi Beli" tidak pernah muncul.
- 🔴 **Invoice/testimoni tidak pernah dikirim untuk produk non-key** — `requiresKey=false` salah dianggap "help/report" di `closeTicket`.
- 🔴 **Stats/leaderboard tidak mencatat penjualan non-key** — `recordPurchase` hanya jalan di flow Set Key.
- 🔴 **Auto-role produk non-key tidak pernah diberikan** padahal `/set-product-role` menjanjikannya (sekarang lewat Kirim Pesanan ATAU Pesanan Sukses).
- 🔴 **Routing `modal_deliver_order:` hilang** — prefix modal tanpa fallback generik di router → submit modal menjadi dead interaction.
- 🟠 **Invoice dobel untuk transaksi key** — dikirim saat Set Key DAN saat close "Selesai". Diperbaiki dengan flag `isInvoiceSent` di meta tiket.
- 🟠 **Modal title > 45 karakter membuat `showModal` throw** — "Set Key — <label produk>" bisa 89 karakter → tombol Set Key mati diam-diam. Fixed (slice 45).
- 🟠 **Deskripsi dropdown panel menyesatkan** — kategori non-key berproduk dilabeli "Bantuan / non-transaksi". Sekarang berbasis konten aktual.

### Added

- ✅ **Tombol 📦 Kirim Pesanan** untuk produk non-key (mirror Set Key): admin isi detail pesanan (multi-baris) di modal → bot **DM detail ke pembeli** (chat tiket terhapus saat close — DM menjadi satu-satunya salinan permanen) + auto-role + auto-expire + invoice + stats + audit log `ORDER_DELIVERED`.
- Emoji dropdown produk kini membedakan 🔑 (pakai key) vs 📦 (tanpa key).
- `resolveTicketType()` backward-compatible: tiket lama (tanpa flag) tetap memakai klasifikasi lama — tanpa regresi; tiket baru selalu benar.

## [3.9.26] — 2026-08-31

Audit ulang seluruh codebase dengan konteks **bot dipakai untuk 1 guild saja** — 6 temuan baru diperbaiki + hardening + garbage collector.

### Fixed

- 🔴 **`/update-panel` image/thumbnail/footer tidak pernah berfungsi** — patch tersimpan di key yang salah (`image`) padahal builder membaca `imageUrl` → 3 dari 6 field yang diiklankan adalah no-op diam-diam. Fixed (key mapping) + pre-fill modal.
- 🔴 **`/giveaway list` & `/poll list` mati permanen di ~30 entry** — description embed > 4096 → throw. Sekarang: 15 terbaru + ringkasan + GC harian (entry > 30 hari dipangkas otomatis).
- 🔴 **Poll dengan question panjang = zombie + admin stuck "Bot is thinking..."** — entry persist sebelum render throw. Fixed: validasi di command (maks 250) + render-first + safeEditReply.
- 🔴 **`claim_giveaway` tidak bisa dihapus permanen** — migration di `getConfig()` (jalan per pesan) menambahkan kategori kembali setelah `/remove-category`. Fixed dengan flag `claimGiveawayDismissed`.
- 🟠 **Label/price produk panjang mematikan flow tiket** — dropdown throw `addOptions` (limit 100). Fixed: cap di registry + handler + slice defensif di 3 dropdown.
- 🟠 **Emoji bebas tersimpan bisa meracuni panel** — string bukan-emoji membuat `/setup-verify` & semua panel tiket mati. Fixed: validasi emoji di set-verify-button, add-category, update-category.

### Changed (Hardening & Performa)

- 🟢 **Karantina file korup** — 16 file data di-rename `.corrupt-<ts>` sebelum fallback default (sebelumnya: isi korup tertimpa diam-diam oleh save berikutnya).
- 🟢 **Hot-path cache** — automod/afk/responders/levels kini read-through cache (sebelumnya 5–7 `readFileSync` sinkron per pesan). AFK mention di-batch.
- 🟢 **Guard `GUILD_ID` di semua event** — pesan/command/member/voice dari guild lain diabaikan.
- 🟢 **Migrasi v1→v2 config tidak lagi drop field modern** (ticketCategories/leveling/verifyButton preserve).
- 🟡 messageCreate per-hook try/catch; `getSubcommand(false)` + hint; prize/question/key max_length; reroll guild-check; backup cancel tombol di-handle; logAudit tahan detail panjang; DM set-key & transcript tahan data panjang; Set Key lookup produk pakai `value` (tahan rename); admin re-check di modal update-panel; leveling clamp nilai.

### Docs

- `docs/ADMIN_GUIDE.md` + `docs/README.md` disinkronkan — struktur folder `src/` yang sebenarnya (sebelumnya masih struktur lama pre-refactor + 47 command).

## [3.9.25] — 2026-08-31

### Added

- Support `\n` (baris baru) ditambahkan ke field yang terlewat di v3.9.24: `/set-message` (tipe Body), `/afk reason`, `/warn reason`, `/setup-selfrole` & `/selfrole-add` description. Hint `(support \n)` tampil di deskripsi opsi command.
- Catatan: tipe **Title** sengaja tidak dikonversi — embed title Discord menolak newline. Input **modal** tidak memerlukan `\n` (Enter menghasilkan baris baru asli).

## [3.9.24] — 2026-08-31

### Added

- **Fitur `\n` (baris baru) untuk semua input teks multi-baris** — input slash command di Discord tidak bisa tekan Enter (Enter = kirim form): `/send-message`, `/announce`, `/announce-schedule`, `/setup-ticket-panel body`, `/add-responder reply`.

### Fixed

- 🔴 **`/update-category` & `/update-product` tidak pernah berfungsi** — terdaftar di registry + diiklankan di /help, tapi tidak di-map di router. Fixed + guard test.
- 🔴 **Backup bolong** — `automod.json`, `levels.json`, `responders.json`, `afk.json`, `panels.json` tidak pernah di-backup. Fixed + guard test.
- 🔴 **Crash exit code 0** — PM2/systemd/Docker tidak restart bot setelah crash. Sekarang `exit(1)` + shutdown guard anti double-flush.
- 🔴 **Test menulis/hapus data produksi** — `npm test` di server live menghapus `panels.json` & meng-evict backup asli. Test sekarang sandbox (snapshot/restore).
- 🟠 ready.js: satu try/catch raksasa → per-langkah; userLock bisa dihapus holder basi → owner-token; tombol close ticket & modal set key tanpa re-check admin → fixed (defense-in-depth); AFK reason bisa mass-ping → `parse: []`; member kehilangan required role tidak bisa keluar giveaway → cek role hanya saat join; `/giveaway end` tidak ber-lock → withUserLock; phantom devDeps; engines node; filter webhook di messageCreate; defer modal poll.

## [3.9.23] — 2026-08-31

### Added — Auto-mod WORD FLEX

- **Word filter fleksibel**: `wordRules` per kata `{word, action, addedBy, addedAt}` + `exemptWords` + `wordMatchMode` (`whole_word` default).
- Matching **whole-word** dengan regex escape — "asu" tidak match "asus" (anti false-positive).
- **Action per kata** — kata ringan cukup delete, kata berat langsung mute/kick.
- 4 command baru: `/add-word` (append, tanpa replace), `/remove-word`, `/list-words`, `/remove-link-whitelist` — total 81 slash command.
- Migrasi otomatis `blockWords` legacy → `wordRules` (idempotent, lazy persist).

## [3.9.22] — 2026-08-16

### Changed

- **DM set-key memakai emoji** (📦🌐🔑🎭⏰📋💡) dan **nama role** (bukan mention — mention role tidak ke-resolve di DM).
- Notif di channel tiket lebih singkat & ditujukan ke user ("key sudah dikirim via DM"), dengan fallback manual jika DM gagal.
- DM `/set-key` konsisten dengan ticket Set Key, dibingkai sebagai hadiah ("kamu mendapat hadiah") — konteks gift untuk member.

## [3.9.21] — 2026-08-16

### Changed

- DM ke member memakai inline code (`` `key` ``) bukan codeblock — long-press di Discord mobile langsung memunculkan menu Copy. Bahasa lebih natural.
- Di channel tiket, bot hanya mengirim pesan singkat untuk user (bukan panel baru untuk admin).

## [3.9.20] — 2026-08-16

### Changed

- **Set Key sukses → channel tiket tetap terbuka** (sebelumnya otomatis dihapus → transcript tidak tersimpan, member tidak sempat bertanya). Bot mengirim pesan singkat "key sudah dikirim ke DM".
- Admin & member bisa Q&A dulu; saat Tutup Tiket dengan `meta.isCompleted=true`, hanya muncul tombol "✅ Selesai" (tanpa "Tidak Jadi Beli").
- Transcript otomatis tersimpan ke channel transcript saat close + invoice dikirim jika belum.

## [3.9.19] — 2026-08-16

### Added — MAX FLEXIBILITY

- **Routing tiket berbasis "kategori punya produk atau tidak"** — kategori berproduk → tiket TRANSAKSI + dropdown produk; kategori kosong → tiket BANTUAN langsung (quick action).
- `/update-category` & `/update-product` — edit tanpa hapus+tambah ulang (semua field opsional, hanya yang diisi yang berubah).

## [3.9.18] — 2026-08-16

### Changed

- Label tombol default tiket diubah ke **Help** & **Report** (sebelumnya "Bantuan Staff" & "Laporkan Member") + kategori contoh **Claim Giveaway** ditambahkan (bisa dihapus permanen sejak v3.9.26).
- Fix bug generalisasi `requiresKey` di kategori.
- Migrasi otomatis label lama saat bot start (hanya jika belum di-customize admin).

## [3.9.17] — 2026-08-06

### Fixed

- Fix 38+ temuan audit (CRITICAL + HIGH + MEDIUM + LOW).
- Hotfix: `DiscordAPIError 50035` — option description command > 100 karakter.
- Hotfix: `/help` embed melebihi limit 6000 karakter.

## [3.9.15] — 2026-08-02

### Fixed

- Ronde 2 audit — 16 bug lintas commands/interactions/data/events/services/ui.
- 🔴 CRITICAL: auto-responder tidak berfungsi karena **Message Content Intent** tidak diaktifkan — ditambahkan hint di console + dokumentasi.

## [3.9.14] — 2026-08-06

### Added

- **Multi-panel tiket persisten** — panel berbeda dengan subset kategori berbeda di channel berbeda, tersimpan di `data/panels.json` (ikut backup). Fix 10 runtime bugs.

## [3.9.13] — 2026-08-01

### Added

- 4 fitur komunitas baru: **Auto-Responder**, **Anti-Spam & Auto-Mod**, **AFK System**, **Leveling System** (XP, role reward, leaderboard) + rebrand ke generic Community Bot.

## [3.9.12] — 2026-08-01

### Added

- Ticket body fleksibel via modal editor + template variables (`{server}`, `{price_list}`) + update `/help`.

## [3.9.11] — 2026-08-01

### Added

- Flexible ticket panel: kategori custom, multi-panel, transcript, conditional roles (Phase 1+2+3).

## [3.9.10] — 2026-08-01

### Changed

- Refactor penuh per-domain (commands/interactions/data/services/ui/infra), tanpa kode legacy + CI/CD (GitHub Actions) — 71 test saat itu.

## [3.9.9] — 2026-08-01

### Changed

- Refactor ke struktur folder profesional + penambahan test.

## [3.9.8] — 2026-08-01

### Fixed

- 30+ bug lintas CRITICAL/HIGH/MEDIUM (ronde 1 + ronde 2: constants sync, audit retry logic, genId entropy).

## [3.9.7] — 2026-08-01

### Fixed

- 🔴 Crash tombol **Send** di embed builder (`ExpectedConstraintError` label > 45 karakter).
- 🟠 `InteractionNotReplied` saat modal submit handler fallback.

## [3.9.6] — 2026-08-01

### Added

- Opsi **💬 Message (plain text)** di embed builder — teks pengantar di luar embed (`@everyone`, mention, `\n`, maks 2000 char) + pre-fill modal Send.

## [3.9.5] — 2026-08-01

### Added

- Command `/send-message` — kirim plain text ke channel (support `\n` & mention valid).
- `/embed-list` menampilkan summary message.

## [3.9.4] — 2026-07-31

### Fixed

- 🔴 CRITICAL: `stats.json` cross-guild data leak — sekarang composite key `${guildId}:${userId}`.
- 🔴 CRITICAL: `safeEditReply` helper dengan `followUp` fallback untuk 10008/10062/40060.
- 🟠 ticket close + set key memakai `getTicketMeta` (anti spoof via channel topic); temp voice orphan cleanup; warn auto-action hanya mark jika API sukses; auto-transfer voice ownership filter bot; `restoreBackup` invalidate permissions cache; `/config-show` guild-scoped.

## [3.9.3] — 2026-07-31

### Fixed

- 🔴 CRITICAL: `removeAllKeysByUser` cross-guild wipe — sekarang scoped per guild.
- Validasi title (256) & description (4096) di `/announce` & `/announce-schedule`.

## [3.9.2] — 2026-07-31

### Fixed

- Per-user lock untuk giveaway join/leave & poll vote (anti double-click TOCTOU).
- TTL cache 30s untuk admin role check; retry 1x audit log; validasi panjang embed builder; `.env.example` dengan catatan keamanan.

## [3.9.1] — 2026-07-31

### Fixed — Security & Race Condition Hardening

- 🔴 **Mask key di audit log** (sebelumnya bocor 8 karakter pertama key).
- 2-step confirmation `/restore-backup`; poll modal customId pakai session store (anti 100-char limit); metadata tiket pindah ke `tickets.json` (sebelumnya di channel topic — bisa di-spoof); validasi mention ketat; hapus hardcoded `@everyone` ping di giveaway; `Math.max(...spread)` diganti loop (anti RangeError); restore lock + path traversal guard; `statsManager.reload()` setelah restore; range validation `parseTime` (maks 365 hari relatif / 5 tahun absolut).

## [3.9.0] — 2026-07-31

### Fixed — Critical Bug Fixes & Data Integrity

- 🔴 **Atomic write** (`safeWriteJSON`, tmp+rename) untuk semua JSON store — anti corrupt saat crash/power loss.
- `/clear-schedule` scoped per guild; 2-step confirmation `/reset-config`; exclusive mode self-role select; prototype pollution guard di `configManager.setField`; `warnManager` keyed `(guildId, userId)` + auto-migration; `processExpiredRole` tidak hapus schedule saat transient error; ghost loop fix recurring announcements; skip bots + single audit log fetch di memberHandler.
