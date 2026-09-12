/**
 * Domain: products
 * Slash commands: /add-product, /remove-product, /list-products,
 *                 /set-product-role, /remove-product-role, /list-product-roles
 *
 * Dipisah dari handlers/commandHandler.js (v3.9.9 refactor).
 * Behavior: kelola produk + auto-role mapping per produk.
 */

const { MessageFlags, getConfig, saveConfig, Embeds, logAudit, safeEditReply, parsePriceNum } = require('./_shared');

/**
 * v3.9.49 (laporan user: "total revenue gak ke update"): validasi harga produk
 * SEBELUM disimpan. String harga yang tidak bisa diparse bot (mis. "murah",
 * "negosiasi", "25rb2") dulu diterima senyap — tiap penjualan berikutnya lalu
 * mencatat parsePrice(harga) = 0 ke stats/leaderboard, dan revenue tidak
 * pernah bergerak. Return null kalau valid (harga gratis "0"/"free"/"gratis"
 * diperbolehkan), atau pesan error kalau invalid.
 *
 * v3.9.50 (laporan user: "saya kasih harga 3$ USD | Rp. 25.000"): harga
 * ganda dua-mata-uang VALID — bagian Rupiah yang dicatat ke stats.
 *
 * v3.9.54 (permintaan user: "bot akan dipakai orang di luar Indonesia juga"):
 * mata uang APA SAJA diterima ("$3", "€25", "¥1000", "25 usd"...) — bot
 * sekarang currency-AGNOSTIC, mencatat nominal angka dalam mata uang apapun
 * yang admin pakai. Harga USD-only tidak lagi ditolak. Harga ganda dua mata
 * uang tetap mencatat bagian Rp (v3.9.50, tidak berubah).
 * v3.9.55 (pertanyaan user: "angka itu support desimal misal $2.5 USD?"):
 * harga DESIMAL dengan penanda non-Rp kini valid ("$2.5", "$2.50", "€9.99") —
 * cents ikut tercatat di stats (2.5, bukan 3).
 * v3.9.57 (permintaan user: "biar support harga desimal untuk add produk nya
 * misal 5.88"): desimal POLOS juga valid — "5.88" dan "5,88" tanpa penanda
 * mata uang kini terbaca 5.88 (dulu "5.88" tercatat 588 di stats — dot polos
 * dianggap pemisah ribuan). Grup dot 3 digit tetap ribuan ("50.000" → 50000).
 * Diekspor untuk unit test (tests/unit/parsePrice.test.js).
 */
function priceValidationError(price) {
    const raw = String(price || '').trim();
    const FREE = ['0', 'free', 'gratis'];
    if (FREE.includes(raw.toLowerCase())) return null; // memang gratis — OK
    if (parsePriceNum(raw) > 0) return null; // terparse jadi jumlah positif — OK
    return (
        `❌ Harga \`${raw}\` tidak bisa dibaca sebagai angka — nanti akan tercatat **0** di stats setiap penjualan.\n` +
        `✅ Format yang diterima: \`25000\` · \`25.000\` · \`25,000\` · \`$3\` · \`$2.50\` · \`5.88\` · \`€25\` · \`Rp 30.000\` · \`30rb\` · \`3jt\` · \`3$ USD | Rp 25.000\` (yang dicatat bagian Rp) · \`gratis\``
    );
}

module.exports = async function (interaction) {
    const embeds = new Embeds(interaction.client);
    const config = getConfig();

    // === ADD PRODUCT ===
    if (interaction.commandName === 'add-product') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const label = interaction.options.getString('label');
        const value = interaction.options.getString('value');
        const price = interaction.options.getString('price');
        // duration opsional - kalau tidak diisi, TIDAK disimpan sama sekali
        const duration = interaction.options.getString('duration');
        // v3.9.11 Phase 2: category & requires_key
        const category = interaction.options.getString('category');
        const requiresKeyOpt = interaction.options.getBoolean('requires_key');

        // v3.9.8 FIX: validate `value` — dipakai di customId modal_set_key:${value}
        if (!value || !/^[a-zA-Z0-9_-]{1,50}$/.test(value)) {
            return safeEditReply(interaction, {
                content: '❌ `value` hanya boleh huruf/angka/_/-, maks 50 karakter, tanpa spasi/kolom/titik dua.'
            });
        }

        // v3.9.26 FIX: cap label/price di handler (konsisten dengan /update-product
        // yang sudah slice ke 80). Registry sudah max_length, tapi data LAMA atau
        // hasil restore backup bisa tetap panjang — dropdown tiket mem-slice
        // defensif, simpanan config juga biar rapi.
        const safeLabel = label.slice(0, 80);
        const safePrice = price.slice(0, 100);

        // v3.9.49 FIX: tolak harga yang akan mencatat revenue Rp 0 senyap.
        const priceErr = priceValidationError(safePrice);
        if (priceErr) return safeEditReply(interaction, { content: priceErr });

        if (config.products.some(p => p.value === value)) {
            return safeEditReply(interaction, { content: `❌ Produk dengan value \`${value}\` sudah ada.` });
        }
        if (config.products.length >= 25) {
            return safeEditReply(interaction, { content: '❌ Maksimal 25 produk (batas dropdown Discord).' });
        }

        // v3.9.11 Phase 2: validate category exists (kalau di-specify)
        const finalCategory = category || 'transaction';
        const categories = config.ticketCategories || [];
        const categoryExists = categories.some(c => c.id === finalCategory);
        if (!categoryExists && category) {
            // Kalau admin specify category yang gak ada, tolak.
            return safeEditReply(interaction, {
                content: `❌ Kategori \`${category}\` tidak ditemukan. Pakai /list-categories untuk lihat daftar, atau /add-category untuk bikin baru.`
            });
        }

        // v3.9.11 Phase 2: determine requiresKey
        // - Kalau explicitly set via option, pakai itu.
        // - Kalau tidak, default berdasarkan category config (kalau category punya requiresKey field).
        let finalRequiresKey;
        if (requiresKeyOpt !== null) {
            finalRequiresKey = requiresKeyOpt;
        } else {
            const catConfig = categories.find(c => c.id === finalCategory);
            finalRequiresKey = catConfig?.requiresKey !== undefined ? catConfig.requiresKey : true;
        }

        // Hanya simpan duration kalau diisi
        const newProduct = { label: safeLabel, value, price: safePrice };
        if (duration) newProduct.duration = duration;
        newProduct.category = finalCategory;
        newProduct.requiresKey = finalRequiresKey;

        config.products.push(newProduct);
        saveConfig(config);

        const durationInfo = duration ? ` (durasi: ${duration})` : ' (tanpa duration)';
        const catInfo = ` | kategori: ${finalCategory} | requiresKey: ${finalRequiresKey ? 'yes' : 'no'}`;
        await logAudit(interaction.client, {
            action: 'ADD_PRODUCT',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Tambah produk: **${label}** (\`${value}\`) — ${price}${durationInfo}${catInfo}`,
            guildId: interaction.guild.id
        });
        // v3.9.49: tampilkan bagaimana harga akan dihitung di /stats — jadi
        // salah format kelihatan saat setup, bukan setelah N penjualan tak terlihat.
        // v3.9.54: tanpa prefiks "Rp" — bot currency-agnostic, mencatat nominal
        // angka dalam mata uang yang dipakai admin sendiri.
        const priceNum = parsePriceNum(safePrice);
        const revenueNote =
            priceNum > 0
                ? `\n💰 Tercatat di stats: **${priceNum.toLocaleString('id-ID')}** per penjualan (transaksi tiket + rekber)`
                : '';
        return safeEditReply(interaction, {
            content: `✅ Produk ditambahkan: **${label}** — ${price}${durationInfo}${revenueNote}\n📦 Kategori: \`${finalCategory}\` | 🔑 Requires Key: ${finalRequiresKey ? 'Yes' : 'No'}`
        });
    }

    // === REMOVE PRODUCT ===
    if (interaction.commandName === 'remove-product') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const value = interaction.options.getString('value');
        const idx = config.products.findIndex(p => p.value === value);
        if (idx === -1) return safeEditReply(interaction, { content: `❌ Produk \`${value}\` tidak ditemukan.` });
        const [removed] = config.products.splice(idx, 1);
        saveConfig(config);
        await logAudit(interaction.client, {
            action: 'REMOVE_PRODUCT',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Hapus produk: **${removed.label}** (\`${removed.value}\`) — ${removed.price}`,
            guildId: interaction.guild.id
        });
        return safeEditReply(interaction, { content: `✅ Produk dihapus: **${removed.label}**` });
    }

    // === LIST PRODUCTS ===
    if (interaction.commandName === 'list-products') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (config.products.length === 0) {
            return safeEditReply(interaction, { content: '📭 Belum ada produk.' });
        }
        const list = config.products
            .map((p, i) => {
                let line = `\`${i + 1}.\` **${p.label}** — ${p.price}\n   └ value: \`${p.value}\``;
                if (p.duration) line += ` | durasi: ${p.duration}`;
                return line;
            })
            .join('\n');
        const embed = embeds.info('📋 DAFTAR PRODUK', list);
        return safeEditReply(interaction, { embeds: [embed] });
    }

    // === SET PRODUCT ROLE (auto-role + auto-expire) ===
    if (interaction.commandName === 'set-product-role') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const value = interaction.options.getString('value');
        const role = interaction.options.getRole('role');
        const days = interaction.options.getInteger('days');

        // v3.9.8 FIX: validate days >= 0. Sebelumnya gak divalidasi — admin bisa
        // input days: -5 → scheduleRoleRemoval compute expireAt = now + (-5)*86400000
        // = 5 hari lalu → scheduler immediate process → member dapat role lalu
        // ke-remove dalam 60 detik.
        if (days == null || days < 0 || days > 3650) {
            return safeEditReply(interaction, {
                content: '❌ `days` harus antara 0 dan 3650. (0 = permanen, >0 = durasi hari).'
            });
        }

        const product = config.products.find(p => p.value === value);
        if (!product) {
            return safeEditReply(interaction, {
                content: `❌ Produk dengan value \`${value}\` tidak ditemukan. Pakai \`/list-products\` untuk lihat daftar.`
            });
        }

        product.roleId = role.id;
        product.days = days;
        saveConfig(config);
        await logAudit(interaction.client, {
            action: 'EDIT_PRODUCT',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Set auto-role produk **${product.label}** → ${role.name} (${days > 0 ? days + ' hari' : 'permanen'})`,
            guildId: interaction.guild.id
        });

        const expireInfo =
            days > 0 ? `akan otomatis dihapus setelah **${days} hari**` : '**permanen** (tidak akan otomatis dihapus)';
        return safeEditReply(interaction, {
            content: `✅ Auto-role untuk produk **${product.label}** diatur!\n\n🎁 Role: ${role}\n⏰ Expire: ${expireInfo}\n\n💡 Role otomatis diberikan saat admin klik **🔑 Set Key** / **📦 Kirim Pesanan** / **✅ Pesanan Sukses** di tiket.`
        });
    }

    // === REMOVE PRODUCT ROLE ===
    if (interaction.commandName === 'remove-product-role') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const value = interaction.options.getString('value');

        const product = config.products.find(p => p.value === value);
        if (!product) {
            return safeEditReply(interaction, { content: `❌ Produk dengan value \`${value}\` tidak ditemukan.` });
        }
        if (!product.roleId) {
            return safeEditReply(interaction, {
                content: `ℹ️ Produk **${product.label}** memang belum punya auto-role.`
            });
        }

        delete product.roleId;
        delete product.days;
        saveConfig(config);
        await logAudit(interaction.client, {
            action: 'EDIT_PRODUCT',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Hapus auto-role produk **${product.label}**`,
            guildId: interaction.guild.id
        });
        return safeEditReply(interaction, {
            content: `✅ Auto-role untuk produk **${product.label}** berhasil dihapus.`
        });
    }

    // === LIST PRODUCT ROLES ===
    if (interaction.commandName === 'list-product-roles') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const withRoles = config.products.filter(p => p.roleId);
        if (withRoles.length === 0) {
            return safeEditReply(interaction, {
                content: '📭 Belum ada produk yang punya auto-role. Pakai `/set-product-role` untuk setup.'
            });
        }
        const list = withRoles
            .map(p => {
                const roleMention = `<@&${p.roleId}>`;
                const expire = p.days > 0 ? `${p.days} hari` : 'permanen';
                return `• **${p.label}** (\`${p.value}\`) → ${roleMention} — expire: ${expire}`;
            })
            .join('\n');
        const embed = embeds.info('🎁 AUTO-ROLE PER PRODUK', list);
        return safeEditReply(interaction, { embeds: [embed] });
    }

    // === UPDATE PRODUCT (v3.9.19) ===
    // Edit produk existing tanpa harus hapus + add ulang.
    // Semua field optional (kecuali `value` sebagai identifier).
    // Catatan: `value` sendiri TIDAK bisa diubah karena dipakai sebagai customId
    // di modal_set_key:${value} — mengubah value akan break tiket yang sedang aktif.
    if (interaction.commandName === 'update-product') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const value = interaction.options.getString('value');
        const newLabel = interaction.options.getString('label');
        const newPrice = interaction.options.getString('price');
        const newDuration = interaction.options.getString('duration');
        const newCategory = interaction.options.getString('category');
        const newRequiresKey = interaction.options.getBoolean('requires_key');

        const product = config.products.find(p => p.value === value);
        if (!product) {
            return safeEditReply(interaction, {
                content: `❌ Produk dengan value \`${value}\` tidak ditemukan. Pakai \`/list-products\` untuk lihat daftar.`
            });
        }

        // Validate category kalau diisi
        if (newCategory !== null) {
            const categories = config.ticketCategories || [];
            const categoryExists = categories.some(c => c.id === newCategory);
            if (!categoryExists) {
                return safeEditReply(interaction, {
                    content: `❌ Kategori \`${newCategory}\` tidak ditemukan. Pakai /list-categories untuk lihat daftar.`
                });
            }
        }

        const before = { ...product };
        const changes = [];

        if (newLabel !== null) {
            product.label = newLabel.slice(0, 80);
            changes.push(`label: \`${before.label}\` → \`${product.label}\``);
        }
        if (newPrice !== null) {
            // v3.9.49 FIX: guard yang sama dengan /add-product — tolak harga tak terparse.
            const priceErr = priceValidationError(newPrice);
            if (priceErr) return safeEditReply(interaction, { content: priceErr });
            product.price = newPrice;
            changes.push(`price: \`${before.price}\` → \`${newPrice}\``);
            // v3.9.50: visibilitas yang sama dengan /add-product — tampilkan nominal
            // yang akan dicatat, supaya salah ketik harga ganda langsung ketahuan
            // saat update.
            const newPriceNum = parsePriceNum(newPrice);
            if (newPriceNum > 0) {
                changes.push(`💰 tercatat di stats: **${newPriceNum.toLocaleString('en-US')}** per penjualan`);
            }
        }
        if (newDuration !== null) {
            // Empty string → hapus field duration
            if (newDuration === '') {
                if (product.duration !== undefined) {
                    delete product.duration;
                    changes.push(`duration: \`${before.duration || '-'}\` → (dihapus)`);
                }
            } else {
                product.duration = newDuration;
                changes.push(`duration: \`${before.duration || '-'}\` → \`${newDuration}\``);
            }
        }
        if (newCategory !== null) {
            product.category = newCategory;
            changes.push(`category: \`${before.category || 'transaction'}\` → \`${newCategory}\``);
        }
        if (newRequiresKey !== null) {
            product.requiresKey = newRequiresKey;
            changes.push(`requiresKey: ${before.requiresKey} → ${newRequiresKey}`);
        }

        if (changes.length === 0) {
            return safeEditReply(interaction, {
                content:
                    `ℹ️ Tidak ada perubahan dilakukan. Berikan minimal 1 field untuk diupdate (label/price/duration/category/requires_key).\n\n` +
                    `Produk **${before.label}** (\`${before.value}\`) tetap seperti sebelumnya.`
            });
        }

        saveConfig(config);
        await logAudit(interaction.client, {
            action: 'EDIT_PRODUCT',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Update produk: **${before.label}** (\`${before.value}\`) — ${changes.join('; ')}`,
            guildId: interaction.guild.id
        });

        return safeEditReply(interaction, {
            content:
                `✅ Produk **${product.label}** (\`${product.value}\`) berhasil diupdate!\n\n` +
                `📝 Perubahan:\n${changes.map(c => `• ${c}`).join('\n')}\n\n` +
                `💡 Pakai \`/refresh-panel <id>\` untuk re-render panel yang sudah terpasang.`
        });
    }
};

// v3.9.50: ekspos validator harga untuk unit test (dipasang SETELAH assignment
// handler di atas supaya tidak tertimpa).
module.exports.priceValidationError = priceValidationError;
