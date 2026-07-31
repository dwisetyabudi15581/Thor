# 🤖 MLBB Community Bot v3.7

Bot Discord untuk setup server Mobile Legends community — dengan **model key-driven VIP** (MAX EXTEND), **self-role fleksibel**, **audit log lengkap**, **anti-spam scheduler**, dan berbagai fitur engagement (giveaway, poll, leaderboard, dll).

> **v3.7 — Stability & Code Quality Release**
> Refactor besar: index.js dipecah jadi 3 file (entry point + command definitions + scheduler tasks), audit log sekarang catat SEMUA admin action (sebelumnya 14 action missing), bug fix race condition tiket, validasi input, dan ~20 perbaikan code quality lainnya. Lihat [Changelog](#-changelog) untuk detail.

## ✨ Fitur Utama

### Core
- 👋 **Welcome / Goodbye** otomatis saat member join/leave (deteksi kick vs leave vs ban via audit log)
- ✅ **Verifikasi** dengan tombol (auto hapus role Unverified, kasih role Verified)
- 🎫 **Sistem Tiket** dengan dropdown produk (Beli / Bantuan / Lapor) + race-condition protection
- 🧾 **Invoice otomatis** ke channel testimoni (dari `/set-key` DAN dari modal set key di tiket)
- ⚙️ **Fully configurable** — semua setting bisa diubah lewat slash command, tanpa edit file

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

**Contoh:**
- Beli 30d → dapat key1 (expire 30 hari), role di-schedule 30 hari
- Di hari ke-15 beli 7d → dapat key2 (expire 7 hari). Role **tetap** mengikuti key1 (sisa 15 hari). Schedule tidak berubah.
- Di hari ke-25 (sisa key1 = 5 hari) beli 7d → dapat key3 (expire 7 hari). Role **di-extend** ke 7 hari (mengikuti key3).
- Di hari ke-30 key1 expired. Role tetap mengikuti key3 (sisa 2 hari).

### 🎭 Self-Role Fleksibel
Member bisa ambil & lepas role sendiri tanpa minta ke admin:

- **Multi-panel**: admin bisa bikin banyak panel (di channel berbeda)
- **2 tipe UI**: `button` (≤25 role) atau `select` (dropdown, ≤25 role)
- **2 mode**: `multi` (boleh banyak role) atau `exclusive` (hanya 1 role pada satu waktu)
- Setiap role bisa custom: label, emoji, description
- Panel message auto-update saat admin add/remove role
- TTL session 1 jam (auto-cleanup) supaya tidak memory leak

### 📢 Announce & Embed Builder
- **`/announce`** — quick announce 1 command (channel, title, description, color, image, mention)
- **`/embed-builder`** — interactive builder dengan **live preview**
  - Edit bagian per bagian via dropdown + modal
  - Bagian: Title, Description, Color, Image, Thumbnail, Footer, Author, Fields (≤25), Timestamp
  - Live preview update real-time setiap edit
  - Tombol Preview (ephemeral), Send (modal input channel), Cancel

### 🛠️ Admin Tools
- **Audit Log**: catat **SEMUA** admin action ke channel khusus (24 action types, termasuk SET_KEY, RESET_CONFIG, POLL_CREATE, ANNOUNCE_SEND, EMBED_BUILDER_SEND, dll)
- **Backup System**: auto-backup JSON files tiap 24 jam + manual (`/backup-now`, `/backup-list`, `/restore-backup`) — maks 7 backup terbaru
- **Giveaway**: `/giveaway create/list/end/reroll` dengan Fisher-Yates shuffle (distribusi uniform) + winner DM + stats tracking
- **Scheduled Announcements**: one-shot atau recurring (daily/weekly/monthly)
- **Warn System**: `/warn` dengan auto-action (3=mute 1h, 5=mute 1d, 7=kick) — tidak re-mute berulang
- **Stats & Leaderboard**: tracking pesan, pembelian VIP, total belanja, giveaway wins
- **Poll**: live bar chart, single/multiple choice, Number.isInteger validation (anti-crash)

### 🛡️ Stability & Anti-Bug (v3.7)
- **Scheduler overlap guard** — cegah double DM saat iterasi >60 detik
- **Stats cache + periodic flush** — tidak block event loop tiap pesan
- **Race condition lock** untuk createTicket — cegah user buka 2 tiket bersamaan
- **Rollback zombie entries** — giveaway/poll/self-role panel dihapus otomatis kalau `channel.send` gagal
- **Graceful shutdown** — flush stats ke disk sebelum SIGINT/SIGTERM
- **Modal submit dedup** — cegah double-reply dari Discord retry

## 🚀 Cara Install

1. Extract folder ini
2. `npm install`
3. Copy `.env.example` jadi `.env`, isi:
   - `DISCORD_TOKEN` — token bot dari Discord Developer Portal
   - `GUILD_ID` — ID server Anda (untuk registrasi command instan; kalau kosong, fallback ke global ~1 jam)
4. `npm start`

### Permission yang Dibutuhkan
- **Server Members Intent** (Privileged Gateway Intent) — wajib di-enable di Developer Portal
- Bot permission di server: `Manage Roles`, `Manage Channels`, `Send Messages`, `Embed Links`, `View Audit Log`, `Moderate Members` (untuk warn auto-action)
- **Role bot harus di ATAS** role Verified, Unverified, VIP, dan Self-Role di server settings

## 📋 Daftar Slash Command

> Semua command admin-only (butuh permission `ManageGuild` atau role Admin yang di-set via `/set-role admin`).
> Exception: `/leaderboard` dan `/my-stats` boleh dipakai member biasa.

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
- `/set-channel audit-log #channel` — catat semua admin action
- `/remove-channel welcome` — hapus channel dari config

### Atur Pesan (Embed)
- `/set-message welcomeBody teks...` (max 4096 char untuk body, 256 untuk title)
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
- `/list-keys user:@user` — lihat semua key (aktif & expired) user
- `/clear-schedule user:@user clear_keys:false` — hapus semua schedule role user
  - `clear_keys:true` = hapus SEMUA key user + lepas semua role VIP (full reset)

### 🎭 Self-Role (member ambil sendiri)
- `/setup-selfrole title:... description:... type:button exclusive:false` — bikin panel baru
- `/selfrole-add panel_id:@role label:Notif emoji:🔔 description:...` — tambah role ke panel
- `/selfrole-remove panel_id:@role` — hapus role dari panel
- `/selfrole-list` — lihat semua panel self-role di guild
- `/selfrole-delete panel_id:` — hapus panel (pesan + config)

### 📢 Announce & Embed Builder
- `/announce channel:#ch title:... description:... color? image? thumbnail? mention?` — quick announce (1 command, 1 embed)
  - `color`: hex 6 digit, mis. `#FF0000` atau `FF0000` (default: blurple)
  - `image` / `thumbnail`: URL gambar (harus `http://` atau `https://`)
  - `mention`: `@everyone`, `@here`, `<@&role_id>`, atau text biasa
- `/embed-builder` — interactive builder dengan live preview
- `/embed-list` — lihat session embed builder aktif
- `/embed-cancel session_id:` — batalkan session

### 🎉 Giveaway
- `/giveaway create channel:#ch prize:VIP 30 Hari duration:60 winners:1 required_role?:@role`
- `/giveaway list` — lihat semua giveaway
- `/giveaway end id:gw_xxx` — akhiri lebih awal (auto update message + announce + DM winner + track stats)
- `/giveaway reroll id:gw_xxx` — reroll winner baru (exclude winner lama, persist, announce, DM, track)

### ⏰ Scheduled Announcements
- `/announce-schedule channel:#ch title:... description:... at:30m|2h|1d|"2026-01-15 20:00" color? image? thumbnail? mention? recurring?:daily|weekly|monthly`
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
- `/poll list` — lihat semua poll
- `/poll close id:poll_xxx` — tutup poll + tampilkan hasil akhir

### 💾 Backup
- `/backup-now` — backup manual sekarang
- `/backup-list` — lihat semua backup (maks 7)
- `/restore-backup name:2026-01-15_20-00-00` — restore (auto safety backup sebelumnya)

### Lihat Konfigurasi
- `/config-show` — lihat semua setting saat ini
- `/list-messages` — lihat semua teks pesan embed

### Reset
- `/reset-config` — ⚠️ **hapus SEMUA setting** (tidak bisa di-undo!)

## 🎫 Flow Tiket Transaksi

1. Member klik **🛒 Beli Key** di panel tiket → pilih produk dari dropdown
2. Bot buat channel tiket private (member + admin only) dengan per-user lock (anti race condition)
3. Member kirim bukti pembayaran di tiket
4. Admin konfirmasi pembayaran, klik tombol **🔑 Set Key** di tiket
5. Modal muncul → admin input key → submit
6. Bot **otomatis**:
   - Simpan key baru ke `keys.json` (expireAt independen)
   - Berikan role VIP ke member
   - Schedule role removal (MAX EXTEND — tidak pernah memendekkan)
   - DM member dengan key + info expire
   - Kirim invoice ke channel invoice
   - Track purchase ke stats/leaderboard
   - Audit log SET_KEY
   - Hapus channel tiket

Kalau transaksi batal → admin klik **🔒 Tutup Tiket** → **❌ Tidak Jadi Beli** → tiket ditutup tanpa key/role.

## 🔑 Model Key-Driven — Cara Kerja

### Penyimpanan
- `keys.json` — daftar semua key (aktif & expired)
- `scheduledRoles.json` — daftar schedule penghapusan role (1 entry per user+role, dengan expireAt = max dari semua key)

### Scheduler (jalan setiap 60 detik, dengan overlap guard)
1. Hapus key yang sudah expired dari `keys.json`
2. Proses schedule yang sudah expired (expireAt ≤ now):
   - Cek `getActiveKeysByUserAndRole(userId, roleId, now)`
   - Kalau ada key **permanen** → hapus schedule, role tetap
   - Kalau ada key aktif dengan `expireAt > now` → `updateExpireAt` ke max, role tetap (reschedule)
   - Kalau **tidak ada** key aktif → hapus role + hapus schedule + DM member
3. Auto-end giveaway yang sudah waktunya (Fisher-Yates shuffle winners)
4. Auto-send scheduled announcements yang sudah waktunya

### MAX EXTEND Logic
Saat `scheduleRoleRemoval` dipanggil (via Set Key atau `/set-key`):
- `newExpireAt = max(existing.expireAt, newKey.expireAt)` — **tidak pernah** mempendekkan
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
2. Bot harus punya permission: Manage Roles, Manage Channels, Send Messages, Embed Links, View Audit Log, Moderate Members
3. Aktifkan **Privileged Gateway Intents → Server Members Intent** di Discord Developer Portal
4. Maksimal 25 produk (batas dropdown Discord)
5. Maksimal 25 role per panel self-role (batas Discord)
6. `GUILD_ID` wajib di-set di `.env` untuk registrasi command instan (1 detik vs 1 jam)
7. File yang di-exclude dari git (lihat `.gitignore`):
   - `config.json` — setting bot
   - `keys.json` — database key
   - `scheduledRoles.json` — database schedule role
   - `selfRoles.json` — database panel self-role
   - `giveaways.json`, `polls.json`, `warns.json`, `stats.json`, `scheduledAnns.json`
   - `.env` — token bot
   - `backups/` — folder backup
8. Setelah `/restore-backup`, **RESTART bot** (`npm start`) supaya data baru ke-load.

## 📁 Struktur File

```
Thor/
├── index.js                          # Entry point (215 lines) — client init, event handlers, scheduler loop
├── package.json
├── .env.example
├── .gitignore
├── README.md                         # File ini
├── ADMIN_GUIDE.md                    # Panduan detail untuk admin server
├── handlers/
│   ├── commandHandler.js             # Slash command handler (45 commands)
│   ├── interactionHandler.js         # Button/select/modal handler
│   └── memberHandler.js              # Welcome/goodbye + kick/ban detection
└── utils/
    ├── constants.js                  # 🆕 Magic numbers, Discord limits, timing (P3-6)
    ├── commandDefinitions.js         # 🆕 Definisi 45 slash command (P3-6 refactor)
    ├── schedulerTasks.js             # 🆕 processExpiredRole, processGiveawayEnd, dll (P3-6 refactor)
    ├── configManager.js              # CRUD config.json (readFileSync, no require.cache hack)
    ├── embedBuilder.js               # Embed helper
    ├── embedBuilderSessions.js       # Session manager /embed-builder (TTL 1 jam)
    ├── permissions.js                # isAdmin check
    ├── keyManager.js                 # CRUD keys.json (key-driven model)
    ├── roleScheduler.js              # Schedule role removal (MAX EXTEND)
    ├── selfRoleManager.js            # CRUD selfRoles.json
    ├── selfRolePanelBuilder.js       # Render panel embed + components
    ├── ticketManager.js              # Create/close ticket + invoice (per-user lock anti-race)
    ├── auditLog.js                   # Kirim audit log (fetch fallback + 24 action types)
    ├── backupManager.js              # Auto + manual backup (interval.unref)
    ├── giveawayManager.js            # CRUD giveaways.json (Fisher-Yates shuffle)
    ├── scheduledAnnouncements.js     # CRUD scheduledAnns.json
    ├── warnManager.js                # CRUD warns.json (no re-mute berulang)
    ├── statsManager.js               # CRUD stats.json (in-memory cache + periodic flush)
    └── pollManager.js                # CRUD polls.json (Number.isInteger validation)
```

## 🔄 Changelog

### v3.7 — Stability & Code Quality Release
**Bug fixes (P2/P3):**
- `/set-key` slash command sekarang kirim invoice + track purchase + audit log (sebelumnya hanya modal set key)
- `createTicket` per-user lock — cegah user buka 2 tiket bersamaan (race condition)
- `defaultMemberPermissions` `/warn` disamakan dengan `isAdmin` check (ManageGuild) — sebelumnya moderator bisa lihat command tapi ditolak
- `configManager.getConfig` pakai `readFileSync` (hapus `delete require.cache` hack yang rentan race condition)
- `memberHandler` deteksi kick vs ban lebih akurat (fetch 10 entry + cek ban type 22)
- `set-message` validasi panjang sesuai Discord embed limits (title ≤256, body ≤4096)
- `parsePrice` handle ID thousand separator dengan benar ("25,000" → 25000, bukan 25)
- `auditLog.logAudit` pakai `client.channels.fetch` (fallback API untuk channel non-cached)
- `backupManager` setInterval `.unref()` (tidak block process exit)
- Regex parse topic tiket pakai `[^|]+?` (cegah truncate kalau label mengandung ` | `)
- Hapus hard-coded `GUILD_ID` fallback — sekarang wajib via .env
- Hapus dead code `formatTimeLeft` dari exports (tidak pernah dipanggil)

**Audit log coverage (P1-10):**
- Tambah `logAudit` di 14 command yang sebelumnya missing: SET_KEY, RESET_MESSAGE, RESET_CONFIG, EDIT_PRODUCT, CLEAR_SCHEDULE, REMOVE_ROLE, REMOVE_CHANNEL, SETUP_SELFROLE, SELFROLE_ADD, SELFROLE_REMOVE, SELFROLE_DELETE, ANNOUNCE_SEND, EMBED_BUILDER_SEND, POLL_CREATE

**Refactor (P3-6):**
- `index.js` dipecah dari 894 → 215 baris (76% reduction)
- Definisi command dipindah ke `utils/commandDefinitions.js`
- Scheduler tasks (processExpiredRole, processGiveawayEnd, processScheduledAnnouncement, announceRerollWinner) dipindah ke `utils/schedulerTasks.js`
- Buat `utils/constants.js` — pusat untuk magic numbers, Discord limits, timing, colors

**Documentation:**
- README diupdate ke v3.7
- Buat `ADMIN_GUIDE.md` terpisah — panduan lengkap setup & operasional untuk admin server

### v3.6 — Temp Voice removed
- **REMOVED**: Seluruh fitur Temp Voice (slash commands, panel, voiceStateUpdate handler)
- **REMOVED**: File `utils/tempVoice*.js`, `GuildVoiceStates` intent
- Pembersihan: hapus import yang tidak terpakai

### v3.5 — Critical bug fixes (commit sebelumnya)
- P0-1: statsManager caching (tidak block event loop tiap pesan)
- P0-2: scheduler overlap guard (cegah double DM)
- P0-3: `/giveaway end` update message + announce + DM + track stats
- P0-4: `/giveaway reroll` persist + announce + DM + dedup
- P0-5: rollback zombie entries (giveaway/poll/self-role)
- P1-6: modal submit guard (cegah double-reply)
- P1-7: `/warn` tidak re-apply timeout berulang
- P1-8: modal Set Key validasi interaction.channel
- P1-9: Fisher-Yates shuffle untuk pickWinners
- P2-8: poll vote Number.isInteger check
- P2-11: processExpiredRole pakai guild.roles.fetch
- P3-4: embedBuilderSessions TTL cleanup

### v3.4 — Temp Voice panel (later removed in v3.6)

### v3.2 — audit, backup, giveaway, scheduled ann, warn, stats, poll
- Audit Log channel — log admin action
- Backup System + auto-backup tiap 24 jam
- Giveaway dengan join/leave + auto-end + reroll
- Scheduled Announcements — one-shot & recurring
- Warn System dengan auto-action
- Stats & Leaderboard
- Poll dengan live bar chart

### v3.1 — announce + embed builder

### v3.0 — key-driven + self-role
- Model key-driven VIP dengan MAX EXTEND
- Self-role fleksibel (button / select, multi / exclusive)
- Tombol "Set Key" di tiket transaksi

### v2.0 — Welcome/Goodbye, Verify, Ticket, Invoice, fully configurable

### v1.0 — Versi awal (flat config, hardcoded IDs)
