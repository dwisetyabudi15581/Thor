#!/bin/bash
# ============================================================
# Script Push ke GitHub - MLBB Community Bot v2.0
# ============================================================
# Cara pakai:
#   1. Extract Thor-pro.zip di komputer Anda
#   2. Buka terminal di folder Thor-pro
#   3. Jalankan: bash push-to-github.sh
#   4. Saat diminta token, PASTE token Anda (tidak akan terlihat)
# ============================================================

set -e

REPO_URL="https://github.com/dwisetyabudi15581/Thor.git"
BRANCH="main"

echo "🚀 Push MLBB Community Bot v2.0 ke GitHub"
echo "=========================================="
echo ""

# Cek apakah sudah ada git
if [ ! -d ".git" ]; then
    echo "📦 Init git repo..."
    git init -q
    git config user.name "dwisetyabudi15581"
    git config user.email "dwisetyabudi15581@users.noreply.github.com"
fi

# Tambah remote
echo "🔗 Tambah remote origin..."
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"

# Tambah & commit semua file
echo "📥 Stage files..."
git add -A

if git diff --cached --quiet; then
    echo "ℹ️  Tidak ada perubahan baru, lanjut push..."
else
    git commit -m "feat: v2.0 - welcome/goodbye, verify role swap, fully configurable" -q
    echo "✅ Commit dibuat"
fi

# Pilih branch
git branch -M "$BRANCH" 2>/dev/null || true

echo ""
echo "🔐 Saat ini git akan minta login GitHub."
echo "   Username : username GitHub Anda (dwisetyabudi15581)"
echo "   Password : PASTE Personal Access Token Anda (bukan password)"
echo "             (token tidak akan muncul di layar saat paste)"
echo ""
echo "⏳ Push ke $REPO_URL ..."
echo ""

# Push! (akan minta kredensial)
git push -u origin "$BRANCH" --force-with-lease 2>&1 || {
    echo ""
    echo "❌ Push gagal. Coba opsi force push:"
    read -p "   Force push (akan TIMPA isi repo lama)? [y/N] " -r
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git push -u origin "$BRANCH" --force
    else
        echo "   Dibatalkan."
        exit 1
    fi
}

echo ""
echo "🎉 BERHASIL! Repo sudah terupdate:"
echo "   https://github.com/dwisetyabudi15581/Thor"
echo ""
echo "🔒 Tips keamanan:"
echo "   - Token akan tersimpan di Windows Credential Manager / Keychain"
echo "   - Untuk hapus: Control Panel > Credential Manager > Windows Credentials"
echo "   - Kalau token bocor, segera revoke di: https://github.com/settings/tokens"
