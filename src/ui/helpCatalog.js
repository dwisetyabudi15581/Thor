/**
 * Help Catalog — single source of truth untuk isi /help (v3.9.44).
 *
 * v3.9.44 REDESIGN (user request: "/warn kok masuk kategori Scheduled
 * Announce — tolong baca & sync semua fitur, susun ulang biar mudah
 * dipahami"):
 *   - /warn* PINDAH ke kategori Moderasi (dulu nyangkut di "Scheduled
 *     Announce & Warn" — janggal). Moderasi kini satu pintu: warn →
 *     timeout → kick → ban + purge.
 *   - 20 kategori diurut dari yang paling sering dipakai: 🚀 Panduan Cepat
 *     (BARU — urutan setup server baru) → Moderasi → jualan (produk, key,
 *     panel, kategori, rekber) → pengawasan (log, auto-mod) → engagement
 *     (giveaway, leveling, role) → utility (pesan, backup, stats).
 *   - Kategori lama yang amburadul dirapikan: "Scheduled Announce & Warn"
 *     → murni Pengumuman; "Announce, Embed & Backup" → dipecah jadi
 *     "Pesan & Embed Builder" + "Backup & Maintenance"; "Stats & Lainnya"
 *     → murni Statistik (audit-log pindah ke Log & Channel, reset-config
 *     pindah ke Backup); set-channel (tadinya tersebar di 3 kategori) kini
 *     satu pintu di Log & Channel.
 *   - Setiap command diberi penjelasan 1 frasa — admin baru tidak perlu
 *     menebak fungsi dari nama command saja.
 *
 * Arsitektur navigator (tidak berubah dari v3.9.39):
 *   - 🏠 Home   : ringkasan kategori + tugas populer + dropdown 📂 + tombol
 *   - 📂 Kategori: detail command per kategori (embed kecil, gampang dibaca)
 *   - 🔍 Search : modal kata kunci ATAU /help search:<keyword> → hasil instan
 *   - 📖 All    : daftar lengkap (dengan guard budget — lihat buildAllEmbeds)
 * Semua view di-render ke SATU pesan ephemeral (interaction.update) — tidak
 * ada spam pesan baru tiap kali ganti kategori.
 *
 * Modul ini dipakai bersama oleh:
 *   - src/commands/help.js      (slash /help + opsi search)
 *   - src/interactions/help.js  (dropdown/tombol/modal navigation)
 *
 * Kontrak Discord yang dijaga (di-unit-test di tests/unit/helpNav.test.js):
 *   - StringSelectMenu max 25 opsi (saat ini 20 kategori — ada guard test).
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
const { truncateUtf8Safe } = require('../infra/text');

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
 * Katalog kategori help (v3.9.44 — urutan = prioritas pemakaian).
 * `lines` = isi detail kategori (baris command).
 * `short` = deskripsi singkat untuk opsi dropdown (≤100 char, di-guard test).
 */
const HELP_CATEGORIES = [
    {
        id: 'quickstart',
        emoji: '🚀',
        name: 'Panduan Cepat',
        short: 'Baru pakai bot? Urutan setup server dari nol',
        lines: [
            '**Baru pakai bot? Ikuti urutan ini:**',
            '1️⃣ `/set-role verified @Verified` — role member terverifikasi',
            '2️⃣ `/add-category` + `/add-product` — siapkan katalog',
            '3️⃣ `/setup-ticket-panel` — pasang panel tiket',
            '4️⃣ `/setup-verify` — verifikasi member baru',
            '5️⃣ `/set-channel server-log #log` — aktifkan log',
            '💡 Lanjut eksplor kategori lain lewat dropdown 📂.'
        ]
    },
    {
        id: 'moderation',
        emoji: '🛡️',
        name: 'Moderasi',
        short: 'Warn, timeout, kick, ban, purge — satu pintu',
        lines: [
            '**Riwayat pelanggaran:**',
            '• `/warn user reason` — peringatan (3=mute 1j, 5=mute 1h, 7=kick)',
            '• `/warn-list user` — riwayat warn + sanksi · `/warn-remove` `/warn-clear`',
            '**Tindakan langsung:**',
            '• `/timeout user menit reason` — mute (maks 40320 = 28 hari) · `/untimeout`',
            '• `/kick` keluarkan · `/ban` blokir · `/unban` buka blokir',
            '• `/purge amount:100 user?` — hapus massal pesan (1-100)',
            '💡 Tercatat otomatis di `/warn-list` + log server. Role lebih tinggi kebal tindakan.'
        ]
    },
    {
        id: 'products',
        emoji: '📦',
        name: 'Produk & Auto-Role',
        short: 'CRUD produk + role otomatis saat beli',
        lines: [
            '• `/add-product value:vip30 label:"VIP 30 Hari" price:"Rp 30.000"` — produk key',
            '• `/add-product ... requires_key:false` — jasa/akun (detail dikirim DM pembeli)',
            '• `/update-product value:vip30 label:"..."` — edit · `/remove-product` · `/list-products`',
            '• `/set-product-role` — role otomatis saat beli (+ expire) · `/remove-product-role` `/list-product-roles`'
        ]
    },
    {
        id: 'keys',
        emoji: '🔑',
        name: 'Key Manager',
        short: 'Stok key produk & jadwal expire member',
        lines: [
            '• `/set-key user:@user value:vip30 key:ABCDE-12345` — set key produk',
            '• `/list-keys user:@user` — key member · `/clear-schedule user clear_keys:true` — bersihkan'
        ]
    },
    {
        id: 'panels',
        emoji: '🎫',
        name: 'Panel Tiket & Verifikasi',
        short: 'Pasang panel tiket & verifikasi member',
        lines: [
            '• `/setup-ticket-panel` — panel multi-kategori (opsi: `title` `body` `categories` `color` `image` `footer` `channel` `use_dropdown`)',
            '• `/list-panels` `/update-panel` `/refresh-panel` `/delete-panel` — kelola panel',
            '• `/setup-verify` — verifikasi member baru · `/set-verify-button` — kustom tombol',
            '• `/setup-ticket` — panel legacy 1 kategori'
        ]
    },
    {
        id: 'categories',
        emoji: '🗂️',
        name: 'Kategori Tiket',
        short: 'CRUD kategori + auto-split 3 kategori',
        lines: [
            '• `/add-category id:jasa label:"Jasa" emoji:🎮 style:Success requires_key:false`',
            '• `/update-category id:jasa label:...` — edit · `/remove-category` · `/list-categories`',
            '💡 Berproduk → dropdown; tanpa produk → langsung buat tiket.',
            '**Auto-Split** 3 kategori: 🎫 TRANSAKSI (produk) · 🎫 BANTUAN (help/report) · 🤝 REKBER (deal). Nama custom: `ticketCategoryKey` `ticketCategoryNoKey` `midman.category`'
        ]
    },
    {
        id: 'midman',
        emoji: '🤝',
        name: 'Midman / Rekber (Escrow)',
        short: 'Deal escrow 3-pihak + fee otomatis',
        lines: [
            '• `/set-role midman @role` — WAJIB di-set sebelum deal dibuka',
            '• `/set-midman-fee mode:Persen value:5` — fee per deal (persen/flat, 0=gratis)',
            '• `/midman-deals` — semua deal aktif',
            '💡 Escrow 3-pihak: pembeli ⇄ penjual, midman pegang dana. Buka lewat tombol **🤝 Rekber** di panel — 3 langkah sampai kedua pihak **Setuju Deal**.'
        ]
    },
    {
        id: 'logging',
        emoji: '📜',
        name: 'Log & Channel',
        short: 'Aktifkan server-log, audit, transcript, welcome',
        lines: [
            '• `/set-channel server-log #ch` — log pesan hapus/edit, join/leave, ban, role',
            '• `/set-channel audit-log #ch` — aksi admin · `transcript #ch` — arsip tiket',
            '• `/set-channel welcome/goodbye/invoice #ch` — sambutan & invoice',
            '• `/remove-channel tipe` — matikan salah satu',
            'ℹ️ Tanpa `server-log`, event server tidak dicatat.'
        ]
    },
    {
        id: 'automod',
        emoji: '🤖',
        name: 'Anti-Spam & Auto-Mod',
        short: 'Blocklist kata, whitelist link, action otomatis',
        lines: [
            '• `/set-automod` `/automod-show` `/automod-toggle` — aktifkan & lihat',
            '• `/add-word words:kata1,kata2 action:Mute_10_menit` — kata + sanksinya',
            '• `/remove-word` `/list-words` · `/add-word tipe:Exempt_(kata)` — whitelist',
            '• `/add-link-whitelist` `/remove-link-whitelist` — link diizinkan',
            '💡 Whole-word: "asu" tidak match "asus"'
        ]
    },
    {
        id: 'responder',
        emoji: '💬',
        name: 'Auto-Responder',
        short: 'Auto-reply FAQ saat member kirim trigger',
        lines: [
            '• `/add-responder trigger:halo reply:...` — pasang auto-reply (cocok untuk FAQ)',
            '• `/list-responder` · `/remove-responder` — lihat & hapus'
        ]
    },
    {
        id: 'roles',
        emoji: '🎭',
        name: 'Role & Self-Role',
        short: 'Role sistem + panel role pilihan member',
        lines: [
            '• `/set-role verified @role` — role sistem (verified/unverified/admin/**midman**) · `/remove-role`',
            '• `/setup-selfrole title:... type:button` — panel role pilihan member',
            '• `/selfrole-add` `/selfrole-remove` — kelola daftar · `/selfrole-list` `/selfrole-delete`',
            '💡 `requires_role:@Verified` — role terkunci syarat'
        ]
    },
    {
        id: 'leveling',
        emoji: '📊',
        name: 'Leveling',
        short: 'XP per pesan + role otomatis saat level up',
        lines: [
            '• `/setup-leveling` — aktifkan XP per pesan',
            '• `/add-level-role level:5 role:@VIP` — role saat naik level · `/list-level-roles` `/remove-level-role`',
            '• `/rank` — XP sendiri · `/leaderboard-level` — top member'
        ]
    },
    {
        id: 'afk',
        emoji: '💤',
        name: 'AFK System',
        short: 'Auto-reply saat user AFK di-mention',
        lines: [
            '• `/afk alasan:...` — set AFK (bot auto-reply saat di-mention)',
            '• `/afk-clear` — kembali aktif · `/afk-list` — siapa saja AFK'
        ]
    },
    {
        id: 'giveaway',
        emoji: '🎉',
        name: 'Giveaway & Poll',
        short: 'Buat / kelola giveaway & polling',
        lines: [
            '• `/giveaway create channel:#ch prize:... winners:1 duration:60` — mulai',
            '• `/giveaway list` `/giveaway end` `/giveaway reroll` — kelola',
            '• `/poll create` `/poll list` `/poll close` — polling'
        ]
    },
    {
        id: 'announce',
        emoji: '📢',
        name: 'Pengumuman Terjadwal',
        short: 'Kirim pengumuman sekarang / terjadwal',
        lines: [
            '• `/announce channel:#ch title:... description:...` — kirim pengumuman',
            '• `/announce-schedule at:30m recurring:daily` — terjadwal (sekali/berulang)',
            '• `/announce-list` `/announce-cancel` — lihat & batalkan jadwal'
        ]
    },
    {
        id: 'messages',
        emoji: '✏️',
        name: 'Pesan & Embed Builder',
        short: 'Edit teks sistem + kirim embed custom',
        lines: [
            '**Teks sistem:** `/set-message ticketBody teks...` · `/edit-message` (modal) · `/reset-message` · `/list-messages`',
            '**Embed custom:** `/send-message` (form) · `/embed-builder` · `/embed-list` `/embed-cancel`',
            '💡 Vars: `{server}` `{price_header}` `{price_list}` `{price_list:cat}` `{categories_list}`'
        ]
    },
    {
        id: 'tempvoice',
        emoji: '🎤',
        name: 'Voice Pribadi',
        short: 'Voice otomatis saat member join trigger',
        lines: [
            '• `/setup-tempvoice` — pasang trigger channel · `/tempvoice-remove` — matikan',
            '💡 Join trigger → otomatis bikin voice pribadi + panel kontrol (rename, lock, transfer)'
        ]
    },
    {
        id: 'backup',
        emoji: '💾',
        name: 'Backup & Maintenance',
        short: 'Backup data, restore, reset konfigurasi',
        lines: [
            '• `/backup-now` — backup sekarang (auto 24 jam, maks 7 slot)',
            '• `/backup-list` `/restore-backup` — lihat & pulihkan',
            '• `/reset-config` — ⚠️ HAPUS SEMUA konfigurasi (2-step)'
        ]
    },
    {
        id: 'stats',
        emoji: '📈',
        name: 'Statistik',
        short: 'Statistik server, leaderboard, transaksi',
        lines: [
            '• `/stats` — statistik server (member, tiket, transaksi)',
            '• `/leaderboard metric:messages|vipPurchases|totalSpent` — peringkat',
            '• `/my-stats` — statistik transaksi pribadi'
        ]
    },
    {
        id: 'info',
        emoji: '📋',
        name: 'Informasi Bot',
        short: 'Pusat bantuan & lihat semua konfigurasi',
        lines: [
            '• `/help` — pusat bantuan (atau `/help search:kata kunci`)',
            '• `/config-show` — lihat semua konfigurasi bot sekaligus'
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
 * 🏠 Home — index kategori + tugas populer (ringkas, tanpa daftar command).
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
            `Halo ${mention}! Anda masuk sebagai **Admin/Staff** — ini pusat kendali bot (v${BOT_VERSION}), **${HELP_CATEGORIES.length} kategori command**.\n\n` +
                `**Butuh apa sekarang?**\n` +
                `> 🛡️ Ada member nakal? → **Moderasi** (warn/timeout/kick/ban)\n` +
                `> 🛒 Mau mulai jualan? → **Panduan Cepat** · **Produk** · **Midman/Rekber**\n` +
                `> 👀 Mau pantau server? → **Log & Channel**\n` +
                `> 🎉 Server sepi? → **Giveaway & Poll** · **Leveling**\n\n` +
                `**Cara pakai:**\n` +
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
 * Return array 1 EmbedBuilder (kontrak array dipertahankan).
 *
 * v3.9.40 REWRITE: dalam SATU pesan, TOTAL semua embed = 6000 char —
 * "auto-split 2 embed" v3.9.39 TIDAK menambah budget sama sekali (jalur itu
 * dead code — konten saat ini 5.4K < 5.800 — dan kalau katalog tumbuh, split
 * justru bisa bikin total overshoot + embed 1/2 kebagian deskripsi "Lanjutan"
 * yang salah). Sekarang 1 embed dengan GUARANTEE muat selalu:
 *   - Guard 1: setiap field value di-cap 1024 (truncate surrogate-safe + note).
 *   - Guard 2: max 25 field (Discord; saat ini 20 kategori).
 *   - Guard 3: kalau total > budget (5.800), kategori paling belakang di-drop
 *     bergantian + note pengganti yang mengarah ke 📂 dropdown / 🔍 Cari —
 *     total pesan TIDAK PERNAH lewat 6.000, untuk ukuran kategori apa pun.
 */
function buildAllEmbeds() {
    // Guard 1: field value ≤ 1024 — sisakan ruang utk note truncation.
    const capField = lines => {
        const text = lines.join('\n');
        if (text.length <= EMBED_LIMITS.FIELD_VALUE) return text;
        return truncateUtf8Safe(text, EMBED_LIMITS.FIELD_VALUE - 45) + '\n… +baris lainnya tidak ditampilkan.';
    };
    // Guard 2: slice 25 — kategori ke-26+ tidak pernah masuk addFields.
    // (const: hanya di-mutate via pop, tidak pernah di-reassign.)
    const fields = HELP_CATEGORIES.slice(0, EMBED_LIMITS.FIELDS_COUNT).map(c => ({
        name: `${c.emoji} ${c.name}`,
        value: capField(c.lines),
        inline: false
    }));

    const droppedNote = n =>
        `\n\n… +${n} kategori lainnya tidak dimuat (batas ukuran 1 pesan) — pakai 📂 dropdown atau 🔍 Cari Command.`;
    const build = (fs, extra) =>
        baseEmbed()
            .setTitle('🤖 SEMUA COMMAND')
            .setDescription(`_Daftar lengkap semua command (v${BOT_VERSION})._${extra || ''}`)
            .addFields(fs);

    // Budget total SEMUA embed dalam 1 pesan = 6.000 — slack 200 utk overhead
    // note + hitungan embedTotalChars (title/footer ikut dihitung).
    const BUDGET = EMBED_LIMITS.TOTAL_CHARS - 200;
    let dropped = 0;
    let embed = build(fields, '');
    // Guard 3: drop kategori paling belakang sampai total muat (min 1 field).
    while (fields.length > 1 && embedTotalChars(embed) > BUDGET) {
        fields.pop();
        dropped++;
        embed = build(fields, droppedNote(dropped));
    }
    return [embed];
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
    // v3.9.40 FIX: cap input 100 char sebelum diproses. Registry slash option
    // kini juga max_length:100, tapi builder ini dipakai DUA pintu (slash + modal)
    // dan modal lama/pesan lama masih bisa lewat — defensive di satu titik ini
    // menutup semua jalur. Tanpa cap, query ribuan char di-echo ke embed hasil
    // → description > 4096 → EmbedBuilder.setDescription throw (uncaught).
    const query = String(rawQuery || '')
        .slice(0, 100)
        .trim()
        .toLowerCase();
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

    // v3.9.40 FIX: backtick di query bisa menutup inline-code header dan
    // merusak styling sisa embed — sanitize untuk display (match tetap pakai
    // query mentah, hasil identik).
    const safeQuery = result.query.replace(/`/g, "'");
    const header =
        `Kata kunci: \`${safeQuery}\` — ` +
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
            // Guard: Discord max 25 opsi per select (20 kategori saat ini —
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
