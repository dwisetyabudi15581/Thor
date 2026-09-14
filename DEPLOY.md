# 🚀 Panduan Deploy — Thor Bot (v3.17.0)

Bot Discord 100% gratis, mode 1 server atau publik (ala Dyno) + DASH API
untuk dashboard web. Panduan lengkap bot + dashboard + domain + HTTPS ada di
repo dashboard: **[thor-dashboard/DEPLOY.md](https://github.com/dwisetyabudi15581/thor-dashboard)**.

Dokumen ini fokus deploy **bot-nya saja** (tanpa dashboard).

---

## 1. Prasyarat

| Kebutuhan | Minimum | Catatan |
| --- | --- | --- |
| VPS / hosting Node.js | 1 vCPU · 1 GB RAM · 10 GB disk | Node.js **18+** (disarankan 20/22). VPS lokal Indonesia ±Rp 50–100rb/bln; internasional (Hetzner/Vultr/DO) ±$4–6/bln |
| Discord bot token | — | https://discord.com/developers/applications → aplikasi → **Bot** → Reset Token |
| 2 Privileged Intents | — | Tab **Bot** → aktifkan **SERVER MEMBERS INTENT** + **MESSAGE CONTENT INTENT** (tanpa ini login gagal / fitur mati) |

> Bot bisa juga dijalankan tanpa VPS di hosting Node.js (Railway, Render,
> Pterodactyl gratisan) — yang penting prosesnya **jalan terus 24/7**, bukan
> serverless/fungsional (data disimpan di file `data/`).

## 2. Install di VPS

```bash
# masuk VPS sebagai user biasa (bukan root)
sudo apt update && sudo apt install -y nodejs npm git   # atau NodeSource untuk Node 20/22
node -v   # harus >= 18

git clone https://github.com/dwisetyabudi15581/Thor.git
cd Thor
npm install
cp .env.example .env
nano .env
```

### Isi `.env`

```ini
DISCORD_TOKEN=token_bot_dari_developer_portal

# MODE SERVER — satu-satunya variabel yang menentukan perilaku:
#  TERISI  = mode 1 server: command instan, event server lain diabaikan
#  KOSONG  = MODE PUBLIK ala Dyno: command global, muncul otomatis di
#            semua server yang meng-invite bot (propagasi ±1 jam)
GUILD_ID=

# DASH API (WAJIB diisi kalau dashboard web dipakai; tanpa ini server
# API internal tidak jalan — bot tetap normal via slash command):
DASH_API_HOST=127.0.0.1
DASH_API_PORT=8788
DASH_API_TOKEN=hasil-openssl-rand-hex-32
```

Buat token acak: `openssl rand -hex 32`.

## 3. Uji dulu, lalu jalankan 24/7 (pm2)

```bash
npm test          # 639 unit test harus hijau semua
npm start         # uji manual: bot online, /help jalan

# lanjut pakai pm2 (auto-restart + start saat boot)
sudo npm install -g pm2
pm2 start index.js --name thor-bot
pm2 save
pm2 startup        # jalankan perintah yang muncul sekali saja
```

Log: `pm2 logs thor-bot`. Restart: `pm2 restart thor-bot`.

## 4. Invite bot ke server

Pakai URL berikut (permission least-privilege, ganti `CLIENT_ID` bila perlu):

```
https://discord.com/oauth2/authorize?client_id=1548297613969985546&permissions=1099800112150&scope=bot+applications.commands
```

Setelah bot masuk:
1. Role bot harus **di atas** semua role yang bot kelola (drag di Server Settings → Roles)
2. `/set-role admin @role` → role admin bot
3. `/setup-verify` → panel verifikasi
4. `/setup-ticket` → panel tiket
5. `/config-show` → cek semua setting

Panduan admin lengkap: **[docs/ADMIN_GUIDE.md](./docs/ADMIN_GUIDE.md)**.

## 5. Bot publik (ala Dyno) — checklist

- [ ] `GUILD_ID=` **kosong** di `.env`
- [ ] Kedua Privileged Intents aktif
- [ ] Command global muncul ±1 jam setelah restart (normal, propagasi Discord)
- [ ] `data/config/<guildId>.json` otomatis terpisah per server — admin server A tidak bisa menimpa server B
- [ ] Discord mewajibkan verifikasi bot setelah **100 server** (form + info pemilik di Developer Portal)

## 6. Backup & update

```bash
# data penting semuanya di folder data/ — backup cukup rsync:
rsync -av user@vps:Thor/data/ ./backup-thor-data/

# update versi baru:
cd Thor && git pull && npm install && npm test && pm2 restart thor-bot
```

Backup otomatis internal (maks 7 snapshot, tiap 24 jam + saat start) tetap
berjalan sendiri via `/backup-now` — folder `data/` adalah sumber kebenaran.
