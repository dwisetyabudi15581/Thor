# 📖 ADMIN GUIDE — Community Bot v3.9.7

Panduan lengkap untuk admin server Discord yang menjalankan bot ini. Cocok untuk admin baru yang baru pertama kali setup, maupun admin yang sudah ada untuk referensi harian.

---

## 🎯 Daftar Isi

1. [Quick Start (5 menit)](#1-quick-start-5-menit)
2. [Setup Awal Server](#2-setup-awal-server)
3. [Manajemen Produk & VIP](#3-manajemen-produk--vip)
4. [Operasional Harian](#4-operasional-harian)
5. [Moderation (Warn System)](#5-moderation-warn-system)
6. [Engagement (Giveaway & Poll)](#6-engagement-giveaway--poll)
7. [Backup & Restore](#7-backup--restore)
8. [Troubleshooting](#8-troubleshooting)
9. [Best Practices](#9-best-practices)
10. [Apa yang Baru di v3.9.x](#10-apa-yang-baru-di-v39x)

---

## 1. Quick Start (5 menit)

### Prasyarat

- Node.js 16.11+ (rekomendasi 18+)
- Bot udah di-invite ke server dengan permission: Manage Roles, Manage Channels, Send Messages, Embed Links, View Audit Log, Moderate Members, Move Members
- **3 Privileged Intents** udah di-enable di Discord Developer Portal (https://discord.com/developers/applications → pilih bot → tab "Bot" → scroll ke "Privileged Gateway Intents"):
    - ✅ **Server Members Intent** — buat welcome/goodbye, auto-role, member sync
    - ✅ **Message Content Intent** — WAJIB buat auto-responder, anti-spam kata/link, AFK mention reply. Tanpa ini, `message.content` selalu kosong → fitur-fitur tersebut gak jalan!
    - ✅ **Presence Intent** — (opsional, belum dipakai)
- **Role bot di ATAS** semua role yang bakal dikelola (Verified, Unverified, VIP, dll)

### Install

```bash
npm install
cp .env.example .env
# Edit .env, isi DISCORD_TOKEN dan GUILD_ID
npm start
```

### Verifikasi

- Cek console muncul: `✅ Bot online sebagai NamaBot#1234`
- Cek console muncul: `✅ Slash Commands terdaftar ke guild: Nama Server (instan!)`
- Cek di Discord, ketik `/` — semua 47 slash command harus muncul
- Kalau command tidak muncul, pastikan `GUILD_ID` di `.env` benar

---

## 2. Setup Awal Server

Urutan ini **rekomendasi** untuk server baru. Skip yang sudah pernah di-set.

### Step 1: Set Role

```
/set-role verified @Verified
/set-role unverified @Unverified
/set-role admin @Staff
```

**Tips:**

- Role `verified` = role yang didapat member setelah klik tombol verifikasi
- Role `unverified` = role default member baru (akan dilepas setelah verify)
- Role `admin` = role staff yang akan dapat akses channel tiket + panel admin
- Perubahan admin role langsung efektif (cache di-invalidate otomatis)

### Step 2: Set Channel

```
/set-channel welcome #welcome
/set-channel goodbye #goodbye
/set-channel invoice #testimoni
/set-channel audit-log #audit-log
```

**Penjelasan:**

- `welcome` — channel tempat bot kirim welcome message saat member join
- `goodbye` — channel tempat bot kirim goodbye message saat member leave/kick/ban
- `invoice` — channel testimoni transaksi (otomatis terisi setiap Set Key sukses)
- `audit-log` — channel tempat bot catat SEMUA admin action (24 action types)
    - Audit log di-retry 1x otomatis bila gagal kirim (rate limit/network blip)

### Step 3: Pasang Panel Verifikasi

```
/setup-verify
```

Bot akan kirim embed + tombol "Verifikasi Saya" ke channel tempat Anda jalankan command. Member baru klik tombol → dapat role Verified + lepas role Unverified.

**Rekomendasi:** Pasang di `#information` atau `#rules` channel, pin pesannya.

### Step 4: Tambah Produk ke Price List

```
/add-product label:"7 Days" value:7d price:"Rp. 25.000" duration:"7 Hari"
/add-product label:"30 Days" value:30d price:"Rp. 80.000" duration:"30 Hari"
/add-product label:"Permanent" value:perm price:"Rp. 250.000" duration:"Permanen"
```

**Aturan:**

- `label` = nama yang ditampilkan ke member
- `value` = ID unik (tanpa spasi, mis. `7d`, `30d`, `perm`)
- `price` = string bebas, bisa pakai format Indonesia (`Rp. 50.000`) atau angka biasa
- `duration` = opsional, hanya keterangan (tidak otomatis jadi expire role)
- Maksimal 25 produk (batas dropdown Discord)

### Step 5: Set Auto-Role untuk Produk

Untuk setiap produk, set role mana yang akan didapat pembeli + durasi expire:

```
/set-product-role value:7d role:@VIP 7 Days days:7
/set-product-role value:30d role:@VIP 30 Days days:30
/set-product-role value:perm role:@VIP Permanent days:0
```

**Aturan:**

- `days:0` = permanen (role tidak akan pernah otomatis dihapus)
- `days:7` = role akan otomatis dihapus setelah 7 hari
- Role bot harus di ATAS role VIP di server settings

### Step 6: Pasang Panel Tiket

```
/setup-ticket
```

Bot akan kirim embed + 3 tombol (Beli Key / Bantuan Staff / Laporkan Member) ke channel tempat command dijalankan. Member klik → bot buat channel tiket private.

**Rekomendasi:** Pasang di `#information` atau channel khusus `#order-here`, pin pesannya.

### Step 7: (Opsional) Pasang Self-Role Panel

Untuk member yang mau ambil role sendiri (mis. role notif game):

```
/setup-selfrole title:"Pilih Notif Game" description:"Klik role yang kamu mau" type:button exclusive:false
/selfrole-add panel_id:sr_xxx role:@Notif ML label:"Notif ML" emoji:"🎮"
/selfrole-add panel_id:sr_xxx role:@Notif PUBG label:"Notif PUBG" emoji:"🔫"
```

### Step 8: Cek Konfigurasi

```
/config-show
```

Akan tampil embed dengan semua setting saat ini: roles, channels, products, key stats, schedule stats, self-role panels.

---

## 3. Manajemen Produk & VIP

### Tambah Produk Baru

```
/add-product label:"60 Days" value:60d price:"Rp. 150.000" duration:"60 Hari"
/set-product-role value:60d role:@VIP 60 Days days:60
```

### Ubah Harga Produk

Hapus + tambah ulang (bot belum punya edit product):

```
/remove-product value:60d
/add-product label:"60 Days" value:60d price:"Rp. 175.000" duration:"60 Hari"
/set-product-role value:60d role:@VIP 60 Days days:60
```

### Lihat Semua Produk

```
/list-products
/list-product-roles
```

### Beri Key Manual (tanpa tiket)

Untuk kasus member sudah bayar tapi lewat DM / transfer langsung:

```
/set-key user:@member value:30d key:ABCDE-12345-FGHIJ
```

Bot akan otomatis:

1. Simpan key ke `keys.json` (di-scope per guild — aman untuk multi-server)
2. Beri role VIP ke member
3. Schedule auto-remove (MAX EXTEND)
4. DM member dengan key + info expire
5. Kirim invoice ke channel invoice
6. Track purchase ke stats
7. Audit log SET_KEY — **key dimasking** (hanya `***` + panjang, tidak bocor nilai key)

### Lihat Key Member

```
/list-keys user:@member
```

Akan tampil semua key member (aktif & expired) + sisa waktu masing-masing.

### Reset VIP Member (Full Reset)

Untuk kasus member minta reset / refund:

```
/clear-schedule user:@member clear_keys:true
```

Bot akan:

- Hapus semua schedule role user (di guild ini saja)
- Hapus SEMUA key user dari `keys.json` (di guild ini saja)
- Lepas semua role VIP yang terkait produk

**Hati-hati:** Tidak bisa di-undo. Pakai `clear_keys:false` kalau hanya ingin hapus schedule tanpa hapus key.

---

## 4. Operasional Harian

### Flow Tiket Transaksi (paling sering dipakai)

1. Member klik **🛒 Beli Key** di panel tiket → pilih produk
2. Bot buat channel tiket private `#ticket-{user-id}`
3. Member kirim bukti pembayaran
4. Admin konfirmasi → klik **🔑 Set Key** di tiket
5. Modal muncul → admin ketik key → submit
6. Bot otomatis: simpan key, beri role, schedule, DM member, kirim invoice, hapus channel tiket

**Tips:**

- Sebelum klik Set Key, pastikan pembayaran sudah masuk
- Key bisa apa saja (string bebas), mis. `ABCDE-12345-FGHIJ-67890`
- Bot akan DM member dengan key + info expire + list semua key aktif
- Invoice otomatis terkirim ke channel invoice (testimoni)
- Metadata tiket (userId, productName, price) disimpan di `tickets.json` — bukan di channel topic (anti spoof/edit)

### Tutup Tiket Tanpa Transaksi

Klik **🔒 Tutup Tiket** → pilih **❌ Tidak Jadi Beli** → tiket ditutup tanpa key/role.

### Quick Announce

```
/announce channel:#announcements title:"Maintenance Besok" description:"Server akan maintenance jam 03:00 WIB" color:#FF0000 mention:@everyone
```

**Format mention yang valid (v3.9.1+):**

- `@everyone` atau `everyone`
- `@here` atau `here`
- `<@&ROLE_ID>` — role mention (copy dari Discord)
- `<@USER_ID>` atau `<@!USER_ID>` — user mention

String lain akan ditolak dengan pesan error. Ini untuk mencegah admin tidak sengaja nge-ping karena typo di string mention.

### Interactive Embed Builder (untuk embed kompleks)

```
/embed-builder
```

Bot kirim draft + dropdown. Klik dropdown → pilih bagian (Title/Description/Color/Image/dst) → modal input → embed auto-update (live preview). Setelah selesai, klik **📤 Send** → input channel target → kirim.

**Tips:**

- Bisa edit lagi setelah Send? Tidak. Embed yang sudah dikirim tidak bisa di-edit via builder. Hapus manual + buat ulang.
- Session hilang kalau bot restart. Tapi TTL 1 jam (auto-cleanup) supaya tidak memory leak.
- Pakai `/embed-list` untuk lihat session aktif, `/embed-cancel` untuk batalkan.
- Validasi panjang title (256), description (4096), field name (256), field value (1024) — kalau kelebihan, bot tolak dengan pesan jelas.

### Scheduled Announcement

```
/announce-schedule channel:#announcements title:"Event Weekend" description:"Mulai 19:00 WIB" at:"2h" mention:@here
/announce-schedule channel:#info title:"Reset Bulanan" description:"Top 10 dapat reward" at:"2026-02-01 09:00" recurring:monthly
```

**Format `at`:**

- `30m` — 30 menit dari sekarang
- `2h` — 2 jam dari sekarang
- `1d` — 1 hari dari sekarang (maks 365 hari)
- `2026-01-15 20:00` — tanggal & waktu spesifik (format YYYY-MM-DD HH:mm, WIB; maks 5 tahun ke depan)

**Recurring:** `daily`, `weekly`, `monthly` — bot otomatis jadwalkan ulang setelah fire.

### Lihat & Cancel Scheduled Ann

```
/announce-list
/announce-cancel id:ann_xxx
```

---

## 5. Moderation (Warn System)

### Beri Warning

```
/warn user:@member reason:"Spam di #general"
```

Bot akan:

- Tambah warning ke `warns.json` (di-scope per guild)
- DM member dengan alasan + total warning
- Auto-action kalau mencapai threshold:
    - **3 warning** → mute (timeout) 1 jam
    - **5 warning** → mute (timeout) 1 hari
    - **7 warning** → kick dari server

**Catatan:** Auto-action tidak re-apply berulang. Kalau member dapat warning ke-4 (sudah pernah mute 1h di warning ke-3), bot tidak akan re-mute. Hanya threshold baru (5, 7) yang trigger action baru.

### Lihat History Warning

```
/warn-list user:@member
```

### Hapus 1 Warning

```
/warn-remove user:@member warn_id:warn_xxx
```

### Hapus SEMUA Warning

```
/warn-clear user:@member
```

### Hierarki Check

Bot akan menolak `/warn` kalau:

- Admin coba warn diri sendiri
- Admin coba warn bot
- Admin coba warn member dengan role setingkat/lebih tinggi dari dirinya

---

## 6. Engagement (Giveaway & Poll)

### Buat Giveaway

```
/giveaway create channel:#giveaway prize:"VIP 30 Hari" duration:60 winners:1 required_role:@Verified
```

**Aturan:**

- `duration` dalam **menit** (min 1)
- `winners` 1-20
- `required_role` opsional — hanya member dengan role itu yang bisa ikut
- **Tidak otomatis ping `@everyone`** (sejak v3.9.1) — kalau mau ping, pakai `/announce` terpisah atau edit pesan giveaway setelah dibuat

Bot akan kirim embed giveaway + tombol 🎉 Join / 🚪 Leave. Member klik Join → terdaftar. Saat berakhir:

- Bot pick winners (Fisher-Yates shuffle, distribusi uniform)
- Edit message jadi "ENDED"
- Announce winners ke channel
- DM winners
- Track ke stats (leaderboard Top Winner)

**Anti double-join (v3.9.2):** Kalau user klik tombol Join terlalu cepat (double-click <100ms), klik kedua ditolak dengan pesan "Tunggu sebentar". Ini mencegah race condition yang bisa menyebabkan participant terdaftar dobel.

### Akhiri Giveaway Lebih Awal

```
/giveaway end id:gw_xxx
```

Bot akan pick winners + update message + announce + DM + track (sama seperti auto-end).

### Reroll Winner

```
/giveaway reroll id:gw_xxx
```

Bot akan pick 1 winner baru (exclude winner yang sudah ada), persist, announce, DM, track.

### Buat Poll

```
/poll create channel:#polls question:"Event weekend ini?" multiple:false
```

Modal muncul → input options (1 per baris, min 2, maks 10). Bot kirim embed poll dengan tombol per option. Member klik → vote (toggle). Bar chart live update.

**Mode:**

- `multiple:false` — single choice (klik option lain otomatis pindah vote)
- `multiple:true` — multi choice (boleh pilih banyak)

**Anti double-vote (v3.9.2):** Sama seperti giveaway, klik terlalu cepat akan ditolak supaya tidak terjadi toggle dobel yang bisa membuat vote hilang.

### Tutup Poll

```
/poll close id:poll_xxx
```

Bot akan disable semua tombol + tampilkan hasil akhir.

---

## 7. Backup & Restore

### Backup Manual

```
/backup-now
```

Bot buat folder `backups/YYYY-MM-DD_HH-mm-ss/` berisi copy semua JSON files (config, keys, scheduledRoles, selfRoles, giveaways, polls, warns, stats, scheduledAnns, tempVoice, tickets).

### Auto-Backup

- Saat bot start: backup otomatis
- Setiap 24 jam: backup otomatis
- Maksimal 7 backup terbaru disimpan (yang lama auto-clean)

### Lihat Daftar Backup

```
/backup-list
```

Akan tampil semua backup termasuk safety backup `pre-restore_*` (kalau pernah restore).

### Restore Backup

```
/restore-backup name:2026-01-15_20-00-00
```

**Flow (v3.9.1+):**

1. Bot kirim embed konfirmasi dengan 2 tombol: **Ya, Restore Sekarang** dan **Batal**
2. Admin klik tombol → restore dijalankan
3. Bot otomatis buat safety backup `pre-restore_*` sebelum overwrite (jaga-jaga kalau salah restore bisa undo)
4. Setelah restore selesai, cache in-memory di-reload otomatis (sejak v3.9.1 — `statsManager.reload()`)
5. **RESTART bot** (`Ctrl+C` lalu `npm start`) tetap direkomendasikan untuk konsistensi penuh

**Proteksi (v3.9.1+):**

- 2-step confirmation — tidak ada lagi restore tidak sengaja karena typo
- Restore lock — kalau 2 admin klik restore bersamaan, hanya 1 yang jalan, yang lain ditolak
- Path traversal guard — name backup divalidasi (tidak boleh mengandung `..`, `/`, `\`)
- Pre-restore backup sekarang bisa juga di-restore (sebelumnya hanya muncul di list tapi tidak bisa di-restore)

---

## 8. Troubleshooting

### Bot tidak online

- Cek `DISCORD_TOKEN` di `.env` benar
- Cek koneksi internet
- Cek console untuk error message

### Slash command tidak muncul

- Cek `GUILD_ID` di `.env` benar (bukan user ID, tapi server ID)
- Cek bot sudah di-invite ke server itu
- Tunggu 1-2 menit untuk propagasi
- Kalau masih tidak muncul, fallback ke global commands (kosongkan GUILD_ID, tunggu ~1 jam)

### Member tidak dapat role setelah Set Key

- Cek **role bot di ATAS** role VIP di server settings (Role → drag bot role ke atas)
- Cek bot punya permission `Manage Roles`
- Cek console untuk error "Gagal add role"

### Welcome/Goodbye tidak terkirim

- Cek `config.channels.welcome` / `config.channels.goodbye` sudah di-set via `/config-show`
- Cek bot punya `Send Messages` + `Embed Links` di channel itu
- Cek channel masih ada (belum dihapus)

### Auto-responder gak reply / Anti-spam kata gak jalan / AFK mention reply gak terkirim

**Penyebab paling sering: `Message Content Intent` belum di-enable.**

Bot butuh akses ke `message.content` buat fitur-fitur ini. Tanpa intent itu, Discord kirim `message.content` sebagai **string kosong** buat pesan user → `findMatch()` return null → auto-responder gak pernah trigger.

**Cara fix:**

1. Buka https://discord.com/developers/applications
2. Pilih bot Anda
3. Tab "Bot"
4. Scroll ke bagian "Privileged Gateway Intents"
5. Toggle **ON** ketiga ini (kalo belum):
    - ✅ PRESENCE INTENT
    - ✅ SERVER MEMBERS INTENT
    - ✅ **MESSAGE CONTENT INTENT** ← yang paling penting buat fitur ini
6. Klik "Save Changes"
7. **Restart bot** (`npm start`)

Cek juga: `/list-responder` buat pastiin responder udah terdaftar. Trigger match-nya case-insensitive dan harus di awal pesan (`!sosmed` match `!sosmed halo`, tapi gak match `halo !sosmed`).

### Cooldown auto-responder kebanyakan lama

Default cooldown 3 detik per-user. Buat ubah:

```
/add-responder trigger:"!sosmed" reply:"..." cooldown:0    # 0 = matiin cooldown
/add-responder trigger:"!sosmed" reply:"..." cooldown:10   # 10 detik
```

Cooldown-nya **per-user** — user A trigger gak ngarang ke user B.

### Audit log tidak terkirim

- Cek `config.channels['audit-log']` sudah di-set via `/set-channel audit-log #channel`
- Cek bot punya `Send Messages` + `Embed Links` + `View Audit Log` di channel itu
- Sejak v3.9.2, audit log di-retry 1x otomatis bila gagal kirim karena rate limit/network

### Stats tidak update

- Stats di-cache di memory, flush setiap 30 detik. Tunggu sebentar lalu cek lagi.
- Kalau bot baru restart, stats lama tetap ada di `stats.json`.
- Setelah restore backup, stats cache otomatis di-reload (sejak v3.9.1) — tidak perlu restart manual untuk stats.
- Cek `/stats` untuk agregat server, `/my-stats` untuk pribadi.

### Tiket tidak bisa dibuat

- Cek `config.roles.admin` sudah di-set via `/set-role admin @role`
- Cek bot punya `Manage Channels` permission
- Cek kategori "🎫 TICKETS" bisa dibuat (server tidak cap 500 channel)
- Member hanya bisa punya 1 tiket aktif pada satu waktu

### Giveaway tidak auto-end

- Scheduler jalan setiap 60 detik. Tunggu max 1 menit setelah `endsAt`.
- Cek `giveaways.json` apakah entry ada dengan `ended: false`
- Bisa pakai `/giveaway end id:gw_xxx` untuk force-end manual

### Setelah restore, data masih lama

- Sejak v3.9.1, `statsManager.reload()` otomatis invalidate cache setelah restore.
- Untuk konsistensi penuh, **RESTART bot** tetap direkomendasikan.
- Manager lain (keyManager, roleScheduler, dll) baca dari disk setiap call — tidak ada cache.

### Pesan "Tunggu sebentar, kamu lagi klik terlalu cepat"

- Ini muncul kalau user double-click tombol Discord (giveaway/poll) dalam <100ms.
- Lock otomatis release dalam 5 detik.
- Coba klik sekali lagi setelah 1 detik — seharusnya sukses.

---

## 9. Best Practices

### Keamanan

1. **Jangan pernah share `DISCORD_TOKEN`** — siapa pun yang punya token bisa kontrol bot
2. **Jangan pernah commit `.env`** ke git (sudah di `.gitignore`)
3. Backup folder `backups/` juga jangan di-commit (berisi data sensitif)
4. Periodically rotate token (1-2 bulan sekali) di Discord Developer Portal
5. Limit admin role hanya ke orang yang dipercaya
6. Cek `#audit-log` secara berkala untuk deteksi misuse admin

### Performance

1. Jangan tambah >100 produk (bakal lambat di `/config-show` dan dropdown)
2. Jangan tambah >10 self-role panel (memory + complexity)
3. Periodic backup manual sebelum maintenance besar: `/backup-now`
4. Kalau server punya >10k member, pertimbangkan migrasi dari JSON ke SQLite

### Operasional

1. **Selalu backup sebelum** ubah config besar (`/backup-now`)
2. **Test di server kecil** dulu kalau ada perubahan role/channel
3. **Catat audit log** — cek `#audit-log` secara berkala untuk deteksi misuse
4. **Komunikasi ke member** sebelum maintenance: `/announce` atau `/announce-schedule`
5. **Pakai `/config-show`** sebelum troubleshooting — sering masalahnya config belum di-set

### Moderation

1. **Jangan langsung kick/ban** — pakai `/warn` dulu, biar ada track record
2. **Beri alasan jelas** di `/warn reason:` — member perlu tahu salahnya apa
3. **Cek `/warn-list`** sebelum escalate — mungkin member sudah punya warning lama yang bisa di-remove
4. **Kick otomatis di threshold 7** — pastikan member sudah tahu sistem warning sebelum di-kick

### Member Engagement

1. **Pakai `/leaderboard`** untuk highlight member aktif di announcement
2. **Giveaway rutin** (mingguan/bulanan) untuk boost engagement
3. **Poll** sebelum keputusan besar (event, rule change) — member lebih engaged
4. **Self-role panel** untuk personalisasi — member suka pilih sendiri role mereka

---

## 10. Apa yang Baru di v3.9.x

### v3.9.7 — Embed Builder hotfix

- Fix crash tombol **Send** di embed builder (`ExpectedConstraintError` label > 45 char)
- Fix `InteractionNotReplied` saat modal submit handler fallback

### v3.9.6 — Embed Builder: plain text message

- Tambah opsi **💬 Message (plain text)** di dropdown embed builder — kirim teks pengantar di luar embed (support `@everyone`, `@here`, mention, `\n`, maks 2000 char)
- Modal Send sekarang pre-fill message supaya admin bisa edit cepat sebelum kirim
- Validasi mention ketat di message (sama seperti `/announce`)

### v3.9.5 — Reliability

- Tambah `/send-message` — kirim plain text message ke channel (support `\n` & mention)
- `/embed-list` sekarang menampilkan summary message (panjang char)

### v3.9.4 — Comprehensive bug fix round

- **CRITICAL**: `stats.json` cross-guild data leak (terlewat dari v3.9.0) — sekarang composite key `${guildId}:${userId}`
- **CRITICAL**: `safeEditReply` helper dengan `followUp` fallback untuk 10008/10062/40060 (Unknown Message / interaction expired)
- HIGH: ticket close + set key pakai `getTicketMeta` (anti spoof via channel topic)
- HIGH: Temp voice orphan cleanup saat create gagal
- HIGH: Warn auto-action hanya mark action kalau API call sukses
- HIGH: Auto-transfer voice ownership filter bot account
- HIGH: `restoreBackup` invalidate permissions cache
- HIGH: `/config-show` pakai variant guild-scoped

### v3.9.3 — Cross-guild keyManager fix

- **CRITICAL**: `removeAllKeysByUser` cross-guild wipe (sejak v3.9.0) — sekarang scoped per guild
- `/announce` & `/announce-schedule` validate title (256) & description (4096)

### v3.9.2 — Race condition & docs hardening

- **Per-user lock** untuk giveaway join/leave & poll vote — mencegah double-click TOCTOU
- **TTL cache 30s** untuk admin role check — kurangi disk I/O di setiap interaction
- **Retry 1x** dengan delay 500ms untuk audit log — anti transient error (rate limit, network blip)
- **Validasi panjang** title/description/field di embed builder (defense-in-depth)
- Tambah `.env.example` dengan catatan keamanan

### v3.9.1 — Security & race condition hardening

- **Mask key di audit log** — sebelumnya bocor 8 char pertama key
- **2-step confirmation** untuk `/restore-backup` — tidak ada lagi restore tidak sengaja
- **Poll modal customId pakai session store** — anti 100-char Discord limit overflow
- **Tiket metadata pindah ke `tickets.json`** — sebelumnya di channel topic (bisa di-spoof/edit)
- **Validasi mention ketat** di `/announce` & `/announce-schedule`
- **Hapus hardcoded `@everyone` ping** di giveaway creation
- **`Math.max(...spread)` diganti loop** di keyManager (anti RangeError)
- **Restore lock + path traversal guard** di backupManager
- **`statsManager.reload()`** di-call setelah restore (anti stale cache)
- **Range validation `parseTime`** di scheduledAnnouncements (maks 365 hari relatif, maks 5 tahun absolut)

### v3.9.0 — Critical bug fixes & data integrity

- **Atomic write** (`safeWriteJSON`) untuk semua 9 JSON store — anti corrupt kalau bot crash / power loss
- **`/clear-schedule` di-scope per guild** — tidak bocor ke guild lain
- **2-step confirmation** untuk `/reset-config` — anti reset tidak sengaja
- **Exclusive mode** di self-role select — hanya 1 role pada satu waktu
- **Prototype pollution guard** di `configManager.setField`
- **`warnManager` keyed by `(guildId, userId)`** + auto-migration dari format lama
- **`processExpiredRole` tidak hapus schedule** pada transient error
- **Ghost loop fix** untuk recurring announcements saat channel dihapus
- **Skip bots + single audit log fetch** di memberHandler

---

## 📞 Bantuan

Kalau ada masalah yang tidak ada di Troubleshooting:

1. **Cek console output bot** — pesan error biasanya ada di sana
2. **Cek `/config-show`** — pastikan semua setting benar
3. **Cek `#audit-log`** — lihat action terakhir yang mungkin trigger masalah
4. **Cek file JSON** di folder root — apakah formatnya valid (bisa dibuka di text editor)
5. **Backup dulu** (`/backup-now`) sebelum debugging lebih lanjut

---

**Versi dokumen:** v3.9.2  
**Last updated:** July 2026  
**Bot version:** 3.9.2
