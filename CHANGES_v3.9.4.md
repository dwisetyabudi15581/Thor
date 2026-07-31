# v3.9.4 — Comprehensive Bug Fix Round + Interaction Reliability

Follow-up ke v3.9.3 (keyManager cross-guild wipe fix). Patch ini fokus pada:

1. **Reliability interaction**: graceful handling `DiscordAPIError[10008]: Unknown Message`
   yang muncul saat user menutup ephemeral reply sebelum bot sempat `editReply`.
2. **Cross-guild data isolation** untuk `stats.json` (CRITICAL — terlewat dari v3.9.0).
3. Beberapa HIGH bug yang ditemukan saat re-read codebase dari awal.

## Root Trigger

User melaporkan error saat `/tempvoice-remove`:

```
Interaction Error: DiscordAPIError[10008]: Unknown Message
    at handleErrors (.../@discordjs/rest/dist/index.js:791:13)
    ...
    at async Client.<anonymous> (/.../index.js:167:13) {
  rawError: { message: 'Unknown Message', code: 10008 },
  status: 404, method: 'PATCH',
  url: 'https://discord.com/api/v10/webhooks/.../messages/%40original'
```

**Penyebab**: `/tempvoice-remove` defer-reply ephemeral, lalu hapus banyak channel
(sequential await). Selama task berjalan (~3-5 detik), user sempat menutup pesan
ephemeral "Bot is thinking..." → Discord invalidate original message → `editReply`
PATCH 404. Error ini gaib ke global error handler dan muncul sebagai full stack trace.

**Fix**: setiap `editReply` sekarang di-wrap `safeEditReply()` yang fallback ke
`followUp` kalau original hilang. Global error handler juga klasifikasi 10008/10062/40060
sebagai warning ringan (bukan full stack).

---

## CRITICAL

### 1. `stats.json` cross-guild data leak
**File:** `utils/statsManager.js` + 5 caller files

**Skenario bug:**
- v3.9.0 menambahkan guildId filtering ke semua JSON store (warns, keys, schedules, dll)
- **TAPI** `stats.json` terlewat — key cuma `userId`, tanpa guildId
- `incrementMessages`, `recordPurchase`, `recordGiveawayWin`, `recordJoin`, `getStats`,
  `getTopUsers`, `getServerStats` semua operasi global
- `/stats` dan `/leaderboard` di Guild A menampilkan data dari Guild B

**Dampak:**
- Multi-guild deployment: revenue Guild A bocor ke Guild B
- Leaderboard cross-server (member Guild A bisa muncul di leaderboard Guild B)
- `vipPurchases` counter di-increment oleh transaksi di guild mana saja

**Fix:**
1. Cache key diganti dari `userId` → `${guildId}:${userId}` (composite, sama seperti `warns.json`)
2. Semua fungsi publik (`getStats`, `incrementMessages`, `recordPurchase`,
   `recordGiveawayWin`, `recordJoin`, `getTopUsers`, `getServerStats`) menerima
   parameter `guildId` sebagai argumen pertama
3. `getTopUsers(guildId, metric, limit)` dan `getServerStats(guildId)` filter dengan
   prefix `${guildId}:`
4. Auto-migration legacy entries: `init(defaultGuildId)` dipanggil dari `index.js`
   ClientReady. Legacy entries (key tanpa `:`) di-assign ke guild pertama (cukup
   untuk mayoritas case single-guild). Idempotent — entry yang sudah composite
   tidak diubah. Backfill `guildId`/`userId` fields ke entry lama untuk filtering.

**Migration:** otomatis. Bot pertama kali start setelah deploy v3.9.4 → legacy
entries di-stats.json di-re-key ke `${guildId}:${userId}`. Tidak ada intervensi
manual. Untuk multi-guild deployment, legacy entries di-assign ke guild pertama
yang terdaftar di cache client (`c.guilds.cache.first().id`) atau ke `GUILD_ID`
dari `.env` kalau di-set.

### 2. `safeReply.js` helper + global error handler classification
**File:** NEW `utils/safeReply.js` + `index.js` + `handlers/commandHandler.js` + `handlers/interactionHandler.js`

**Fix:**
1. **NEW** `utils/safeReply.js` — helper `safeEditReply(interaction, options)`:
   - Coba `interaction.editReply(options)`
   - Kalau `DiscordAPIError[10008]` (Unknown Message) atau `[10062]` (Unknown
     Interaction) atau `[40060]` (Interaction already acknowledged):
     fallback ke `interaction.followUp(options)` (bikin pesan baru)
   - Preserve ephemeral flag dari deferReply original
   - Kalau followUp juga gagal (token expired, >15 menit): silent return null
2. **`index.js`**: tambah `isIgnorableReplyError()` classifier — 10008/10062/40060
   di-log sebagai warning 1 baris (bukan full stack trace)
3. **`commandHandler.js`** + **`interactionHandler.js`**: SEMUA `interaction.editReply(`
   diganti dengan `safeEditReply(interaction,` (126 + 69 = 195 panggilan)

---

## HIGH

### 3. `ticket_close` & `ticket_set_key` masih parse channel topic (v3.9.1 regression)
**File:** `handlers/interactionHandler.js:131-135` + `186-190`

**Skenario bug:**
- v3.9.1 memindahkan ticket metadata dari channel topic ke `tickets.json`
- v3.9.1 menambahkan `getTicketMeta(channelId, topicFallback)` sebagai API resmi
- **TAPI** 2 button handler (`ticket_close` dan `ticket_set_key`) tidak di-update,
  masih parse topic dengan regex langsung
- Hanya modal submit handler (line 239) yang pakai `getTicketMeta`

**Dampak:**
- Kalau admin edit channel topic, `ticket_set_key` lookup product salah
- Admin tidak bisa deliver key untuk tiket tersebut
- `ticket_close` menampilkan tombol konfirmasi yang salah (transaksi vs help)

**Fix:** kedua handler sekarang pakai `getTicketMeta(interaction.channel.id, interaction.channel?.topic || '')`.

### 4. Temp voice orphan entries tidak pernah di-cleanup
**File:** `index.js:440-452` (handleCreateTempVoice)

**Skenario bug:**
- Admin manual delete temp voice channel (atau bot crash antara `delete()` dan `unregisterChannel()`)
- Entry tetap ada di `tempVoice.json` (orphan)
- Saat owner join trigger channel lagi:
  - `findChannelByOwner` return orphan ID
  - `guild.channels.cache.get(orphanId)` return undefined
  - `if (existingChannel)` false → skip ke "bikin channel baru"
  - **TAPI** orphan entry tidak dihapus
- Setiap join berikutnya bikin channel baru (leak), orphan tetap di JSON

**Dampak:**
- `tempVoice.json` bengkak dengan orphan entries
- User bisa punya 5+ ghost entries → panel menampilkan voice yang tidak ada

**Fix:** tambah `else` branch — kalau channel tidak ditemukan, `unregisterChannel`
orphan entry sebelum bikin channel baru.

### 5. Warn auto-action marked as "taken" meskipun gagal
**File:** `handlers/commandHandler.js:1655-1668`

**Skenario bug:**
- `member.timeout(...).catch(()=>{})` swallow error silent
- `markActionTaken(...)` dipanggil unconditional di baris berikutnya
- `warnManager.addWarn` cek `actionAlreadyTaken` (line 150) — cari warn sebelumnya
  dengan `actionTaken` value yang sama
- Setelah `mute_1h` di-mark (meskipun gagal), warn berikutnya di count 3 skip mute

**Dampak:**
- Kalau bot kagak punya `ModerateMembers` permission, timeout gagal
- Admin lihat "🔇 Auto-action: Timeout" (false positive)
- Warn berikutnya yang seharusnya re-trigger mute di-skip → user tidak pernah di-mute

**Fix:** `markActionTaken` hanya dipanggil kalau API call sukses. Kalau gagal,
`actionMsg` di-set ke "⚠️ Auto-action gagal: ..." supaya admin tahu ada masalah.

### 6. Auto-transfer voice ownership bisa ke bot
**File:** `index.js:370`

**Skenario bug:**
- `voiceChannel.members.filter(m => m.id !== oldOwnerId)` tidak exclude bot
- Kalau music bot ada di channel saat owner leave, bot bisa jadi owner baru
- Bot dapat `ManageChannels`/`MoveMembers` permission (tidak berguna)
- Bot di-DM "Kamu sekarang owner voice channel" (gagal silent)
- Real member yang seharusnya jadi owner di-skip

**Fix:** filter `!m.user.bot` di candidate list.

### 7. `restoreBackup` tidak invalidate permissions cache
**File:** `utils/backupManager.js:237-241`

**Skenario bug:**
- v3.9.1 menambahkan `statsManager.reload()` setelah restore
- **TAPI** tidak invalidate `permissions.js` admin role cache (TTL 30 detik)
- Setelah restore, `isAdmin(member)` masih pakai admin role ID LAMA
- Kalau backup punya admin role berbeda, admin lockout sampai 30 detik

**Dampak:**
- Admin tidak bisa pakai command admin (`/set-role admin`, `/config-show`) selama
  30 detik setelah restore — padahal command yang dipakai untuk fix juga admin-gated

**Fix:** panggil `invalidateAdminRoleCache()` setelah restore, bersamaan dengan `statsManager.reload()`.

### 8. `/config-show` menampilkan cross-guild stats
**File:** `handlers/commandHandler.js:343, 354`

**Skenario bug:**
- `getKeyStats()` return global count (semua guild)
- `getAllScheduledActive()` return global list (semua guild)
- `/config-show` di Guild A menampilkan key count dari Guild B

**Fix:**
- `keyManager.getStatsByGuild(guildId)` — variant baru, filter by guild
- `roleScheduler.getActiveByGuild(guildId)` — variant baru, filter by guild
- `/config-show` pakai variant guild-scoped

---

## MEDIUM

### 9. `safeReply.js` `IGNORABLE_REPLY_CODES` tidak konsisten
**File:** `utils/safeReply.js:37`

Comment mendokumentasikan 40060 sebagai ignorable, tapi `Set` tidak include. Fixed.

### 10. `/backup-list` age display "168h lalu" untuk backup 1 minggu
**File:** `handlers/commandHandler.js:1283`

Last branch dibagi 1440 (hari) tapi append `h lalu` (jam). Fixed ke `d lalu`.

---

## LOW

### 11. Audit log action labels missing
**File:** `utils/auditLog.js:26-68`

3 action tidak ada entry di `ACTION_LABELS`:
- `WARN_CLEAR_ALL` (line 1730 di commandHandler)
- `SETUP_TEMPVOICE` (line 1990)
- `TEMPVOICE_REMOVE` (line 2049)

Sebelumnya audit embed title fallback ke raw action string. Fixed: tambah label
untuk ketiganya.

---

## Files Modified

| File | Changes |
|---|---|
| **NEW** `utils/safeReply.js` | Helper `safeEditReply` dengan followUp fallback untuk 10008/10062/40060 |
| `utils/statsManager.js` | #1: composite key `guildId:userId` + `init()` migration + semua fungsi accept `guildId` |
| `utils/keyManager.js` | #8: tambah `getStatsByGuild(guildId)` |
| `utils/roleScheduler.js` | #8: tambah `getActiveByGuild(guildId)` |
| `utils/auditLog.js` | #11: tambah 3 missing action labels |
| `utils/backupManager.js` | #7: invalidate permissions cache setelah restore |
| `index.js` | #2: global error handler classification + apply safeEditReply pattern; #4: orphan temp voice cleanup; #6: bot filter di auto-transfer; call `statsManager.init()` di ClientReady |
| `handlers/commandHandler.js` | #2: 126 editReply → safeEditReply; #5: warn action only mark if success; #8: /config-show pakai guild-scoped variants; #10: backup-list age display fix |
| `handlers/interactionHandler.js` | #2: 69 editReply → safeEditReply; #3: ticket_close + ticket_set_key pakai getTicketMeta; #1 stats: recordPurchase accept guildId |
| `handlers/memberHandler.js` | #1: recordJoin accept guildId |
| `utils/schedulerTasks.js` | #1: trackGiveawayWin accept guildId |
| `package.json` | Version bump ke 3.9.4 |

## Compatibility

- **Backward compatible** dengan data v3.9.3:
  - `stats.json` legacy entries (key tanpa `:`) auto-migrate ke guild pertama
  - `keys.json` legacy entries (tanpa guildId) tetap berfungsi
  - `scheduledRoles.json` legacy entries tetap berfungsi
- **Tidak ada schema migration manual** yang perlu dijalankan
- **Tidak ada config baru** yang perlu di-set
- Behavior change: `/stats`, `/leaderboard`, `/my-stats`, `/config-show` sekarang
  scoped ke guild pemanggil. Untuk single-guild deployment, tidak ada perubahan
  yang terlihat. Untuk multi-guild, data tidak lagi bocor antar guild.

## How to Verify the Fixes

### Fix #1: stats.json guild isolation
1. Setelah deploy, jalankan `/stats` — pastikan count sama dengan sebelumnya
   (untuk single-guild deployment)
2. Cek `stats.json` — entry baru harus punya format key `guildId:userId`
3. Cek `console` saat bot start — harus ada log "🔄 stats.json: N legacy entry di-migrate"

### Fix #2: safeEditReply
1. Jalankan command yang punya deferReply + long task (e.g., `/tempvoice-remove`,
   `/backup-now`, `/restore-backup`)
2. Setelah deferReply muncul (ephemeral "Bot is thinking..."), tutup ephemeral
   reply sebelum command selesai
3. **Sebelum v3.9.4**: error `DiscordAPIError[10008]` di console (full stack)
4. **Sesudah v3.9.4**: warning 1 baris "Interaction reply gagal" + user tetap
   terima konfirmasi via followUp message

### Fix #3: ticket metadata
1. Buka tiket transaksi
2. Edit channel topic (ubah Product name)
3. Klik tombol Set Key
4. **Sebelum v3.9.4**: "Produk tidak ditemukan" error
5. **Sesudah v3.9.4**: product lookup pakai `tickets.json` (benar)

### Fix #5: warn auto-action
1. Set bot tanpa `ModerateMembers` permission
2. Warn user 3 kali
3. **Sebelum v3.9.4**: "🔇 Auto-action: Timeout" (padahal gagal)
4. **Sesudah v3.9.4**: "⚠️ Auto-action gagal: Missing Permissions"
5. Warn ke-4 (count 4) akan tetap trigger mute attempt (sebelumnya di-skip)

## Root Cause Analysis

**Kenapa stats.json terlewat dari v3.9.0 cross-guild fix?**

v3.9.0 fokus pada JSON store yang terlihat "user-facing" (warns, keys, schedules).
`stats.json` dianggap "internal tracking" yang tidak critical untuk guild scoping.
Padahal, `/stats` dan `/leaderboard` adalah command publik yang menampilkan data
ini ke admin/user — sehingga cross-guild leak sama berbahayanya.

**Kenapa ticket_close/ticket_set_key terlewat dari v3.9.1 ticket metadata fix?**

v3.9.1 menambahkan `getTicketMeta()` dan mengupdate modal submit handler (yang
paling jelas terpengaruh). Dua button handler lain (`ticket_close`,
`ticket_set_key`) juga parse topic tapi tidak di-update karena tidak terlihat
dari grep pattern yang dipakai saat itu. Lesson: saat refactor shared logic,
grep untuk SEMUA penggunaan pattern lama, bukan hanya tempat yang jelas.

**Kenapa warn auto-action bug tidak ketemu sebelumnya?**

Bug ini silent — `markActionTaken` tetap jalan, `actionMsg` tetap bilang "Auto-action:
Timeout". Hanya kalau admin perhatikan bahwa user sebenarnya tidak di-timeout,
bug ini ketahuan. Sebelum v3.9.4, tidak ada test yang verify bahwa Discord API
call benar-benar sukses sebelum mark action. Lesson: jangan swallow error dengan
`.catch(()=>{})` kalau side effect berikutnya mengasumsikan sukses.
