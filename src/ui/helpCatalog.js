/**
 * Help Catalog — single source of truth untuk isi /help (v3.9.39).
 *
 * v3.9.39 REDESIGN: /help dulunya SATU embed raksasa (±5.400 char) → admin
 * harus scroll jauh untuk mencari command. Sekarang /help jadi navigator
 * interaktif:
 *   - 🏠 Home   : ringkasan kategori + dropdown 📂 (19 kategori) + tombol
 *   - 📂 Kategori: detail command per kategori (embed kecil, gampang dibaca)
 *   - 🔍 Search : modal kata kunci ATAU /help search:<keyword> → hasil instan
 *   - 📖 All    : daftar lengkap (tampilan lama, tetap tersedia)
 * Semua view di-render ke SATU pesan ephemeral (interaction.update) — tidak
 * ada spam pesan baru tiap kali ganti kategori.
 *
 * Modul ini dipakai bersama oleh:
 *   - src/commands/help.js      (slash /help + opsi search)
 *   - src/interactions/help.js  (dropdown/tombol/modal navigation)
 *
 * Kontrak Discord yang dijaga (di-unit-test di tests/unit/helpNav.test.js):
 *   - StringSelectMenu max 25 opsi (saat ini 19 kategori — ada guard test).
 *   - Opsi select: label ≤ 100, description ≤ 100, value ≤ 100.
 *   - Embed description ≤ 4096; total semua embed dalam 1 pesan ≤ 6000.
 */

const {
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} = require('discord.js');
const { EMBED_LIMITS, DISCORD_LIMITS } = require('../infra/constants');

// v3.9.37: versi diambil dinamis dari package.json (single source of truth)
// supaya /help gak pernah stale lagi.
const { version: BOT_VERSION } = require('../../package.json');

// === Custom IDs (stabil — pesan help lama tetap bisa diklik setelah restart) ===
const HELP_IDS = {
    SELECT: 'help_cat',
    SEARCH_BUTTON: 'help_search',
    SEARCH_MODAL: 'help_search_modal',
    SEARCH_INPUT: 'help_search_input',
    HOME_BUTTON: 'help_home',
    ALL_BUTTON: 'help_all'
};

const EMBED_COLOR = 0x5865f2;
const FOOTER_TEXT = `Community Bot v${BOT_VERSION} — All-in-One`;

// Batas aman hasil pencarian yang ditampilkan sebelum "+N lainnya".
const SEARCH_MAX_LINES = 20;

/**
 * Katalog kategori help. `lines` = isi detail kategori (baris command).
 * `short` = deskripsi singkat untuk opsi dropdown (≤100 char, di-guard test).
 */
const HELP_CATEGORIES = [
    {
        id: 'info',
        emoji: '📋',
        name: 'Informasi',
        short: 'Bantuan, daftar produk/kategori/pesan & konfigurasi',
        lines: [
            '• `/help` — tampilkan pusat bantuan (atau `/help search:kata kunci`)',
            '• `/list-products` — lihat semua produk',
            '• `/list-categories` — lihat semua kategori tiket',
            '• `/list-messages` — lihat semua teks pesan embed',
            '• `/config-show` — lihat semua konfigurasi bot'
        ]
    },
    {
        id: 'panels',
        emoji: '🏗️',
        name: 'Panel Tiket (Multi-Panel)',
        short: 'Setup panel verifikasi & multi-panel tiket',
        lines: [
            '• `/setup-verify` — pasang panel verifikasi',
            '• `/setup-ticket` — pasang panel tiket (legacy)',
            '• `/setup-ticket-panel` — panel multi-panel penuh:',
            '   opsi: `title` `body` `color:#ff5733` `image` `thumbnail` `footer` `categories` `channel` `use_dropdown`',
            '• `/list-panels` `/update-panel` `/refresh-panel` `/delete-panel`',
            '• `/set-verify-button` — kustomisasi tombol verifikasi',
            '💡 Multi-panel = tiap panel custom sendiri. Disimpan ke panels.json.'
        ]
    },
    {
        id: 'categories',
        emoji: '🎫',
        name: 'Kategori Tiket (CRUD)',
        short: 'Tambah / edit / hapus kategori tiket',
        lines: [
            '• `/add-category id:jasa label:"Jasa" emoji:🎮 style:Success requires_key:false`',
            '• `/update-category id:jasa label:"Jasa Premium" emoji:"🛠️"` — edit tanpa hapus',
            '• `/list-categories` — lihat semua kategori',
            '• `/remove-category id:jasa` — hapus kategori (default dilindungi)',
            '💡 v3.9.19: behavior fleksibel — kategori dengan produk → dropdown, kategori tanpa produk → langsung bikin tiket.'
        ]
    },
    {
        id: 'responder',
        emoji: '💬',
        name: 'Auto-Responder',
        short: 'Auto-reply FAQ saat member kirim trigger',
        lines: ['• `/add-responder` `/list-responder` `/remove-responder`', '💡 Member kirim trigger → bot auto-reply. Cocok untuk FAQ.']
    },
    {
        id: 'automod',
        emoji: '🛡️',
        name: 'Anti-Spam & Auto-Mod',
        short: 'Blocklist kata, whitelist link, action otomatis',
        lines: [
            '• `/set-automod` `/automod-show` `/automod-toggle`',
            '• `/add-word words:kata1,kata2 action:Mute_10_menit` — tambah kata (append)',
            '• `/remove-word word:kata` `/list-words` — hapus/lihat kata',
            '• `/add-word tipe:Exempt_(kata_diizinkan)` — whitelist kata anti false-positive',
            '• `/add-link-whitelist` `/remove-link-whitelist`',
            '💡 v3.9.23: action per kata + matching whole-word ("asu" tidak match "asus")'
        ]
    },
    {
        id: 'afk',
        emoji: '💤',
        name: 'AFK System',
        short: 'Auto-reply saat user AFK di-mention',
        lines: ['• `/afk` `/afk-clear` `/afk-list`', '💡 Bot auto-reply saat user AFK di-mention.']
    },
    {
        id: 'leveling',
        emoji: '📊',
        name: 'Leveling System',
        short: 'XP per pesan, level up auto-role',
        lines: [
            '• `/setup-leveling` `/add-level-role` `/list-level-roles` `/remove-level-role`',
            '• `/rank` `/leaderboard-level` (public)',
            '💡 XP per message, level up → auto-assign role.'
        ]
    },
    {
        id: 'roles',
        emoji: '🎭',
        name: 'Atur Role',
        short: 'Set role verified / admin / midman di config',
        lines: [
            '• `/set-role verified @role` — set role (verified/unverified/admin/**midman**)',
            '• `/remove-role verified` — hapus role dari config'
        ]
    },
    {
        id: 'channels',
        emoji: '📢',
        name: 'Atur Channel & Auto-Split Tiket',
        short: 'Set channel & auto-split 3 kategori tiket',
        lines: [
            '• `/set-channel welcome #ch` — set (welcome/goodbye/invoice/audit-log/**transcript**)',
            '• `/remove-channel welcome` — hapus channel dari config',
            '• `/set-channel transcript #ch` — auto-save transcript tiket sebelum close',
            '',
            '**🎫 Auto-Split:** Bot pisah tiket jadi 3 kategori otomatis:',
            '• **`🎫 TRANSAKSI`** — semua tiket produk: pakai key (🔑 Set Key) ATAU non-key (📦 Kirim Pesanan)',
            '• **`🎫 BANTUAN`** — tiket kategori tanpa produk (help/report/claim_giveaway)',
            '• **`🤝 REKBER`** — channel deal escrow middleman (dibuat saat deal rekber dibuka)',
            'Custom nama? Edit `data/config.json`: `ticketCategoryKey`, `ticketCategoryNoKey`, `midman.category`'
        ]
    },
    {
        id: 'messages',
        emoji: '✏️',
        name: 'Atur Pesan Embed',
        short: 'Edit teks welcome/goodbye/tiket + template vars',
        lines: [
            '• `/set-message ticketBody teks...` (cepat, 1-line)',
            '• `/edit-message tipe:"Ticket Body"` → buka modal editor multi-line',
            '• `/reset-message ticketBody` / `/reset-message ALL`',
            '',
            '**Template vars:** `{server}` `{price_header}` `{price_list}` `{price_list:cat}` `{categories_list}`'
        ]
    },
    {
        id: 'products',
        emoji: '📦',
        name: 'Produk & Auto-Role',
        short: 'CRUD produk, role auto-assign + expire',
        lines: [
            '• `/add-product` `/remove-product` `/list-products`',
            '• `/update-product value:vip30 label:"VIP 30 Hari" price:"Rp 30.000"` — edit tanpa hapus',
            '• `/set-product-role` `/remove-product-role` `/list-product-roles`',
            '💡 VIP role + auto-expire (days). Bisa campur produk key & non-key (jasa).',
            '💡 Produk non-key (akun, jasa)? `/add-product ... requires_key:false` → tiket dapat tombol **📦 Kirim Pesanan** (detail dikirim via DM ke pembeli + auto-role + invoice + stats).'
        ]
    },
    {
        id: 'keys',
        emoji: '🔑',
        name: 'Key Manager',
        short: 'Set key produk, list & clear jadwal user',
        lines: ['• `/set-key user:@user value:vip30 key:ABCDE-12345`', '• `/list-keys user:@user`', '• `/clear-schedule user:@user clear_keys:true`']
    },
    {
        id: 'midman',
        emoji: '🤝',
        name: 'Midman / Rekber (Escrow)',
        short: 'Deal escrow 3-pihak + fee otomatis',
        lines: [
            '• `/set-role midman @role` — WAJIB di-set dulu sebelum deal bisa dibuka',
            '• `/set-midman-fee mode:Persen value:5` — fee otomatis per deal (persen / flat, 0 = gratis)',
            '• `/midman-deals` — lihat semua deal rekber aktif di server',
            '💡 Deal 3-pihak (pembeli ⇄ penjual + midman pegang dana). Siapa pun bisa buka lewat tombol **🤝 Rekber** di panel — 3 langkah: item & harga → pilih pembeli → pilih penjual, lalu kedua pihak klik **Setuju Deal**.'
        ]
    },
    {
        id: 'selfrole',
        emoji: '🎭',
        name: 'Self-Role Panel',
        short: 'Panel role pilihan member',
        lines: [
            '• `/setup-selfrole title:... type:button exclusive:false`',
            '• `/selfrole-add` `/selfrole-remove` `/selfrole-list` `/selfrole-delete`',
            '💡 `requires_role:@Verified` — conditional role'
        ]
    },
    {
        id: 'tempvoice',
        emoji: '🎤',
        name: 'Temp Voice',
        short: 'Voice pribadi otomatis saat join trigger',
        lines: ['• `/setup-tempvoice` / `/tempvoice-remove`', '💡 Member join trigger channel → otomatis bikin voice pribadi']
    },
    {
        id: 'announce',
        emoji: '📢',
        name: 'Announce, Embed & Backup',
        short: 'Pengumuman, embed builder, backup data',
        lines: [
            '• `/announce channel:#ch title:... description:...`',
            '• `/send-message` `/embed-builder` `/embed-list` `/embed-cancel`',
            '• `/backup-now` `/backup-list` `/restore-backup` (auto 24h, max 7)'
        ]
    },
    {
        id: 'giveaway',
        emoji: '🎉',
        name: 'Giveaway & Poll',
        short: 'Buat / kelola giveaway & polling',
        lines: [
            '• `/giveaway create channel:#ch prize:... winners:1 duration:60`',
            '• `/giveaway list` `/giveaway end` `/giveaway reroll`',
            '• `/poll create` `/poll list` `/poll close`'
        ]
    },
    {
        id: 'schedule',
        emoji: '⏰',
        name: 'Scheduled Announce & Warn',
        short: 'Pengumuman terjadwal & sistem warn',
        lines: [
            '• `/announce-schedule channel:#ch at:30m recurring?:daily`',
            '• `/announce-list` `/announce-cancel`',
            '• `/warn` `/warn-list` `/warn-remove` `/warn-clear` (3=mute1h, 5=mute1d, 7=kick)'
        ]
    },
    {
        id: 'stats',
        emoji: '📊',
        name: 'Stats & Lainnya',
        short: 'Statistik server/user, audit log, reset config',
        lines: [
            '• `/stats` `/leaderboard metric:messages|vipPurchases|totalSpent` `/my-stats`',
            '• `/set-channel audit-log #ch` — catat admin action',
            '• `/reset-config` — ⚠️ HAPUS SEMUA setting (konfirmasi 2-step)'
        ]
    }
];

// === Helpers ===

function findCategory(id) {
    return HELP_CATEGORIES.find(c => c.id === id) || null;
}

function baseEmbed() {
    return new EmbedBuilder().setColor(EMBED_COLOR).setFooter({ text: FOOTER_TEXT }).setTimestamp();
}

/**
 * Hitung total karakter embed seperti cara Discord menghitung limit 6000
 * (title + description + field name/value + footer + author).
 */
function embedTotalChars(embed) {
    const data = embed.data;
    let total = 0;
    if (data.title) total += data.title.length;
    if (data.description) total += data.description.length;
    for (const f of data.fields || []) {
        total += (f.name?.length || 0) + (f.value?.length || 0);
    }
    if (data.footer?.text) total += data.footer.text.length;
    if (data.author?.name) total += data.author.name.length;
    return total;
}

// === Embed builders ===

/**
 * 🏠 Home — index kategori (ringkas, tanpa daftar command).
 */
function buildHomeEmbed(client, user) {
    const mention = user ? `${user}` : 'Admin';
    // Index kategori dipadatkan 3 per baris biar satu layar (tanpa scroll panjang).
    const names = HELP_CATEGORIES.map(c => `${c.emoji} ${c.name}`);
    const rows = [];
    for (let i = 0; i < names.length; i += 3) {
        rows.push(names.slice(i, i + 3).join(' · '));
    }
    return baseEmbed()
        .setTitle('🤖 COMMUNITY BOT — HELP')
        .setDescription(
            `Halo ${mention}! Anda terverifikasi sebagai **Admin/Staff** (v${BOT_VERSION}).\n` +
                `**${HELP_CATEGORIES.length} kategori command** tersedia.\n\n` +
                `**Cara cepat cari command:**\n` +
                `> 1️⃣ Pilih kategori di dropdown **📂** di bawah\n` +
                `> 2️⃣ Klik **🔍 Cari Command** — ketik kata kunci (mis. \`key\`, \`rekber\`)\n` +
                `> 3️⃣ Atau langsung \`/help search:panel\` tanpa buka menu\n` +
                `> 4️⃣ Klik **📖 Semua Command** untuk daftar lengkap`
        )
        .addFields({ name: `📚 Kategori (${HELP_CATEGORIES.length})`, value: rows.join('\n') });
}

/**
 * 📂 Kategori — detail command satu kategori (embed kecil).
 * Return `null` kalau id tidak dikenal (mis. pesan lama pasca-update bot).
 */
function buildCategoryEmbed(client, categoryId) {
    const cat = findCategory(categoryId);
    if (!cat) return null;
    return baseEmbed()
        .setTitle(`${cat.emoji} ${cat.name}`)
        .setDescription(cat.lines.join('\n'))
        .addFields({
            name: '↩️ Navigasi',
            value: 'Ganti kategori lewat dropdown 📂 · Klik **🏠 Menu Utama** untuk kembali · **🔍 Cari Command** untuk pencarian.'
        });
}

/**
 * 📖 All — daftar lengkap SEMUA command (tampilan klasik).
 * Dipecah ke max 2 embed kalau lewat budget (total gabungan tetap ≤ 6000 —
 * satu pesan bisa punya banyak embed dengan TOTAL 6000).
 * Return array EmbedBuilder (1 atau 2 elemen).
 */
function buildAllEmbeds() {
    const fields = HELP_CATEGORIES.map(c => ({ name: `${c.emoji} ${c.name}`, value: c.lines.join('\n'), inline: false }));
    const desc = `_Daftar lengkap semua command (v${BOT_VERSION})._`;
    const makeEmbed = (fs, part) => {
        const e = baseEmbed()
            .setTitle(part ? `🤖 SEMUA COMMAND (${part})` : '🤖 SEMUA COMMAND')
            .setDescription(part ? `_Lanjutan daftar command (v${BOT_VERSION})._` : desc);
        if (fs.length) e.addFields(fs);
        return e;
    };

    // Budget total semua embed dalam SATU pesan = 6000 (EMBED_LIMITS.TOTAL_CHARS).
    // Ukur pakai builder asli (embedTotalChars) supaya title/footer/desc ikut
    // dihitung — kedua embed sekarang berada dalam SATU pesan (beda dengan
    // v3.9.38 yang kirim 2 pesan terpisah).
    const BUDGET = EMBED_LIMITS.TOTAL_CHARS - 200;
    let first = fields;
    const second = [];
    const totalSize = () =>
        embedTotalChars(makeEmbed(first, null)) + (second.length > 0 ? embedTotalChars(makeEmbed(second, '2/2')) : 0);
    while (first.length > 1 && totalSize() > BUDGET) {
        // Pindahkan field TERAKHIR ke embed kedua (berulang sampai muat).
        second.unshift(first[first.length - 1]);
        first = first.slice(0, -1);
    }
    if (second.length > 0) {
        return [makeEmbed(first, '1/2'), makeEmbed(second, '2/2')];
    }
    return [makeEmbed(fields, null)];
}

// === Search ===

/**
 * Pecah baris kategori jadi "blok": baris bullet (•) + baris lanjutannya
 * (opsi/indent) supaya kalau command match, opsi-opsinya ikut tampil.
 */
function buildBlocks(lines) {
    const blocks = [];
    let current = null;
    for (const line of lines) {
        const isBullet = line.trimStart().startsWith('•');
        if (isBullet || !current) {
            current = [line];
            blocks.push(current);
        } else {
            current.push(line);
        }
    }
    return blocks;
}

/**
 * Cari command di semua kategori. Match: substring case-insensitive di baris
 * command, atau nama/id/deskripsi kategori (kalau nama kategori match, SEMUA
 * isi kategori ditampilkan).
 * Return { query, groups: [{ cat, blocks }], totalBlocks, truncated, emptyQuery }
 */
function searchHelp(rawQuery) {
    const query = String(rawQuery || '').trim().toLowerCase();
    if (!query) return { query: '', groups: [], totalBlocks: 0, truncated: false, emptyQuery: true };

    const groups = [];
    let totalBlocks = 0;
    for (const cat of HELP_CATEGORIES) {
        const catText = `${cat.name} ${cat.short} ${cat.id}`.toLowerCase();
        const wholeCat = catText.includes(query);
        let blocks;
        if (wholeCat) {
            blocks = buildBlocks(cat.lines);
        } else {
            blocks = buildBlocks(cat.lines).filter(block => block.join('\n').toLowerCase().includes(query));
        }
        if (blocks.length > 0) {
            groups.push({ cat, blocks });
            totalBlocks += blocks.length;
        }
    }
    return { query, groups, totalBlocks, truncated: false, emptyQuery: false };
}

/**
 * 🔍 Hasil pencarian.
 */
function buildSearchEmbed(rawQuery) {
    const result = searchHelp(rawQuery);
    const embed = baseEmbed().setTitle('🔍 Hasil Pencarian');

    if (result.emptyQuery) {
        return embed.setDescription(
            'Kata kunci kosong. Klik **🔍 Cari Command** lagi lalu ketik kata kunci (mis. `panel`, `key`, `rekber`).'
        );
    }

    // Cap jumlah baris hasil biar embed tetap kecil & scannable.
    const sections = [];
    let shown = 0;
    let truncated = false;
    for (const group of result.groups) {
        if (shown >= SEARCH_MAX_LINES) {
            truncated = true;
            break;
        }
        const lines = [];
        for (const block of group.blocks) {
            if (shown >= SEARCH_MAX_LINES) {
                truncated = true;
                break;
            }
            lines.push(block.join('\n'));
            shown++;
        }
        sections.push(`**${group.cat.emoji} ${group.cat.name}**\n${lines.join('\n')}`);
    }

    const header =
        `Kata kunci: \`${result.query}\` — ` +
        (result.totalBlocks > 0
            ? `**${result.totalBlocks}** hasil ditemukan`
            : 'tidak ada yang cocok') +
        `\n_Ganti kata kunci lewat tombol 🔍 · 🏠 Menu Utama untuk kembali._`;

    let body;
    if (sections.length === 0) {
        body =
            'Tidak ada command yang cocok. Coba kata kunci lain — mis. `tiket`, `produk`, `role`, `announce`, `warn`, `giveaway`.';
    } else {
        body = sections.join('\n\n');
        if (truncated) {
            body += `\n\n… +hasil lainnya tidak ditampilkan. Coba kata kunci lebih spesifik.`;
        }
    }
    return embed.setDescription(`${header}\n\n${body}`);
}

// === Components ===

/**
 * Baris dropdown kategori — selalu tampil di semua view (navigasi utama).
 */
function buildSelectRow() {
    const select = new StringSelectMenuBuilder()
        .setCustomId(HELP_IDS.SELECT)
        .setPlaceholder('📂 Pilih kategori command…')
        .addOptions(
            // Guard: Discord max 25 opsi per select (19 kategori saat ini —
            // kalau katalog tumbuh > 25, test helpNav gagal duluan).
            HELP_CATEGORIES.slice(0, DISCORD_LIMITS.SELECT_MENU_MAX_OPTIONS).map(
                c =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(c.name)
                        .setValue(c.id)
                        .setDescription(c.short)
                        .setEmoji(c.emoji)
            )
        );
    return new ActionRowBuilder().addComponents(select);
}

/**
 * Baris tombol aksi. `view`: 'home' | kategori/search/all (lainnya).
 * Home: 🔍 Cari + 📖 Semua. View lain: + 🏠 Menu Utama.
 */
function buildButtonRow(view) {
    const buttons = [
        new ButtonBuilder().setCustomId(HELP_IDS.SEARCH_BUTTON).setLabel('🔍 Cari Command').setStyle(ButtonStyle.Primary)
    ];
    if (view !== 'home') {
        buttons.push(new ButtonBuilder().setCustomId(HELP_IDS.HOME_BUTTON).setLabel('🏠 Menu Utama').setStyle(ButtonStyle.Secondary));
    }
    buttons.push(new ButtonBuilder().setCustomId(HELP_IDS.ALL_BUTTON).setLabel('📖 Semua Command').setStyle(ButtonStyle.Secondary));
    return new ActionRowBuilder().addComponents(buttons);
}

/**
 * Komponen lengkap untuk satu view /help.
 */
function buildHelpComponents(view = 'home') {
    return [buildSelectRow(), buildButtonRow(view)];
}

module.exports = {
    HELP_CATEGORIES,
    HELP_IDS,
    SEARCH_MAX_LINES,
    buildHomeEmbed,
    buildCategoryEmbed,
    buildAllEmbeds,
    buildSearchEmbed,
    searchHelp,
    buildHelpComponents,
    buildSelectRow,
    buildButtonRow,
    embedTotalChars
};
