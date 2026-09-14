# 🚀 Panduan Deploy — Thor Bot + Dashboard Web (SATU REPO)

Sejak v3.18.0, bot dan dashboard web **satu repo** — clone sekali, `./setup.sh`
sekali, langsung jalan. Bot 100% gratis (mode 1 server atau publik ala Dyno).

Arsitektur produksi yang dituju (semua komponen **satu VPS**):

```
                        Internet
                           │
                    domain.com :443
                    (Caddy — auto-HTTPS)
                           │
                    Dashboard Next.js :3000
                    (folder dashboard/, login Discord OAuth2)
                           │  http://127.0.0.1:8788 (DASH_API_TOKEN)
                           ▼
                    Bot Thor (node index.js, root repo)
                    └─ DASH API :8788 (localhost only)
                    └─ data/config/<guildId>.json  ← SATU sumber data
```

- **Bot + web menulis konfigurasi ke file yang sama** lewat DASH API — slash
  command di Discord dan dashboard web tidak pernah bentrok.
- Dashboard bisa jalan **tanpa bot** (banner "Bot offline") — tapi untuk
  menyimpan perubahan, bot harus nyala.

---

## 0. Yang perlu disiapkan

| Kebutuhan | Contoh | Biaya |
| --- | --- | --- |
| VPS 1 vCPU / 1 GB / Node.js 20+ | VPS lokal ID (Niagahoster/RackGema dsb.) atau Hetzner/Vultr/DO | ±Rp 50–100rb / $5 per bulan |
| Domain | `thor.domainmu.com` | ±Rp 20–150rb/tahun |
| Aplikasi Discord (sudah ada) | Client ID + Client Secret + token bot | gratis |

## 1. Setup VPS (sekali saja)

```bash
ssh root@IP_VPS

# user harian (jangan jalan sebagai root)
adduser thor && usermod -aG sudo thor
su - thor

# Node.js 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
sudo npm install -g pm2

# firewall — port 3000 & 8788 TIDAK perlu dibuka (localhost only)
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443
sudo ufw enable
```

## 2. Clone + install (SATU repo, sekali jalan)

```bash
cd ~
git clone https://github.com/dwisetyabudi15581/Thor.git
cd Thor
./setup.sh        # install bot + dashboard + buat kedua .env dari contoh
```

## 3. Isi kedua file .env

Buat token acak yang SAMA untuk kedua sisi (jembatan bot ⇄ web):

```bash
openssl rand -hex 32   # simpan hasilnya — dipakai di DUA tempat
```

**`.env` (bot — root repo):**

```ini
DISCORD_TOKEN=token_bot_dari_developer_portal
GUILD_ID=                          # KOSONG = mode publik ala Dyno

DASH_API_HOST=127.0.0.1
DASH_API_PORT=8788
DASH_API_TOKEN=HASIL-OPENSSL-RAND-HEX-32-DI-ATAS
```

**`dashboard/.env` (web):**

```ini
DATABASE_URL=file:db/custom.db
SESSION_SECRET=HASIL-OPENSSL-RAND-HEX-32-YANG-BARU   # secret BARU, bukan yang DASH
DEMO_MODE=false
DISCORD_CLIENT_ID=1548297613969985546
DISCORD_CLIENT_SECRET=client_secret_dari_portal
PUBLIC_ORIGIN=https://thor.domainmu.com
ADMIN_DISCORD_IDS=1290700587373039619

DASH_API_URL=http://127.0.0.1:8788
DASH_API_TOKEN=HASIL-OPENSSL-RAND-HEX-32-DI-ATAS     # SAMA PERSIS dengan .env bot
```

> ⚠️ Kesalahan paling umum: `DASH_API_TOKEN` beda antara kedua .env →
> dashboard tampil "Bot offline" dan save tidak berpengaruh. Samakan lalu
> restart kedua proses.

## 4. Uji dulu, lalu jalankan 24/7

```bash
npm test                    # 639 unit test bot harus hijau semua

# cara cepat (cek kedua komponen hidup):
./start.sh                  # Ctrl+C untuk berhenti

# produksi 24/7 via pm2:
(cd dashboard && npm run build)
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
pm2 logs thor-bot           # pastikan: bot online + DASH API listening :8788
```

## 5. Domain + HTTPS (Caddy)

```bash
# A record domain: thor.domainmu.com → IP_VPS
sudo apt install -y caddy
sudo nano /etc/caddy/Caddyfile
```

Isi (ganti domain):

```
thor.domainmu.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
# Caddy otomatis mengurus sertifikat HTTPS (Let's Encrypt) — tunggu ±30 detik
```

## 6. Discord Developer Portal (penting!)

1. https://discord.com/developers/applications → aplikasi bot
2. **Bot** → *Privileged Gateway Intents* → aktifkan:
   - ✅ SERVER MEMBERS INTENT
   - ✅ MESSAGE CONTENT INTENT
3. **OAuth2** → *Redirects* → tambah:
   ```
   https://thor.domainmu.com/api/auth/discord/callback
   ```
   (dashboard juga menampilkan URI persis ini di footer landing — salin dari sana)
4. Simpan.

## 7. Verifikasi end-to-end (5 menit)

1. Buka `https://thor.domainmu.com` → landing muncul
2. **Login dengan Discord** → otorisasi → masuk daftar server
3. Pilih server tempat bot sudah di-invite → dashboard 11 modul terbuka
4. Ubah satu setting (mis. modul **Umum** → Simpan) → cek di Discord dengan
   `/config-show` → nilai harus sama (bukti slash command & web satu sumber)
5. `pm2 logs thor-bot` → request DASH API tercatat

## 8. Operasional harian

```bash
pm2 status                 # thor-bot + thor-dash harus online
pm2 logs thor-bot          # log bot
pm2 logs thor-dash         # log dashboard
pm2 restart all            # restart keduanya

# update ke versi baru:
cd ~/Thor && git pull
./setup.sh                 # install ulang deps bila berubah
npm test
(cd dashboard && npm run build)
pm2 restart all

# backup SEMUA data (bot): cukup folder data/
rsync -av thor@IP_VPS:~/Thor/data/ ./backup-thor/
# backup dashboard (user login): file dashboard/db/custom.db
```

## Troubleshooting cepat

| Gejala | Penyebab umum | Solusi |
| --- | --- | --- |
| Bot tidak online | DISCORD_TOKEN salah / intent mati | cek token + 2 intent, `pm2 logs thor-bot` |
| Slash command tidak muncul | GUILD_ID terisi salah / propagasi global ±1 jam | kosongkan GUILD_ID untuk mode publik, tunggu 1 jam |
| Login Discord gagal | Redirect URI beda / client secret salah | samakan persis dengan yang dashboard tampilkan |
| Daftar server kosong | OAuth login sebelum scope `guilds` aktif | logout → login ulang |
| "Bot offline" di dashboard | DASH_API_TOKEN beda / bot mati | samakan token, `pm2 status` |
| Save di web tidak berpengaruh | token beda (tulis ditolak) | sama seperti atas — cek `pm2 logs` |
| `npm install` gagal di dashboard | Node < 20 | upgrade Node (setup.sh mengecek) |
