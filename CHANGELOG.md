# Changelog

Semua perubahan penting pada bot ini akan didokumentasikan di file ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), dan
versi mengikuti [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.9.7] — 2026-08-01

### CRITICAL
- **Fix `ExpectedConstraintError` saat klik Send di Embed Builder** — label TextInput `'Pesan di luar embed (opsional, support @everyone / \\n)'` panjangnya 54 char, melebihi batas Discord 45 char untuk `setLabel`. Akibatnya `showModal()` throw synchronously, button interaction tidak di-acknowledge, dan user lihat "The application did not respond". Fix: label dipersingkat ke 41 char `'Pesan di luar embed (opsional, support @)'`. Placeholder juga dipersingkat dari 105 → 87 char (limit 100).
- **Fix `InteractionNotReplied` cascading error** — root cause dari error di atas. Saat `showModal()` gagal, kadang Discord masih fire modal submit event (dari modal lama yang cached di client). `handleEmbedBuilderModal` lalu `deferReply()` yang gagal senyap (`.catch(() => {})`), lalu `safeEditReply` → `editReply` throw `InteractionNotReplied` karena interaction belum di-acknowledge. Fix: `safeEditReply` sekarang detect `InteractionNotReplied` dan fallback ke `interaction.reply()`. Juga, `.catch(() => {})` di deferReply diganti dengan `.catch(err => console.warn(...))` supaya failure tidak gaib.

### MEDIUM
- Fix placeholder `emb_modal_message` yang panjangnya 100 char (tepat di limit Discord). Dipersingkat ke 63 char untuk safety margin.
- Audit semua `setLabel` dan `setPlaceholder` calls di codebase — tidak ada lagi yang melebihi batas Discord (45 char untuk label, 100 char untuk placeholder).

## [3.9.6] — 2026-08-01

### Added
- **Embed Builder: opsi "💬 Message (plain text)"** — kini embed builder bisa kirim plain text message + embed dalam 1 message Discord. Cocok untuk teks pengantar (mis. "Halo semua, cek pengumuman di bawah ⬇️"), @everyone / @here ping yang harus berada di content (bukan di embed) supaya trigger ping, atau mention role/user spesifik.
  - Pilih opsi "Message (plain text)" di dropdown builder → buka modal input teks (maks 2000 char, support `\n` newline).
  - Saat klik **Send**, modal kirim sekarang punya 2 field: channel + message. Field message di-pre-fill dengan teks yang sudah diset, bisa di-edit cepat sebelum kirim.
  - Preview ephemeral menampilkan plain text message (di code block) + embed, supaya admin bisa lihat bagaimana keduanya akan tampil saat dikirim.
  - Validasi mention sama ketatnya dengan `/announce` dan `/send-message`: hanya `@everyone`/`@here`/`<@&ROLE_ID>`/`<@USER_ID>` yang diperbolehkan. Mention format lain (mis. `@halo`, `@admin`) akan ditolak dengan pesan error yang menjelaskan format valid.
  - Audit log `EMBED_BUILDER_SEND` sekarang include info `+message (X char)` kalau message ikut dikirim.
  - `/embed-list` sekarang menampilkan indikator `msg (X char)` di summary session.
  - Tips di control panel draft diupdate supaya admin tahu fitur message tersedia.

## [3.9.5] — 2026-08-01

### Added
- **NEW `/send-message` command** — kirim plain text message ke text channel (pelengkap `/announce` yang kirim embed). Cocok untuk pengumuman kasual, chat bot, atau teks yang tidak perlu styling embed.
  - Options: `channel` (text channel, required), `message` (string, required, maks 2000 char, support `\n` untuk newline), `mention` (opsional: `@everyone`/`@here`/`<@&ROLE_ID>`/`<@USER_ID>`)
  - Validasi ketat: channel harus `GuildText` (bukan voice/category/forum), cek permission bot `SendMessages`, mention divalidasi dengan regex yang sama seperti `/announce` (mencegah injection mention yang tidak diinginkan)
  - Audit log: action `SEND_MESSAGE` dicatat dengan channel, mention, dan panjang pesan
  - Reply ephemeral dengan preview pesan yang sudah dikirim (potong jika > 1500 char)

## [3.9.4] — 2026-08-01

### CRITICAL
- **Fix `stats.json` cross-guild data leak** — bug terlewat dari v3.9.0. `stats.json` key cuma `userId` (tanpa guildId), sehingga `/stats`, `/leaderboard`, `/my-stats` menampilkan data dari semua guild. Fix: composite key `${guildId}:${userId}` + auto-migration legacy entries via `statsManager.init(defaultGuildId)` di ClientReady.
- **Fix `DiscordAPIError[10008]: Unknown Message` saat editReply** — terjadi saat user menutup ephemeral reply sebelum bot sempat editReply (terutama setelah long task seperti `/tempvoice-remove`). Fix: NEW `utils/safeReply.js` helper dengan followUp fallback; semua `interaction.editReply` di commandHandler (126 panggilan) dan interactionHandler (69 panggilan) diganti dengan `safeEditReply`. Global error handler di `index.js` klasifikasi 10008/10062/40060 sebagai warning ringan.

### HIGH
- **Fix `ticket_close` & `ticket_set_key` masih parse channel topic** — v3.9.1 regression. v3.9.1 menambahkan `getTicketMeta()` tapi 2 button handler tidak di-update. Fix: pakai `getTicketMeta(interaction.channel.id, topic)` sebagai sumber utama.
- **Fix Temp voice orphan entries tidak pernah di-cleanup** — saat admin manual delete channel, entry tetap di `tempVoice.json`. Setiap join trigger berikutnya bikin channel baru (leak). Fix: tambah `else` branch di `handleCreateTempVoice` untuk `unregisterChannel` orphan.
- **Fix Warn auto-action marked "taken" meskipun gagal** — `markActionTaken` dipanggil unconditional bahkan kalau `member.timeout()` throw. Akibatnya, warn berikutnya yang seharusnya re-trigger mute di-skip. Fix: hanya `markActionTaken` kalau API call sukses.
- **Fix Auto-transfer voice ownership bisa ke bot** — `voiceChannel.members.filter` tidak exclude bot account. Fix: tambah `!m.user.bot` di filter.
- **Fix `restoreBackup` tidak invalidate permissions cache** — TTL 30 detik untuk admin role ID masih pakai config lama setelah restore. Fix: panggil `invalidateAdminRoleCache()` bersamaan dengan `statsManager.reload()`.
- **Fix `/config-show` menampilkan cross-guild stats** — `getKeyStats()` dan `getAllScheduledActive()` return global count. Fix: tambah `getStatsByGuild(guildId)` dan `getActiveByGuild(guildId)` variants.

### MEDIUM
- Fix `safeReply.js` `IGNORABLE_REPLY_CODES` tidak konsisten (40060 documented tapi tidak di Set)
- Fix `/backup-list` age display "168h lalu" untuk backup 1 minggu (seharusnya "7d lalu")

### LOW
- Tambah 3 missing audit log action labels: `WARN_CLEAR_ALL`, `SETUP_TEMPVOICE`, `TEMPVOICE_REMOVE`

## [3.9.3] — 2026-07-31

### CRITICAL
- **Fix `removeAllKeysByUser(userId, guildId)` silently menghapus 0 key** — bug sejak v3.9.0. `keys.json` tidak menyimpan `guildId` per key, jadi filter `k.guildId === guildId` tidak pernah match. Akibatnya `/clear-schedule clear_keys:true` tidak menghapus key apa pun padahal admin mengira VIP sudah di-reset. Fix: `addKey` sekarang simpan `guildId`; `removeAllKeysByUser` backward compat (key lama tanpa guildId juga dihapus kalau guildId di-pass).

### MEDIUM
- **Validasi panjang title/description di `/announce` & `/announce-schedule`** — sebelumnya, title > 256 atau description > 4096 char menyebabkan `EmbedBuilder` throw `RangeError` yang ditangkap sebagai "Terjadi error" generik. Untuk `/announce-schedule`, error terjadi saat scheduled time (bukan saat command dijalankan) → entry stuck di `scheduledAnns.json`. Fix: validasi eksplisit sebelum build embed.

## [3.9.2] — 2026-07-31

### Added
- `utils/userLock.js` — per-user in-process lock utility untuk mencegah TOCTOU race condition
- Retry 1x dengan delay 500ms di `utils/auditLog.js` untuk error transient (rate limit, network blip)
- Validasi panjang title (256), description (4096), field name (256), field value (1024) di embed builder modal submission — defense-in-depth walau modal sudah setMaxLength
- TTL cache 30 detik untuk admin role ID di `utils/permissions.js` — kurangi disk I/O di setiap interaction
- `invalidateAdminRoleCache()` — dipanggil otomatis saat `/set-role admin` atau `/remove-role admin`
- File `CHANGELOG.md` ini
- `.env.example` diperluas dengan catatan keamanan & cara dapat Guild ID

### Changed
- `package.json` version bump ke 3.9.2
- `README.md` diupdate untuk refleksikan v3.9.x changes:
  - Update header version
  - Tambah section atomic JSON writes
  - Tambah mention validation di `/announce`
  - Tambah range validation di `/announce-schedule`
  - Update `/restore-backup` description (2-step confirmation + reload cache)
  - Update `/reset-config` description (2-step confirmation)
  - Tambah section "Apa yang Baru di v3.9.x" di changelog
- `ADMIN_GUIDE.md` diupdate:
  - Update header version ke 3.9.2
  - Tambah section 10 "Apa yang Baru di v3.9.x"
  - Update section Backup & Restore dengan flow 2-step confirmation
  - Update section Announce dengan format mention yang valid
  - Tambah troubleshooting untuk pesan "klik terlalu cepat"
  - Tambah troubleshooting untuk audit log retry

### Fixed
- **TOCTOU race condition di giveaway join/leave** — 2 klik cepat (<100ms) sebelumnya bisa lolos cek `includes()` keduanya lalu keduanya push userId → participant dobel. Sekarang di-wrap per-user lock.
- **TOCTOU race condition di poll vote** — 2 klik cepat di option yang sama (multiple=false) sebelumnya bisa toggle ON lalu toggle OFF → vote hilang padahal user merasa sudah vote. Sekarang di-wrap per-user lock.
- **`permissions.isAdmin` baca config sync di setiap call** — sebelumnya 50-100 disk read/detik untuk server aktif. Sekarang di-cache 30 detik, invalidate saat admin role berubah.
- **`auditLog.logAudit` silent failure** — sebelumnya, satu error transient langsung bikin audit log hilang. Sekarang di-retry 1x.

## [3.9.1] — 2026-07-31

### CRITICAL
- **Mask key di audit log** — sebelumnya `key.slice(0, 8) + '...'` bocor 8 char pertama key ke channel audit-log. Sekarang ganti dengan `***` + panjang key saja.
- **2-step confirmation untuk `/restore-backup`** — sebelumnya langsung overwrite semua JSON file tanpa konfirmasi. Sekarang admin harus klik tombol "Ya, Restore Sekarang" dulu.
- **Poll modal customId overflow 100-char Discord limit** — sebelumnya `poll_modal_create:<channelId>:<multiple>:<encodeURIComponent(question)>`. Kalau question panjang, Discord API reject modal-nya. Sekarang pakai in-memory session store dengan TTL 5 menit.
- **Tiket metadata pindah dari channel topic ke `tickets.json`** — sebelumnya di channel topic yang bisa di-edit admin (spoofable) dan dibatasi 1024 char. Sekarang di JSON file dengan backward compat fallback ke topic parsing untuk tiket lama.

### HIGH
- **Validasi mention ketat di `/announce` & `/announce-schedule`** — sebelumnya admin bisa oper string bebas yang bisa trigger ping tidak diinginkan. Sekarang hanya `@everyone`, `@here`, `<@&ROLE_ID>`, `<@USER_ID>` yang diterima.
- **Hapus hardcoded `@everyone` ping di giveaway creation** — sebelumnya setiap giveaway baru otomatis ping `@everyone`. Sekarang admin yang mau ping pakai `/announce` terpisah.
- **`Math.max(...spread)` diganti loop di `keyManager.getMaxExpireAtByUserAndRole`** — anti RangeError pada kasus ekstrim dengan ratusan key aktif.
- **Restore lock di `backupManager.restoreBackup`** — anti concurrent restore yang bisa corrupt data.
- **Pre-restore backup sekarang bisa di-restore** — sebelumnya muncul di `/backup-list` tapi tidak bisa di-restore (regex mismatch). Sekarang regex di-update + path traversal guard.
- **`statsManager.reload()` di-call setelah restore** — sebelumnya cache in-memory bisa overwrite data hasil restore saat periodic flush jalan.

### MEDIUM
- **Range validation `parseTime` di `scheduledAnnouncements`** — maks 365 hari untuk relative time, maks 5 tahun untuk absolute time, reject past time.

## [3.9.0] — 2026-07-31

### CRITICAL
- **Atomic write via `safeWriteJSON`** — pattern `tmp + rename` untuk semua 9 JSON store (config, keys, scheduledRoles, selfRoles, giveaways, polls, warns, stats, scheduledAnns, tempVoice). Anti corrupt kalau bot crash / OOM / power loss saat write.
- **`/clear-schedule` di-scope per guild** — sebelumnya hapus schedule user di SEMUA guild. Sekarang hanya di guild tempat command dijalankan.
- **2-step confirmation untuk `/reset-config`** — sebelumnya langsung hapus SEMUA setting tanpa konfirmasi. Sekarang admin harus klik tombol konfirmasi dulu.
- **Prototype pollution guard di `configManager.setField`** — reject path yang mengandung `__proto__`, `constructor`, `prototype`.

### HIGH
- **`warnManager` keyed by `(guildId, userId)`** — sebelumnya keyed by `userId` saja (bocor cross-guild). Sekarang di-scope per guild + auto-migration dari format lama.
- **`processExpiredRole` tidak hapus schedule pada transient error** — sebelumnya, error transient (mis. Discord API 5xx) bikin schedule dihapus padahal role masih ada. Sekarang schedule tetap di-retry.
- **Ghost loop fix untuk recurring announcements** — sebelumnya, kalau channel tujuan dihapus, recurring announcement tetap jalan forever (next fire tiap interval). Sekarang di-cancel otomatis.
- **Exclusive mode di self-role select** — sebelumnya, `exclusive: true` di select menu tidak benar-benar eksklusif (role lain tetap bisa dipilih). Sekarang role lain otomatis dilepas.
- **`/clear-schedule` skip-write optimization** — kalau tidak ada schedule yang perlu dihapus, skip write ke disk.

### MEDIUM
- **`memberHandler` skip bots** — sebelumnya, bot yang join/leave server trigger welcome/goodbye message. Sekarang di-skip.
- **`memberHandler` single `fetchAuditLogs` call** — sebelumnya, 2 call (kick + ban check) yang redundan. Sekarang 1 call saja.

## [3.8.5] — Temp Voice Global Panel

### Added
- Panel global: menampilkan daftar semua voice aktif (bukan focused owner/personal)
- Button Info Room — lihat detail voice room (ephemeral)
- Auto-transfer ownership saat owner leave dan masih ada member lain

### Changed
- Switch select: semua user bisa lihat info room (bukan owner-only)
- Lock button: toggle otomatis (1 tombol, bukan 2)
- Buat voice hanya via join trigger channel "🔊 Buat Voice" (hapus button dari panel)

### Fixed
- Audit log action mismatch (SETUP_SELFROLE → SETUP_TEMPVOICE)

## [3.7] — Stability & Code Quality Release

### Added
- Refactor besar: index.js dipecah jadi 3 file (commandHandler, interactionHandler, memberHandler)
- Audit log coverage: 14 action missing ditambahkan (total 24 action types)

### Fixed
- Bug fix race condition tiket, validasi input, ~20 perbaikan code quality

## [3.6] — Temp Voice removed
- Seluruh fitur Temp Voice dihapus (diperbaiki ulang di v3.8.5)

## [3.5] — Critical bug fixes
- statsManager caching, scheduler overlap guard, giveaway end/reroll, rollback zombie entries

## [3.2] — audit, backup, giveaway, scheduled ann, warn, stats, poll

## [3.0] — key-driven + self-role

## [2.0] — Welcome/Goodbye, Verify, Ticket, Invoice, fully configurable

## [1.0] — Versi awal

---

**Legend:**
- **CRITICAL** — bug yang bisa cause data loss, security breach, atau crash
- **HIGH** — bug yang cause incorrect behavior atau poor UX
- **MEDIUM** — improvement yang tidak critical tapi nice to have
- **Added** — fitur baru
- **Changed** — perubahan pada existing functionality
- **Fixed** — bug fix
