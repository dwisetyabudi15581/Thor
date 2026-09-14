#!/usr/bin/env bash
# start.sh — jalankan bot + dashboard web BERSAMAAN (mode production).
#
# Pakai:  ./start.sh
#
# - Dashboard di-build dulu bila belum ada (sekali saja, ~1 menit).
# - Ctrl+C menghentikan keduanya sekaligus.
# - Untuk server produksi 24/7, pakai pm2 (lebih andal + auto-restart):
#     pm2 start ecosystem.config.cjs && pm2 save
#   Lihat DEPLOY.md.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f dashboard/.next/standalone/server.js ]; then
  echo "==> Build dashboard (sekali saja)..."
  (cd dashboard && npm run build)
fi

pids=()
cleanup() {
  echo
  echo "Menghentikan bot + dashboard..."
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup EXIT INT TERM

echo "==> Menjalankan bot Thor..."
node index.js & pids+=("$!")

echo "==> Menjalankan dashboard web (http://localhost:3000)..."
(cd dashboard && npm run start) & pids+=("$!")

echo
echo "Thor jalan: bot Discord + dashboard http://localhost:3000"
echo "Tekan Ctrl+C untuk menghentikan keduanya."
wait -n
