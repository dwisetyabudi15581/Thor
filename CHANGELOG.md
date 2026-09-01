# Changelog

Semua perubahan penting pada project ini didokumentasikan di file ini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/).

Legend: 🔴 critical · 🟠 high · 🟡 medium · 🟢 improvement

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
