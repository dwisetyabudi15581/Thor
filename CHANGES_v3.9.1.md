# v3.9.1 — Security & Race Condition Hardening

Follow-up ke v3.9.0 (atomic writes + cross-guild fixes). Fokus kali ini:
masking data sensitif di audit log, validasi input ketat, mencegah race
condition pada operasi destruktif, dan memindahkan metadata tiket ke
persistent store.

## CRITICAL

### 1. Audit log membocorkan 8 char pertama key
**File:** `handlers/commandHandler.js` (set-key flow)

Sebelumnya, audit log menyimpan `key.slice(0, 8) + '...'` ke channel
audit-log. Siapa pun yang punya akses baca ke channel itu bisa melihat
8 karakter pertama setiap key yang pernah diberikan admin — cukup untuk
mengidentifikasi pattern key (mis. kalau semua key pakai prefix `VIP-`).

**Fix:** ganti dengan `***` + panjang key saja. Audit log tetap bisa dipakai
untuk accountability (admin mana, ke user mana, produk apa), tapi nilai key
tidak bocor sama sekali.

### 2. `/restore-backup` tanpa konfirmasi
**File:** `handlers/commandHandler.js` + `handlers/interactionHandler.js`

Sebelumnya, `/restore-backup name:2026-07-31_15-30-00` langsung overwrite
semua file JSON (config, keys, warns, scheduledRoles, dll) tanpa konfirmasi.
Kalau admin salah ketik nama backup atau salah pilih, data hari ini langsung
hilang (walau ada safety backup `pre-restore_*`).

**Fix:** tambah 2-step confirmation button, sama seperti `/reset-config`.
Admin klik tombol "Ya, Restore Sekarang" baru eksekusi jalan. Cancel button
juga tersedia.

### 3. Poll modal customId bisa overflow 100-char Discord limit
**File:** `handlers/commandHandler.js` + `utils/pollManager.js` + `handlers/interactionHandler.js`

Sebelumnya, customId modal poll di-encode sebagai:
`poll_modal_create:<channelId>:<multiple>:<encodeURIComponent(question)>`

Kalau question panjang (apalagi setelah URL-encode — spasi jadi `%20`,
tanda baca jadi `%XX`), customId bisa exceed 100 char dan Discord API
reject modal-nya. Admin tidak bisa buat poll dengan question > ~60 char.

**Fix:** buat in-memory session store di `pollManager.js` (`createPollSession`,
`getPollSession`, `deletePollSession`) dengan TTL 5 menit. CustomId sekarang
cuma `poll_modal_create:<sessionId>` (~50 char, aman). Defense-in-depth:
verifikasi user yang submit modal = user yang buat session.

### 4. Ticket metadata disimpan di channel topic (spoofable)
**File:** `utils/ticketManager.js` + `handlers/interactionHandler.js`

Sebelumnya, metadata tiket (userId, productName, price) disimpan di channel
topic dengan format `Ticket UserID: 123 | Product: Foo | Price: Rp 50.000`.
Masalah:
  1. Channel topic bisa di-edit admin → metadata bisa rusak / dispoof.
  2. Channel topic dibatasi 1024 char, bisa ter-truncate.
  3. Parsing regex rentan false-positive kalau nama produk mengandung ` | `.

**Fix:** pindahkan metadata utama ke `tickets.json` (keyed by channelId).
Channel topic tetap di-set untuk human-readable info, tapi bukan sumber
kebenaran. Backward compat: kalau channelId tidak ada di tickets.json,
fallback ke topic parsing (untuk tiket lama yang dibuat sebelum v3.9.1).

Cleanup: `removeTicketMeta(channelId)` dipanggil saat `closeTicket` supaya
tidak ada zombie metadata.

## HIGH

### 5. `/announce` & `/announce-schedule` — mention passthrough tanpa validasi
**File:** `handlers/commandHandler.js`

Sebelumnya, admin bisa oper string bebas sebagai `mention` (mis.
`"halo @everyone dunia"`) yang akan bocor ke channel tujuan dan trigger
ping yang tidak diinginkan. Apalagi untuk `/announce-schedule` recurring —
bisa bikin spam ping harian tanpa sengaja.

**Fix:** validasi mention secara ketat. Hanya format berikut yang diterima:
  - `@everyone` / `everyone`
  - `@here` / `here`
  - `<@&ROLE_ID>` (role mention)
  - `<@USER_ID>` / `<@!USER_ID>` (user mention)

Selain itu → reject dengan pesan error yang menjelaskan format yang valid.

### 6. Giveaway creation otomatis ping `@everyone`
**File:** `handlers/commandHandler.js`

Sebelumnya, setiap giveaway baru otomatis ping `@everyone`. Kalau admin
bikin giveaway sering, member bisa mute / leave server karena terganggu.

**Fix:** hapus hardcoded `@everyone`. Admin yang mau ping @everyone bisa
pakai `/announce` terpisah atau edit pesan giveaway setelah dibuat.

### 7. `keyManager.getMaxExpireAtByUserAndRole` — `Math.max(...spread)` RangeError
**File:** `utils/keyManager.js`

Sebelumnya: `Math.max(...actives.map(k => k.expireAt))`. Kalau user punya
ratusan key aktif (kasus ekstrim), spread operator bisa kena call stack
limit dan throw `RangeError: Maximum call stack size exceeded`.

**Fix:** ganti dengan simple `for` loop.

### 8. `backupManager.restoreBackup` tanpa lock
**File:** `utils/backupManager.js`

Sebelumnya, kalau 2 admin jalankan `/restore-backup` bersamaan, file JSON
saling ditimpa → data corruption.

**Fix:** tambah in-process lock (`restoreInProgress`). Panggilan concurrent
langsung ditolak dengan pesan "Restore lain sedang berjalan".

### 9. Pre-restore backup tidak bisa di-restore
**File:** `utils/backupManager.js`

Sebelumnya, regex `^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$` hanya match
format timestamp polos. Backup `pre-restore_*` muncul di `/backup-list`
tapi tidak bisa di-restore via command → confusing UX.

**Fix:** update regex untuk juga accept `pre-restore_YYYY-MM-DD_HH-mm-ss`.
Tambah defense-in-depth: reject name yang mengandung `..`, `/`, atau `\`
(path traversal protection).

### 10. `statsManager` cache stale setelah restore
**File:** `utils/statsManager.js` + `utils/backupManager.js`

Sebelumnya, setelah `/restore-backup`, cache in-memory statsManager masih
berisi data lama. Saat periodic flush jalan, cache lama menimpa file
hasil restore → data restore hilang.

**Fix:** tambah `statsManager.reload()` yang invalidates cache.
`backupManager.restoreBackup` memanggilnya setelah selesai.

## MEDIUM

### 11. `scheduledAnnouncements.parseTime` tanpa range validation
**File:** `utils/scheduledAnnouncements.js`

Sebelumnya, admin bisa schedule announce `1000000d` (2739 tahun) ke depan
yang akan recurring forever dan bikin scheduler sibuk tanpa tujuan.

**Fix:**
  - Relative time: maks 365 hari
  - Absolute time: maks 5 tahun ke depan
  - Past time: reject

## Files Modified

| File | Changes |
|---|---|
| `handlers/commandHandler.js` | #1 (audit log masking), #5 (mention validation for /announce + /announce-schedule), #6 (giveaway @everyone removal), #2 (restore-backup confirmation), #3 (poll session in commandHandler) |
| `handlers/interactionHandler.js` | #2 (restore-backup confirm button handler), #3 (poll modal session lookup), #4 (ticket meta via getTicketMeta) |
| `utils/keyManager.js` | #7 (Math.max → loop) |
| `utils/pollManager.js` | #3 (in-memory session store with TTL) |
| `utils/ticketManager.js` | #4 (tickets.json store + backward compat fallback) |
| `utils/backupManager.js` | #8 (restore lock), #9 (pre-restore regex + path traversal), #10 (call stats.reload) |
| `utils/statsManager.js` | #10 (reload function) |
| `utils/scheduledAnnouncements.js` | #11 (parseTime range validation) |

## Compatibility

- **Backward compatible** dengan data v3.9.0:
  - Tiket lama (metadata di topic) tetap bisa di-close & set-key
  - Backup lama tetap bisa di-restore (format polos)
  - Stats cache lama otomatis reload saat bot restart
- **Tidak ada schema migration** yang perlu dijalankan manual
- `tickets.json` dibuat otomatis saat tiket baru dibuat (post-v3.9.1)

## Known Issues NOT Fixed (TODO v3.9.2+)

- TOCTOU race condition di giveaway join/poll vote (sudah ada lock per-user
  untuk tiket, tapi belum untuk giveaway/poll). Mitigated oleh `safeWriteJSON`
  atomic writes, tapi tetap bisa double-add kalau 2 klik <100ms.
- `permissions.isAdmin` baca config sync setiap call. Bisa di-cache dengan
  TTL pendek (60s) supaya tidak baca disk di setiap interaction.
- `tempVoiceManager` masih pakai sync I/O di hot path voiceStateUpdate.
  Bisa di-batch atau cache.
- `auditLog` log warning tapi tidak retry. Kalau channel audit-log sibuk,
  log bisa hilang.
