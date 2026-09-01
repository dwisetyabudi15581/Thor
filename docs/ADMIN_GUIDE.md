# 📖 ADMIN GUIDE — Community Bot v3.9.28

Panduan lengkap untuk admin server Discord yang menjalankan bot ini. Cocok untuk admin baru yang baru pertama kali setup, maupun admin yang sudah ada untuk referensi harian.

---

## 🎯 Daftar Isi

1. [Quick Start (5 menit)](#1-quick-start-5-menit)
2. [Setup Awal Server](#2-setup-awal-server)
3. [Manajemen Produk & VIP](#3-manajemen-produk--vip)
4. [Operasional Harian](#4-operasional-harian)
5. [Moderation (Warn System)](#5-moderation-warn-system)
6. [Engagement (Giveaway & Poll)](#6-engagement-giveaway--poll)
7. [Fitur Komunitas Lanjutan](#7-fitur-komunitas-lanjutan)
8. [Backup & Restore](#8-backup--restore)
9. [Troubleshooting](#9-troubleshooting)
10. [Best Practices](#10-best-practices)
11. [Apa yang Baru di v3.9.x](#11-apa-yang-baru-di-v39x)

---

## 1. Quick Start (5 menit)

### Prasyarat

- Node.js 18+ (`engines` di package.json mensyaratkan >= 18)
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

- Cek console muncul: `✅ Bot online sebagai NamaBot`
- Cek console muncul: `✅ Slash Commands terdaftar ke guild: Nama Server (instan!)`
- Cek di Discord, ketik `/` — semua 81 slash command harus muncul
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
- `invoice` — channel testimoni transaksi (otomatis terisi setiap Set Key / Kirim Pesanan / Pesanan Sukses — sekali per tiket, tidak dobel)
- `audit-log` — channel tempat bot catat SEMUA admin action (50 action types)
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

Bot akan kirim embed + 4 tombol default (Beli Key / Transaksi, Help, Report, Claim Giveaway) ke channel tempat command dijalankan. Member klik → bot buat channel tiket private.

> **v3.9.18:** Label tombol default sudah diubah ke **Help** & **Report** (sebelumnya "Bantuan Staff" & "Laporkan Member"). Kategori contoh **Claim Giveaway** juga ditambahkan — bisa dihapus dengan `/remove-category id:claim_giveaway` kalau tidak dibutuhkan.

**Rekomendasi:** Pasang di `#information` atau channel khusus `#order-here`, pin pesannya.

#### Custom Tombol Tiket (v3.9.18+)

Sekarang semua tombol tiket **100% dinamis** — bisa CRUD dari Discord tanpa edit code:

```
# Lihat semua kategori
/list-categories

# Tambah kategori baru (contoh: tombol "Partnership")
/add-category id:partnership label:"Partnership" emoji:"🤝" style:"Primary" requires_key:false

# Update kategori existing tanpa hapus+add ulang (v3.9.19)
/update-category id:partnership label:"Kerjasama" emoji:"💼" style:"Success"

# Hapus kategori (kecuali default: transaction, help, report)
/remove-category id:claim_giveaway

# Setelah ubah kategori, refresh panel yang sudah terpasang:
/refresh-panel id:<panel-id>
```

**Tipe kategori:**

- `requires_key: true` → default produk di kategori ini pakai key (dropdown produk, tombol 🔑 Set Key). Contoh: `transaction`.
- `requires_key: false` → default produk di kategori ini TANPA key (dropdown produk, tombol 📦 Kirim Pesanan). Kalau kategori tidak punya produk sama sekali → langsung buat channel bantuan. Contoh: `jasa`, `help`, `report`, `claim_giveaway`, `partnership`.

> v3.9.27: `requires_key` di kategori/produk hanya menentukan **paket tombol** (Set Key vs Kirim Pesanan) — routing channel TRANSAKSI vs BANTUAN ditentukan oleh "kategori punya produk atau tidak", bukan oleh requires_key.
>
> **v3.9.28: menambah kategori BARU (akun ML, lisensi key, dll) aman otomatis.** Rule klasifikasi (`classifyProduct()`): hanya kategori `help` / `report` / produk ber-flag `isHelp` yang masuk **BANTUAN** — **semua id kategori lain apa pun otomatis TRANSAKSI**. Tidak ada daftar kategori yang di-hardcode; id kategori bebas (`akun_ml`, `lisensi_key`, `topup_diamond`, ...) asal format `[a-zA-Z0-9_-]{1,30}` dan tidak sama persis dengan `help`/`report`. Dilengkapi 14 unit test khusus (`tests/unit/newCategorySafety.test.js`).
>
> ⚠️ **Gotcha penting**: produk transaksi yang **tidak punya** flag `requires_key` (mis. produk lama atau input manual di config) akan dianggap **pakai key** (tombol Set Key). Untuk produk akun/jasa pastikan `requires_key:false` — paling gampang set di **kategori**-nya, semua produk baru di kategori itu mewarisi otomatis.

**Behavior v3.9.19 (FLEKSIBEL — berbasis "ada produk atau tidak") + tombol v3.9.27:**

| Skenario Kategori                      | Produk di kategori   | Behavior                                                        |
| -------------------------------------- | -------------------- | --------------------------------------------------------------- |
| `transaction` (requires_key: true)     | Ada produk key       | Dropdown 🔑 → Set Key                                           |
| `transaction` (requires_key: true)     | Campur key & non-key | Dropdown 🔑/📦 → Set Key untuk key, Kirim Pesanan untuk non-key |
| `jual_akun` (requires_key: false)      | Ada produk akun/jasa | Dropdown 📦 → Kirim Pesanan (tanpa Set Key)                     |
| `help` (requires_key: false)           | Kosong               | Langsung create ticket (BANTUAN)                                |
| `report` (requires_key: false)         | Kosong               | Langsung create ticket (BANTUAN)                                |
| `claim_giveaway` (requires_key: false) | Kosong               | Langsung create ticket (BANTUAN)                                |
| `partnership` (requires_key: false)    | Kosong               | Langsung create ticket (BANTUAN)                                |

**Contoh setup kategori baru (v3.9.28 — terverifikasi aman oleh unit test):**

```
# Jual akun ML — produk tanpa key (tombol 📦 Kirim Pesanan)
/add-category id:akun_ml label:"Akun ML" emoji:🎮 requires_key:false
/add-product label:"Akun ML Mythic" value:ml_mythic price:"Rp 150.000" category:akun_ml
#  ↑ requires_key tidak diisi → mewarisi false dari kategori

# Lisensi key — produk pakai key (tombol 🔑 Set Key)
/add-category id:lisensi_key label:"Lisensi Key" emoji:🔑 requires_key:true
/add-product label:"Windows 11 Pro OEM" value:win11_pro price:"Rp 150.000" category:lisensi_key

# Refresh panel supaya kategori baru muncul:
/refresh-panel id:<panel-id>
```

**Jadi kamu fleksibel mau pilih cara mana:**

- **Cara 1 (sederhana)**: Taruh semua produk (key + jasa) di kategori `transaction`. User pilih lewat 1 dropdown.
- **Cara 2 (terpisah)**: Bikin kategori `jasa` khusus, isi dengan produk jasa. User pilih kategori dulu → dropdown jasa muncul.
- **Cara 3 (quick action)**: Bikin kategori tanpa produk (mis. `claim_giveaway`) untuk akses cepat tanpa pilih produk.

**Update produk existing (v3.9.19):**

```
# Edit produk tanpa hapus+add ulang
/update-product value:vip30 label:"VIP 30 Hari Promo" price:"Rp 40.000"

# Pindah kategori produk
/update-product value:joki category:jasa

# Ubah requires_key (dari key ke non-key atau sebaliknya)
/update-product value:joki requires_key:false
```

**Migration otomatis (v3.9.18):**

Saat bot start, config lama akan otomatis di-migrate:

- Label `"Bantuan Staff"` → `"Help"` (hanya kalau belum di-customize admin)
- Label `"Laporkan Member"` → `"Report"` (hanya kalau belum di-customize admin)
- Kategori `claim_giveaway` ditambahkan kalau belum ada. Kalau admin hapus via `/remove-category`, bot menandai `claimGiveawayDismissed` (v3.9.26) dan **tidak akan menambah ulang** — sebelumnya kategori ini "hidup lagi" diam-diam setiap getConfig() berikutnya.

### Step 7: (Opsional) Pasang Self-Role Panel

Untuk member yang mau ambil role sendiri (mis. role notif game):

```
/setup-selfrole title:"Pilih Notif Game" description:"Klik role yang kamu mau" type:button exclusive:false
/selfrole-add panel_id:sr_xxx role:@Notif ML label:"Notif ML" emoji:"🎮" style:Primary
/selfrole-add panel_id:sr_xxx role:@Notif PUBG label:"Notif PUBG" emoji:"🔫" style:Success
```

Opsi lanjutan `/selfrole-add` (v3.9.11+):

- `style` — warna tombol: Primary (blurple), Secondary (abu), Success (hijau), Danger (merah)
- `requires_role` — role "prerequisite": role ini baru muncul bisa diambil kalau member sudah punya role lain (berguna untuk role bertingkat)
- `type:select` di `/setup-selfrole` — pakai dropdown (rapi untuk banyak role)

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

### Ubah Produk (label / harga / durasi / kategori)

Sejak v3.9.19 ada `/update-product` — tidak perlu hapus + tambah ulang:

```
/update-product value:60d price:"Rp. 175.000"
/update-product value:60d label:"60 Days+" duration:"60 Hari" category:transaction
```

Semua field opsional — hanya yang diisi yang berubah. Tombol Set Key di tiket lama tetap jalan setelah rename (v3.9.26: lookup produk sekarang pakai `value` yang stabil, bukan label).

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

**A. Produk pakai key (mis. VIP 30 Hari):**

1. Member klik **🛒 Beli Key** di panel tiket → pilih produk (🔑)
2. Bot buat channel tiket private `#ticket-{user-id}`
3. Member kirim bukti pembayaran
4. Admin konfirmasi → klik **🔑 Set Key** di tiket
5. Modal muncul → admin ketik key → submit
6. Bot otomatis: simpan key, beri role, schedule, DM member, kirim invoice
7. **v3.9.20+:** Channel tiket TIDAK otomatis dihapus. Bot kirim pesan teks
   simpel "key udah dikirim ke DM" di channel. Admin bisa Q&A dengan member
   dulu (mis. member nanya cara pakai key).
8. Kalau sudah selesai, admin klik **🔒 Tutup Tiket** (tombolnya ada di pesan
   awal tiket dari bot) → pilih **✅ Selesai** → bot save transcript otomatis
   ke channel transcript, lalu hapus channel.

**B. Produk TANPA key (v3.9.27 — mis. jual akun ML, jasa joki):**

1. Tambahkan produk dengan `requires_key:false`:
   `/add-product label:"Akun ML Mythic" value:akun_ml price:"Rp 150.000" category:transaction requires_key:false`
   (opsional: `/set-product-role value:akun_ml role:@Customer days:0` untuk auto-role)
2. Member pilih produk (📦) di dropdown → tiket TRANSAKSI dibuat — dengan tombol **📦 Kirim Pesanan**
3. Member kirim bukti pembayaran
4. Admin konfirmasi → klik **📦 Kirim Pesanan** → modal muncul → admin ketik
   detail pesanan (username/password/note — Enter = baris baru, maks 1500 char)
5. Bot otomatis: **DM detail pesanan ke pembeli** (channel tiket akan terhapus
   saat close — DM jadi satu-satunya salinan permanen buat pembeli), auto-role
   (+ auto-expire kalau `days` diisi), catat pembelian ke stats/leaderboard,
   kirim invoice, audit log `ORDER_DELIVERED`
6. Tombol Tutup Tiket berubah jadi **✅ Selesai** → transcript + hapus channel

> Alternatif tanpa lewat Kirim Pesanan: admin langsung klik **🔒 Tutup Tiket →
> ✅ Pesanan Sukses** — role + stats + invoice tetap otomatis jalan. Cocok
> kalau pesanan disampaikan lewat chat/hadiah bukan digital.

**Tips:**

- Sebelum klik Set Key / Kirim Pesanan, pastikan pembayaran sudah masuk
- Key bisa apa saja (string bebas), mis. `ABCDE-12345-FGHIJ-67890`
- Bot akan DM member dengan key + info expire + list semua key aktif
- Di Discord mobile, long-press key di DM → muncul menu "Copy"
- Detail pesanan dikirim ke DM APA ADANYA (tanpa modifikasi) — jangan khawatir password berubah
- Invoice otomatis terkirim ke channel invoice (testimoni) — sekali saja per tiket (v3.9.27: tidak lagi dobel untuk transaksi key)
- Transcript otomatis tersimpan ke channel transcript saat admin Tutup Tiket
- Metadata tiket (userId, productName, price, isTransaction, requiresKey, isCompleted) disimpan di `tickets.json` — bukan di channel topic (anti spoof/edit)

### v3.9.21: DM format lebih natural + gak ada panel baru di channel

**Perubahan dari v3.9.20:**

- **DM ke member** sekarang pakai inline code (`` `key` ``) bukan codeblock. Di Discord mobile, long-press inline code langsung muncul menu Copy. Bahasa juga lebih santai, gak terlalu kaku.
- **Di channel tiket**, bot cuma kirim pesan teks singkat buat user — bukan untuk admin.

### v3.9.22: DM pakai emoji + role pakai nama (bukan mention)

**Perubahan dari v3.9.21:**

- **DM ke member** sekarang pakai emoji biar gak sepi (📦🌐🔑🎭⏰📋💡). Role pakai `role.name` (nama role) bukan mention (`${role}`), karena di DM mention role gak ke-resolve (muncul "unknown role" atau @role mentah).
- **Notif di channel** dibikin lebih singkat & targeting user (bukan admin). Cuma ngasih tau "key udah dikirim via DM, cek ya". Kalau DM gagal, fallback kasih tau user supaya nunggu admin kirim manual.

**Contoh DM yang dikirim ke member:**

```
Halo thor064747! Transaksi kamu udah selesai 🎉

📦 Produk: 3 DAYS
🌐 Server: Chronos

🔑 KEY:
`Abgs-1828`

🎭 Role: VIP 3 Days
⏰ Expire: 3 hari lagi

📋 Key aktif kamu untuk role ini:
1. `Test-1233` (sisa 3 hari lagi)
2. `12345` (sisa 3 hari lagi)
3. `Test-2910` (sisa 3 hari lagi)
4. `Abgs-1828` (sisa 3 hari lagi)

💡 Simpan keynya. Kalau role tiba-tiba hilang padahal key masih aktif, hubungi admin.
```

**Contoh notif yang muncul di channel tiket (untuk user, bukan admin):**

Kalau DM sukses:

```
Halo @user! 🔑 Key kamu udah dikirim via DM, cek ya 📬
```

Kalau DM gagal:

```
⚠️ @user — gagal kirim DM (kemungkinan DM ditutup). Admin akan kirim key manual ya.
```

### v3.9.20: Perubahan penting Set Key & Tutup Tiket

**Sebelum v3.9.20:**

- Set Key sukses → channel otomatis dihapus → transcript TIDAK tersimpan (karena hapus channel tanpa lewat closeTicket)
- Member gak sempat nanya kalau belum paham cara pakai key

**Sekarang (v3.9.20+):**

- Set Key sukses → channel TETAP TERBUKA + pesan teks "key udah dikirim DM" muncul
- Admin & member bisa Q&A dulu di channel tiket
- Saat admin klik Tutup Tiket → karena `meta.isCompleted=true`, hanya muncul tombol "✅ Selesai" (tidak ada "Tidak Jadi Beli" karena transaksi sudah sukses)
- Klik "✅ Selesai" → closeTicket(isSuccess=true) → transcript otomatis tersimpan ke channel transcript + kirim invoice (kalau belum) → hapus channel

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

## 7. Fitur Komunitas Lanjutan

Fitur berikut ditambahkan sejak v3.9.13 — semuanya bisa dikonfigurasi penuh dari Discord.

### Auto-Responder

Bot membalas pesan otomatis saat member mengetik trigger di awal pesan (case-insensitive).

```
/add-responder trigger:"!sosmed" reply:"Instagram: ig.com/serverkita\nYouTube: yt.com/@serverkita" reply_type:embed
/list-responder
/remove-responder trigger:"!sosmed"
```

- `reply_type`: `text` (plain) atau `embed`
- Support `\n` untuk multi-baris (v3.9.24)
- Cooldown default 3 detik per-user (bisa diatur per responder, `0` = mati)
- Maks 50 responder per guild
- Anti mass-ping: mention di reply tidak men-trigger ping (`allowedMentions` dikunci)

### Anti-Spam & Auto-Mod

```
/set-automod spam_action:mute_10m word_action:delete_only mention_action:warn
/automod-toggle enabled:true
/automod-show
/add-word words:"kata1 kata2" tipe:blocklist action:mute_10m
/remove-word word:kata1
/list-words
/add-link-whitelist channel:#share-link
/remove-link-whitelist channel:#share-link
```

- **Spam**: N pesan dalam window (default 5/10 detik) → action
- **Word filter (v3.9.23 WORD FLEX)**: tambah kata satu per satu, action per kata, exempt word, matching **whole-word** ("asu" TIDAK match "asus")
- **Link block** + whitelist channel/role
- **Mass-mention** (default >5 mention/pesan)
- Action: `delete_only`, `warn`, `mute_10m`, `mute_1h`, `kick`
- Admin & whitelisted user otomatis kebal

### AFK System

```
/afk reason:"Tidur\nJangan ganggu"
/afk-clear
/afk-list
```

- Saat di-mention, bot auto-reply dengan reason + durasi AFK (auto-delete 30 detik)
- AFK auto-clear saat user kirim pesan lagi (bot sapa "welcome back")
- Reason support `\n` multi-baris (v3.9.25) dan tidak bisa mass-ping

### Leveling System

```
/setup-leveling enabled:true xp_per_message:15 cooldown:60 announce_levelup:true
/add-level-role level:10 role:@Member Aktif
/list-level-roles
/remove-level-role level:10
/rank
/leaderboard-level
```

- XP per pesan dengan cooldown per-user (anti spam chat)
- Role reward otomatis saat level up (bisa bertingkat)
- `/rank` menampilkan kartu level pribadi, `/leaderboard-level` top 10

### Temp Voice

```
/setup-tempvoice channel:#Join For Voice
/tempvoice-remove
```

- Member join channel trigger → bot bikin voice channel pribadi (owner otomatis)
- Kontrol via panel: rename, lock, limit user, transfer ownership, delete
- Channel kosong otomatis dihapus; owner keluar → auto-transfer ke member lain

### Multi-Panel Tiket + Kustomisasi

```
/setup-ticket-panel channel:#tiket title:"Klik untuk order" body:"Harga:\n{price_list}" color:#ff5733
/list-panels
/update-panel id:tp_xxx field:image
/refresh-panel id:tp_xxx
/delete-panel id:tp_xxx
/set-transcript-channel #transcript
```

- Beberapa panel berbeda di channel berbeda, masing-masing bisa filter kategori (`categories:transaction,help`)
- Semua field bisa dikustom: title, body (support template `{server}` `{price_list}` `{price_list:<kategori>}` + `\n`), warna, image, thumbnail, footer, tombol/dropdown
- Panel terdaftar persisten di `data/panels.json` (ikut backup)
- Transcript tiket otomatis tersimpan ke channel transcript sebelum close

### Edit Teks Pesan (modal + newline)

```
/set-message tipe:welcomeBody teks:"Halo {user}\nSelamat datang di {server}"
/edit-message tipe:ticketBody    ← buka modal editor (Enter di modal = baris baru asli)
/list-messages
/reset-message tipe:welcomeBody
```

- Input slash command di PC **tidak bisa Enter** (Enter = kirim) — tulis `\n` untuk baris baru
- Berlaku untuk: `\n` di send-message, announce, set-message (tipe Body), setup-ticket-panel, responder, afk, warn, selfrole (v3.9.24-25)
- ⚠️ Tipe **Title** sengaja TIDAK dikonversi (embed title Discord menolak newline)

---

## 8. Backup & Restore

### Backup Manual

```
/backup-now
```

Bot buat folder `backups/YYYY-MM-DD_HH-mm-ss/` berisi copy **semua 16 file data** dari folder `data/`: config, keys, scheduledRoles, selfRoles, giveaways, polls, warns, stats, scheduledAnns, tempVoice, tickets, **automod, levels, responders, afk, panels** (5 file terakhir ditambahkan v3.9.24 — sebelumnya word filter, leveling, auto-responder, AFK, dan panel multi-tiket TIDAK ikut di-backup).

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
4. Setelah restore selesai, semua cache in-memory di-reload otomatis (stats, panels, permissions; sejak v3.9.26 juga automod/afk/responders/levels)
5. **RESTART bot** (`Ctrl+C` lalu `npm start`) tetap direkomendasikan untuk konsistensi penuh

**Proteksi (v3.9.1+):**

- 2-step confirmation — tidak ada lagi restore tidak sengaja karena typo
- Restore lock — kalau 2 admin klik restore bersamaan, hanya 1 yang jalan, yang lain ditolak
- Path traversal guard — name backup divalidasi (tidak boleh mengandung `..`, `/`, `\`)
- Pre-restore backup sekarang bisa juga di-restore (sebelumnya hanya muncul di list tapi tidak bisa di-restore)

---

## 9. Troubleshooting

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
- Manager lain membaca dari disk; sejak v3.9.26 automod/afk/responder/levels memakai cache 15 detik yang otomatis di-invalidasi setelah restore dan setiap kali data ditulis.

### Pesan "Tunggu sebentar, kamu lagi klik terlalu cepat"

- Ini muncul kalau user double-click tombol Discord (giveaway/poll) dalam <100ms.
- Lock otomatis release dalam 5 detik.
- Coba klik sekali lagi setelah 1 detik — seharusnya sukses.

---

## 10. Best Practices

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

## 11. Apa yang Baru di v3.9.x

### v3.9.28 — Kategori baru aman otomatis (akun ML / lisensi key)

- **Verifikasi pertanyaan admin: "tambah kategori baru seperti akun ML atau lisensi key — aman?"** → **Ya, aman otomatis**. Klasifikasi (`classifyProduct()`) tidak hardcode daftar kategori: hanya `help`/`report`/`isHelp` yang masuk BANTUAN, **semua id kategori lain apa pun otomatis TRANSAKSI**
- **14 unit test baru** (`tests/unit/newCategorySafety.test.js`): skenario akun_ml non-key (📦 Kirim Pesanan aktif, Set Key ditolak), lisensi_key (🔑 Set Key aktif, Kirim Pesanan ditolak), roundtrip metadata → tombol, pewarisan `requires_key` kategori→produk di `/add-product`, deskripsi dropdown campur
- **Fix deskripsi dropdown kategori campur** — v3.9.27 masih pakai flag kategori (kategori "Akun ML" berisi 2 akun non-key + 1 top-up key dilabeli "pakai key"). Sekarang dihitung dari produk aktual: "pakai key" / "tanpa key" / "N tanpa key / M pakai key"
- **Gotcha terdokumentasi**: produk transaksi tanpa flag `requires_key` → default pakai key (Set Key). Set `requires_key:false` di kategori supaya produk mewarisi

### v3.9.27 — Transaksi non-key (jual akun / jasa) + tombol Kirim Pesanan

- **Bug user-reported fixed:** produk tanpa key (jual akun ML, jasa) dianggap tiket BANTUAN — tombol close gaya help, invoice tidak terkirim, stats tidak tercatat, auto-role tidak pernah diberikan. Semua diperbaiki lewat flag `isTransaction` eksplisit di `tickets.json`
- **Fitur baru: tombol 📦 Kirim Pesanan** di tiket produk non-key — admin isi detail pesanan (multi-baris) di modal → bot DM detail ke pembeli + auto-role + invoice + stats + audit `ORDER_DELIVERED`
- **"✅ Pesanan Sukses" sekarang benar-benar bekerja** untuk produk non-key (role + stats + invoice otomatis)
- **Dobel invoice fixed** — transaksi key tadinya kekirim invoice 2x (saat Set Key + saat close)
- **Modal title >45 char fixed** — produk dengan label panjang membuat tombol Set Key mati diam-diam
- **Deskripsi dropdown panel** kini berbasis konten: "Transaksi — N produk (pakai/tanpa key)" vs "Bantuan / buka tiket langsung"
- **Emoji dropdown produk** 🔑 (pakai key) vs 📦 (tanpa key)
- Klasifikasi tiket lama (yang masih terbuka saat update) tidak berubah — tiket baru selalu benar

### v3.9.26 — Audit menyeluruh (single-guild) + hardening

- **`/update-panel` image/thumbnail/footer FIXED** — sebelumnya tersimpan di key yang salah (no-op diam-diam)
- **`/giveaway list` & `/poll list` dibatasi 15 terbaru** — sebelumnya mati permanen di ~30 entry (limit 4096)
- **Poll create divalidasi** (question maks 250, channel harus text) — sebelumnya entry zombie + admin stuck "Bot is thinking..."
- **claim_giveaway bisa dihapus permanen** — sebelumnya "hidup lagi" diam-diam tiap pesan
- **Karantina file korup** — semua 16 file data di-rename `.corrupt-<ts>` sebelum fallback default (tidak lagi tertimpa diam-diam)
- **GC harian** — giveaway/poll/announcement lama (>30 hari) otomatis dipangkas
- **Hot-path cache** — automod/afk/responder/levels (dulu 5-7 readFileSync sync per pesan)
- **GUILD_ID guard** di semua event (asuransi kalau bot tak sengaja di-invite ke server lain)
- Migrasi v1→v2 config tidak lagi drop field modern; emoji tervalidasi (anti poison panel); per-hook try/catch di messageCreate; DM set-key & transcript tahan data panjang

### v3.9.25 — Newline everywhere

- `\n` support ditambahkan ke /set-message (Body), /afk, /warn, /setup-selfrole, /selfrole-add

### v3.9.24 — Newline + hardening (full codebase review)

- `\n` untuk send-message, announce, announce-schedule, setup-ticket-panel, add-responder
- Router `/update-category` & `/update-product` FIXED (sebelumnya selalu error "belum didukung")
- Backup +5 file (automod, levels, responders, afk, panels)
- Crash exit code 0 → 1 (PM2/systemd kini restart dengan benar)
- Test sandbox (tidak lagi menghapus data produksi)
- ready.js per-langkah, userLock owner-token, re-check admin di tombol destruktif, dll.

### v3.9.23 — Auto-mod WORD FLEX

- Word filter per kata + action per kata + exempt + whole-word matching + `/add-word`, `/remove-word`, `/list-words`, `/remove-link-whitelist`

### v3.9.13–v3.9.22 — Fitur komunitas besar

- v3.9.13: Auto-Responder, Anti-Spam/Auto-Mod, AFK, Leveling
- v3.9.14: Multi-panel tiket persisten + kustomisasi penuh
- v3.9.15-22: set key via tiket (tanpa auto-close), DM HP-friendly, transcript otomatis, Set Key DM "kamu dapat hadiah", stabilisasi tiket/panel

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
4. **Cek file JSON** di folder `data/` — apakah formatnya valid (bisa dibuka di text editor). Kalau ada file `*.corrupt-<timestamp>`, itu file yang gagal di-parse dan otomatis di-karantina bot (v3.9.26) — isinya bisa diperiksa/dipulihkan manual sebelum di-rename balik.
5. **Backup dulu** (`/backup-now`) sebelum debugging lebih lanjut

---

**Versi dokumen:** v3.9.26  
**Last updated:** September 2026  
**Bot version:** 3.9.26
