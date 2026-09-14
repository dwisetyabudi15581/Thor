#!/usr/bin/env bash
# dev.sh — mode PENGGEMBANGAN: bot (nodemon, auto-restart saat kode berubah)
# + dashboard web (next dev, hot-reload) berjalan bersamaan.
#
# Pakai:  ./dev.sh
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "!!.env belum ada — jalankan ./setup.sh dulu."; exit 1; }
[ -f dashboard/.env ] || cp dashboard/.env.example dashboard/.env

pids=()
cleanup() {
  echo
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup EXIT INT TERM

echo "==> Dashboard dev (next dev) di http://localhost:3000..."
(cd dashboard && npm run dev) & pids+=("$!")

echo "==> Bot dev (nodemon index.js)..."
npx nodemon index.js & pids+=("$!")

echo
echo "Mode pengembangan jalan — Ctrl+C untuk berhenti."
echo "Tips: tanpa bot menyala, dashboard menampilkan banner 'Bot offline'."
echo "      Untuk UI dengan data demo: (cd dashboard && npm run mock) di terminal lain."
wait -n
