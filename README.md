# 🤖 MLBB Community Bot v3.0

Bot Discord untuk setup server Mobile Legends community — dengan **model key-driven VIP** (MAX EXTEND) dan **self-role fleksibel**.

## ✨ Fitur

### Core
- 👋 **Welcome / Goodbye** otomatis saat member join/leave
- ✅ **Verifikasi** dengan tombol (auto hapus role Unverified, kasih role Verified)
- 🎫 **Sistem Tiket** dengan dropdown produk (Beli / Bantuan / Lapor)
- 🧾 **Invoice otomatis** ke channel testimoni
- ⚙️ **Fully configurable** — semua setting bisa diubah lewat slash command, tanpa edit file

### 🔑 Key-Driven VIP (v3.0 baru)
Model baru untuk manajemen role VIP berbasis **key** dengan logika **MAX EXTEND**:

- Setiap pembelian = **1 key baru** dengan `expireAt` independen (tidak ditumpuk)
- Role VIP akan dihapus mengikuti **key dengan sisa waktu terbanyak**
- Key yang expired otomatis dihapus dari `keys.json` setiap 60 detik
- Saat schedule fires, scheduler **cek ulang** key aktif:
  - Kalau ada key permanen → hapus schedule, role tetap
  - Kalau masih ada key aktif → reschedule ke `max(expireAt)`
  - Kalau tidak ada key aktif → hapus role + schedule
- Produk `days:0` = permanen (role tidak akan pernah dihapus)

**Contoh:**
- Beli 30d → dapat key1 (expire dalam 30 hari), role di-schedule 30 hari
- Di hari ke-15 beli 7d → dapat key2 (expire dalam 7 hari). Role **tetap** mengikuti key1 (sisa 15 hari). Schedule tidak berubah.
- Di hari ke-25 (sisa key1 = 5 hari) beli 7d → dapat key3 (expire 7 hari). Role **di-extend** ke 7 hari (mengikuti key3). Schedule di-reschedule.
- Di hari ke-30 key1 expired (dihapus dari keys.json). Role tetap mengikuti key3 (sisa 2 hari).

### 🎭 Self-Role Fleksibel (v3.0 baru)
Member bisa ambil & lepas role sendiri tanpa minta ke admin:

- **Multi-panel**: admin bisa bikin banyak panel (di channel berbeda)
- **2 tipe UI**:
  - `button` — tombol klik toggle (≤25 role, 5 button per row)
  - `select` — dropdown select menu (≤25 role)
- **2 mode**:
  - `multi` — member boleh ambil banyak role (mis. role notif game A, B, C)
  - `exclusive` — hanya 1 role pada satu waktu (mis. role warna: merah / biru / hijau)
- Setiap role bisa custom: label, emoji, description
- Panel message auto-update saat admin add/remove role
- Member klik → toggle role → reply ephemeral (cuma yang klik yang lihat)

## 🚀 Cara Install

1. Extract folder ini
2. `npm install`
3. Copy `.env.example` jadi `.env`, isi `DISCORD_TOKEN` dan `GUILD_ID`
4. `npm start`

## 📋 Daftar Slash Command

> Semua command admin-only (butuh permission `ManageGuild` atau role Admin yang di-set via `/set-role admin`).

### Panel Setup
- `/setup-verify` — pasang panel verifikasi
- `/setup-ticket` — pasang panel tiket & price list
- `/setup-selfrole title description type exclusive` — pasang panel self-role baru

### Atur Role
- `/set-role verified @role` — set role Verified
- `/set-role unverified @role` — set role Unverified
- `/set-role admin @role` — set role Admin/Staff
- `/remove-role verified` — hapus role dari config

### Atur Channel
- `/set-channel welcome #channel`
- `/set-channel goodbye #channel`
- `/set-channel invoice #channel`
- `/remove-channel welcome` — hapus channel dari config

### Atur Pesan (Embed)
- `/set-message welcomeBody teks...`
- `/set-message goodbyeBody teks...`
- `/set-message verifyBody teks...`
- `/set-message ticketBody teks...`
- `/reset-message welcomeBody` — reset ke default
- `/reset-message ALL` — reset semua pesan

**Variabel yang bisa dipakai:**
- `{user}` — mention user
- `{username}` — nama user (User#1234)
- `{server}` — nama server
- `{count}` — jumlah member
- `{action}` — untuk goodbye (keluar / dikeluarkan)

### Manajemen Produk
- `/add-product label value price duration` — tambah produk
- `/remove-product value` — hapus produk
- `/list-products` — lihat semua produk

### Auto-Role Produk (VIP role + auto-expire)
- `/set-product-role value:@role days:30` — set role + durasi untuk produk
  - `days:0` = role permanen
- `/remove-product-role value:` — hapus auto-role
- `/list-product-roles` — lihat semua mapping

### 🔑 Key Manager (model key-driven)
- `/set-key user:@user value:30d key:ABCDE-12345-FGHIJ` — beri key ke user + grant role + extend schedule (MAX EXTEND) + DM member
- `/list-keys user:@user` — lihat semua key (aktif & expired) user
- `/clear-schedule user:@user clear_keys:false` — hapus semua schedule role user
  - `clear_keys:true` = hapus SEMUA key user + lepas semua role VIP (full reset)

### 🎭 Self-Role (member ambil sendiri)
- `/setup-selfrole title:... description:... type:button exclusive:false` — bikin panel baru
- `/selfrole-add panel_id:@role label:Notif emoji:🔔 description:...` — tambah role ke panel
- `/selfrole-remove panel_id:@role` — hapus role dari panel
- `/selfrole-list` — lihat semua panel self-role di guild
- `/selfrole-delete panel_id:` — hapus panel (pesan + config)

### Lihat Konfigurasi
- `/config-show` — lihat semua setting saat ini
- `/list-messages` — lihat semua teks pesan embed

### Reset
- `/reset-config` — ⚠️ **hapus SEMUA setting** (tidak bisa di-undo!)

## 🎫 Flow Tiket Transaksi (Model Baru)

1. Member klik **🛒 Beli Key** di panel tiket → pilih produk dari dropdown
2. Bot buat channel tiket private (member + admin only)
3. Member kirim bukti pembayaran di tiket
4. Admin konfirmasi pembayaran, klik tombol **🔑 Set Key** di tiket
5. Modal muncul → admin input key → submit
6. Bot **otomatis**:
   - Simpan key baru ke `keys.json` (expireAt independen)
   - Berikan role VIP ke member
   - Schedule role removal (MAX EXTEND — tidak pernah memendekkan)
   - DM member dengan key + info expire
   - Kirim invoice ke channel invoice
   - Hapus channel tiket

Kalau transaksi batal → admin klik **🔒 Tutup Tiket** → **❌ Tidak Jadi Beli** → tiket ditutup tanpa key/role.

## 🔑 Model Key-Driven — Cara Kerja

### Penyimpanan
- `keys.json` — daftar semua key (aktif & expired)
- `scheduledRoles.json` — daftar schedule penghapusan role (1 entry per user+role, dengan expireAt = max dari semua key)

### Scheduler (jalan setiap 60 detik)
1. Hapus key yang sudah expired dari `keys.json`
2. Proses schedule yang sudah expired (expireAt ≤ now):
   - Cek `getActiveKeysByUserAndRole(userId, roleId, now)`
   - Kalau ada key **permanen** → hapus schedule, role tetap
   - Kalau ada key aktif dengan `expireAt > now` → `updateExpireAt` ke max, role tetap (reschedule)
   - Kalau **tidak ada** key aktif → hapus role + hapus schedule + DM member

### MAX EXTEND Logic
Saat `scheduleRoleRemoval` dipanggil (via Set Key atau `/set-key`):
- `newExpireAt = max(existing.expireAt, newKey.expireAt)` — **tidak pernah** memendekkan
- Kalau `existing.expireAt = null` (permanen) → tidak diubah
- Kalau `newExpireAt > existing.expireAt` → update (extend)
- Kalau `newExpireAt <= existing.expireAt` → keep existing (no shorten)
- Kalau `days <= 0` → permanen, hapus schedule lama

## 🎭 Self-Role — Cara Kerja

### Setup (admin)
1. `/setup-selfrole title:"Pilih Notif" description:"..." type:button exclusive:false`
   - Bot kirim embed panel ke channel + balas ephemeral dengan Panel ID
2. `/selfrole-add panel_id:sr_abc123 role:@Notif label:"Notif ML" emoji:"🎮"`
   - Bot tambahkan role ke panel + update panel message dengan tombol baru
3. Ulangi step 2 untuk setiap role yang ingin ditambahkan

### Penggunaan (member)
- Member klik tombol (mode button) / pilih dari dropdown (mode select)
- Bot toggle role: kalau belum punya → tambah, kalau sudah → lepas
- Untuk mode **exclusive**: ambil role baru otomatis lepas role lama dari panel yang sama
- Reply ephemeral (cuma yang klik yang lihat hasilnya)

## ⚠️ Catatan Penting

1. **Role bot harus di ATAS** role Verified, Unverified, VIP, dan Self-Role di server settings
2. Bot harus punya permission: Manage Roles, Manage Channels, Send Messages, Embed Links
3. Aktifkan **Privileged Gateway Intents → Server Members Intent** di Discord Developer Portal
4. Maksimal 25 produk (batas dropdown Discord)
5. Maksimal 25 role per panel self-role (batas Discord)
6. File yang di-exclude dari git (lihat `.gitignore`):
   - `config.json` — setting bot
   - `keys.json` — database key
   - `scheduledRoles.json` — database schedule role
   - `selfRoles.json` — database panel self-role
   - `.env` — token bot

## 📁 Struktur File

```
Thor-pro/
├── index.js                          # Entry point + scheduler
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── handlers/
│   ├── commandHandler.js             # Slash command handler
│   ├── interactionHandler.js         # Button/select/modal handler
│   └── memberHandler.js              # Welcome/goodbye handler
└── utils/
    ├── configManager.js              # CRUD config.json
    ├── embedBuilder.js               # Embed helper
    ├── permissions.js                # isAdmin check
    ├── keyManager.js                 # CRUD keys.json (key-driven model)
    ├── roleScheduler.js              # Schedule role removal (MAX EXTEND)
    ├── selfRoleManager.js            # CRUD selfRoles.json
    ├── selfRolePanelBuilder.js       # Render panel embed + components
    └── ticketManager.js              # Create/close ticket + invoice
```

## 🔄 Changelog

### v3.0 (key-driven + self-role)
- **NEW**: Model key-driven VIP dengan MAX EXTEND logic
- **NEW**: Self-role fleksibel (button / select, multi / exclusive)
- **NEW**: Tombol "Set Key" di tiket transaksi (ganti "Transaksi Sukses")
- **NEW**: `/set-key`, `/list-keys`, `/clear-schedule` commands
- **NEW**: `/setup-selfrole`, `/selfrole-add`, `/selfrole-remove`, `/selfrole-list`, `/selfrole-delete`
- **CHANGED**: Scheduler sekarang cek ulang key aktif sebelum hapus role
- **REMOVED**: Mode kumulatif (stacking durasi) — diganti dengan MAX EXTEND

### v2.0
- Welcome/Goodbye, Verify, Ticket, Invoice, fully configurable

### v1.0
- Versi awal (flat config, hardcoded IDs)
