# Thor — MLBB Community Bot

Bot Discord untuk komunitas Mobile Legends: Bang Bang. Welcome/Goodbye, verifikasi, tiket transaksi, key-driven VIP role, self-role, temp voice, giveaway, scheduled announcements, embed builder, backup, warn system, stats/leaderboard, poll — semua configurable dari Discord.

> **Version:** 3.9.10 — full per-domain refactor, no legacy code, 71 passing tests.
> See [docs/ADMIN_GUIDE.md](./docs/ADMIN_GUIDE.md) untuk panduan admin.

---

## 📁 Struktur Folder

```
Thor/
├── index.js                      # Entry point — slim (95 lines): login + wire events + data migration
├── .github/
│   └── workflows/ci.yml          # GitHub Actions: lint + test on push/PR
├── src/
│   ├── bot/
│   │   ├── memberHandler.js      # Welcome/Goodbye logic
│   │   └── events/               # Discord event handlers (1 file per event)
│   │       ├── ready.js
│   │       ├── interactionCreate.js
│   │       ├── guildMemberAdd.js
│   │       ├── guildMemberRemove.js
│   │       ├── messageCreate.js
│   │       └── voiceStateUpdate.js
│   ├── commands/                 # Slash command handlers — PER DOMAIN
│   │   ├── index.js              # Router: commandName → handler
│   │   ├── registry.js           # Slash command definitions (Discord API schema)
│   │   ├── _shared.js            # Shared imports for all domain handlers
│   │   ├── help.js               (145 lines)
│   │   ├── config.js             (325 lines) — set-role, set-channel, config-show, etc.
│   │   ├── products.js           (155 lines) — add-product, set-product-role, etc.
│   │   ├── keys.js               (263 lines) — set-key, list-keys, clear-schedule
│   │   ├── selfrole.js           (228 lines)
│   │   ├── announce.js           (281 lines) — announce, announce-schedule
│   │   ├── embed.js              (181 lines) — embed-builder, embed-list
│   │   ├── backup.js             (130 lines) — backup-now, restore-backup
│   │   ├── giveaway.js           (205 lines)
│   │   ├── warn.js               (188 lines)
│   │   ├── stats.js              (112 lines) — stats, leaderboard, my-stats
│   │   ├── poll.js               (157 lines)
│   │   ├── tempvoice.js          (199 lines)
│   │   └── send-message.js       (139 lines)
│   ├── interactions/             # Button/select/modal handlers — PER DOMAIN
│   │   ├── index.js              # Router: customId prefix → handler
│   │   ├── _dedup.js             # Interaction dedup (15-min TTL, per-entry prune)
│   │   ├── verify.js             # btn_verify
│   │   ├── ticket.js             # ticket_*, modal_set_key
│   │   ├── selfrole.js           # sr_btn:, sr_sel:
│   │   ├── embed.js              # emb_*, modal_emb_*
│   │   ├── giveaway.js           # gw_join:, gw_leave:
│   │   ├── poll.js               # poll_vote:, modal_poll_create
│   │   ├── tempvoice.js          # tv_*, modal_tv_* (14 helper functions)
│   │   └── backup.js             # reset_config_confirm, restore_backup_confirm
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
├── data/                         # Runtime JSON files (gitignored)
│   ├── config.json
│   ├── keys.json
│   └── ...
├── docs/
│   ├── README.md                 # Original README (legacy, kept for reference)
│   └── ADMIN_GUIDE.md
├── tests/
│   ├── unit/
│   │   ├── parsePrice.test.js        (14 tests)
│   │   ├── parseTime.test.js         (11 tests)
│   │   ├── safeWrite.test.js         (10 tests)
│   │   ├── userLock.test.js          (9 tests)
│   │   ├── keyManager.test.js        (7 tests)
│   │   ├── backupManager.test.js     (8 tests)
│   │   ├── commandsRouter.test.js    (5 tests)
│   │   └── interactionsRouter.test.js (7 tests)
│   └── integration/              # (placeholder for future)
├── .env.example
├── .eslintrc.json
├── .prettierrc.json
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

### Upgrade dari versi lama (pre-v3.9.10)

Bot akan otomatis migrate file JSON dari root folder ke `data/` folder saat startup pertama kali. Tidak perlu intervensi manual.

---

## 🧪 Testing

```bash
# Run semua tests (71 tests, ~1 detik)
npm test

# Run hanya unit tests
npm run test:unit

# Lint check
npm run lint

# Format check
npm run format:check
```

Tests pakai built-in `node:test` (Node.js v18+), tidak perlu install dependency tambahan.

### Test coverage

| Layer | Tests | Apa yang diproteksi |
|-------|-------|---------------------|
| `parsePrice` | 14 | Admin input harga (`Rp 50.000`, `25k`, `1.5m`) → stats terhitung benar |
| `parseTime` | 11 | Schedule announce `2026-13-40 99:99` → di-reject |
| `safeWrite` | 10 | Bot crash tengah write JSON → file tetap utuh (atomic) |
| `userLock` | 9 | User double-click tombol → gak double-process (TOCTOU guard) |
| `keyManager` | 7 | Duplicate key rejected, guild-scoped findAllByUser, permanen key detection |
| `backupManager` | 8 | Backup/restore cycle, path traversal rejection, formatSize |
| `commandsRouter` | 5 | Permission check (admin vs public), unknown command handling |
| `interactionsRouter` | 7 | Dedup, prefix routing, slash command ignored, unknown customId safe |

---

## 📜 Scripts

| Script | Deskripsi |
|--------|-----------|
| `npm start` | Jalankan bot |
| `npm run dev` | Jalankan dengan nodemon (auto-restart) |
| `npm test` | Run semua tests (71 tests) |
| `npm run test:unit` | Run unit tests saja |
| `npm run lint` | ESLint check |
| `npm run lint:fix` | ESLint auto-fix |
| `npm run format` | Prettier format all files |
| `npm run format:check` | Prettier check (CI mode) |

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
- **CI/CD pipeline**: GitHub Actions auto-run tests + lint di setiap push & PR. Merge yang break tests akan ditandai failed.

---

## 🏗️ Architecture

Bot mengikuti pola **event-driven + domain-driven**:

1. **Entry point** (`index.js`) — slim, hanya login + wire events + data migration
2. **Event handlers** (`src/bot/events/`) — 1 file per Discord event, delegasi ke domain
3. **Command router** (`src/commands/index.js`) — cek permission, dispatch ke domain handler
4. **Interaction router** (`src/interactions/index.js`) — dedup + dispatch by customId prefix
5. **Domain handlers** (`src/commands/<domain>.js`, `src/interactions/<domain>.js`) — business logic per fitur
6. **Data layer** (`src/data/`) — JSON persistence, atomic write, schema migrations
7. **UI builders** (`src/ui/`) — embed & panel constructors
8. **Infrastructure** (`src/infra/`) — cross-cutting concerns (lock, audit, safe write, permissions)

### Prinsip design
- **Single Responsibility**: tiap file punya 1 alasan untuk berubah
- **Domain-driven**: fitur (giveaway, poll, ticket, dll) terpisah jelas
- **Backward compatible**: data migration otomatis saat struktur berubah
- **Defensive**: TOCTOU guards, atomic writes, retry logic, error classification
- **Testable**: pure functions & small files = mudah di-unit-test

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
- File data JSON ada di `data/` folder (sebelum v3.9.10 ada di root — auto-migrate saat startup)

### Tests fail
- Pastikan Node.js v18+
- Run `npm install` dulu
- Run `npm test` — kalau ada fail, lihat pesan error spesifik

---

## 📝 License

MIT — bebas dipakai, dimodifikasi, didistribusikan.
