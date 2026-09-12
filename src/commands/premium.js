/**
 * Domain: premium
 * Slash commands: /gen-key, /redeem, /list-stock, /revoke-key
 *
 * v3.13.0: PREMIUM SAAS — stok key + penukaran MANDIRI (self-service).
 * Melengkapi /set-key (model lama: admin mengarang key manual + set
 * langsung ke user). Dengan mode publik v3.12.0 (ala Dyno), admin tidak
 * bisa online 24 jam menunggu pembeli — jadi:
 *
 *   /gen-key  (admin)  : bot mengarang key acak crypto-secure
 *                        (XXXXX-XXXXX-XXXXX) → disimpan sebagai STOK.
 *   /redeem   (public) : member menukar key SENDIRI → role + jadwal
 *                        expire otomatis. Durasi mulai SAAT DITUKAR.
 *   /list-stock (admin) : lihat stok key guild ini yang belum ditukar.
 *   /revoke-key (admin) : batalkan key stok yang bocor / salah buat.
 *
 * Keamanan (anti-abuse /redeem — command publik pertama yang menyentuh
 * data key bernilai uang):
 *   1. Rate limiter di data layer (keyManager): 5 kegagalan / 10 menit
 *      per user → cooldown. Cegah brute-force 31^15 kombinasi key.
 *   2. Semua kegagalan /redeem pakai pesan GENERIK yang sama ("Key
 *      tidak valid atau sudah dipakai") — key tidak bisa di-enumerasi
 *      (tidak bocor mana key valid-belum-dipakai vs sudah-dipakai vs
 *      punya guild lain).
 *   3. Konsumsi key ATOMIC di redeemKey (load→validasi→mutate→save
 *      tanpa await di tengah) — dua redeem bersamaan cuma satu sukses.
 *   4. Audit log TIDAK PERNAH berisi nilai key (pola v3.9.1 FIX) —
 *      cukup panjang/count + produk.
 *
 * Urutan operasi /redeem (setelah rate-limit check):
 *   redeemKey (konsumsi atomik) → add role → schedule → DM → audit.
 *   Kalau add role gagal SETELAH key terkonsumsi: key tetap tersimpan
 *   (sama seperti /set-key gagal di tengah) — member diminta hubungi
 *   admin; admin bisa add role manual, data key tidak hilang.
 */

const {
    EmbedBuilder,
    MessageFlags,
    getConfig,
    resolveGuildId,
    createStockKey,
    redeemKey,
    listStockKeys,
    revokeStockKey,
    isRedeemRateLimited,
    noteRedeemFailure,
    noteRedeemSuccess,
    scheduleRoleRemoval,
    logAudit,
    safeEditReply
} = require('./_shared');

// Konvensi pesan generik /redeem — SATU string untuk SEMUA kegagalan
// validasi key supaya tidak bisa di-enumerasi (harus sama dengan yang
// di-throw keyManager.redeemKey).
const GENERIC_KEY_ERROR = '❌ Key tidak valid atau sudah dipakai.';

// /gen-key: jumlah key per sekali jalan (1-10). Lebih dari 10 → admin
// jalankan ulang (batas kecil supaya reply tidak menjulang + typo massal
// tidak terjadi).
const GEN_KEY_MAX_COUNT = 10;

// /list-stock: batas tampilan per embed (field value Discord max 1024
// char — 15 entry format ringkas aman; sisanya dihitung "… dan N lagi").
const LIST_STOCK_PAGE = 15;

module.exports = async function (interaction) {
    // v3.10.0 multi-guild: stok & redeem selalu scoped guild ini.
    const guildId = resolveGuildId(interaction);
    const config = getConfig(guildId);

    // ====================================================
    // === /gen-key — ADMIN BUAT KEY STOK ===
    // ====================================================
    if (interaction.commandName === 'gen-key') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const value = interaction.options.getString('value');
        // Discord hanya validasi min/max di sisi client — server tetap
        // harus re-validasi (pola v3.9.38 FIX: jangan percaya input).
        const count = Math.min(
            Math.max(Math.floor(interaction.options.getInteger('count') || 1), 1),
            GEN_KEY_MAX_COUNT
        );
        const note = interaction.options.getString('note') || '';

        const product = config.products.find(p => p.value === value);
        if (!product) {
            return safeEditReply(interaction, {
                content: `❌ Produk value \`${value}\` tidak ditemukan. Pakai \`/list-products\` untuk lihat daftar.`
            });
        }
        // Sama seperti /set-key: tanpa roleId, key tidak bisa ditukar
        // dengan benar nantinya (redeem butuh role untuk diberikan).
        if (!product.roleId) {
            return safeEditReply(interaction, {
                content: `❌ Produk **${product.label}** belum punya auto-role. Pakai \`/set-product-role\` dulu.`
            });
        }

        const entries = [];
        try {
            for (let i = 0; i < count; i++) {
                entries.push(
                    createStockKey({
                        productName: product.label,
                        roleId: product.roleId,
                        days: product.days || 0,
                        guildId: interaction.guild.id,
                        note,
                        createdBy: interaction.user.tag
                    })
                );
            }
        } catch (err) {
            // Sebagian key bisa sudah tersimpan kalau gagal di tengah loop
            // — tampilkan yang berhasil + pesan error supaya admin tahu
            // persis kondisi stoknya (tidak diam-diam gagal).
            console.error('createStockKey gagal:', err);
            const successList = entries.map(e => `\`${e.key}\``).join('\n') || '(tidak ada)';
            return safeEditReply(interaction, {
                content:
                    `⚠️ Gagal membuat stok key: ${err.message}\n\n` +
                    `Key yang sempat tersimpan (${entries.length}):\n${successList}\n\n` +
                    `Cek disk space / permission file \`data/keys.json\`, lalu jalankan ulang.`
            });
        }

        const durasiStr =
            (product.days || 0) > 0 ? `${product.days} hari sejak DITUKAR` : 'permanen sejak ditukar';

        // Audit log: JANGAN bocorkan nilai key (pola v3.9.1 FIX) —
        // cukup count + produk + panjang key.
        await logAudit(interaction.client, {
            action: 'GEN_KEY',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Generate ${count} key stok — produk: **${product.label}**, durasi: ${durasiStr}, key: \`***\` (len=${entries[0].key.length})${note ? `, note: ${note}` : ''}`,
            guildId: interaction.guild.id
        });

        // Reply ephemeral (hanya admin yang melihat nilai key — pola
        // keamanan yang sama dengan kenapa /set-key ephemeral).
        const keyBlock = entries.map(e => `\`${e.key}\``).join('\n');
        return safeEditReply(interaction, {
            content:
                `✅ **${count} key stok dibuat!**\n\n` +
                `📦 Produk: ${product.label}\n` +
                `⏰ Durasi: ${durasiStr}\n` +
                (note ? `📝 Note: ${note}\n` : '') +
                `\n🔑 **Key (kirim ke pembeli — jangan taruh di channel publik):**\n${keyBlock}\n\n` +
                `Pembeli menukarkannya sendiri lewat \`/redeem\`. Lihat stok kapan saja: \`/list-stock\`.`
        });
    }

    // ====================================================
    // === /redeem — MEMBER TUKAR KEY SENDIRI (PUBLIK) ===
    // ====================================================
    if (interaction.commandName === 'redeem') {
        const keyValue = (interaction.options.getString('key') || '').trim();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // 1. Rate limiter — dicek SEBELUM menyentuh file (user yang
        //    sudah kena cooldown tidak boleh menghasilkan I/O file).
        if (isRedeemRateLimited(interaction.user.id)) {
            return safeEditReply(interaction, {
                content:
                    '⏳ Kamu mencoba terlalu banyak kali. Tunggu ±10 menit sebelum mencoba menukar key lagi.\n\n' +
                    '💡 Pastikan key disalin utuh (format `XXXXX-XXXXX-XXXXX`, huruf besar, tanpa spasi).'
            });
        }

        // 2. Konsumsi key (ATOMIC). Semua kegagalan validasi → pesan
        //    generik yang sama (anti-enumeration), lalu catat kegagalan
        //    ke rate limiter.
        let entry;
        try {
            entry = redeemKey(keyValue, {
                userId: interaction.user.id,
                username: interaction.user.tag,
                guildId: interaction.guild.id
            });
        } catch (_err) {
            noteRedeemFailure(interaction.user.id);
            // Pesan generik — jangan pernah echo err.message validasi
            // (redeemKey memang sengaja melempar pesan generik, tapi
            // echo mentah berisiko kalau ada path error non-generik
            // seperti input kosong).
            return safeEditReply(interaction, { content: GENERIC_KEY_ERROR });
        }

        // 3. Key sah & terkonsumsi — catat sukses (reset limiter:
        //    user yang berhasil jelas bukan penyerang brute-force).
        noteRedeemSuccess(interaction.user.id);

        const guild = interaction.guild;
        const member = interaction.member;
        const role = guild.roles.cache.get(entry.roleId);

        let roleWarning = '';
        let dmSent = false;
        if (role) {
            // 3a. Berikan role. Kalau gagal (hierarki/permission bot),
            //     key SUDAH tersimpan — jangan rollback (data user sah),
            //     tampilkan instruksi hubungi admin (pola /set-key).
            try {
                if (!member.roles.cache.has(role.id)) {
                    await member.roles.add(role);
                }
            } catch (_err) {
                roleWarning =
                    `\n⚠️ **Role \`${role.name}\` gagal diberikan otomatis** — hubungi admin/server owner ` +
                    `supaya role kamu di-add manual (pembelianmu sudah tersimpan, tidak hilang).`;
            }
        } else {
            // Role produk dihapus dari Discord setelah key dibuat.
            // Pembeli tidak bisa apa-apa — eskalasi ke admin.
            roleWarning =
                '\n⚠️ **Role produk sudah tidak ada di server** — hubungi admin; pembelianmu sudah tersimpan, admin bisa memberikan role pengganti.';
        }

        // 3b. Jadwal auto-expire (MAX EXTEND — sama seperti /set-key,
        //     expireAt sudah dihitung redeemKey: durasi SEJAK DITUKAR).
        let scheduleWarning = '';
        try {
            scheduleRoleRemoval({
                userId: interaction.user.id,
                roleId: entry.roleId,
                guildId: guild.id,
                days: entry.days,
                expireAt: entry.expireAt,
                productName: entry.productName
            });
        } catch (schedErr) {
            console.error('scheduleRoleRemoval gagal (redeem):', schedErr);
            scheduleWarning =
                '\n⚠️ Jadwal expire otomatis gagal dibuat — role tidak akan auto-expire. Hubungi admin.';
        }

        // 3c. DM konfirmasi (best-effort — DM ditutup tidak fatal,
        //     ephemeral reply tetap tampil).
        const expireInfo =
            entry.expireAt === null
                ? 'permanen (tidak akan hilang)'
                : `${Math.ceil((entry.expireAt - Date.now()) / 86400000)} hari lagi`;
        try {
            await interaction.user.send(
                `Terima kasih! Key kamu berhasil ditukar di **${guild.name}** 🎉\n\n` +
                    `📦 Produk: ${entry.productName}\n` +
                    `🎭 Role: ${role ? role.name : 'sedang bermasalah — hubungi admin'}\n` +
                    `⏰ Expire: ${expireInfo}\n\n` +
                    `💡 Simpan pesan ini sebagai bukti pembelian.`
            );
            dmSent = true;
        } catch (_) {}

        // 3d. Audit log — TANPA nilai key (cukup produk + panjang).
        await logAudit(interaction.client, {
            action: 'REDEEM_KEY',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Redeem key mandiri — produk: **${entry.productName}**, key: \`***\` (len=${keyValue.length})`,
            guildId: guild.id
        });

        return safeEditReply(interaction, {
            content:
                `🎉 **Key berhasil ditukar!**\n\n` +
                `📦 Produk: ${entry.productName}\n` +
                `🎭 Role: ${role ? role : '⚠️ bermasalah — lihat catatan di bawah'}\n` +
                `⏰ Expire: ${expireInfo}\n` +
                `${dmSent ? '📬 Cek DM kamu untuk bukti pembelian.' : 'ℹ️ DM tidak terkirim (DM kamu ditutup) — simpan pesan ini sebagai bukti.'}` +
                roleWarning +
                scheduleWarning
        });
    }

    // ====================================================
    // === /list-stock — ADMIN LIHAT STOK KEY GUILD INI ===
    // ====================================================
    if (interaction.commandName === 'list-stock') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const stock = listStockKeys(guildId);
        if (stock.length === 0) {
            return safeEditReply(interaction, {
                content: '📭 Belum ada key stok di server ini. Buat lewat `/gen-key`.'
            });
        }

        const shown = stock.slice(0, LIST_STOCK_PAGE);
        const hidden = stock.length - shown.length;
        const lines = shown.map(k => {
            const durasi = (Number(k.days) || 0) > 0 ? `${k.days}h` : 'permanen';
            const noteStr = k.note ? ` · ${k.note}` : '';
            return `\`${k.key}\` — ${k.productName} · ${durasi} sejak ditukar${noteStr}`;
        });
        if (hidden > 0) lines.push(`… dan ${hidden} key lagi (total ${stock.length}).`);

        const embed = new EmbedBuilder()
            .setTitle(`🏷️ Stok Key — ${stock.length} belum ditukar`)
            .setDescription(
                `Key berikut **belum dipakai siapa pun** — aman dikirim ke pembeli. ` +
                    `Durasi baru mulai ketika key DITUKAR (\`/redeem\`), bukan sekarang.`
            )
            .addFields({ name: `🔑 Key (${shown.length} ditampilkan)`, value: lines.join('\n').slice(0, 1024), inline: false })
            .setColor(0x57f287)
            .setFooter({
                text: interaction.client.user.username,
                iconURL: interaction.client.user.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp();
        return safeEditReply(interaction, { embeds: [embed] });
    }

    // ====================================================
    // === /revoke-key — ADMIN BATALKAN KEY STOK ===
    // ====================================================
    if (interaction.commandName === 'revoke-key') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const keyValue = (interaction.options.getString('key') || '').trim();

        const removed = revokeStockKey(keyValue, guildId);
        if (!removed) {
            return safeEditReply(interaction, {
                content:
                    '❌ Key itu tidak bisa dibatalkan: tidak ada di stok guild ini, atau SUDAH ditukar member ' +
                    '(pencairan sah — kalau perlu dicabut dari member, pakai `/clear-schedule user clear_keys:true`).'
            });
        }

        await logAudit(interaction.client, {
            action: 'REVOKE_KEY',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Revoke key stok — produk: **${removed.productName}**, key: \`***\` (len=${keyValue.length})`,
            guildId: interaction.guild.id
        });

        return safeEditReply(interaction, {
            content:
                `🗑️ **Key stok dibatalkan.**\n\n` +
                `📦 Produk: ${removed.productName}\n` +
                `🔑 Key: \`***\` (len=${keyValue.length})\n\n` +
                `Key itu kini tidak bisa ditukar siapa pun. Kalau key bocor, ini mencegah penyalahgunaan.`
        });
    }
};
