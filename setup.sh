#!/usr/bin/env bash
# setup.sh — pasang SEMUA dependensi Thor (bot + dashboard web) sekali jalan.
#
# Pakai:  ./setup.sh        (jalankan dari folder root repo, setelah clone)
#
# Yang dilakukan:
#   1. Cek Node.js (butuh >= 20; bot jalan di 18+, dashboard butuh 20+)
#   2. npm install untuk bot (root)
#   3. npm install + prisma generate untuk dashboard (folder dashboard/)
#   4. Membuat .env (bot) dan dashboard/.env (web) dari file contoh bila belum ada
set -euo pipefail
cd "$(dirname "$0")"

echo "==> [1/4] Cek Node.js..."
if ! command -v node >/dev/null 2>&1; then
  echo "!! Node.js belum terpasang. Install dulu (butuh >= 20):"
  echo "   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  echo "   sudo apt install -y nodejs"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "!! Node.js kamu v$(node -v) — dashboard web butuh >= 20. Upgrade dulu."
  exit 1
fi
echo "    Node $(node -v) OK"

echo "==> [2/4] Install dependensi bot..."
npm install --no-audit --no-fund

echo "==> [3/4] Install dependensi dashboard web..."
(cd dashboard && npm install --no-audit --no-fund && npx prisma generate)

echo "==> [4/4] Siapkan file .env..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    .env dibuat dari contoh — JANGAN LUPA diisi (DISCORD_TOKEN, DASH_API_TOKEN, ...)"
fi
if [ ! -f dashboard/.env ]; then
  cp dashboard/.env.example dashboard/.env
  echo "    dashboard/.env dibuat dari contoh — isi DISCORD_CLIENT_ID/SECRET"
  echo "    + DASH_API_TOKEN (HARUS sama persis dengan .env bot)"
fi

echo
echo "Selesai! Langkah berikutnya:"
echo "  1. Isi .env            (token bot + DASH_API_TOKEN)"
echo "  2. Isi dashboard/.env  (OAuth Discord + DASH_API_TOKEN yang sama)"
echo "  3. ./start.sh          (production: bot + dashboard sekali jalan)"
echo "     ./dev.sh            (pengembangan: nodemon + next dev)"
echo ""
echo "Lihat DEPLOY.md untuk panduan lengkap (VPS + domain + HTTPS + pm2)."
