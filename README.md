# 🤖 Thor — All-in-One Discord Community Bot

Bot Discord serbaguna untuk komunitas apa pun — server jualan, gaming, content creator, hingga komunitas umum. Semua konfigurasi dapat diatur langsung dari Discord melalui slash command, tanpa mengedit file.

> **v3.19.0** · 93 slash command · 670 unit test · discord.js v14 · Node.js 20+ · mode 1 server / publik (ala Dyno) · **100% GRATIS — semua fitur terbuka** · **+ dashboard web DI DALAM REPO INI**
>
> 📖 **[Panduan Admin Lengkap](./docs/ADMIN_GUIDE.md)** — setup, operasional harian, troubleshooting
> 📜 **[Changelog](./CHANGELOG.md)** — riwayat semua versi

---

## ✨ Fitur Utama

### 🌐 Dashboard Web (ala Dyno) — v3.19.0: Command Manager + 18 Modul

- **Dashboard web sekarang ada DI DALAM REPO INI** (folder `dashboard/` — Next.js 16 + Prisma SQLite, dependensi ramping 12 paket). Clone sekali → `./setup.sh` → `./start.sh` — bot + web jalan bersamaan, tanpa repo terpisah.
- **Dua cara mengatur bot**: langsung via **slash command** di Discord, atau via **dashboard web** — keduanya menulis ke SATU sumber data yang sama (`data/config/<guildId>.json`), jadi tidak pernah bentrok.
- **🧩 Command Manager ala Dyno (v3.19.0)** — aktif/nonaktifkan **tiap slash command per-server** dari web (pencarian + grup + aksi massal) atau dari Discord (`/commands list|toggle|enable-all`). Command nonaktif ditolak bot dengan pesan jelas; `/commands` sendiri kebal-disable supaya admin tidak pernah terkunci.
- **18 modul dashboard** (v3.19.0, dari 11): + **Command Manager**, **Backup** (buat/restore dari web), **Moderasi** (riwayat warn + tindakan moderator), **Kunci VIP** (beri key produk + auto-expire), **Giveaway** (mulai dari web), **Embed** (kirim embed + pratinjau), **Poll** (polling interaktif).
- **DASH API built-in** (`src/infra/dashServer.js`): HTTP API kecil di `127.0.0.1:8788` dengan token rahasia (`DASH_API_TOKEN`) — dibaca/tulis oleh dashboard web untuk semua modul di atas.
- **Akses dijaga Discord**: user hanya melihat server tempat dia punya izin **Manage Server**; semua tulisan tervalidasi bot (whitelist section + guard prototype pollution) + tercatat siapa actor-nya.
- **Bot 100% GRATIS** (v3.17.0): semua fitur terbuka untuk siapa pun — tidak ada tier, tidak ada langganan, tidak ada key aktivasi bot.

```bash
./setup.sh   # install bot + dashboard + siapkan kedua .env
./start.sh   # production: bot + dashboard sekali jalan (Ctrl+C stop keduanya)
./dev.sh     # pengembangan: nodemon (bot) + next dev (web) hot-reload
```

Detail lengkap (login OAuth Discord, pm2, domain + HTTPS): **[DEPLOY.md](./DEPLOY.md)** · dokumentasi dashboard: **[dashboard/README.md](./dashboard/README.md)**

### 🎫 Tiket & Transaksi

- **Panel tiket multi-kategori & multi-panel** — kategori dan produk dapat ditambah, diubah, dan dihapus sepenuhnya dari Discord (CRUD tanpa edit kode).
- **Kategori custom otomatis aman** — id kategori apa pun (`akun_ml`, `lisensi_key`, `jasa`, `topup`, ...) otomatis terklasifikasi sebagai TRANSAKSI; hanya `help`/`report` yang menjadi BANTUAN.
- **Dua alur transaksi**: produk ber-key (**🔑 Set Key**) dan produk non-key seperti jual akun/jasa (**📦 Kirim Pesanan** — detail pesanan dikirim via DM ke pembeli).
- **Invoice otomatis** ke channel testimoni (sekali per tiket) + **transcript otomatis** tersimpan sebelum channel tiket dihapus.
- **🤝 Midman / Rekber (deal escrow 3-pihak)** — pembeli, penjual, dan midman dalam satu channel deal dengan **Deal Board** (embed sumber kebenaran) + **state machine**: dana masuk (konfirmasi midman) → barang diterima (konfirmasi pembeli) → cairkan (midman). Dispute → freeze, hanya admin yang resolve. **Deal bisa dibuka siapa saja** (pembeli/penjual/pihak yang menolong) lewat **formulir 3 langkah** (item + harga → pilih pembeli → pilih penjual, semua dropdown searchable), **terms terkunci hanya setelah pembeli & penjual dua-duanya setuju**. Tombol **👥 Tambah Member / ➖ Keluarkan Member** untuk mengelola member tambahan di dalam channel deal (hanya bisa lihat & chat; tidak bisa menggerakkan deal). **Fee ditambah di atas harga** (penjual selalu terima harga penuh; pembeli bayar harga + fee), history klik tercatat, invoice/transcript/audit terintegrasi.

### 🔑 Produk & VIP (Key-Driven)

- Produk dengan kategori, harga, dan flag `requires_key` (diwariskan dari kategori ke produk).
- Role VIP berbasis key dengan model **MAX EXTEND** — role mengikuti key dengan sisa waktu terbanyak; auto-expire terjadwal.
- Set Key sukses → simpan key, beri role, DM member, invoice, catat stats — semua otomatis.
- Key selalu **dimasking** di audit log (tidak pernah bocor nilai).

### 🛡️ Anti-Spam & Auto-Mod

- Spam detection (N pesan dalam window → action) + mass-mention block.
- Link blocking dengan whitelist channel/role.
- **Word filter fleksibel**: tambah kata satu per satu (`/add-word`), action per kata, exempt word, matching **whole-word** ("asu" tidak match "asus").

### ⚔️ Moderasi Langsung

- **`/timeout` `/untimeout`** — mute sementara (menit → maks 28 hari) dengan DM alasan ke member.
- **`/purge`** — hapus pesan massal 1–100 (filter per-user, otomatis skip pesan >14 hari sesuai limit API).
- **`/kick` `/ban` `/unban`** — tindakan keras tercatat di riwayat user (`/warn-list`), tanpa sanksi ganda.
- **Guard hierarki dua arah** — role moderator & bot wajib lebih tinggi dari target; command bisa diberikan ke moderator non-admin (permission Discord, least privilege).
- **Server Log** — pesan dihapus/diedit (isi + by siapa), purge massal, join/leave (umur akun, kick terdeteksi), ban/unban (termasuk manual dari UI Discord), perubahan role & nickname → channel `server-log` terpisah.

### 💬 Auto-Responder & AFK

- Trigger keyword (`beli`, `!sosmed`, ...) → auto-reply plain text atau embed, dengan cooldown per-user. Dua match mode (v3.9.47): **contains** (default — trigger cocok sebagai kata utuh di mana saja dalam pesan, mis. `beli` menjawab "bagaimana cara beli") atau **exact** (pesan harus diawali trigger).
- AFK system: auto-reply saat di-mention, auto-clear saat kembali, `/afk-list` untuk admin.

### 📊 Leveling & Stats

- XP per pesan (cooldown anti-spam) + role reward per level + `/rank` + `/leaderboard-level`.
- Stats server: jumlah member live, boost, tiket terbuka (langsung dari Discord) + aktivitas terlacak & transaksi. **Channel counter live** (`/serverstats`) — nama channelnya sendiri adalah counter yang ter-update otomatis (member, bot, boost, role, channel — **pilih mana yang mau ditampilkan** lewat opsi boolean), aman rate-limit. **Tampilan kategori `/help` adalah panduan lengkap per-command** — sintaks, perilaku + jawaban pertanyaan yang paling sering, biar member berhenti bertanya-tanya. Leaderboard messages/purchases/spending/wins; `/my-stats` menampilkan tanggal gabung asli.
- **Server Booster:** notifikasi boost tambah/hilang ke channel booster khusus + catch-up offline + daftar `/boosters` publik (roster live + riwayat boost terbaru) + **`/test-booster`** — simulasi boost tambah/hilang untuk mengetes rantai notifikasi end-to-end (simulasi murni, tidak ada yang dicatat) + **auto role booster** — `/set-role booster @role` memberikan role otomatis saat member boost (diterapkan retroaktif ke booster yang sudah ada) dan menghapusnya saat boost berakhir.

### 🎭 Lainnya

- **Verifikasi** — tombol customizable (label, emoji, style), auto-swap role Unverified → Verified.
- **Self-Role** — panel button/select, mode exclusive/multi, prerequisite role bertingkat.
- **Temp Voice** — channel voice pribadi otomatis + panel kontrol (rename, kick, limit, lock, transfer).
- **Giveaway** — required role, multiple winners, reroll, per-user lock anti double-join.
- **Poll** — live bar chart, single/multi choice, toggle vote.
- **Announce** — quick embed, scheduled (one-shot & recurring daily/weekly/monthly), embed builder interaktif dengan live preview.
- **Warn system** — auto-action: 3 warning → mute 1 jam, 5 → mute 1 hari, 7 → kick.
- **Backup** — otomatis tiap 24 jam + saat start, maks 7 backup, restore dengan 2-step confirmation + safety backup.
- **Audit log** — semua admin action tercatat ke channel khusus (63 action types, retry otomatis).

---

## 📁 Struktur Proyek

```
Thor/
├── index.js                      # Entry point
├── .github/workflows/ci.yml      # GitHub Actions: lint + test (Node 18/20/22)
├── src/
│   ├── bot/events/               # Discord event handlers
│   ├── commands/                 # Slash command handlers (per-domain)
│   ├── interactions/             # Button/select/modal handlers (per-domain)
│   ├── data/                     # JSON persistence layer (18 managers)
│   ├── services/                 # Business logic (scheduler, dll)
│   ├── ui/                       # Embed/panel builders
│   └── infra/                    # safeWrite, safeReply, userLock, permissions, auditLog
├── data/                         # Runtime JSON files (gitignored)
├── docs/                         # ADMIN_GUIDE + index dokumen
├── tests/unit/                   # 670 unit test (node:test)
├── dashboard/                    # 🌐 Dashboard web Next.js (v3.19.0 — satu repo)
├── setup.sh · start.sh · dev.sh  # Instalasi & menjalankan bot + web bersamaan
├── ecosystem.config.cjs          # pm2: thor-bot + thor-dash 24/7
├── CHANGELOG.md                  # Riwayat versi
├── .env.example
├── eslint.config.js
└── .prettierrc.json
```

---

## 🚀 Setup

### Prasyarat

- Node.js v20+ (bot saja bisa jalan di 18+, tapi dashboard web bawaan butuh 20+)
- Discord bot token ([cara mendapatkan](https://discord.com/developers/applications))
- **3 Privileged Intents** diaktifkan di Discord Developer Portal (tab **Bot** → _Privileged Gateway Intents_):
    - ✅ **Server Members Intent** — untuk welcome/goodbye, auto-role
    - ✅ **Message Content Intent** — **WAJIB** untuk auto-responder, anti-spam kata/link, dan AFK mention reply. Tanpa intent ini, `message.content` selalu kosong dan fitur tersebut tidak berfungsi.
    - ✅ Presence Intent — opsional
- Bot diundang ke server target dengan permission: `Manage Roles`, `Manage Channels`, `Send Messages`, `Embed Links`, `View Audit Log`, `Moderate Members`, `Move Members`
- Role bot berada **di atas** semua role yang dikelola

### Instalasi

```bash
# 1. Clone repo (bot + dashboard web SATU repo)
git clone https://github.com/dwisetyabudi15581/Thor.git
cd Thor

# 2. Install SEMUA (bot + dashboard + kedua .env dari contoh)
./setup.sh

# 3. Isi environment
nano .env             # DISCORD_TOKEN + GUILD_ID (kosong = mode publik ala Dyno) + DASH_API_TOKEN
nano dashboard/.env   # OAuth Discord + DASH_API_TOKEN (SAMA dengan .env bot)

# 4. Jalankan bot + dashboard bersamaan
./start.sh            # atau ./dev.sh untuk pengembangan
```

Registrasi slash command berlangsung instan ke guild yang ditentukan `GUILD_ID`. Kalau `GUILD_ID` dikosongkan, bot jalan **mode publik ala Dyno**: command didaftarkan global dan muncul otomatis di semua server yang meng-invite bot (±1 jam propagasi) — tanpa memasukkan guild id manual di mana pun. Untuk development dengan auto-restart: `npm run dev`.

### Konfigurasi Awal (setelah bot online)

1. `/set-role admin @role` — role admin bot
2. `/set-role verified @role` — role member terverifikasi
3. `/set-role unverified @role` — role default member baru
4. `/set-channel welcome #channel` — channel welcome
5. `/set-channel goodbye #channel` — channel goodbye
6. `/test-welcome tipe:welcome` — pastikan welcome berfungsi (diagnosis + preview langsung)
7. `/set-channel invoice #channel` — channel invoice/testimoni
8. `/set-channel audit-log #channel` — channel audit log
9. `/set-channel transcript #channel` — channel arsip transcript tiket (opsional)
10. `/set-channel server-booster #channel` — notifikasi boost (opsional — `/boosters` tetap jalan tanpa ini)
11. `/set-role booster @Booster` — auto role booster: dapat role saat boost, hilang saat boost berakhir (opsional — diterapkan langsung ke booster yang sudah ada; `/test-booster` bisa mengecek rantainya)
12. `/serverstats setup` — channel counter live (opsional — counter gaya `👥 Member: 123` di paling atas daftar channel, ter-update otomatis; pilih counter mana yang mau ditampilkan lewat opsi boolean `members`/`bots`/`boosts`/`roles`/`channels`)
13. `/setup-verify` — pasang panel verifikasi
14. `/setup-ticket` — pasang panel tiket
15. `/config-show` — verifikasi semua setting

Panduan lengkap termasuk contoh produk, kategori custom, dan operasional harian: **[docs/ADMIN_GUIDE.md](./docs/ADMIN_GUIDE.md)**.

---

## 🧪 Development

| Script             | Deskripsi                                          |
| ------------------ | -------------------------------------------------- |
| `npm start`        | Jalankan bot                                       |
| `npm run dev`      | Jalankan dengan nodemon (auto-restart)             |
| `npm test`         | Jalankan semua unit test (670 test)                |
| `npm run lint`     | ESLint check                                       |
| `npm run format`   | Prettier format semua file                         |
| `./setup.sh`       | Install bot + dashboard + siapkan kedua .env       |
| `./start.sh`       | Production: bot + dashboard web bersamaan          |
| `./dev.sh`         | Pengembangan: nodemon + next dev bersamaan         |
| `npm run dash:dev` | Dashboard web saja (next dev :3000)                |
| `npm run dash:mock`| Dashboard + DASH API tiruan (data demo, tanpa bot) |

Test memakai `node:test` bawaan Node.js — tidak perlu dependensi tambahan. Semua test berjalan dalam sandbox (snapshot/restore) sehingga aman dijalankan di server live. CI (GitHub Actions) menjalankan lint + test pada setiap push untuk Node 18/20/22.

---

## 🛡️ Keamanan

- **Token Discord** hanya di `.env` (di-gitignore) — jangan pernah di-commit.
- **Atomic write** — semua file JSON ditulis via `safeWriteJSON` (tmp+rename), anti corrupt saat crash/power loss.
- **Karantina file korup** — file data gagal parse di-rename `.corrupt-<ts>`, tidak pernah tertimpa diam-diam.
- **TOCTOU guard** — `userLock` mencegah double-process saat user double-click.
- **Audit log** — key selalu dimasking; semua admin action tercatat.
- **Mode 1 server / publik — SATU variabel `GUILD_ID` (v3.12.0)** — `GUILD_ID` terisi: command instan + event dari server lain diabaikan (asuransi kalau bot tak sengaja ter-invite). `GUILD_ID` kosong: **mode publik ala Dyno** — command global, muncul otomatis di semua server yang meng-invite bot, dan config terisolasi per-server (`data/config/<guildId>.json`) — admin server A tidak bisa menimpa setting server B. Panduan membuka bot ke publik: [docs/ADMIN_GUIDE.md → Mode Publik](./docs/ADMIN_GUIDE.md).

---

## 🆘 Troubleshooting

### Bot tidak online

Cek `DISCORD_TOKEN` di `.env` dan pastikan bot sudah di-invite ke server dengan ID `GUILD_ID`.

### Slash command tidak muncul

Pastikan `GUILD_ID` benar (server ID, bukan user ID) dan bot adalah member guild itu. Restart bot — registrasi ulang instan. Catatan: kalau `GUILD_ID` dikosongkan (mode publik), registrasi GLOBAL memerlukan ±1 jam propagasi Discord — command tidak instan, itu normal.

### Permission error

Role bot harus **di atas** role yang dikelola, dan bot memerl permission yang tercantum di bagian Prasyarat.

### Auto-responder / anti-spam / AFK tidak berfungsi

Penyebab paling sering: **Message Content Intent** belum diaktifkan.

1. Buka https://discord.com/developers/applications → pilih bot
2. Tab **Bot** → _Privileged Gateway Intents_
3. Aktifkan **MESSAGE CONTENT INTENT** (dan SERVER MEMBERS INTENT jika belum)
4. Save Changes → restart bot

Jika console bot menampilkan warning `⚠️ [HINT] Pesan dari ... isinya kosong`, intent memang belum aktif.

### Welcome / goodbye tidak muncul

Jalankan **`/test-welcome tipe:welcome`** — command ini mendiagnosis setiap mata rantai (channel sudah di-set? channel masih ada? permission bot di channel itu?) + mengirim preview langsung. Sejak v3.9.48 bot juga **menyebut alasannya** di console setiap kali welcome ter-skip (channel belum di-set / tidak ditemukan / gagal kirim), dan mengecek konfigurasi saat startup. Intent GuildMembers bukan penyebabnya — bot yang online membuktikan intent itu NYALA (intent privileged yang mati justru bikin login crash).

### Total revenue tidak bergerak saat jualan

**Baris "Total Revenue" agregat DIHAPUS dari `/stats` di v3.9.51** (permintaan user — toh angkanya tidak akan pernah cocok dengan pembukuan manual). Belanja pribadi per member tetap dilacak dan terlihat di `/my-stats` ("Total Belanja") dan `/leaderboard` ("Top Spender"). Sejak v3.9.49/50 parser harga paham suffix Indonesia (`25rb` = 25.000, `2jt`/`2juta` = 2.000.000) dan harga dua mata uang (`3$ USD | Rp. 25.000` tercatat **Rp 25.000 per penjualan**); sejak **v3.9.54 harga currency-AGNOSTIC** — penanda APA SAJA diterima (`$3`, `€25`, `¥1000`, `₩25.000`, `25 usd`, `IDR 30.000`…), USD-only tidak lagi ditolak, dan `/add-product` hanya **menolak** string yang benar-benar tak terbaca (beserta daftar format) — jadi yang terlacak tercatat dengan benar. Sejak **v3.9.55 harga desimal mempertahankan cents** — dengan penanda non-Rp, `$2.5` / `$2.50` → 2.5 dan `$9.99` → 9.99 — dan sejak **v3.9.57 desimal POLOS juga sah** (`5.88` → 5.88, `5,88` → 5.88; dulu `5.88` terbaca 588), sementara grup dot 3 digit tetap ribuan (`50.000` → 50.000); nominal deal rekber tetap wajib angka bulat (memang didesain begitu). Stats & rekber menampilkan angka locale polos (tanpa `Rp` yang di-hardcode). Belanja pribadi menghitung order tiket + penyelesaian rekber (harga + fee) yang diproses **lewat bot** — penjualan manual di luar tiket/deal tidak terlacak.

Troubleshooting lengkap (tiket, role, stats, backup, dll): **[docs/ADMIN_GUIDE.md → Section 9](./docs/ADMIN_GUIDE.md)**.

---

## 📝 Lisensi

MIT — bebas dipakai, dimodifikasi, dan didistribusikan. Lihat [LICENSE](./LICENSE).
