# Thor — MLBB Community Bot

Bot Discord untuk komunitas Mobile Legends: Bang Bang. Welcome/Goodbye, verifikasi, tiket transaksi, key-driven VIP role, self-role, temp voice, giveaway, scheduled announcements, embed builder, backup, warn system, stats/leaderboard, poll — semua configurable dari Discord.

> **Version:** 3.9.9 — refactored to professional folder structure.
> See [docs/ADMIN_GUIDE.md](./docs/ADMIN_GUIDE.md) untuk panduan admin.

---

## 📁 Struktur Folder

```
Thor/
├── index.js                      # Entry point — login + wire events (slim)
├── src/
│   ├── bot/
│   │   └── events/               # Discord event handlers (1 file per event)
│   │       ├── ready.js
│   │       ├── interactionCreate.js
│   │       ├── guildMemberAdd.js
│   │       ├── guildMemberRemove.js
│   │       ├── messageCreate.js
│   │       └── voiceStateUpdate.js
│   ├── commands/                 # Slash command handlers (per-domain)
│   │   ├── index.js              # Router: commandName → handler
│   │   └── registry.js           # Slash command definitions (Discord API schema)
│   ├── interactions/             # Button/select/modal handlers (per-domain)
│   │   └── index.js              # Router: customId prefix → handler
│   ├── data/                     # JSON persistence layer
│   │   ├── configManager.js
│   │   ├── keyManager.js
│   │   ├── roleScheduler.js
│   │   ├── ticketManager.js
│   │   ├── selfRoleManager.js
│   │   ├── giveawayManager.js
│   │   ├── pollManager.js
│   │   ├── warnManager.js
│   │   ├── statsManager.js
│   │   ├── scheduledAnnouncements.js
│   │   ├── tempVoiceManager.js
│   │   └── backupManager.js
│   ├── services/                 # Business logic
│   │   └── schedulerTasks.js
│   ├── ui/                       # UI builders (embeds, panels)
│   │   ├── embedBuilder.js
│   │   ├── embedBuilderSessions.js
│   │   ├── selfRolePanelBuilder.js
│   │   └── tempVoiceControlPanel.js
│   └── infra/                    # Infrastructure helpers
│       ├── safeWrite.js          # Atomic JSON write (tmp+rename)
│       ├── safeReply.js          # Edit-reply with followUp fallback
│       ├── userLock.js           # TOCTOU race condition guard
│       ├── permissions.js        # isAdmin check + cache
│       ├── constants.js          # Magic numbers / Discord limits
│       └── auditLog.js           # Audit log to Discord channel
├── handlers/                     # ⚠️ LEGACY — being migrated to src/commands/ + src/interactions/
│   ├── commandHandler.js         # 2259 lines — will be split per-domain
│   ├── interactionHandler.js     # 2488 lines — will be split per-domain
│   └── memberHandler.js
├── utils/                        # ⚠️ SHIM — re-export from src/ for backward compat (will be removed)
├── docs/
│   ├── README.md
│   └── ADMIN_GUIDE.md
├── tests/
│   ├── unit/
│   │   ├── parsePrice.test.js
│   │   ├── parseTime.test.js
│   │   ├── safeWrite.test.js
│   │   └── userLock.test.js
│   └── integration/              # (planned)
├── .env.example
├── .gitignore
├── package.json
└── package-lock.json
```

---

## 🚀 Setup

### Prasyarat
- Node.js v18+ (recommended v20+)
- Discord bot token ([cara dapatkan](https://discord.com/developers/applications))
- Server Discord tempat bot akan di-deploy

### Instalasi

```bash
# 1. Clone repo
git clone https://github.com/dwisetyabudi15581/Thor.git
cd Thor

# 2. Install dependencies
npm install

# 3. Copy .env.example ke .env dan isi
cp .env.example .env
# Edit .env:
#   DISCORD_TOKEN=bot_token_kamu
#   GUILD_ID=id_server_discord_kamu

# 4. Jalankan bot
npm start

# Untuk development (auto-restart on save):
npm run dev
```

---

## 🧪 Testing

```bash
# Run semua tests
npm test

# Run hanya unit tests
npm run test:unit

# Run hanya integration tests (planned)
npm run test:integration
```

Tests pakai built-in `node:test` (Node.js v18+), tidak perlu install dependency tambahan.

---

## 📜 Scripts

| Script | Deskripsi |
|--------|-----------|
| `npm start` | Jalankan bot |
| `npm run dev` | Jalankan dengan nodemon (auto-restart) |
| `npm test` | Run semua tests |
| `npm run test:unit` | Run unit tests saja |
| `npm run test:integration` | Run integration tests saja |

---

## 🔧 Konfigurasi

Setelah bot online, gunakan slash command di Discord untuk konfigurasi:

1. `/set-role admin @role` — set role admin bot
2. `/set-role verified @role` — set role untuk member terverifikasi
3. `/set-role unverified @role` — set role default member baru
4. `/set-channel welcome #channel` — channel untuk welcome message
5. `/set-channel goodbye #channel` — channel untuk goodbye message
6. `/set-channel invoice #channel` — channel untuk invoice/testimoni
7. `/add-product label value price duration` — tambah produk VIP key
8. `/set-product-role value:@role days:30` — map produk ke role + durasi

Lihat [docs/ADMIN_GUIDE.md](./docs/ADMIN_GUIDE.md) untuk panduan lengkap.

---

## 🛡️ Keamanan

- **Token Discord & GitHub**: Jangan pernah commit ke git atau share di chat publik. Selalu pakai `.env`.
- **Backup otomatis**: Bot membuat backup JSON setiap 24 jam + saat start. Maks 7 backup disimpan.
- **Restore backup**: `/restore-backup name:<nama>` — bikin safety backup otomatis sebelum restore.
- **Atomic write**: Semua file JSON ditulis via `safeWriteJSON` (write-to-tmp + rename) untuk cegah corrupt on crash.

---

## 🆘 Troubleshooting

### Bot tidak online
- Cek `DISCORD_TOKEN` di `.env` (harus valid, bukan expired)
- Cek bot sudah di-invite ke server dengan ID `GUILD_ID`
- Lihat log: `❌ Gagal login ke Discord: <pesan error>`

### Slash command tidak muncul
- Pastikan `GUILD_ID` di `.env` benar (bot harus member guild itu)
- Restart bot (registrasi command instan untuk guild)
- Kalau tanpa `GUILD_ID`, command global butuh ~1 jam propagasi

### Permission error
- Pastikan role bot **di atas** role yang akan dikelola (Server Settings → Roles)
- Bot butuh permission: `Manage Roles`, `Manage Channels`, `Send Messages`, `Embed Links`, `View Audit Log`, `Moderate Members`

### Data hilang setelah restart
- Cek folder `backups/` — ada auto-backup tiap 24 jam
- Restore via `/restore-backup name:<nama_backup>`

---

## 📝 License

MIT — bebas dipakai, dimodifikasi, didistribusikan.
