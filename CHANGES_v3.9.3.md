# v3.9.3 — Critical Bug Fix: keyManager Cross-Guild Wipe

Follow-up ke v3.9.2 (race condition hardening + docs). Patch kali ini fokus
menutup **bug kritis yang terlewat dari v3.9.0** — `removeAllKeysByUser` yang
broken sejak v3.9.0 menambahkan parameter guildId tanpa update schema keys.json.

## CRITICAL

### 1. `removeAllKeysByUser(userId, guildId)` silently menghapus 0 key
**File:** `utils/keyManager.js` + `handlers/commandHandler.js` + `handlers/interactionHandler.js`

**Skenario bug:**
1. Admin jalankan `/clear-schedule user:@member clear_keys:true`
2. `commandHandler.js` memanggil `removeAllKeysByUser(user.id, guildId)`
3. Fungsi filter: `list.filter(k => !(k.userId === userId && k.guildId === guildId))`
4. **TAPI** `keys.json` tidak menyimpan `guildId` per key (field tidak pernah di-set di `addKey`)
5. Jadi `k.guildId` selalu `undefined`, yang tidak pernah sama dengan `guildId` yang di-pass
6. **Hasil:** 0 key dihapus, tapi admin lihat pesan "✅ Clear selesai" dan mengira VIP sudah di-reset

**Dampak:**
- Admin mengira sudah reset VIP member, padahal key masih ada di `keys.json`
- Role dilepas (line 778 di commandHandler), tapi key tetap aktif
- Saat member dapat key baru untuk role yang sama, `getActiveKeysByUserAndRole` masih menemukan key lama → MAX EXTEND salah hitung
- Member bisa mendapat role lebih lama dari yang seharusnya

**Fix:**
1. **`addKey`** sekarang menerima & menyimpan `guildId` per key entry (field baru di schema)
2. **Kedua caller** (`commandHandler.js` `/set-key` + `interactionHandler.js` Set Key via ticket) di-update untuk pass `interaction.guild.id`
3. **`removeAllKeysByUser`** backward compat:
   - Kalau guildId di-pass DAN key punya guildId → hapus kalau match
   - Kalau guildId di-pass TAPI key tidak punya guildId (schema lama, pre-v3.9.3) → juga hapus (asumsi: key lama milik guild pertama yang memanggil)
   - Kalau guildId tidak di-pass → behavior lama (hapus semua key user)

**Migration:** tidak perlu manual. Key lama (tanpa `guildId`) tetap berfungsi — dianggap milik guild pertama yang memanggil `removeAllKeysByUser`. Key baru (v3.9.3+) punya `guildId` eksplisit.

## MEDIUM

### 2. `/announce` & `/announce-schedule` — tidak validasi panjang title/description
**File:** `handlers/commandHandler.js`

Sebelumnya, Discord slash command string options menerima input sampai 6000 char. Kalau admin pass title > 256 char atau description > 4096 char, `EmbedBuilder.setTitle()` / `setDescription()` akan throw `RangeError`. Error ini ditangkap outer try-catch dan dilaporkan sebagai "❌ Terjadi error. Coba lagi sebentar." — pesan generik yang tidak menjelaskan akar masalah.

Untuk `/announce-schedule`, bug ini lebih buruk: error tidak terjadi saat command dijalankan, tapi saat `processScheduledAnnouncement` fire di kemudian hari. EmbedBuilder throw → announce gagal terkirim → entry stuck di `scheduledAnns.json` dengan status `sent: false` → scheduler terus mencoba tiap menit → log spam.

**Fix:** validasi panjang sebelum build embed:
- title: maks 256 char (Discord embed title limit)
- description: maks 4096 char (Discord embed description limit)

Pakai konstanta dari `utils/constants.js` (`EMBED_LIMITS.TITLE`, `EMBED_LIMITS.DESCRIPTION`) supaya tidak ada magic number.

## Files Modified

| File | Changes |
|---|---|
| `utils/keyManager.js` | #1: `addKey` simpan guildId, `removeAllKeysByUser` backward compat fix |
| `handlers/commandHandler.js` | #1: pass guildId ke addKey di /set-key, #2: validasi panjang /announce & /announce-schedule |
| `handlers/interactionHandler.js` | #1: pass guildId ke addKey di Set Key via ticket |
| `package.json` | Version bump ke 3.9.3 |

## Compatibility

- **Backward compatible** dengan data v3.9.2:
  - Key lama (tanpa `guildId`) tetap berfungsi
  - `removeAllKeysByUser` dengan guildId akan menghapus key lama (diasumsikan milik guild pemanggil)
  - Key baru (v3.9.3+) punya `guildId` eksplisit
- **Tidak ada schema migration** manual yang perlu dijalankan
- **Tidak ada config baru** yang perlu di-set

## How to Verify the Fix

Setelah deploy v3.9.3:

1. Buat key baru via `/set-key` atau Set Key via ticket
2. Cek `keys.json` — entry baru harus punya field `guildId`
3. Jalankan `/clear-schedule user:@member clear_keys:true`
4. Cek `keys.json` — key milik member di guild ini harus terhapus (count > 0)
5. Sebelum v3.9.3: langkah 4 akan menunjukkan 0 key terhapus (bug)

## Root Cause Analysis

Bug ini terjadi karena v3.9.0 menambahkan parameter `guildId` ke `removeAllKeysByUser` untuk mencegah cross-guild wipe, **tetapi**:

1. `addKey` tidak di-update untuk menyimpan `guildId` per key
2. Implementasi `removeAllKeysByUser` mengasumsikan `k.guildId` ada, padahal tidak
3. Comment di code menyebutkan "fallback: hapus key yang roleId milik guild tersebut" tetapi fallback ini **tidak pernah diimplementasikan**
4. Tidak ada test yang catch bug ini karena semua validasi manual via `node --check` (syntax only, bukan behavior)

**Lesson learned:** saat menambah parameter ke fungsi yang sudah ada, pastikan:
- Schema data mendukung parameter baru
- Backward compat fallback benar-benar diimplementasikan (bukan cuma comment)
- Ada test case yang verifikasi behavior baru
