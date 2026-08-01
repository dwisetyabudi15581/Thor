# v3.9.5 — NEW `/send-message` Command

Patch kecil yang menambahkan fitur baru tanpa breaking changes. Pelengkap
`/announce` untuk skenario dimana admin ingin kirim plain text biasa ke text
channel (bukan embed).

## Latar Belakang

Bot sebelumnya punya 2 cara kirim pesan ke channel:

1. `/announce` — kirim **embed** (judul + deskripsi + warna + gambar).
2. `/embed-builder` — interactive builder untuk embed kompleks.

Tidak ada cara untuk kirim **plain text biasa**. Admin harus pakai workaround:

- Pakai `/announce` dengan title kosong → embed tetap muncul dengan border
  warna, terlihat tidak natural untuk chat kasual.
- Atau admin ketik manual di channel (tapi kalau channel restricted hanya
  untuk bot, admin tidak bisa).

`/send-message` mengisi gap ini: kirim plain text dengan styling default
Discord (seperti pesan user biasa), tapi tetap dengan admin permission check
dan audit log.

## Implementasi

### Command Definition (`utils/commandDefinitions.js`)

```javascript
{
    name: 'send-message',
    description: 'Kirim plain text message ke text channel (support \\n & mention)',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
    options: [
        { type: 7, name: 'channel', description: 'Channel tujuan (harus text channel)', required: true },
        { type: 3, name: 'message', description: 'Isi pesan (support \\n untuk newline). Maks 2000 char.', required: true },
        { type: 3, name: 'mention', description: 'Mention: @everyone, @here, atau <@&role_id> / <@user_id>', required: false }
    ]
}
```

### Handler (`handlers/commandHandler.js`)

Validasi yang dilakukan sebelum pesan dikirim:

1. **Channel type** — `channel.type === 0` (GuildText). Reject voice,
   category, forum, announcement thread, dll. Discord slash command option
   `type: 7` sebenarnya sudah filter ke channel, tapi type 7 includes voice
   channel juga jadi kita cek eksplisit.
2. **Channel exists in guild cache** — `interaction.guild.channels.cache.get(channel.id)`.
   Interaction option bisa stale kalau channel baru saja dihapus.
3. **Bot permission** — cek `SendMessages` permission untuk bot di channel
   tujuan. Kalau tidak ada, beri pesan error yang actionable.
4. **Message length** — `message.length > DISCORD_LIMITS.MESSAGE_CONTENT` (2000 char).
   Discord API akan reject dengan 400 Bad Request kalau lebih.
5. **Message not empty** — `message.trim().length === 0 && !mention` → reject.
6. **Mention format** — regex validation sama seperti `/announce`:
   - `@everyone` / `everyone`
   - `@here` / `here`
   - `<@&ROLE_ID>` (17-20 digit)
   - `<@USER_ID>` atau `<@!USER_ID>` (17-20 digit)

   Selain format di atas → reject. Mencegah admin nggak sengaja kirim string
   yang mengandung `@` yang bisa trigger mention yang tidak diinginkan.

### Mention Placement

Mention diletakkan di depan, dipisahkan newline dari body:

```
@everyone
Ini pengumuman... body pesan...
```

Ini lebih natural daripada menempel mention di akhir (seperti yang dilakukan
`/announce`). Untuk `/announce` mention dipisah dari embed karena memang
content dan embeds adalah field terpisah di Discord API.

### Audit Log

Action `SEND_MESSAGE` dicatat dengan format:

```
Kirim plain text message ke #channel-name | mention: @everyone | 142 char
```

Tanpa mention, field `| mention: ...` di-skip.

### Reply ke Admin

Setelah kirim, bot reply ephemeral dengan preview:

```
✅ Pesan terkirim ke #general!

📋 **Preview:**
```
@everyone
Ini pesan test...
```
```

Preview dibungkus code block supaya newline dan format tampil persis seperti
yang dikirim. Kalau pesan > 1500 char, preview dipotong dengan suffix
`...*(pesan dipotong untuk preview)*` untuk avoid ephemeral reply overflow.

## Use Cases

1. **Pengumuman kasual** — `Halo semua, hari ini maintenance jam 22:00 ya` —
   tidak perlu embed styling, terlihat seperti chat admin biasa.
2. **Reminder cepat** — `Reminder: event weekend mulai besok!` — lebih
   ringan daripada bikin embed.
3. **Bot system message** — di channel yang restricted hanya untuk bot
   (`#announcements`, `#rules`), admin bisa kirim teks tanpa perlu switch
   ke channel tersebut.
4. **Trigger mention** — `mention:@everyone` + pesan singkat untuk ping
   seluruh guild tanpa styling embed yang berat.

## Perbandingan dengan `/announce`

| Aspek | `/announce` | `/send-message` |
|-------|-------------|-----------------|
| Format | Embed (judul + deskripsi + warna + gambar) | Plain text biasa |
| Limit | Description 4096 char | Message 2000 char |
| Styling | Border warna, timestamp, footer | Tidak ada (default Discord) |
| Cocok untuk | Pengumuman formal, pengumuman dengan gambar | Chat kasual, reminder cepat |
| Mention support | ✅ | ✅ |
| Audit log action | `ANNOUNCE_SEND` | `SEND_MESSAGE` |

## Files Changed

- `package.json` — version bump ke 3.9.5
- `CHANGELOG.md` — entry v3.9.5
- `utils/commandDefinitions.js` — tambah definisi `/send-message`
- `handlers/commandHandler.js` — tambah handler `/send-message` + update `/help`
- `CHANGES_v3.9.5.md` — file ini

## Testing

```bash
node --check utils/commandDefinitions.js
node --check handlers/commandHandler.js
```

Verifikasi syntax pass. Functional test dilakukan manual di Discord:

1. `/send-message channel:#general message:Halo` → kirim plain text "Halo" ke
   #general.
2. `/send-message channel:#general message:"Baris 1\nBaris 2"` → kirim dengan
   newline.
3. `/send-message channel:#voice-chat message:Test` → reject dengan error
   "Channel harus berupa text channel".
4. `/send-message channel:#general message:Test mention:@everyone` → kirim
   dengan ping everyone.
5. `/send-message channel:#general message:Test mention:halo` → reject dengan
   error format mention tidak valid.
