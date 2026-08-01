# v3.9.7 — Hotfix: Embed Builder Send Button Crash

Hotfix untuk v3.9.6. Saat user klik **Send** di Embed Builder, bot crash dengan
`ExpectedConstraintError` karena label TextInput melebihi batas 45 karakter
Discord. Ini menyebabkan cascading error `InteractionNotReplied` juga.

## Bug Report

User jalankan `npm start` di v3.9.6, lalu coba Embed Builder → klik Send:

```
Interaction Error: DiscordjsError [InteractionNotReplied]: The reply to this
interaction has not been sent or deferred.
    at ModalSubmitInteraction.editReply (...)
    at safeEditReply (.../utils/safeReply.js:48:34)
    at handleEmbedBuilderModal (.../interactionHandler.js:1224:12)
    ...

Interaction Handler Error: ExpectedConstraintError > s.string().lengthLessThanOrEqual()
Invalid string length
Expected: expected.length <= 45
Received: 'Pesan di luar embed (opsional, support @everyone / \\n)'
    at TextInputBuilder.setLabel (.../interactionHandler.js:429:26)
```

## Root Cause Analysis

### Error 1: `ExpectedConstraintError` (primary)

Discord API membatasi `TextInputBuilder.setLabel()` ke **maksimal 45 karakter**.
Label yang saya tulis di v3.9.6:

```
'Pesan di luar embed (opsional, support @everyone / \\n)'
```

Panjang: **54 karakter** (melebihi batas 9 karakter).

Error ini throw **synchronously** saat `setLabel()` dipanggil, **sebelum**
`interaction.showModal()` jalan. Akibatnya:

1. `setLabel()` throw `ExpectedConstraintError`
2. Error propagate ke global error handler di `index.js`
3. Button interaction (klik Send) **tidak pernah di-acknowledge**
4. Discord menampilkan "The application did not respond" ke user
5. Modal tidak pernah terbuka

### Error 2: `InteractionNotReplied` (cascading)

Setelah error 1, user mungkin masih punya modal lama yang cached di Discord
client (mis. dari session sebelumnya yang belum di-submit). Saat user submit
modal lama itu:

1. `handleEmbedBuilderModal` di-trigger
2. `await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {})`
3. `deferReply` **gagal** (kemungkinan interaction token sudah expired karena
   modal terbuka >15 menit, atau interaction invalid karena berasal dari
   session yang sudah tidak ada)
4. `.catch(() => {})` **menelan error senyap** — tidak ada log
5. Code lanjut ke `safeEditReply(interaction, { content: '✅ Embed diupdate.' })`
6. `safeEditReply` → `interaction.editReply()` throw `InteractionNotReplied`
   karena interaction belum pernah di-acknowledge
7. `InteractionNotReplied` error code adalah string `'InteractionNotReplied'`,
   bukan angka — tidak ada di `IGNORABLE_REPLY_CODES` Set
8. `safeEditReply` re-throw error ke global handler
9. Full stack trace muncul di log

## Fix

### Fix 1: Shorten Label & Placeholder (`handlers/interactionHandler.js`)

**modal_send message field:**

| Field | Before | After | Limit |
|-------|--------|-------|-------|
| Label | `Pesan di luar embed (opsional, support @everyone / \n)` (54 char) | `Pesan di luar embed (opsional, support @)` (41 char) | 45 |
| Placeholder | `Kosongkan = kirim embed saja. Isi = kirim teks + embed.\nSupport @everyone, @here, <@&role_id>, <@user_id>` (105 char) | `Kosongkan = embed saja. Isi = teks + embed.\nSupport @everyone, @here, <@&role>, <@user>` (87 char) | 100 |

**modal_message field:**

| Field | Before | After | Limit |
|-------|--------|-------|-------|
| Label | `Pesan di luar embed (kosongkan untuk hapus)` (43 char) | (tidak berubah, sudah OK) | 45 |
| Placeholder | `Halo semua! Cek pengumuman di bawah ya ⬇️\nSupport newline, @everyone, @here, <@&role_id>, <@user_id>` (100 char) | `Teks pengantar di luar embed.\nSupport @everyone, @here, mention` (63 char) | 100 |

**Audit lengkap:** semua `setLabel` dan `setPlaceholder` calls di
`interactionHandler.js` dan `commandHandler.js` sudah di-check. Tidak ada lagi
yang melebihi batas Discord.

### Fix 2: `safeEditReply` Handle `InteractionNotReplied` (`utils/safeReply.js`)

Sebelum v3.9.7, `safeEditReply` hanya handle error codes numerik
(`10008`, `10062`, `40060`). `InteractionNotReplied` punya string code
`'InteractionNotReplied'` yang tidak ter-handle, jadi di-throw ke caller.

Sekarang `safeEditReply` detect `InteractionNotReplied` dan fallback ke
`interaction.reply()`:

```javascript
async function safeEditReply(interaction, options) {
    try {
        return await interaction.editReply(options);
    } catch (err) {
        // v3.9.7: InteractionNotReplied — deferReply gagal senyap
        if (err.code === 'InteractionNotReplied') {
            try {
                const replyOptions = { ...options };
                if (replyOptions.flags === undefined) {
                    replyOptions.flags = MessageFlags.Ephemeral;
                }
                return await interaction.reply(replyOptions);
            } catch (_) {
                return null; // token expired total, tidak bisa apa-apa
            }
        }

        if (!IGNORABLE_REPLY_CODES.has(err.code)) {
            throw err;
        }
        // ... existing followUp fallback
    }
}
```

**Kenapa `reply()` bukan `followUp()`?** `InteractionNotReplied` berarti
interaction belum di-acknowledge sama sekali. `followUp()` butuh acknowledgment
dulu — kalau belum ada, followUp juga gagal. `reply()` adalah satu-satunya
yang bisa jalan untuk interaction yang belum di-acknowledge (selama token
belum expired total).

**Default ephemeral:** semua caller `safeEditReply` di codebase ini pakai
`deferReply({ flags: MessageFlags.Ephemeral })`. Jadi kalau `options.flags`
tidak specify, kita default ke `MessageFlags.Ephemeral` di fallback `reply()`.

### Fix 3: Log `deferReply` Failure (`handlers/interactionHandler.js`)

Sebelum v3.9.7, `deferReply` failure di-telan senyap:

```javascript
await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
```

Sekarang failure di-log:

```javascript
await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(err => {
    console.warn(`[Embed Builder Modal] deferReply gagal untuk ${interaction.customId}: ${err.message}`);
});
```

Ini tidak mengubah behavior — `safeEditReply` masih fallback ke `reply()`
secara otomatis. Tapi sekarang admin bisa lihat di log kenapa konfirmasi
ephemeral mungkin tidak muncul (mis. "token expired", "interaction already
acknowledged", dll).

Dua lokasi yang di-update:
1. `handleEmbedBuilderModal` (line ~990) — modal submit embed builder
2. Modal set key submit (line ~222) — modal submit set key di ticket

## Discord API Limits Reference

Untuk `TextInputBuilder` (modal components):

| Field | Min | Max | Source |
|-------|-----|-----|--------|
| `customId` | 1 | 100 | Discord API docs |
| `label` | 1 | **45** | Discord API docs |
| `placeholder` | 0 | **100** | Discord API docs |
| `value` (default) | 0 | 4000 | Discord API docs |
| `minLength` | 0 | 4000 | Discord API docs |
| `maxLength` | 1 | 4000 | Discord API docs |

Untuk `ModalBuilder`:

| Field | Min | Max | Source |
|-------|-----|-----|--------|
| `title` | 1 | **45** | Discord API docs |
| `customId` | 1 | 100 | Discord API docs |

Untuk `StringSelectMenuBuilder` options:

| Field | Min | Max | Source |
|-------|-----|-----|--------|
| `label` | 1 | **100** | Discord API docs |
| `description` | 0 | **100** | Discord API docs |
| `value` | 1 | 100 | Discord API docs |

## Prevention

Untuk mencegah bug serupa di masa depan:

1. **Selalu hitung panjang string** sebelum pass ke `setLabel` / `setPlaceholder`
2. **Audit otomatis:** script Node.js sederhana bisa scan semua `setLabel` /
   `setPlaceholder` calls dan verify length (saya sudah jalankan untuk
   codebase ini — semua OK setelah fix)
3. **Test sebelum push:** buka modal di Discord test server untuk verify
   tidak ada `ExpectedConstraintError`

## Files Changed

- `package.json` — version bump ke 3.9.7
- `CHANGELOG.md` — entry v3.9.7
- `utils/safeReply.js` — tambah handling `InteractionNotReplied` (fallback ke `reply()`)
- `handlers/interactionHandler.js`:
  - Fix label & placeholder modal_send message field
  - Fix placeholder modal_message
  - Log deferReply failure (2 lokasi: embed builder modal + set key modal)

## Testing

```bash
node --check utils/safeReply.js
node --check handlers/interactionHandler.js
node --check handlers/commandHandler.js
```

Verifikasi syntax pass. Functional test manual di Discord:

1. `/embed-builder` → klik Send → modal harus terbuka (tidak crash)
2. Isi channel + message → submit → embed + message terkirim ke channel
3. Buka modal, biarkan terbuka >15 menit, submit → bot harus tetap reply
   (fallback ke `reply()`) dengan pesan "✅ Embed diupdate" atau error yang
   jelas, bukan stack trace `InteractionNotReplied`
4. Pilih opsi "Message (plain text)" di dropdown → modal harus terbuka
   (tidak crash)
