/**
 * Embed Payload — validasi + builder untuk embed dari WEB (v3.20.0).
 *
 * Kenapa ada: sejak v3.20.0 embed bisa dibangun dari web dashboard (Embed
 * Builder lengkap + balasan Custom Command) DAN dari Discord (/embed-builder,
 * /send-message). Aturan validasi harus SATU di semua jalur itu — persis
 * pola normalizeDisabledList (commands.js) — supaya tidak pernah ada
 * perbedaan batas antara web dan Discord.
 *
 * Bentuk data (plain object — bebas discord.js, bisa disimpan ke JSON):
 *   {
 *     title:        string ≤256
 *     description:  string ≤4096
 *     color:        integer 0..0xFFFFFF
 *     authorName:   string ≤256
 *     authorIconURL: URL string ≤500 (http/https)
 *     thumbnail:    URL string ≤500
 *     image:        URL string ≤500
 *     footerText:   string ≤2048
 *     footerIconURL: URL string ≤500
 *     timestamp:    boolean
 *     fields:       [{ name ≤256, value ≤1024, inline boolean }] maks 25
 *   }
 *
 * Batas angka = batas asli Discord API (title 256, description 4096, dsb).
 * Total gabungan semua teks embed maks 6000 karakter (aturan Discord).
 */

// Batas resmi Discord API.
const CAPS = {
    title: 256,
    description: 4096,
    authorName: 256,
    footerText: 2048,
    fieldName: 256,
    fieldValue: 1024,
    maxFields: 25,
    url: 500,
    total: 6000
};

/** Trim aman: null/undefined → string kosong. */
function s(v) {
    return typeof v === 'string' ? v.trim() : '';
}

/**
 * URL valid? Hanya http/https + panjang wajar. Discord menolak yang lain
 * saat kirim — lebih baik ditolak di sini dengan pesan jelas.
 */
function validUrl(v) {
    return /^https?:\/\/\S+$/i.test(v) && v.length <= CAPS.url;
}

/** Total karakter embed (aturan Discord 6000). */
function totalEmbedLength(def) {
    let total = 0;
    total += s(def.title).length;
    total += s(def.description).length;
    total += s(def.authorName).length;
    total += s(def.footerText).length;
    for (const f of def.fields || []) {
        total += s(f.name).length + s(f.value).length;
    }
    return total;
}

/**
 * Apakah def embed ini kosong total (tidak ada satu pun elemen terisi)?
 * Dipakai pengecekan "minimal content ATAU embed harus terisi".
 */
function isEmbedEmpty(def) {
    if (!def || typeof def !== 'object') return true;
    return (
        !s(def.title) &&
        !s(def.description) &&
        !s(def.authorName) &&
        !s(def.footerText) &&
        !s(def.thumbnail) &&
        !s(def.image) &&
        !(Array.isArray(def.fields) && def.fields.some((f) => s(f.name) || s(f.value)))
    );
}

/**
 * Validasi + normalisasi embed dari input mentah (web dashboard / API).
 * Semua field opsional; yang kosong dibuang supaya penyimpanan bersih.
 *
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 *   value = def ternormalisasi (mungkin object kosong {} kalau input kosong).
 */
function normalizeEmbedDef(raw) {
    const value = {
        title: '',
        description: '',
        color: 0x5865f2,
        authorName: '',
        authorIconURL: '',
        thumbnail: '',
        image: '',
        footerText: '',
        footerIconURL: '',
        timestamp: false,
        fields: []
    };
    if (!raw || typeof raw !== 'object') return { ok: true, value };

    const title = s(raw.title);
    if (title.length > CAPS.title) return { ok: false, error: `Title maksimal ${CAPS.title} karakter` };
    value.title = title;

    const description = s(raw.description);
    if (description.length > CAPS.description)
        return { ok: false, error: `Description maksimal ${CAPS.description} karakter` };
    value.description = description;

    // Warna: integer 0..0xFFFFFF. String hex ("#5865f2") diterima juga.
    let color = 0x5865f2;
    if (raw.color !== undefined && raw.color !== null) {
        if (typeof raw.color === 'number' && Number.isInteger(raw.color) && raw.color >= 0 && raw.color <= 0xffffff) {
            color = raw.color;
        } else if (typeof raw.color === 'string' && /^#?[0-9a-fA-F]{6}$/.test(raw.color.trim())) {
            color = parseInt(raw.color.trim().replace('#', ''), 16);
        } else {
            return { ok: false, error: 'Warna tidak valid (harus integer 0-16777215 atau hex #RRGGBB)' };
        }
    }
    value.color = color;

    const authorName = s(raw.authorName);
    if (authorName.length > CAPS.authorName) return { ok: false, error: `Nama author maksimal ${CAPS.authorName} karakter` };
    value.authorName = authorName;

    const footerText = s(raw.footerText);
    if (footerText.length > CAPS.footerText) return { ok: false, error: `Footer maksimal ${CAPS.footerText} karakter` };
    value.footerText = footerText;

    for (const [key, label] of [
        ['authorIconURL', 'Icon author'],
        ['thumbnail', 'Thumbnail'],
        ['image', 'Image'],
        ['footerIconURL', 'Icon footer']
    ]) {
        const url = s(raw[key]);
        if (!url) continue;
        if (!validUrl(url)) return { ok: false, error: `${label} harus URL http(s) yang valid (maks ${CAPS.url} char)` };
        value[key] = url;
    }

    value.timestamp = raw.timestamp === true;

    if (raw.fields !== undefined && raw.fields !== null) {
        if (!Array.isArray(raw.fields)) return { ok: false, error: 'Fields harus berupa array' };
        if (raw.fields.length > CAPS.maxFields) return { ok: false, error: `Maksimal ${CAPS.maxFields} field per embed` };
        for (const f of raw.fields) {
            if (!f || typeof f !== 'object') return { ok: false, error: 'Field tidak valid' };
            const name = s(f.name);
            const fv = s(f.value);
            if (!name && !fv) continue; // field kosong → skip
            if (name.length > CAPS.fieldName) return { ok: false, error: `Nama field maksimal ${CAPS.fieldName} karakter` };
            if (fv.length > CAPS.fieldValue) return { ok: false, error: `Isi field maksimal ${CAPS.fieldValue} karakter` };
            value.fields.push({ name, value: fv, inline: f.inline === true });
        }
    }

    const total = totalEmbedLength(value);
    if (total > CAPS.total) {
        return { ok: false, error: `Total teks embed maksimal ${CAPS.total} karakter (sekarang ${total})` };
    }

    return { ok: true, value };
}

/**
 * Bangun EmbedBuilder discord.js dari def yang SUDAH dinormalisasi.
 * Pemanggil bertanggung jawab normalizeEmbedDef dulu (kecuali def internal
 * yang sudah bersih — mis. dari customCommandManager).
 *
 * @param {object} def        def embed ternormalisasi
 * @param {Function} EmbedBuilderClass kelas EmbedBuilder discord.js (di-inject
 *                            supaya file ini tetap enak di-mock saat unit test)
 */
function buildEmbedFromDef(def, EmbedBuilderClass) {
    const embed = new EmbedBuilderClass().setColor(def.color ?? 0x5865f2);
    if (def.title) embed.setTitle(def.title);
    if (def.description) embed.setDescription(def.description);
    if (def.authorName) {
        const author = { name: def.authorName };
        if (def.authorIconURL) author.iconURL = def.authorIconURL;
        embed.setAuthor(author);
    }
    if (def.thumbnail) embed.setThumbnail(def.thumbnail);
    if (def.image) embed.setImage(def.image);
    if (def.footerText) {
        const footer = { text: def.footerText };
        if (def.footerIconURL) footer.iconURL = def.footerIconURL;
        embed.setFooter(footer);
    }
    if (def.timestamp === true) embed.setTimestamp();
    for (const f of def.fields || []) {
        embed.addFields({ name: f.name, value: f.value, inline: f.inline === true });
    }
    return embed;
}

module.exports = {
    CAPS,
    normalizeEmbedDef,
    buildEmbedFromDef,
    totalEmbedLength,
    isEmbedEmpty
};
