/**
 * Premium command domain — /premium (v3.15.0).
 *
 * Slash command: /premium — kelola langganan Thor Premium server (ala Dyno).
 *
 * Subcommand & siapa yang boleh:
 *   - status   → SEMUA orang (lihat status langganan server + fitur free).
 *   - activate → admin server (permission ManageGuild) — tukar key jadi
 *                langganan untuk SELURUH server.
 *   - gen      → pemilik bot saja (PREMIUM_ADMIN_IDS) — bikin key lokal.
 *   - keys     → pemilik bot saja — list key lokal + langganan aktif.
 *   - revoke   → pemilik bot saja — cabut langganan guild (refund).
 *
 * Provider key:
 *   - local  (default): pool key lokal data/guildPremium.json (dibuat /premium gen).
 *   - remote (opsional): PREMIUM_API_URL + PREMIUM_API_TOKEN di .env → key
 *     divalidasi & dikonsumsi ke dashboard web (POST /api/bot/premium).
 *     Key web scope "guild" yang dibuat admin di dashboard.
 *
 * Aktivasi server TIDAK mengubah data user/role VIP lama (sistem produk
 * member /set-key tetap bekerja seperti sebelumnya untuk server premium).
 */

const { MessageFlags, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { safeEditReply, logAudit } = require('./_shared');
const { resolveGuildId } = require('../infra/guild');
const pm = require('../data/guildPremiumManager');
const { isPremiumAdmin } = require('../infra/premiumGate');

// ====================================================
// === Provider remote (dashboard web) — best effort ===
// ====================================================

/** Konfigurasi provider remote dari env (null kalau tidak diset lengkap). */
function remoteProviderConfig() {
    const url = (process.env.PREMIUM_API_URL || '').trim().replace(/\/$/, '');
    const token = (process.env.PREMIUM_API_TOKEN || '').trim();
    if (!url || !token) return null;
    return { url, token };
}

/**
 * Validasi + konsumsi key ke dashboard web.
 * @returns {Object} { ok, plan, days } saat valid; { ok:false, reason, message } kalau tidak.
 */
async function redeemRemoteKey({ key, guildId, guildName, activatedBy, activatedByName }) {
    const cfg = remoteProviderConfig();
    if (!cfg) return { ok: false, reason: 'not-configured' };

    let res;
    try {
        res = await fetch(`${cfg.url}/api/bot/premium`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-bot-token': cfg.token },
            body: JSON.stringify({ key, guildId, guildName, activatedBy, activatedByName }),
            signal: AbortSignal.timeout(10_000) // jangan gantung interaction Discord
        });
    } catch (err) {
        return { ok: false, reason: 'unreachable', message: err.message };
    }

    let body = {};
    try {
        body = await res.json();
    } catch (_) {
        body = {};
    }
    if (res.ok && body.ok) {
        return { ok: true, plan: body.plan, days: Number(body.days) || 0 };
    }
    // 4xx dari API = jawaban bisnis (key salah/used/scope salah) — bukan error teknis.
    if (res.status >= 400 && res.status < 500) {
        return { ok: false, reason: 'rejected', message: body.error || `HTTP ${res.status}` };
    }
    return { ok: false, reason: 'server-error', message: body.error || `HTTP ${res.status}` };
}

// ====================================================
// === Helper tampilan ===
// ====================================================

function statusEmbed(guildId, guildName) {
    const status = pm.getGuildStatus(guildId);
    const display = guildName || 'Server ini';
    const embed = new EmbedBuilder()
        .setColor(status.tier ? 0xf59e0b : 0x71717a)
        .setTitle(status.tier ? '✨ Thor Premium Aktif' : 'Thor Free')
        .setDescription(
            status.tier === 'lifetime'
                ? `${display} berlangganan **Premium Lifetime** — akses penuh seluruh fitur.`
                : status.tier === 'premium'
                    ? `${display} berlangganan **Premium** — akses penuh seluruh fitur.`
                    : `${display} memakai tier **Free**: moderasi inti, verifikasi, rank, leaderboard, dan AFK.\nAktifkan Premium untuk tiket jualan, produk + key VIP, rekber, automod, giveaway, dan lainnya.`
        )
        .setFooter({ text: 'Thor Premium' })
        .setTimestamp();

    if (status.tier === 'premium' && status.expireAt) {
        embed.addFields({ name: '⏳ Berlaku sampai', value: pm.formatRemaining(status.expireAt), inline: true });
        embed.addFields({ name: '📦 Paket terakhir', value: pm.PLANS[status.plan]?.label || status.plan, inline: true });
    } else if (status.tier === 'lifetime') {
        embed.addFields({ name: '♾️ Masa aktif', value: 'Seumur hidup', inline: true });
    } else {
        embed.addFields({ name: '🔑 Cara upgrade', value: '`/premium activate <key>`', inline: true });
    }
    return embed;
}

/** Pesan sukses aktivasi. */
function activatedEmbed(entry) {
    const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('🎉 Thor Premium Aktif!')
        .setDescription(
            `Key **${pm.maskKey(entry.keyCode)}** berhasil ditukar — **seluruh member server sekarang bisa memakai semua fitur Thor**.`
        )
        .addFields(
            { name: '📦 Paket', value: pm.PLANS[entry.plan]?.label || entry.plan, inline: true },
            { name: '⏳ Berlaku', value: pm.formatRemaining(entry.expireAt), inline: true },
            { name: '🌐 Sumber key', value: entry.source === 'remote' ? 'Dashboard web' : 'Lokal', inline: true }
        )
        .setFooter({ text: 'Terima kasih sudah berlangganan!' })
        .setTimestamp();
    return embed;
}

// ====================================================
// === Handler utama ===
// ====================================================

module.exports = async function (interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = resolveGuildId(interaction);
    const guildName = interaction.guild?.name || '';

    // === /premium status — publik ===
    if (sub === 'status') {
        await interaction.deferReply();
        if (!guildId) {
            return safeEditReply(interaction, {
                content: 'ℹ️ Status premium hanya berlaku di dalam server. Panggil command ini dari server kamu.'
            });
        }
        return safeEditReply(interaction, { embeds: [statusEmbed(guildId, guildName)] });
    }

    // === /premium activate <key> — admin server (ManageGuild) ===
    if (sub === 'activate') {
        // Bot owner selalu boleh (buat demo ke calon pembeli).
        if (!isPremiumAdmin(interaction.user?.id)) {
            const hasManage = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
            if (!hasManage) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                return safeEditReply(interaction, {
                    content:
                        '🚫 **Akses Ditolak.**\n\nKey hanya bisa diaktifkan oleh **admin server** (permission *Manage Server*).\nMinta owner/admin server untuk menjalankan command ini.'
                });
            }
        }
        if (!guildId) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return safeEditReply(interaction, { content: '❌ Command ini hanya bisa dipakai di dalam server.' });
        }

        const key = (interaction.options.getString('key') || '').trim();
        if (!key) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return safeEditReply(interaction, { content: '❌ Key tidak boleh kosong.' });
        }
        if (!/^[A-Z0-9]{5}(-[A-Z0-9]{5}){2}$/i.test(key)) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return safeEditReply(interaction, {
                content:
                    '❌ Format key tidak valid.\nFormat yang benar: `XXXXX-XXXXX-XXXXX` (3 blok 5 karakter).\nCoba salin ulang key dari pembelian kamu.'
            });
        }

        await interaction.deferReply();

        const activator = {
            guildId,
            guildName,
            key,
            activatedBy: interaction.user.id,
            activatedByName: interaction.user.tag || interaction.user.username
        };

        // 1) Provider remote dulu (kalau dikonfigurasi) — key dari dashboard.
        const remote = remoteProviderConfig();
        if (remote) {
            const result = await redeemRemoteKey(activator);
            if (result.ok) {
                const entry = pm.activateGuildKey({
                    guildId,
                    guildName,
                    keyCode: key,
                    plan: result.plan,
                    activatedBy: activator.activatedBy,
                    activatedByName: activator.activatedByName,
                    source: 'remote'
                });
                await logAudit(interaction.client, {
                    action: 'PREMIUM_ACTIVATE',
                    actorId: interaction.user.id,
                    actorTag: interaction.user.tag,
                    details: `Server **${guildName || guildId}** berlangganan paket **${result.plan}** (key ${pm.maskKey(key)}, provider remote)`,
                    guildId
                });
                return safeEditReply(interaction, { embeds: [activatedEmbed(entry)] });
            }
            // Key ditolak API dengan alasan bisnis → tamat, jangan coba lokal
            // (key web tidak akan ada di pool lokal).
            if (result.reason === 'rejected') {
                return safeEditReply(interaction, {
                    content: `❌ **Key tidak bisa dipakai.**\n${result.message}\nKalau kamu merasa ini salah, hubungi penjual key.`
                });
            }
            // API tidak terjangkau (server down) → fallback pool lokal dulu.
            console.warn(`⚠️ Premium API tidak terjangkau (${result.reason}) — fallback ke pool lokal.`);
        }

        // 2) Pool lokal.
        const localEntry = pm.findAvailableLocalKey(key);
        if (!localEntry) {
            const hint = remote
                ? 'Key dicek ke dashboard web dan pool lokal — tidak ditemukan.'
                : 'Key tidak ditemukan di pool lokal. Set `PREMIUM_API_URL` + `PREMIUM_API_TOKEN` di .env kalau key-mu dibuat dari dashboard web.';
            return safeEditReply(interaction, {
                content:
                    `❌ **Key tidak valid atau sudah dipakai.**\n${hint}\nCek lagi penulisan key (format: \`XXXXX-XXXXX-XXXXX\`).`
            });
        }
        if (!pm.consumeLocalKey(key)) {
            return safeEditReply(interaction, { content: '❌ Key gagal dikonsumsi (mungkin baru saja dipakai orang lain). Coba lagi.' });
        }
        const entry = pm.activateGuildKey({
            guildId,
            guildName,
            keyCode: key,
            plan: localEntry.plan,
            activatedBy: activator.activatedBy,
            activatedByName: activator.activatedByName,
            source: 'local'
        });
        await logAudit(interaction.client, {
            action: 'PREMIUM_ACTIVATE',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Server **${guildName || guildId}** berlangganan paket **${localEntry.plan}** (key ${pm.maskKey(key)}, provider lokal)`,
            guildId
        });
        return safeEditReply(interaction, { embeds: [activatedEmbed(entry)] });
    }

    // === /premium gen — pemilik bot saja ===
    if (sub === 'gen') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!isPremiumAdmin(interaction.user?.id)) {
            return safeEditReply(interaction, {
                content: '🚫 Khusus **pemilik bot** (daftar user id di `PREMIUM_ADMIN_IDS` .env).'
            });
        }
        const plan = interaction.options.getString('plan');
        const note = interaction.options.getString('note') || '';
        if (!pm.PLANS[plan]) {
            return safeEditReply(interaction, { content: `❌ Plan tidak dikenal: ${plan}` });
        }
        try {
            const code = pm.generatePremiumKey({ plan, note });
            await logAudit(interaction.client, {
                action: 'PREMIUM_KEY_GEN',
                actorId: interaction.user.id,
                actorTag: interaction.user.tag,
                details: `Key premium dibuat: paket **${plan}** (nilai key TIDAK dicatat — masked: ${pm.maskKey(code)})`,
                guildId: guildId || undefined
            });
            return safeEditReply(interaction, {
                content:
                    `✅ Key **${pm.PLANS[plan].label}** dibuat:\n\n\`\`\`${code}\`\`\`\n` +
                    `${note ? `📝 Catatan: ${note}\n` : ''}` +
                    `⚠️ Simpan key ini sekarang — key hanya tampil **sekali**. Kirim ke pembeli, lalu pembeli menjalankan \`/premium activate ${'<key>'} di server mereka.`
            });
        } catch (err) {
            return safeEditReply(interaction, { content: `❌ Gagal membuat key: ${err.message}` });
        }
    }

    // === /premium keys — pemilik bot saja ===
    if (sub === 'keys') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!isPremiumAdmin(interaction.user?.id)) {
            return safeEditReply(interaction, {
                content: '🚫 Khusus **pemilik bot** (daftar user id di `PREMIUM_ADMIN_IDS` .env).'
            });
        }

        const subs = pm.listActiveSubscriptions();
        const keys = pm.listLocalKeys();

        const embed = new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle('📦 Stok Key & Langganan Aktif')
            .setDescription(
                `${subs.length} server berlangganan · ${keys.filter(k => k.status === 'available').length} key tersedia · ${keys.filter(k => k.status === 'redeemed').length} sudah dipakai${remoteProviderConfig() ? ' · provider remote: **aktif**' : ' · provider remote: tidak diset'}`
            )
            .setFooter({ text: 'Key selalu dimasking — nilai penuh hanya tampil sekali saat /premium gen' })
            .setTimestamp();

        if (subs.length > 0) {
            embed.addFields({
                name: `🏬 Server berlangganan (${subs.length})`,
                value: subs
                    .slice(0, 15)
                    .map(
                        s =>
                            `• **${s.guildName || s.guildId}** — ${pm.PLANS[s.plan]?.label || s.plan} (${pm.formatRemaining(s.expireAt)})`
                    )
                    .join('\n')
                    .slice(0, 1024)
            });
        }
        if (keys.length > 0) {
            embed.addFields({
                name: `🔑 Key lokal (${keys.length} terakhir)`,
                value: keys
                    .slice(0, 15)
                    .map(
                        k =>
                            `• \`${pm.maskKey(k.code)}\` — ${pm.PLANS[k.plan]?.label || k.plan} — ${k.status === 'available' ? '✅ tersedia' : k.status === 'redeemed' ? '☑️ dipakai' : '⛔ dicabut'}${k.note ? ` · ${k.note}` : ''}`
                    )
                    .join('\n')
                    .slice(0, 1024)
            });
        }
        if (subs.length === 0 && keys.length === 0) {
            embed.addFields({
                name: 'Kosong',
                value: 'Belum ada key atau langganan. Mulai dengan `/premium gen`.'
            });
        }
        return safeEditReply(interaction, { embeds: [embed] });
    }

    // === /premium revoke — pemilik bot saja (refund/chargeback) ===
    if (sub === 'revoke') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!isPremiumAdmin(interaction.user?.id)) {
            return safeEditReply(interaction, {
                content: '🚫 Khusus **pemilik bot** (daftar user id di `PREMIUM_ADMIN_IDS` .env).'
            });
        }
        const input = (interaction.options.getString('guild') || '').trim();
        // Default: guild tempat command dijalankan (praktis untuk demo langsung).
        const target = input || guildId;
        if (!target) {
            return safeEditReply(interaction, {
                content: '❌ Tentukan guild id (atau jalankan command ini dari server yang mau dicabut).'
            });
        }
        const removed = pm.revokeGuildSubscription(target);
        if (removed === 0) {
            return safeEditReply(interaction, { content: `ℹ️ Guild \`${target}\` tidak punya langganan aktif.` });
        }
        await logAudit(interaction.client, {
            action: 'PREMIUM_REVOKE',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Langganan guild **${target}** dicabut (${removed} entry dihapus).`,
            guildId: guildId || undefined
        });
        return safeEditReply(interaction, {
            content: `✅ Langganan guild \`${target}\` dicabut (${removed} entry). Server kembali ke tier Free pada interaksi berikutnya.`
        });
    }

    // Subcommand tidak dikenal — defensive.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return safeEditReply(interaction, { content: `❌ Subcommand tidak dikenal: ${sub}` });
};
