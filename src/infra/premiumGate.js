/**
 * Premium Gate — pembatas fitur ala Dyno (v3.15.0).
 *
 * Server yang meng-invite Thor mendapat tier FREE (moderasi inti + komunitas
 * dasar). Fitur penuh (tiket, produk+key VIP, rekber, automod, giveaway,
 * announce, backup, dll.) hanya terbuka setelah server berlangganan:
 * /premium activate <key> oleh admin server (permission ManageGuild).
 *
 * Kapan gate AKTIF? (PREMIUM_GATE di .env: auto [default] | on | off)
 *   - auto → AKTIF hanya di MODE PUBLIK (GUILD_ID kosong). Mode 1 server
 *     (deployment privat) tidak di-gate — perilaku bot tidak berubah
 *     setelah upgrade ke v3.15.0.
 *   - on  → paksa aktif (mode publik + privat).
 *   - off → paksa mati (semua fitur terbuka, mis. untuk self-host bebas).
 *
 * Bypass (tidak pernah di-gate):
 *   - PREMIUM_BYPASS_GUILDS: comma-separated guild id milik pemilik bot
 *     sendiri — server "rumah" tetap full access saat mode publik.
 *   - PREMIUM_ADMIN_IDS: comma-separated Discord user id pemilik bot —
 *     boleh pakai command premium di server manapun (buat demo/jualan),
 *     dan satu-satunya yang bisa /premium gen|keys|revoke.
 *   - Interaksi tanpa konteks guild (DM / unit test mock) → dibiarkan lewat;
 *     permission check router tetap jalan.
 *
 * Gate hanya memfilter CHAT INPUT COMMAND (routeCommand). Interaksi
 * komponen (tombol panel) tidak di-gate — server free tidak bisa MEMBUAT
 * panel premium karena command setup-nya sudah diblokir, sementara tombol
 * verifikasi (fitur free) tetap berfungsi normal.
 *
 * Semua cek sinkron & murah (cache 15 detik di guildPremiumManager) — aman
 * untuk dipanggil di setiap interaction.
 */

const { resolveGuildId, getPrimaryGuildId } = require('./guild');
const { isGuildPremium } = require('../data/guildPremiumManager');

/**
 * Command yang tetap tersedia tanpa langganan — tier FREE.
 *
 * Prinsip pembagian (ala Dyno/MEE6):
 *   - Moderasi inti & keamanan server free (server tetap aman walau tidak
 *     bayar — timeout/purge/kick/ban/warn + verifikasi anti-raid).
 *   - Fitur member biasa free (my-stats, rank, leaderboard, afk, boosters).
 *   - SEMUA fitur jualan/otomasi/engagement = premium (tiket, produk+key,
 *     rekber, automod, responder, announce, embed, giveaway, poll, selfrole,
 *     temp voice, leveling setup, backup, serverstats, send-message, dst).
 */
const FREE_COMMANDS = [
    // bantuan & langganan itu sendiri
    'help',
    'premium',
    // moderasi inti (least privilege: permission Discord tetap dicek handler)
    'timeout',
    'untimeout',
    'purge',
    'kick',
    'ban',
    'unban',
    'warn',
    'warn-list',
    'warn-remove',
    'warn-clear',
    // keamanan dasar (verifikasi anti-raid)
    'setup-verify',
    'set-verify-button',
    'config-show',
    // komunitas dasar (member biasa)
    'my-stats',
    'rank',
    'leaderboard',
    'leaderboard-level',
    'boosters',
    'afk',
    'afk-clear'
];

/** Split comma-separated env jadi array string bersih. */
function parseIdList(raw) {
    return String(raw || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

/** PREMIUM_GATE: 'auto' (default) | 'on' | 'off'. */
function isGateEnabled() {
    const flag = (process.env.PREMIUM_GATE || 'auto').trim().toLowerCase();
    if (flag === 'on') return true;
    if (flag === 'off') return false;
    // auto: hanya mode publik (GUILD_ID kosong) yang di-gate.
    return getPrimaryGuildId() === null;
}

/** Guild bypass permanen (server sendiri pemilik bot). */
function isBypassGuild(guildId) {
    if (!guildId) return false;
    const list = parseIdList(process.env.PREMIUM_BYPASS_GUILDS);
    return list.includes(String(guildId));
}

/** Pemilik bot (bisa pakai command premium di mana pun + kelola key). */
function isPremiumAdmin(userId) {
    if (!userId) return false;
    const list = parseIdList(process.env.PREMIUM_ADMIN_IDS);
    return list.includes(String(userId));
}

/**
 * Cek akses sebuah slash command terhadap gate premium.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {{ allowed: boolean, reason: 'gate-off'|'no-guild'|'bypass-guild'|'premium-admin'|'free-command'|'guild-premium'|'blocked' }}
 *   reason 'blocked' = satu-satunya kondisi tolak.
 */
function checkCommandAccess(interaction) {
    if (!isGateEnabled()) return { allowed: true, reason: 'gate-off' };

    const guildId = resolveGuildId(interaction);
    // DM / mock test tanpa konteks guild → tidak ada server yang bisa
    // di-gate; permission check router tetap berjalan setelahnya.
    if (!guildId) return { allowed: true, reason: 'no-guild' };

    if (isBypassGuild(guildId)) return { allowed: true, reason: 'bypass-guild' };
    if (isPremiumAdmin(interaction.user?.id)) return { allowed: true, reason: 'premium-admin' };

    const commandName = interaction.commandName;
    if (FREE_COMMANDS.includes(commandName)) return { allowed: true, reason: 'free-command' };

    if (isGuildPremium(guildId)) return { allowed: true, reason: 'guild-premium' };

    return { allowed: false, reason: 'blocked' };
}

/**
 * Bangun embed upsell untuk command yang diblokir gate.
 * Ephemeral, informatif, langsung kasih tahu cara aktivasi.
 */
function buildUpsellEmbed(guildName) {
    const { EmbedBuilder } = require('discord.js');
    const display = guildName || 'Server ini';
    return new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle('🔒 Thor Premium')
        .setDescription(
            `${display} belum berlangganan — command ini bagian fitur **Premium**.\n\n` +
            '**Gratis sekarang:** moderasi inti (timeout, purge, kick, ban, warn), verifikasi, rank, leaderboard, AFK.\n' +
            '**Premium:** tiket & panel jualan, produk + key VIP, rekber/midman, automod, giveaway, poll, self-role, temp voice, announce, backup, server stats, dan lainnya.\n\n' +
            '🔑 **Cara aktifkan:** beli key dari pemilik bot, lalu jalankan `/premium activate <key>` (admin server).'
        )
        .addFields(
            { name: '💬 Cek status', value: '`/premium status`', inline: true },
            { name: '📖 Daftar lengkap', value: '`/help`', inline: true }
        )
        .setFooter({ text: 'Thor · akses penuh untuk seluruh member server' })
        .setTimestamp();
}

module.exports = {
    FREE_COMMANDS,
    isGateEnabled,
    isBypassGuild,
    isPremiumAdmin,
    checkCommandAccess,
    buildUpsellEmbed,
    // helper untuk unit test
    _parseIdList: parseIdList
};
