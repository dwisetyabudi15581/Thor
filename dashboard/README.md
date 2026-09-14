# Thor Dashboard — Kelola Bot Discord-mu via Web (ala Dyno)

> Folder ini adalah bagian dari repo **Thor** (bot + dashboard SATU repo).
> Panduan deploy lengkap ada di [../DEPLOY.md](../DEPLOY.md) (root repo).

Dashboard web untuk bot Discord **Thor** — atur semua fitur bot langsung dari
browser, tanpa command. **Bot 100% gratis untuk siapa pun** — tidak ada key,
tidak ada langganan. Dibangun dengan Next.js 16, TypeScript, Tailwind CSS 4,
shadcn/ui, dan Prisma (SQLite).

## Cara Kerja

```
Browser ──> Dashboard Next.js (login Discord OAuth2)
                │  guard: login + permission Manage Guild (live dari Discord)
                ▼
           DASH API bot Thor (http://127.0.0.1:8788, token rahasia)
                │  validasi bisnis tetap di bot
                ▼
           data/config/<guildId>.json + managers bot
```

- **Dua cara mengatur bot**: slash command langsung di Discord **atau** dashboard
  web ini — keduanya menulis ke SATU sumber data yang sama, jadi tidak pernah
  bentrok.
- **Akses dijaga Discord**: user hanya melihat server tempat dia punya role
  Owner / **Manage Server**, dan bot harus ada di server itu.
- **Semua tulisan tervalidasi bot** (whitelist section + tipe + anti
  prototype pollution) dan tercatat siapa aktor-nya (audit).

## Fitur

- **Login Discord (OAuth2)** — masuk dengan akun Discord, tanpa password
- **Pemilih server** — daftar server yang kamu kelola + status bot (aktif/belum)
- **11 modul konfigurasi**: Ringkasan, Umum, Tiket & Produk, AutoMod, Leveling,
  Rekber, Auto-Responder, Self-Roles, Announce (terjadwal), Temp Voice,
  Server Stats (channel counter live)
- **CRUD langsung** — tambah/hapus responder, panel self-role, announce
  terjadwal, tanpa restart bot
- **Invite bot** — tombol invite dengan permission least-privilege

## Menjalankan

Cara termudah — dari **root repo**:

```bash
./setup.sh     # sekali saja: install bot + dashboard + siapkan .env
./start.sh     # production: bot + dashboard bersamaan
./dev.sh       # pengembangan: nodemon (bot) + next dev (dashboard)
```

Atau manual dari folder ini:

```bash
npm install
npx prisma generate
cp .env.example .env      # lalu isi (lihat tabel di bawah)
npm run build
npm run start             # :3000
```

> Tanpa bot menyala, dashboard tetap jalan tapi menampilkan banner "Bot
> offline". Untuk mencoba UI tanpa bot: `npm run mock` (DASH API tiruan
> dengan data demo di 127.0.0.1:8788).

### Variabel penting (`.env`)

| Variabel | Keterangan |
| --- | --- |
| `DATABASE_URL` | SQLite, mis. `file:db/custom.db` |
| `SESSION_SECRET` | String acak (`openssl rand -hex 32`) |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | OAuth2 dari Developer Portal |
| `PUBLIC_ORIGIN` | Domain produksi, mis. `https://thor.contohmu.com` |
| `ADMIN_DISCORD_IDS` | Discord ID (pisah koma) yang jadi admin |
| `DASH_API_URL` / `DASH_API_TOKEN` | Harus SAMA dengan `.env` bot Thor |

Redirect URI OAuth yang didaftarkan di Developer Portal:
`https://<domain-dashboard>/api/auth/discord/callback`
