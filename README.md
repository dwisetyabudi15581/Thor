# 🤖 Community Bot — All-in-One Discord Bot

Bot Discord serbaguna buat komunitas apapun — gaming, content creator, online community, server jualan, dll. Penuh fitur: welcome/goodbye, verifikasi, tiket transaksi (multi-kategori), key-driven VIP role, self-role, temp voice, giveaway, scheduled announcements, embed builder, backup, warn system, stats/leaderboard, poll, **auto-responder, anti-spam & auto-mod, AFK system, leveling system**.

> **Version:** 3.9.26 — 81 slash commands, 190+ tests passing, fully configurable dari Discord.
> See [docs/ADMIN_GUIDE.md](./docs/ADMIN_GUIDE.md) untuk panduan admin lengkap.

---

## 🆕 v3.9.26 "AUDIT MENYELURUH (SINGLE-GUILD)"

Audit ulang seluruh codebase dengan konteks **bot dipakai untuk 1 guild saja** — 6 temuan baru diperbaiki + hardening + GC:

**Bug fix (semua terverifikasi + unit test):**

- 🔴 **`/update-panel` image/thumbnail/footer tidak pernah jalan** — patch tersimpan di key yang salah (`image`) padahal builder baca `imageUrl` → 3 dari 6 field iklankan adalah no-op diam-diam. Fixed (key mapping) + pre-fill modal sekarang benar.
- 🔴 **`/giveaway list` & `/poll list` mati permanen di ~30 entry** — giveaway/poll lama tidak pernah dihapus → description embed > 4096 → throw. Sekarang: 15 terbaru + ringkasan + **GC harian** (entry >30 hari dipangkas otomatis).
- 🔴 **Poll dengan question panjang = zombie + admin stuck "Bot is thinking..."** — entry persist dulu baru render throw + error reply ditelan post-defer. Fixed: validasi di command (maks 250) + render-first + safeEditReply.
- 🔴 **`claim_giveaway` mustahil dihapus permanen** — migration di getConfig() (jalan per pesan!) re-add kategori setelah `/remove-category`. Fixed dengan flag `claimGiveawayDismissed`.
- 🟠 **Product label/price panjang bunuh flow tiket** — dropdown throw `addOptions` (limit 100). Fixed: cap di registry + handler + slice defensif di 3 dropdown.
- 🟠 **Emoji bebas tersimpan bisa meracuni panel** — string bukan-emoji bikin `/setup-verify` & semua panel tiket mati. Fixed: validasi emoji di set-verify-button, add-category, update-category.

**Hardening & performa:**

- 🟢 **Karantina file korup** — 16 file data di-rename `.corrupt-<ts>` sebelum fallback default (sebelumnya: isi korup TERTIMPA diam-diam oleh save berikutnya — keys/config bisa hilang tanpa bekas).
- 🟢 **Hot-path cache** — automod/afk/responders/levels kini read-through cache (dulu 5-7 readFileSync sync per pesan). AFK mention di-batch (dulu 1+N baca).
- 🟢 **GUILD_ID guard di semua event** — pesan/command/member/voice dari guild lain diabaikan (asuransi bot single-guild).
- 🟢 **Migrasi v1→v2 config tidak lagi drop field modern** (ticketCategories/leveling/verifyButton preserve).
- 🟡 messageCreate per-hook try/catch (hook AFK error tidak lagi bunuh leveling); `getSubcommand(false)` + hint di /giveaway & /poll; prize/question/key max_length; reroll guild-check; backup cancel tombol di-handle; logAudit tahan detail panjang; DM set-key & transcript tahan data panjang; Set Key lookup produk pakai value (tahan rename); admin re-check di modal update-panel; leveling clamp nilai.

**Docs sync:** `docs/ADMIN_GUIDE.md` + `docs/README.md` di-update ke v3.9.26 — 81 command, semua fitur v3.9.13-v3.9.26 terdokumentasi, struktur file `src/` yang sebenarnya (sebelumnya masih struktur lama pre-refactor + 47 command).

---

## 🆕 v3.9.25 "NEWLINE EVERYWHERE"

**Fitur `\n` sekarang support di SEMUA input teks multi-baris (termasuk yang terlewat di v3.9.24):**

```
/set-message teks:"Halo\nSelamat datang\n\nSemoga betah"  → welcome/goodbye/verify/ticket body
/afk reason:"Tidur\nJangan ganggu\n\nSampai pagi"        → reason AFK multi-baris
/warn reason:"Pelanggaran A\nPelanggaran B"             → DM warning multi-baris
/setup-selfrole description:"Baris 1\nBaris 2"           → deskripsi panel multi-baris
/selfrole-add description:"...\n..."                      → deskripsi role (select menu)
```

- ⚠️ **Catatan `/set-message`:** konversi hanya untuk tipe **Body** (welcomeBody, ticketBody, dll). Tipe **Title** sengaja TIDAL dikonversi — embed title Discord menolak newline (kalau dipaksa, panel verifikasi/welcome gagal kirim). Tulis `\n` di Title = tampil literal sebagai teks `\n`.
- Input **modal** (popup form, mis. /edit-message, /embed-builder, poll options) tidak butuh `\n` — di modal, Enter memang menghasilkan baris baru.
- Hint `(support \n)` sekarang tampil di deskripsi opsi command di Discord (registry).

---

## 🆕 v3.9.24 "NEWLINE + HARDENING"

**Fitur baris baru (\n) untuk semua input teks multi-baris:**

Input slash command di Discord **tidak bisa tekan Enter** (Enter = kirim form) — sekarang tulis `\n` untuk baris baru, berlaku di:

```
/send-message message:"Baris 1\nBaris 2"           → plain text multi-baris
/announce description:"Poin 1\nPoin 2\n\nPoin 3"   → embed multi-baris
/announce-schedule description:"...\n..."           → idem, untuk announce terjadwal
/setup-ticket-panel body:"Harga:\n• VIP 30d: 25k"  → body panel multi-baris
/add-responder reply:"Halo!\nCara beli: ..."       → auto-reply multi-baris
/set-message teks:"...\n..."                        → v3.9.25 (tipe Body saja)
/afk reason, /warn reason, /setup-selfrole & /selfrole-add description → v3.9.25
```

**Perbaikan bug (full codebase review):**

- 🔴 **`/update-category` & `/update-product` tidak pernah jalan** — terdaftar di registry + diiklankan di /help, tapi tidak di-map di router (selalu error "belum didukung"). Fixed + guard test anti kejadian ulang.
- 🔴 **Backup bolong** — `automod.json` (word rules!), `levels.json`, `responders.json`, `afk.json`, `panels.json` TIDAK pernah di-backup. Fixed + guard test.
- 🔴 **Crash exit code 0** — PM2/systemd/Docker tidak restart bot setelah crash. Sekarang exit(1) + shutdown guard anti double-flush.
- 🔴 **Test menulis/hapus data produksi** — `npm test` di server live menghapus `panels.json` & meng-evict backup asli. Test sekarang sandbox (snapshot/restore).
- 🟠 **Ready.js**: satu try/catch raksasa bisa mematikan scheduler, backup, dan auto-flush diam-diam kalau langkah awal gagal → sekarang per-langkah.
- 🟠 **userLock** bisa dihapus oleh holder basi (race saat operasi lambat) → owner-token.
- 🟠 **Tombol close ticket & modal set key** tanpa re-check admin → fixed (defense-in-depth).
- 🟠 **AFK reason bisa mass-ping** (`@everyone` di reason bocor ke chat) → `parse: []`.
- 🟠 **member kehilangan required role tidak bisa keluar giveaway** → cek role hanya saat join.
- 🟠 **/giveaway end** tidak ber-lock (double-invoke = double-announce) → withUserLock.
- 🟡 Phantom devDeps (nodemon/@eslint/js/globals), engines node, urutan wipe command global, filter webhook di messageCreate, defer modal poll, dll.

---

## ✨ Fitur Utama

### 🎫 Ticket Panel (Multi-Category)

- Panel tiket dengan tombol dinamis per kategori (bukan hardcoded)
- Support kategori produk: key, jasa, layanan, dll — bebas di-CRUD dari Discord
- Multi-panel: pasang panel berbeda dengan subset kategori berbeda di channel berbeda
- Auto-transcript: simpan chat history tiket sebelum close
- Tombol "Set Key" hanya muncul untuk produk yang `requiresKey: true`

### 💬 Auto-Responder (v3.9.13)

- Set trigger keyword (`!sosmed`, `!jadwal`, dll) → bot auto-reply
- Support plain text atau embed
- Cooldown anti-spam per trigger

### 🛡️ Anti-Spam & Auto-Mod (v3.9.13 + v3.9.23 WORD FLEX)

- Spam detection (N messages in window → action)
- Link blocking (with channel/role whitelist — bisa tambah **dan hapus**)
- Word filter dengan **matching whole-word**: "asu" tidak match "asus" (anti false-positive)
- **Edit kata fleksibel**: `/add-word` nambah tanpa replace, `/remove-word` hapus spesifik, `/list-words` lihat semua
- **Action per kata**: kata ringan cukup delete, kata berat langsung mute/kick
- **Exempt words**: kata aman yang tidak di-flag (mis. block "asu" tapi allow "asus")
- Mass-mention block
- Action: delete only, warn, mute, atau kick

### 💤 AFK System (v3.9.13)

- User set AFK dengan reason
- Bot auto-reply saat ada yang mention user AFK
- Auto-clear saat user kirim pesan lagi
- `/afk-list` untuk admin lihat semua yang AFK

### 📊 Leveling System (v3.9.13)

- XP per message (dengan cooldown anti-spam)
- Level up announcement + auto-assign role reward
- `/rank` untuk lihat level sendiri
- `/leaderboard-level` top 10 member

### 🔐 Verifikasi Panel

- Button customizable (label, emoji, style)
- Auto-give role Verified, auto-remove role Unverified

### 🎭 Self-Role Panel

- Member ambil/lepas role sendiri
- Per-role button style (Primary/Secondary/Success/Danger)
- Conditional role: butuh prerequisite role dulu (tier system)
- Mode exclusive (1 role saja) atau multi

### 🎤 Temp Voice

- Member join trigger channel → otomatis bikin voice pribadi
- Panel kontrol: rename, kick, limit, lock, transfer, delete
- Auto-transfer ownership saat owner leave
- Auto-delete saat channel kosong

### 📦 Produk & Key Manager

- Produk dengan kategori & `requiresKey` flag (bisa campur key & non-key)
- Key-driven VIP role (MAX EXTEND model)
- Auto-expire role sesuai durasi key
- Guild-scoped (cross-guild safe)
- Set Key sukses → DM member + role + schedule (channel gak auto-close, biar admin & member bisa Q&A dulu)
- Transcript otomatis tersimpan saat admin Tutup Tiket

### 🎉 Giveaway, Poll, Warn, Stats

- Giveaway dengan required role, multiple winners, reroll
- Poll dengan live bar chart, toggle vote
- Warn system dengan auto-action (3=mute, 5=mute 1d, 7=kick)
- Stats leaderboard (messages, purchases, totalSpent, giveawaysWon)

### 📢 Announce & Embed Builder

- `/announce` quick embed
- `/send-message` plain text
- `/embed-builder` interactive builder dengan live preview

### 💾 Backup System

- Auto-backup tiap 24 jam + saat start
- Manual backup via `/backup-now`
- Restore dengan safety backup otomatis
- Maks 7 backup tersimpan

---

## 📁 Struktur Folder

```
Community Bot/
├── index.js                      # Entry point (slim)
├── .github/workflows/ci.yml      # GitHub Actions: lint + test
├── src/
│   ├── bot/events/               # Discord event handlers
│   ├── commands/                 # Slash command handlers (per-domain, 20+ files)
│   ├── interactions/             # Button/select/modal handlers (per-domain)
│   ├── data/                     # JSON persistence layer (15+ managers)
│   ├── services/                 # Business logic
│   ├── ui/                       # Embed/panel builders
│   └── infra/                    # safeWrite, safeReply, userLock, permissions, dll
├── data/                         # Runtime JSON files (gitignored)
├── docs/                         # README + ADMIN_GUIDE
├── tests/unit/                   # 160+ passing tests
├── .env.example
├── .eslintrc.json
└── .prettierrc.json
```

---

## 🚀 Setup

### Prasyarat

- Node.js v18+ (recommended v20+)
- Discord bot token ([cara dapetin](https://discord.com/developers/applications))
- Server Discord tempat bot mau di-deploy
- **3 Privileged Intents** udah di-enable di Discord Developer Portal (https://discord.com/developers/applications → pilih bot → tab "Bot" → scroll ke "Privileged Gateway Intents"):
    - ✅ Server Members Intent — buat welcome/goodbye, auto-role
    - ✅ **Message Content Intent** — WAJIB biar auto-responder, anti-spam kata/link, dan AFK mention reply jalan. Kalau gak di-enable, fitur-fitur ini diam-diam gak berfungsi!
    - ✅ Presence Intent — (opsional, belum dipakai)

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

# Untuk development:
npm run dev
```

---

## 🧪 Testing

```bash
# Run semua tests
npm test

# Lint check
npm run lint

# Format check
npm run format:check
```

Tests pakai built-in `node:test` (Node.js v18+), tidak perlu install dependency tambahan.

---

## 📜 Scripts

| Script           | Deskripsi                              |
| ---------------- | -------------------------------------- |
| `npm start`      | Jalankan bot                           |
| `npm run dev`    | Jalankan dengan nodemon (auto-restart) |
| `npm test`       | Run semua tests                        |
| `npm run lint`   | ESLint check                           |
| `npm run format` | Prettier format all files              |

---

## 🔧 Konfigurasi Awal (Setelah Bot Online)

1. `/set-role admin @role` — set role admin bot
2. `/set-role verified @role` — set role member terverifikasi
3. `/set-role unverified @role` — set role default member baru
4. `/set-channel welcome #channel` — channel welcome message
5. `/set-channel goodbye #channel` — channel goodbye message
6. `/set-channel invoice #channel` — channel invoice/testimoni
7. `/set-channel audit-log #channel` — channel audit log (catat admin action)
8. `/setup-verify` — pasang panel verifikasi
9. `/setup-ticket` — pasang panel tiket

### Untuk fitur baru (v3.9.13):

**Auto-Responder:**

```
/add-responder trigger:"!sosmed" reply:"Instagram: @server\nTikTok: @server"
```

**Anti-Spam (v3.9.13):**

```
/set-automod spam_threshold:5 spam_action:mute_10m block_links:true
/automod-toggle enabled:true
```

**Word Filter Fleksibel (v3.9.23):**

```
/add-word words:"begitu,bgini" action:Mute_10_menit   → tambah kata + action khusus
/add-word words:"asus" tipe:Exempt_(kata_diizinkan)  → whitelist anti false-positive
/remove-word word:bgini                              → hapus 1 kata
/list-words                                          → lihat semua kata + action-nya
/remove-link-whitelist role:@Member                 → hapus dari whitelist link
```

**AFK:**

```
/afk reason:"Makan dulu"
```

**Leveling:**

```
/setup-leveling enabled:true xp_per_message:15
/add-level-role level:10 role:@Active
```

---

## 🛡️ Keamanan

- **Token Discord & GitHub**: Jangan commit ke git. Pakai `.env`.
- **Atomic write**: Semua file JSON ditulis via `safeWriteJSON` (tmp+rename) — anti corrupt.
- **TOCTOU guards**: `userLock` cegah double-process saat user double-click.
- **CI/CD**: GitHub Actions auto-run tests di setiap push.
- **Auto-backup**: Tiap 24 jam + saat bot start.

---

## 🆘 Troubleshooting

### Bot tidak online

- Cek `DISCORD_TOKEN` di `.env`
- Cek bot sudah di-invite ke server dengan ID `GUILD_ID`

### Slash command tidak muncul

- Pastikan `GUILD_ID` benar (bot harus member guild itu)
- Restart bot (registrasi instan untuk guild)

### Permission error

- Role bot harus **di atas** role yang dikelola
- Bot butuh: `Manage Roles`, `Manage Channels`, `Send Messages`, `Embed Links`, `View Audit Log`, `Moderate Members`

### Auto-responder / Anti-spam / AFK reply gak berfungsi

**Penyebab paling sering: "Message Content Intent" belum di-enable.**

Bot butuh akses ke `message.content` buat fitur-fitur ini. Tanpa intent itu, Discord kirim content sebagai string kosong → trigger gak match → fitur gak jalan.

**Cara fix:**

1. Buka https://discord.com/developers/applications → pilih bot
2. Tab "Bot" → scroll ke "Privileged Gateway Intents"
3. Toggle ON: **MESSAGE CONTENT INTENT** (dan SERVER MEMBERS INTENT kalo belum)
4. Save Changes → Restart bot

Cek console bot — kalo ada warning `⚠️ [HINT] Pesan dari ... isinya kosong`, berarti intent emang belum on.

### Tests fail

- Pastikan Node.js v18+
- Run `npm install` dulu

---

## 📝 License

MIT — bebas dipakai, dimodifikasi, didistribusikan.
