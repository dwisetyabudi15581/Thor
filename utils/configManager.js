const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');

// Default structure (digunakan kalau config.json kosong / rusak / format lama)
const DEFAULTS = {
    roles: {},
    channels: {},
    messages: {
        welcomeTitle: '👋 SELAMAT DATANG!',
        welcomeBody: 'Halo {user}!\n\nSelamat datang di **{server}** 🎉\n\n🔐 Silakan verifikasi dirimu untuk mendapatkan akses penuh ke server.\n\n📊 Kamu adalah member ke-**{count}**!',
        goodbyeTitle: '👋 SELAMAT JALAN',
        goodbyeBody: '**{username}** telah {action} dari server.\n\nSampai jumpa lagi! 👋\n\n📊 Sisa member: **{count}**',
        verifyTitle: '✅ VERIFIKASI SERVER',
        verifyBody: 'Selamat datang di **{server}**!\n\nKlik tombol di bawah untuk diverifikasi dan mendapatkan akses penuh ke seluruh channel.',
        ticketTitle: '🎫 SISTEM TIKET & PRICE LIST',
        ticketBody: 'Butuh bantuan atau ingin membeli key?\n\nKlik tombol di bawah untuk memulai transaksi atau menghubungi staff.'
    },
    colors: {
        success: 3066993,
        danger: 15158332,
        primary: 3447003,
        warning: 15105570,
        info: 5793266
    },
    products: []
};

/**
 * Baca config.json (selalu fresh - anti cache).
 * - Kalau file tidak ada / rusak -> pakai DEFAULTS
 * - Kalau format v1 (flat) -> auto-migrate ke v2 (nested)
 * - Kalau format v2 -> merge dengan DEFAULTS supaya field baru tetap ada
 *
 * P2-4 FIX: sebelumnya pakai `delete require.cache` + `require()` yang
 * rentan race condition dan anti-pattern. Sekarang pakai readFileSync + JSON.parse
 * seperti manager lain.
 */
function getConfig() {
    let raw = {};
    try {
        const fileContent = fs.readFileSync(configPath, 'utf8');
        raw = JSON.parse(fileContent);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            // File ada tapi rusak — log warning. Kalau ENOENT (file belum ada), silent.
            console.warn('⚠️ config.json rusak, pakai DEFAULTS. Pesan:', err.message);
        }
        raw = {};
    }

    // === AUTO-MIGRATE v1 -> v2 ===
    // v1 punya field flat: verifiedRoleId, unverifiedRoleId, invoiceChannelId, welcomeChannelId, goodbyeChannelId
    if (raw.verifiedRoleId || raw.invoiceChannelId) {
        if (!raw.roles) raw.roles = {};
        if (raw.verifiedRoleId && !raw.roles.verified) raw.roles.verified = raw.verifiedRoleId;
        if (raw.unverifiedRoleId && !raw.roles.unverified) raw.roles.unverified = raw.unverifiedRoleId;
        if (raw.adminRoleId && !raw.roles.admin) raw.roles.admin = raw.adminRoleId;

        if (!raw.channels) raw.channels = {};
        if (raw.invoiceChannelId && !raw.channels.invoice) raw.channels.invoice = raw.invoiceChannelId;
        if (raw.welcomeChannelId && !raw.channels.welcome) raw.channels.welcome = raw.welcomeChannelId;
        if (raw.goodbyeChannelId && !raw.channels.goodbye) raw.channels.goodbye = raw.goodbyeChannelId;

        // Auto-save hasil migrasi supaya next time bersih
        try {
            saveConfig({
                roles: raw.roles,
                channels: raw.channels,
                messages: raw.messages || DEFAULTS.messages,
                colors: raw.colors || DEFAULTS.colors,
                products: raw.products || DEFAULTS.products
            });
            console.log('✅ config.json lama (v1) otomatis di-migrate ke v2.');
        } catch (e) {
            console.warn('⚠️ Gagal auto-save migrasi:', e.message);
        }
    }

    // === MERGE dengan DEFAULTS (deep untuk messages) ===
    const config = {
        roles: { ...DEFAULTS.roles, ...(raw.roles || {}) },
        channels: { ...DEFAULTS.channels, ...(raw.channels || {}) },
        messages: { ...DEFAULTS.messages, ...(raw.messages || {}) },
        colors: { ...DEFAULTS.colors, ...(raw.colors || {}) },
        products: Array.isArray(raw.products) ? raw.products : DEFAULTS.products
    };

    return config;
}

/**
 * Simpan config.json dengan format rapi.
 */
function saveConfig(config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Set nilai nested (mis. 'roles.admin' atau 'channels.welcome').
 */
function setField(dotPath, value) {
    const config = getConfig();
    const keys = dotPath.split('.');
    let cur = config;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!cur[keys[i]]) cur[keys[i]] = {};
        cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
    saveConfig(config);
    return config;
}

/**
 * Ganti placeholder {user} {username} {server} {count} {action} dalam teks.
 */
function fillTemplate(text, vars = {}) {
    return text
        .replace(/\{user\}/g, vars.user || '')
        .replace(/\{username\}/g, vars.username || '')
        .replace(/\{server\}/g, vars.server || '')
        .replace(/\{count\}/g, vars.count || '0')
        .replace(/\{action\}/g, vars.action || 'keluar');
}

module.exports = { getConfig, saveConfig, setField, fillTemplate, DEFAULTS };
