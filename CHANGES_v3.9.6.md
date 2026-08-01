# v3.9.6 — Embed Builder: Plain Text Message Support

Patch kecil yang menambahkan fitur "💬 Message (plain text)" ke Embed Builder.
Sekarang admin bisa kirim plain text message + embed dalam 1 message Discord —
tidak lagi hanya embed saja.

## Latar Belakang

Embed Builder sebelumnya hanya bisa kirim embed. Ada beberapa skenario dimana
ini kurang fleksibel:

1. **Ping @everyone / @here** — kalau admin mau ping everyone + kirim embed,
   mention harus berada di `content` field message (bukan di dalam embed),
   karena mention di embed description/footer tidak trigger ping.
2. **Teks pengantar** — admin sering mau kasih teks pengantar sebelum embed
   (mis. "Halo semua, cek pengumuman di bawah ⬇️"), tapi tidak mau bikin 2
   message terpisah.
3. **Mention role/user spesifik** — sama seperti @everyone, mention role
   (`<@&ROLE_ID>`) dan user (`<@USER_ID>`) harus di content field supaya
   trigger ping.

Workaround sebelumnya: pakai `/send-message` untuk kirim plain text, lalu
`/embed-builder` untuk kirim embed — tapi itu bikin 2 message terpisah, dan
urutan kirim bisa terbalik kalau ada race condition.

Dengan fitur ini, embed builder bisa kirim keduanya dalam 1 message tunggal.

## Implementasi

### 1. Session Data (`utils/embedBuilderSessions.js`)

Tambah field baru `content: string | null` di `createDefaultData()`:

```javascript
function createDefaultData() {
    return {
        title: null,
        description: null,
        color: 0x5865F2,
        image: null,
        thumbnail: null,
        footer: null,
        author: null,
        fields: [],
        timestamp: true,
        content: null // v3.9.6: plain text message yang dikirim bersama embed
    };
}
```

Juga update `getStatusText()` untuk menampilkan status message:

```javascript
lines.push(`Message: ${d.content ? `✅ (${d.content.length} char)` : '❌'}`);
```

### 2. Select Menu (`handlers/commandHandler.js`)

Tambah option baru di dropdown embed builder:

```javascript
{ label: 'Message (plain text)', value: 'message', emoji: '💬',
  description: 'Teks di luar embed (maks 2000 char, support \\n)' }
```

Posisi: setelah Description, sebelum Color. Urutan logis karena message adalah
bagian "konten utama" bersama description.

### 3. Modal Edit (`handlers/interactionHandler.js`)

Tambah handler untuk action `message` di `handleEmbedBuilderEdit()`:

```javascript
if (action === 'message') {
    const modal = new ModalBuilder()
        .setCustomId(`emb_modal_message:${sessionId}`)
        .setTitle('Set Message (Plain Text)');
    modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
            .setCustomId('value')
            .setLabel('Pesan di luar embed (kosongkan untuk hapus)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(2000)
            .setPlaceholder('Halo semua! Cek pengumuman di bawah ya ⬇️\nSupport newline, @everyone, @here, <@&role_id>, <@user_id>')
            .setValue(d.content || '')
    ));
    return interaction.showModal(modal);
}
```

### 4. Modal Submit Handler

Tambah case `emb_modal_message` di `handleEmbedBuilderModal()`:

```javascript
else if (modalType === 'emb_modal_message') {
    const val = getFieldValue(0);
    if (val && val.length > 2000) {
        return safeEditReply(interaction, {
            content: `❌ Message terlalu panjang (${val.length} char, maks 2000).`
        });
    }
    d.content = val || null;
}
```

### 5. Modal Send — Update dengan Field Message

Modal `emb_modal_send` sekarang punya 2 field:
1. `channel` (required) — channel target
2. `message` (optional) — teks pengantar, di-pre-fill dengan `session.data.content`

```javascript
const currentMessage = session.data.content || '';
const modal = new ModalBuilder()
    .setCustomId(`emb_modal_send:${sessionId}`)
    .setTitle('Kirim Embed ke Channel');
modal.addComponents(
    new ActionRowBuilder().addComponents(
        new TextInputBuilder()
            .setCustomId('channel')
            .setLabel('Channel target (#mention atau ID)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('#announcements atau 123456789012345678')
            .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
        new TextInputBuilder()
            .setCustomId('message')
            .setLabel('Pesan di luar embed (opsional, support @everyone / \\n)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(2000)
            .setPlaceholder('Kosongkan = kirim embed saja. Isi = kirim teks + embed.')
            .setValue(currentMessage)
    )
);
```

### 6. Validasi Mention di Modal Send

Saat admin klik Send, message di-scan untuk mention. Hanya format berikut
yang diperbolehkan:

- `@everyone` / `@here`
- `<@&ROLE_ID>` (17-20 digit)
- `<@USER_ID>` atau `<@!USER_ID>` (17-20 digit)

Mention format lain (mis. `@halo`, `@admin`, `@semua`) akan ditolak. Strategi
validasi: scan semua token mention dengan regex gabungan, lalu cek satu per
satu:

```javascript
const mentionRegex = /@everyone|@here|<@!?\d{17,20}>|<@&\d{17,20}>|@\w+/g;
const foundMentions = messageText.match(mentionRegex) || [];
const invalidMentions = [];
for (const m of foundMentions) {
    const lower = m.toLowerCase();
    if (lower === '@everyone' || lower === '@here') continue;
    if (/^<@&\d{17,20}>$/.test(m)) continue;
    if (/^<@!?\d{17,20}>$/.test(m)) continue;
    invalidMentions.push(m);
}
if (invalidMentions.length > 0) {
    return safeEditReply(interaction, {
        content: `❌ Mention tidak valid di message: \`${invalidMentions.join('`, `')}\`...`
    });
}
```

### 7. Pengiriman Message + Embed

```javascript
const finalMessage = messageText.replace(/\\n/g, '\n'); // unescape \\n → \n

await targetChannel.send({
    content: finalMessage || undefined,
    embeds: [embed],
    allowedMentions: { parse: ['everyone', 'roles', 'users'] }
});
```

`allowedMentions` explicit supaya Discord parse mention normal (everyone,
roles, users). Tanpa ini, default Discord.js v14 adalah **tidak** parse
mention (mencegah ping yang nggak sengaja), tapi karena kita sudah validasi
ketat di atas, kita izinkan parse.

### 8. Preview dengan Message

Tombol **Preview** sekarang menampilkan plain text message (di code block) +
embed, supaya admin bisa lihat keduanya sebelum kirim:

```javascript
const previewContent = session.data.content
    ? `👁️ **Preview:**\n\n💬 **Plain text message:**\n\`\`\`\n${session.data.content}\n\`\`\`\n📋 **Embed:**`
    : '👁️ **Preview:**';
return interaction.reply({ content: previewContent, embeds: [embed], flags: MessageFlags.Ephemeral });
```

### 9. `/embed-list` Summary

Update summary untuk include indikator message:

```javascript
if (d.content) summary.push(`msg (${d.content.length} char)`);
```

### 10. Audit Log

Audit log `EMBED_BUILDER_SEND` sekarang include info message:

```javascript
details: `Kirim embed (builder) ke ${targetChannel}: ${session.data.title ? `**${session.data.title}**` : '_(no title)_'}${finalMessage ? ` | +message (${finalMessage.length} char)` : ''}`
```

## UX Flow

1. Admin jalankan `/embed-builder` → bot buat session + draft message.
2. Admin klik dropdown → pilih **💬 Message (plain text)** → modal muncul.
3. Admin ketik teks pengantar + `@everyone` → submit.
4. Draft message tidak berubah (preview embed saja), tapi session.data.content
   sudah terisi. Admin bisa klik **Preview** untuk lihat keduanya.
5. Admin klik **Send** → modal muncul dengan 2 field:
   - Channel: isi `#announcements`
   - Message: sudah ter-pre-fill dengan teks dari step 3, bisa di-edit.
6. Admin submit → bot kirim 1 message berisi plain text + embed ke channel.
7. Draft dihapus, session dihapus, audit log dicatat.

## Use Cases

1. **Pengumuman dengan ping everyone**:
   ```
   Message: @everyone
   Embed title: 📢 Pengumuman Maintenance
   Embed description: Server akan maintenance jam 22:00 WIB...
   ```

2. **Teks pengantar + embed event**:
   ```
   Message: Halo semua! Jangan lupa event weekend ini ya 🎉
   Embed: (detail event dengan gambar)
   ```

3. **Mention role spesifik + embed info**:
   ```
   Message: <@&VIP_ROLE_ID> exclusive offer untuk kalian!
   Embed: (detail offer)
   ```

## Files Changed

- `package.json` — version bump ke 3.9.6
- `CHANGELOG.md` — entry v3.9.6
- `utils/embedBuilderSessions.js` — tambah field `content` di default data + status text
- `handlers/commandHandler.js` — tambah option "Message" di select menu + update `/help` + tips di draft
- `handlers/interactionHandler.js` — tambah modal `emb_modal_message` + handler, update modal `emb_modal_send` dengan field message + validasi mention, update preview, update audit log
- `CHANGES_v3.9.6.md` — file ini

## Backward Compatibility

- Session lama (tanpa field `content`) tetap works — `session.data.content` akan `undefined`, di-fallback ke `''` di semua penggunaan.
- Behavior default tetap sama: kalau admin tidak set message, embed builder kirim embed saja (tanpa content).
- Tidak ada perubahan schema JSON file (session in-memory, bukan persistent).

## Testing

```bash
node --check utils/embedBuilderSessions.js
node --check handlers/commandHandler.js
node --check handlers/interactionHandler.js
```

Verifikasi syntax pass. Functional test manual di Discord:

1. `/embed-builder` → pilih "Message" → input "Halo semua!" → submit → klik Preview → lihat teks + embed.
2. `/embed-builder` → pilih "Message" → input "@everyone\nCek pengumuman di bawah" → submit → klik Send → isi channel → kirim → verify message + embed terkirim ke channel.
3. `/embed-builder` → pilih "Message" → input "@halo" → submit → klik Send → expect error "Mention tidak valid".
4. `/embed-builder` → tanpa set message → klik Send → field message di modal kosong → submit → kirim embed saja (tanpa content).
5. `/embed-list` → verify session dengan message menampilkan "msg (X char)" di summary.
