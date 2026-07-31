# v3.9.2 — Race Condition & Documentation Hardening

Follow-up ke v3.9.1 (security & race condition hardening). Fokus kali ini:
menutup TOCTOU race condition yang tersisa di giveaway & poll, optimasi
performance, retry audit log, dan merapikan dokumentasi.

## CRITICAL

### 1. TOCTOU race condition di giveaway join/leave
**File:** `handlers/interactionHandler.js` + `utils/userLock.js` (NEW)

Sebelumnya, 2 klik tombol Join cepat (<100ms) bisa lolos cek
`gw.participantIds.includes(userId)` keduanya, lalu keduanya push userId ke
array → participant terdaftar dobel. Manifest:
- Statistik peserta salah (count +2 padahal user 1 orang)
- Winner pick probability ter-distort (user dobel-chance)
- Member bisa jadi winner 2x untuk giveaway yang sama

**Fix:** buat utility `utils/userLock.js` — per-user in-process lock di-key
per `(scope, userId)`. Wrap giveaway join/leave dalam `withLock('gw', userId, ...)`.
Klik kedua (yang datang <5 detik setelah klik pertama) langsung ditolak dengan
pesan "Tunggu sebentar, kamu lagi klik terlalu cepat". Lock auto-release di
`finally` block, jadi tidak nge-hang kalau ada exception.

### 2. TOCTOU race condition di poll vote
**File:** `handlers/interactionHandler.js` + `utils/userLock.js`

Sama seperti giveaway, 2 klik cepat di option yang sama (mode `multiple:false`)
bisa:
- Klik-1: toggle vote ON (user belum vote → vote ON)
- Klik-2: toggle vote OFF (user sudah vote → vote OFF)

Hasil: user merasa sudah vote, tapi vote-nya hilang.

**Fix:** wrap `votePoll()` dalam `withLock('poll', userId, ...)`. Klik kedua
ditolak sampai klik pertama selesai.

## HIGH

### 3. `permissions.isAdmin` baca config sync di setiap call
**File:** `utils/permissions.js` + `utils/configManager.js` + `handlers/commandHandler.js`

Sebelumnya, setiap interaction yang masuk manggil `isAdmin(member)` yang
internal-nya manggil `getConfig()` → `fs.readFileSync('config.json')` →
`JSON.parse(...)`. Untuk server aktif dengan banyak slash command, ini bisa
50-100 disk read/detik yang sebenarnya tidak perlu (config admin role jarang
berubah).

**Fix:**
- Cache admin role ID selama 30 detik di `utils/permissions.js`
- `invalidateAdminRoleCache()` dipanggil otomatis dari `configManager.setField()`
  saat `roles.admin` berubah
- Juga dipanggil dari `commandHandler.js` saat `/remove-role admin` dijalankan
- Perubahan admin role langsung efektif — tidak perlu nunggu TTL 30 detik

### 4. `auditLog.logAudit` silent failure
**File:** `utils/auditLog.js`

Sebelumnya, satu error transient (rate limit Discord 429, network blip, 5xx)
langsung bikin audit log entry hilang forever. Untuk compliance & accountability,
ini tidak ideal — admin action harus tercatat.

**Fix:**
- Retry 1x dengan delay 500ms untuk error retryable (code >= 500, 429, atau
  code === 0 / network error)
- Error non-retryable (4xx selain 429) tidak di-retry (pasti gagal lagi)
- Log warning ke console kalau attempt 1 gagal, supaya bisa di-monitor

## MEDIUM

### 5. Validasi panjang field di embed builder (defense-in-depth)
**File:** `handlers/interactionHandler.js`

Sebelumnya, modal sudah pakai `setMaxLength(256)` untuk field name dan
`setMaxLength(1024)` untuk field value. Tapi tidak ada validasi eksplisit di
submit handler — kalau ada code path lain (mis. REST API langsung, atau bug di
modal config), value bisa lolos dan `embed.addFields()` throw error saat dikirim.

**Fix:** tambah validasi eksplisit:
- Field name: maks 256 char
- Field value: maks 1024 char
- Title: maks 256 char (Discord embed title limit)
- Description: maks 4096 char (Discord embed description limit)

Kalau kelebihan, bot reply dengan pesan error yang jelas (termasuk panjang
aktual vs limit), bukan silent failure.

## Documentation

### 6. Update `package.json` version ke 3.9.2
Sebelumnya masih 3.8.5 — tidak sinkron dengan changelog v3.9.0/v3.9.1.

### 7. Update `README.md`
- Update header version ke 3.9.2
- Tambah mention atomic JSON writes di section Core
- Tambah mention cross-guild safe di section Key-Driven VIP
- Tambah mention mention-validation di section Announce
- Update `/restore-backup` description (2-step confirmation + reload cache)
- Update `/reset-config` description (2-step confirmation)
- Update `/giveaway create` (tidak otomatis ping @everyone)
- Update `/announce-schedule` (range validation)
- Update `/poll create` (customId aman)
- Tambah changelog v3.9.0, v3.9.1, v3.9.2 di section Changelog
- Update struktur file (tambah safeWrite.js, userLock.js, tickets.json, CHANGELOG.md, dll)
- Tambah catatan keamanan DISCORD_TOKEN di section Catatan Penting

### 8. Update `ADMIN_GUIDE.md`
- Update header version ke 3.9.2
- Tambah section 10 "Apa yang Baru di v3.9.x"
- Update section Backup & Restore dengan flow 2-step confirmation
- Update section Announce dengan format mention yang valid
- Tambah troubleshooting untuk pesan "klik terlalu cepat"
- Tambah troubleshooting untuk audit log retry
- Update section Stats — cache otomatis reload setelah restore
- Tambah catatan anti double-join / anti double-vote di section Giveaway & Poll

### 9. Tambah `CHANGELOG.md`
File changelog terkonsolidasi mengikuti format Keep a Changelog. Mencakup
semua versi dari v1.0 sampai v3.9.2. Untuk detail teknis v3.9.0/v3.9.1, lihat
file `CHANGES_v3.9.0.md` dan `CHANGES_v3.9.1.md`.

### 10. Perluas `.env.example`
- Tambah catatan keamanan (jangan share token, kalau bocor langsung reset)
- Tambah instruksi cara dapat Guild ID step-by-step
- Tambah komentar opsional untuk LOG_FILE

## Files Modified

| File | Changes |
|---|---|
| `utils/userLock.js` | NEW — per-user in-process lock utility |
| `utils/permissions.js` | TTL cache 30s untuk admin role ID + `invalidateAdminRoleCache()` |
| `utils/configManager.js` | Call `invalidateAdminRoleCache()` saat `roles.admin` berubah |
| `utils/auditLog.js` | Retry 1x dengan delay 500ms untuk error transient |
| `handlers/interactionHandler.js` | #1 (giveaway lock), #2 (poll lock), #5 (embed field validation) |
| `handlers/commandHandler.js` | Call `invalidateAdminRoleCache()` saat `/remove-role admin` |
| `package.json` | Version bump ke 3.9.2 |
| `README.md` | Update ke v3.9.2 + tambah section baru |
| `ADMIN_GUIDE.md` | Update ke v3.9.2 + tambah section 10 |
| `CHANGELOG.md` | NEW — changelog terkonsolidasi |
| `.env.example` | Tambah catatan keamanan + instruksi Guild ID |

## Compatibility

- **Backward compatible** dengan data v3.9.1:
  - Cache admin role ID otomatis populated saat pertama call `isAdmin()`
  - Lock utility tidak butuh data persistent — fully in-memory
  - Retry audit log transparent — caller tetap dapat `true`/`false`
- **Tidak ada schema migration** yang perlu dijalankan manual
- **Tidak ada config baru** yang perlu di-set

## Known Issues NOT Fixed (TODO v3.9.3+)

- `tempVoiceManager` masih pakai sync I/O di hot path voiceStateUpdate.
  Bisa di-batch atau cache.
- Backup retention hanya 7 — bisa di-config per guild.
- Tidak ada metrics/observability (Prometheus, dll) — kalau bot dipakai
  di server besar, sulit debug performance issue.
- Tidak ada unit test — semua validasi manual via `node --check`.
