# 🤖 Thor Bot v3.9.7

Bot Discord untuk manajemen server community — dengan **temp voice system**, **model key-driven VIP** (MAX EXTEND), **self-role fleksibel**, **audit log lengkap**, dan berbagai fitur engagement (giveaway, poll, leaderboard, dll).

> **v3.9.x — Stability & Security Hardening**
> Patch fokus pada data integrity, race condition, dan validasi input.

## ✨ Fitur Utama

### Core
- 👋 **Welcome / Goodbye** otomatis saat member join/leave (deteksi kick vs leave vs ban via audit log)
- ✅ **Verifikasi** dengan tombol (auto hapus role Unverified, kasih role Verified)
- 🎫 **Sistem Tiket** dengan dropdown produk (Beli / Bantuan / Lapor) + race-condition protection
- 🧾 **Invoice otomatis** ke channel testimoni (dari `/set-key` DAN dari modal set key di tiket)
- ⚙️ **Fully configurable** — semua setting bisa diubah lewat slash command, tanpa edit file
- 🔒 **Atomic JSON writes** — semua file JSON ditulis via pattern `tmp + rename` supaya tidak corrupt kalau bot crash / power loss di tengah write

### 🎤 Temp Voice
Voice channel pribadi yang otomatis dibuat saat member join trigger channel:

- **Buat voice**: Member join ke channel "🔊 Buat Voice" → bot otomatis buat voice channel pribadi → member dipindahkan ke channel baru
- **Panel global**: Satu panel kontrol di control channel menampilkan semua voice aktif + button kontrol
- **Kontrol owner**: Rename, Kick, Limit, Lock, Transfer, Delete, Info Room
- **Auto-transfer**: Kalau owner leave tapi masih ada member lain, ownership otomatis pindah ke member paling senior
- **Auto-delete**: Channel otomatis dihapus saat kosong
- **Info Room**: Lihat detail voice room (owner, member, limit, status, dll) via button ephemeral

### 🔑 Key-Driven VIP
Model manajemen role VIP berbasis **key** dengan logika **MAX EXTEND**:

- Setiap pembelian = **1 key baru** dengan `expireAt` independen (tidak ditumpuk)
- Role VIP akan dihapus mengikuti **key dengan sisa waktu terbanyak**
- Key yang expired otomatis dihapus dari `keys.json` setiap 60 detik
- Saat schedule fires, scheduler **cek ulang** key aktif:
  - Kalau ada key permanen → hapus schedule, role tetap
  - Kalau masih ada key aktif → reschedule ke `max(expireAt)`
  - Kalau tidak ada key aktif → hapus role + schedule + DM member
- Produk `days:0` = permanen (role tidak akan pernah dihapus)
- **Cross-guild safe**: data key di-scope per `(guildId, userId)` — key dari server A tidak bisa dipakai di server B

### 🎭 Self-Role Fleksibel
Member bisa ambil & lepas role sendiri tanpa minta ke admin:

- **Multi-panel**: admin bisa bikin banyak panel (di channel berbeda)
- **2 tipe UI**: `button` (≤25 role) atau `select` (dropdown, ≤25 role)
- **2 mode**: `multi` (boleh banyak role) atau `exclusive` (hanya 1 role pada satu waktu)
- Setiap role bisa custom: label, emoji, description
- Panel message auto-update saat admin add/remove role

### 📢 Announce & Embed Builder
- **`/announce`** — quick announce 1 command (channel, title, description, color, image, mention)
  - Mention divalidasi ketat: hanya `@everyone`, `@here`, `<@&ROLE_ID>`, `<@USER_ID>` yang diterima
- **`/embed-builder`** — interactive builder dengan live preview + validasi panjang field (Discord limit)

### 🛠️ Admin Tools
- **Audit Log**: catat **SEMUA** admin action ke channel khusus (dengan retry 1x bila gagal kirim)
- **Backup System**: auto-backup tiap 24 jam + manual — maks 7 backup terbaru
  - `/restore-backup` sekarang **2-step confirmation** (harus klik tombol "Ya, Restore" dulu)
  - Pre-restore safety backup otomatis dibuat (format `pre-restore_*`)
- **Giveaway**: Fisher-Yates shuffle + winner DM + stats tracking + per-user lock anti double-join
- **Scheduled Announcements**: one-shot atau recurring (daily/weekly/monthly) + range validation (maks 365 hari relatif, maks 5 tahun absolut)
- **Warn System**: auto-action (3=mute 1h, 5=mute 1d, 7=kick)
- **Stats & Leaderboard**: tracking pesan, pembelian VIP, total belanja, giveaway wins
- **Poll**: live bar chart, single/multiple choice + per-user lock anti double-vote

## 🚀 Cara Install

1. Extract folder ini
2. `npm install`
3. Copy `.env.example` jadi `.env`, isi:
   - `DISCORD_TOKEN` — token bot dari Discord Developer Portal
   - `GUILD_ID` — ID server Anda (untuk registrasi command instan; kalau kosong, fallback ke global ~1 jam)
4. `npm start`

### Permission yang Dibutuhkan
- **Server Members Intent** (Privileged Gateway Intent) — wajib di-enable di Developer Portal
- Bot permission di server: `Manage Roles`, `Manage Channels`, `Send Messages`, `Embed Links`, `View Audit Log`, `Moderate Members`, `Move Members` (untuk temp voice)
- **Role bot harus di ATAS** role Verified, Unverified, VIP, dan Self-Role di server settings

## 📋 Daftar Slash Command

> Semua command admin-only (butuh permission `ManageGuild` atau role Admin yang di-set via `/set-role admin`).
> Exception: `/leaderboard` dan `/my-stats` boleh dipakai member biasa.

### Panel Setup
- `/setup-verify` — pasang panel verifikasi
- `/setup-ticket` — pasang panel tiket & price list
- `/setup-selfrole title description type exclusive` — pasang panel self-role baru
- `/setup-tempvoice` — setup temp voice (kategori + trigger channel + control panel)
- `/tempvoice-remove` — hapus semua setup temp voice

### Atur Role
- `/set-role verified @role` — set role Verified
- `/set-role unverified @role` — set role Unverified
- `/set-role admin @role` — set role Admin/Staff
- `/remove-role verified` — hapus role dari config

### Atur Channel
- `/set-channel welcome #channel`
- `/set-channel goodbye #channel`
- `/set-channel invoice #channel`
- `/set-channel audit-log #channel` — catat semua admin action
- `/remove-channel welcome` — hapus channel dari config

### Atur Pesan (Embed)
- `/set-message welcomeBody teks...` (max 4096 char untuk body, 256 untuk title)
- `/set-message goodbyeBody teks...`
- `/set-message verifyBody teks...`
- `/set-message ticketBody teks...`
- `/reset-message welcomeBody` — reset ke default
- `/reset-message ALL` — reset semua pesan (2-step confirmation)

**Variabel yang bisa dipakai:**
- `{user}` — mention user
- `{username}` — nama user (User#1234)
- `{server}` — nama server
- `{count}` — jumlah member
- `{action}` — untuk goodbye (keluar / dikeluarkan (kick) / di-ban)

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
- `/set-key user:@user value:30d key:ABCDE-12345-FGHIJ` — beri key ke user + grant role + extend schedule (MAX EXTEND) + DM member + kirim invoice + audit log
  - Audit log tidak membocorkan nilai key (hanya `***` + panjang)
- `/list-keys user:@user` — lihat semua key (aktif & expired) user
- `/clear-schedule user:@user clear_keys:false` — hapus semua schedule role user
  - `clear_keys:true` = hapus SEMUA key user + lepas semua role VIP (full reset)

### 🎭 Self-Role (member ambil sendiri)
- `/setup-selfrole title:... description:... type:button exclusive:false` — bikin panel baru
- `/selfrole-add panel_id:@role label:Notif emoji:🔔 description:...` — tambah role ke panel
- `/selfrole-remove panel_id:@role` — hapus role dari panel
- `/selfrole-list` — lihat semua panel self-role di guild
- `/selfrole-delete panel_id:` — hapus panel (pesan + config)

### 🎤 Temp Voice — Cara Kerja

**Setup (admin):**
1. `/setup-tempvoice` — bot auto-buat kategori "🎤 TEMP VOICE" berisi:
   - 📋 `control-panel` (text channel) — tempat panel global dipasang
   - 🔊 `Buat Voice` (voice channel) — trigger channel untuk buat voice baru
2. Panel global otomatis muncul di control-panel channel

**Penggunaan (member):**
1. Member join ke channel "🔊 Buat Voice" → bot otomatis buat voice channel pribadi → member dipindahkan ke channel baru
2. Member jadi owner dan bisa kontrol via panel global:
   - ✏️ **Rename** — ubah nama channel
   - 🚫 **Kick** — keluarkan member dari voice
   - 👥 **Limit** — atur max member (0 = unlimited)
   - 🔒 **Lock** — kunci/buka akses join
   - 🔄 **Transfer** — pindah ownership ke member lain
   - 🗑️ **Delete** — hapus channel
   - ℹ️ **Info Room** — lihat detail voice room

**Aturan:**
- Satu member hanya bisa punya 1 temp voice aktif
- Kalau owner leave tapi masih ada member lain → ownership otomatis pindah
- Channel otomatis dihapus saat semua member keluar

### 📢 Announce & Embed Builder
- `/announce channel:#ch title:... description:... color? image? thumbnail? mention?` — quick announce
  - `mention` divalidasi ketat — hanya `@everyone`/`@here`/`<@&ROLE_ID>`/`<@USER_ID>` yang diterima
- `/embed-builder` — interactive builder dengan live preview + validasi panjang
- `/embed-list` — lihat session embed builder aktif
- `/embed-cancel session_id:` — batalkan session

### 🎉 Giveaway
- `/giveaway create channel:#ch prize:VIP 30 Hari duration:60 winners:1 required_role?:@role`
  - Tidak lagi otomatis ping `@everyone` (admin yang mau ping pakai `/announce` terpisah)
- `/giveaway list` — lihat semua giveaway
- `/giveaway end id:gw_xxx` — akhiri lebih awal
- `/giveaway reroll id:gw_xxx` — reroll winner

### ⏰ Scheduled Announcements
- `/announce-schedule channel:#ch title:... description:... at:30m|2h|1d|"2026-01-15 20:00" recurring?:daily|weekly|monthly`
  - Validasi range: maks 365 hari untuk relative time, maks 5 tahun untuk absolute time
- `/announce-list` — lihat semua announce terjadwal
- `/announce-cancel id:ann_xxx`

### ⚠️ Warn System
- `/warn user:@user reason:Spam` — beri warning (auto-action: 3=mute 1h, 5=mute 1d, 7=kick)
- `/warn-list user:@user` — lihat history warning
- `/warn-remove user:@user warn_id:warn_xxx` — hapus 1 warn
- `/warn-clear user:@user` — hapus SEMUA warn

### 📊 Stats & Leaderboard
- `/stats` — statistik agregat server (admin)
- `/leaderboard metric:messages|vipPurchases|totalSpent|giveawaysWon` — top 10 (public)
- `/my-stats` — statistik pribadi (public)

### 📊 Poll
- `/poll create channel:#ch question:Event weekend? multiple?:false` — buka modal input options
  - Modal customId aman (panjang tetap, tidak overflow walau question panjang)
- `/poll list` — lihat semua poll
- `/poll close id:poll_xxx` — tutup poll + tampilkan hasil akhir

### 💾 Backup
- `/backup-now` — backup manual sekarang
- `/backup-list` — lihat semua backup (maks 7 + safety pre-restore backup)
- `/restore-backup name:2026-01-15_20-00-00` — restore (2-step confirmation + auto safety backup)
  - Setelah restore selesai, cache in-memory otomatis di-reload — tidak perlu restart bot lagi (rekomendasi tetap restart untuk konsistensi penuh)

### Lihat Konfigurasi
- `/config-show` — lihat semua setting saat ini
- `/list-messages` — lihat semua teks pesan embed

### Reset
- `/reset-config` — ⚠️ **hapus SEMUA setting** (2-step confirmation, tidak bisa di-undo!)

## ⚠️ Catatan Penting

1. **Role bot harus di ATAS** role Verified, Unverified, VIP, dan Self-Role di server settings
2. Bot harus punya permission: Manage Roles, Manage Channels, Send Messages, Embed Links, View Audit Log, Moderate Members, Move Members
3. Aktifkan **Privileged Gateway Intents → Server Members Intent** di Discord Developer Portal
4. Maksimal 25 produk (batas dropdown Discord)
5. Maksimal 25 role per panel self-role (batas Discord)
6. `GUILD_ID` wajib di-set di `.env` untuk registrasi command instan (1 detik vs 1 jam)
7. File yang di-exclude dari git (lihat `.gitignore`):
   - `config.json`, `keys.json`, `scheduledRoles.json`, `selfRoles.json`
   - `giveaways.json`, `polls.json`, `warns.json`, `stats.json`, `scheduledAnns.json`
   - `tempVoice.json`, `tickets.json` — data runtime
   - `.env` — token bot
   - `backups/` — folder backup
8. Setelah `/restore-backup` selesai, **RESTART bot** (`npm start`) supaya semua cache konsisten.
9. **Jangan pernah share `DISCORD_TOKEN`** — siapa pun yang punya token bisa kontrol bot penuh. Kalau bocor, langsung Reset Token di Developer Portal.

## 📁 Struktur File

```
Thor/
├── index.js                          # Entry point — client init, event handlers, voice state handler
├── package.json
├── .env.example                      # Template env (copy ke .env)
├── .gitignore
├── README.md                         # File ini
├── ADMIN_GUIDE.md                    # Panduan detail untuk admin server
├── handlers/
│   ├── commandHandler.js             # Slash command handler (47 commands)
│   ├── interactionHandler.js         # Button/select/modal handler (termasuk temp voice)
│   └── memberHandler.js              # Welcome/goodbye + kick/ban detection
└── utils/
    ├── commandDefinitions.js         # Definisi slash command
    ├── schedulerTasks.js             # processExpiredRole, processGiveawayEnd, dll
    ├── configManager.js              # CRUD config.json (atomic + prototype pollution guard)
    ├── constants.js                  # Magic numbers, Discord limits, timing
    ├── permissions.js                # isAdmin check (TTL-cached admin role)
    ├── safeWrite.js                  # Atomic JSON write (tmp + rename)
    ├── userLock.js                   # Per-user in-process lock (TOCTOU guard)
    ├── tempVoiceManager.js           # CRUD tempVoice.json (data layer)
    ├── tempVoiceControlPanel.js      # Render panel embed + button (UI builder)
    ├── keyManager.js                 # CRUD keys.json (key-driven model, cross-guild)
    ├── roleScheduler.js              # Schedule role removal (MAX EXTEND, cross-guild)
    ├── selfRoleManager.js            # CRUD selfRoles.json
    ├── selfRolePanelBuilder.js       # Render panel embed + components
    ├── ticketManager.js              # Create/close ticket + invoice (metadata di tickets.json)
    ├── auditLog.js                   # Kirim audit log (retry 1x bila transient error)
    ├── backupManager.js              # Auto + manual backup (restore lock + path traversal guard)
    ├── giveawayManager.js            # CRUD giveaways.json
    ├── scheduledAnnouncements.js     # CRUD scheduledAnns.json (range validation)
    ├── warnManager.js                # CRUD warns.json (cross-guild)
    ├── statsManager.js               # CRUD stats.json (cache + reload)
    ├── pollManager.js                # CRUD polls.json + poll session store
    ├── embedBuilder.js               # Embed helper
    └── embedBuilderSessions.js       # Session manager /embed-builder
```

## 📚 Dokumentasi

- **[ADMIN_GUIDE.md](./ADMIN_GUIDE.md)** — panduan lengkap untuk admin server (setup, operasional harian, troubleshooting, best practices)
