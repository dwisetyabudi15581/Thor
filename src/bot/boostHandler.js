/**
 * Boost Handler — notifikasi server booster (v3.9.49).
 *
 * Dipanggil oleh:
 *   - src/bot/events/guildMemberUpdate.js (deteksi boost add/remove live)
 *   - src/commands/stats.js (daftar /boosters — pakai builder embed yang sama)
 *   - src/commands/config.js + src/bot/events/ready.js (sinkronisasi role booster, v3.9.59)
 *
 * Logika:
 *   - Boost TAMBAH (premium_since: null → tanggal): embed perayaan pink ke
 *     channel server-booster + entri BOOST_ADD di server log.
 *   - Boost HILANG (premium_since: tanggal → null): embed abu-abu + entri
 *     BOOST_REMOVE di server log.
 *   - AUTO ROLE BOOSTER (v3.9.59): role `roles.booster` di-config diberikan
 *     otomatis saat boost mulai & dihapus saat boost berakhir — semantik yang
 *     sama dengan role "Server Booster" bawaan Discord (perk mengikuti status
 *     boost aktif, bukan badge permanen: member yang berhenti bayar berhenti
 *     dapat akses). Role bawaan Discord sendiri tidak bisa dikustom urutan/
 *     warnanya, jadi admin pakai role sendiri lewat `/set-role booster @role`.
 *
 * Pola diagnosabilitas v3.9.48: setiap alasan skip meninggalkan log penyebab +
 * perintah solusi, dan gagal kirim menyebut channel + permission yang persis
 * harus dicek. Boost tanpa notifikasi DAN tanpa baris log tidak boleh terjadi.
 */

const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('../data/configManager');
const { logServerEvent } = require('../infra/serverLog');

const BOOST_PINK = 0xf472b6;
const BOOST_GRAY = 0x95a5a6;

/**
 * Build the boost-started embed. Pure — no side effects, no send.
 * @param {Object} member - discord.js GuildMember
 */
function buildBoostAddEmbed(member) {
    const { guild, user } = member;
    const tierText =
        guild.premiumTier && guild.premiumTier > 0
            ? `Level Server **${guild.premiumTier}** · total ${guild.premiumSubscriptionCount ?? 0} boost`
            : 'Level Server 0 (menuju Level 1!)';
    return new EmbedBuilder()
        .setTitle('🚀 BOOST SERVER BARU!')
        .setDescription(`**${user}** baru saja boost **${guild.name}**! Terima kasih sudah mendukung server 💖`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setColor(BOOST_PINK)
        .addFields(
            { name: '👤 Booster', value: `${user} (\`${user.tag}\`)`, inline: true },
            { name: '🚀 Boost sejak', value: `<t:${Math.floor((member.premiumSinceTimestamp || Date.now()) / 1000)}:R>`, inline: true },
            { name: '📊 Server', value: tierText, inline: false }
        )
        .setFooter({ text: `${guild.name} — terima kasih!`, iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp();
}

/**
 * Build the boost-ended embed. Pure — no side effects, no send.
 * @param {Object} member - the member AFTER the change (premiumSinceTimestamp
 *   already null — the handler passes the old streak via `sinceTs`)
 * @param {number|null} sinceTs - the premiumSinceTimestamp BEFORE the removal
 */
function buildBoostRemoveEmbed(member, sinceTs) {
    const { guild, user } = member;
    const since = sinceTs ? `\n\nMereka sudah boost sejak <t:${Math.floor(sinceTs / 1000)}:D>.` : '';
    return new EmbedBuilder()
        .setTitle('💔 BOOST BERAKHIR')
        .setDescription(`**${user}** sudah tidak lagi boost **${guild.name}**.${since}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setColor(BOOST_GRAY)
        .addFields({ name: '👤 Booster', value: `${user} (\`${user.tag}\`)`, inline: true })
        .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp();
}

/**
 * Send the boost notification to the server-booster channel + record it in
 * the server log. Never throws — logs every failure with the fix (v3.9.48
 * silent-failure pattern).
 *
 * @param {Object} member - discord.js GuildMember (after the change)
 * @param {'add'|'remove'} action
 * @param {number|null} [oldSinceTs] - the premiumSinceTimestamp before the change
 */
async function onBoostChange(member, action, oldSinceTs = null) {
    const { guild, user } = member;
    const config = getConfig();

    // 1. Simpan riwayat dulu (walau notifikasi gagal, data tetap ada).
    try {
        const boostManager = require('../data/boostManager');
        if (action === 'add') boostManager.recordBoostStart(guild.id, user.id, member.premiumSinceTimestamp || Date.now());
        else boostManager.recordBoostEnd(guild.id, user.id);
    } catch (err) {
        console.warn(`⚠️ Gagal mencatat boost ${action} untuk ${user.tag}:`, err.message);
    }

    // 2. Entri server log (channel terpisah — catatan historis).
    try {
        await logServerEvent(member.client, {
            type: action === 'add' ? 'BOOST_ADD' : 'BOOST_REMOVE',
            guildId: guild.id,
            fields: [
                { name: '👤 Booster', value: `<@${user.id}> (\`${user.tag}\`)`, inline: true },
                {
                    name: action === 'add' ? '🚀 Mulai' : '💔 Berakhir',
                    value:
                        action === 'add'
                            ? member.premiumSinceTimestamp
                                ? `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`
                                : 'baru saja'
                            : oldSinceTs
                              ? `sejak <t:${Math.floor(oldSinceTs / 1000)}:R>`
                              : 'awal tidak diketahui'
                }
            ],
            footer: `User ID: ${user.id}`
        });
    } catch (_) {
        // logServerEvent tidak pernah throw, tapi tetap defensif.
    }

    // 3. Channel server-booster khusus (embed perayaan).
    const channelId = config.channels['server-booster'];
    if (!channelId) {
        console.warn(
            `⚠️ ${user.tag} ${action === 'add' ? 'mulai' : 'berhenti'} boost, tapi channel server-booster BELUM di-set — notifikasi boost dilewati. ` +
                `Solusi: /set-channel server-booster #channel (server log tetap mencatatnya kalau di-set)`
        );
        return;
    }
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
        console.warn(
            `⚠️ Channel server-booster (ID: ${channelId}) tidak ditemukan — sudah dihapus, atau ID milik server lain. ` +
                `Solusi: /set-channel server-booster #channel`
        );
        return;
    }

    const embed = action === 'add' ? buildBoostAddEmbed(member) : buildBoostRemoveEmbed(member, oldSinceTs);

    try {
        const content = action === 'add' ? `<@${user.id}>` : undefined;
        await channel.send({ content, embeds: [embed] });
        console.log(`🚀 Notifikasi boost ${action} terkirim untuk ${user.tag} di #${channel.name || channel.id}`);
    } catch (err) {
        console.error(
            `❌ Gagal mengirim notifikasi boost ${action} di #${channel.name || channel.id}: ${err.message}\n` +
                `   Cek permission Kirim Pesan + Embed Links bot di channel itu.`
        );
    }
}

/**
 * Build the /boosters list embed. Pure — no side effects, no send.
 * @param {Object} guild - discord.js Guild
 * @param {Array<Object>} boosters - GuildMembers with premiumSinceTimestamp, sorted
 *   by boost date ASCENDING (earliest supporter first — caller sorts)
 * @param {Array<{userId, event, at, boostedAt}>} recentEvents - from boostManager.getRecentEvents
 */
function buildBoostersEmbed(guild, boosters, recentEvents = []) {
    const boostCount = guild.premiumSubscriptionCount ?? boosters.length;
    const tierText =
        guild.premiumTier && guild.premiumTier > 0 ? `Level ${guild.premiumTier}` : 'Level 0 (belum ada boost)';

    // Daftar booster — cap 40 baris supaya deskripsi selalu muat (limit 4096
    // dengan ~60 char/baris ≈ 2.400 + sisa; daftar booster lebih besar dari itu
    // jarang di server komunitas, tapi guard tetap ada).
    const MAX_LIST = 40;
    const lines = boosters.slice(0, MAX_LIST).map((m, i) => {
        const ts = Math.floor((m.premiumSinceTimestamp || 0) / 1000);
        return `${i + 1}. <@${m.user.id}> — sejak <t:${ts}:D> (<t:${ts}:R>)`;
    });
    const hidden = boosters.length - MAX_LIST;
    if (hidden > 0) lines.push(`… +${hidden} booster lainnya tidak ditampilkan`);

    const description =
        boosters.length === 0
            ? 'Server ini belum punya booster aktif saat ini. 🌱\nBoost server membuka keuntungan untuk semua member — tiap boost berarti!'
            : `Member berikut sedang boost **${guild.name}** sekarang 💖\n\n${lines.join('\n')}`;

    const recentLines = recentEvents
        .slice(0, 5)
        .map(e => `${e.event === 'add' ? '🚀' : '💔'} <@${e.userId}> — <t:${Math.floor((e.at || 0) / 1000)}:R>`)
        .join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`🚀 SERVER BOOSTER — ${guild.name}`)
        .setDescription(description)
        .setColor(BOOST_PINK)
        .addFields(
            { name: '📊 Level Server', value: `${tierText} (${boostCount} boost)`, inline: true },
            { name: '⭐ Booster Terdaftar', value: `${boosters.length}`, inline: true }
        )
        .setFooter({ text: 'Daftar booster = live dari Discord • riwayat boost dilacak bot' })
        .setTimestamp();

    if (recentLines) {
        embed.addFields({ name: '🕘 Aktivitas Boost Terbaru', value: recentLines.slice(0, 1000) });
    }
    const icon = typeof guild.iconURL === 'function' ? guild.iconURL() : null;
    if (icon) embed.setThumbnail(icon);
    return embed;
}

/**
 * v3.9.59: AUTO ROLE BOOSTER — beri/hapus role Booster mengikuti status boost.
 * Dipanggil guildMemberUpdate.js tepat setelah onBoostChange (event live).
 *
 * Semantik = role "Server Booster" bawaan Discord: role ada SELAMA member
 * boost. Member yang berhenti boost kehilangan role (perk boost berhenti
 * bersama langganannya — bukan badge permanen).
 *
 * Catatan log: penambahan/penghapusan role memicu event guildMemberUpdate
 * LAGI (diff role), yang otomatis tercatat sebagai ROLE_UPDATE di server log
 * kalau server-log di-set — tidak perlu entri log duplikat di sini.
 *
 * Tidak pernah throw — setiap kegagalan/log-dilewati meninggalkan log penyebab
 * + solusi (pola v3.9.48).
 *
 * @param {Object} member - discord.js GuildMember (setelah perubahan)
 * @param {'add'|'remove'} action
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
async function applyBoostRole(member, action) {
    try {
        if (!member?.guild?.id || !member.user || member.user.bot) {
            return { ok: false, reason: 'skip' };
        }
        const config = getConfig();
        const roleId = config.roles && config.roles.booster;
        if (!roleId) {
            // Role belum di-set = fitur opsional belum dinyalakan. Untuk boost
            // BARU kasih petunjuk sekali per event (pola channel server-booster);
            // untuk remove cukup diam — tanpa config, role tidak pernah diberikan.
            if (action === 'add') {
                console.warn(
                    `⚠️ ${member.user.tag} mulai boost, tapi role Booster BELUM di-set — auto-role dilewati. ` +
                        `Solusi: /set-role booster @role`
                );
            }
            return { ok: false, reason: 'not-set' };
        }
        const role = member.guild.roles.cache.get(roleId);
        if (!role) {
            console.warn(
                `⚠️ Role Booster (ID: ${roleId}) tidak ditemukan — sudah dihapus, atau ID milik server lain. ` +
                    `Solusi: /set-role booster @role`
            );
            return { ok: false, reason: 'ghost' };
        }
        const has = typeof member.roles?.cache?.has === 'function' ? member.roles.cache.has(roleId) : false;

        if (action === 'add') {
            if (has) return { ok: true, reason: 'already' }; // idempotent
            // Pre-check hierarki (pesan lebih jelas daripada error API mentah;
            // catch di bawah tetap menutup race role berpindah posisi).
            const botPos = member.guild.members?.me?.roles?.highest?.position;
            if (typeof botPos === 'number' && (role.position ?? 0) >= botPos) {
                console.error(
                    `❌ Role Booster (${role.name}) posisinya DI ATAS role bot tertinggi — bot tidak bisa meng-assign ke ${member.user.tag}. ` +
                        `Solusi: pindahkan role Booster ke bawah role bot (Server Settings → Roles).`
                );
                return { ok: false, reason: 'position' };
            }
            await member.roles.add(role);
            console.log(`🎭 Role Booster diberikan otomatis ke ${member.user.tag}`);
            return { ok: true, reason: 'added' };
        }

        // action === 'remove'
        if (!has) return { ok: true, reason: 'absent' }; // tidak punya → no-op
        await member.roles.remove(role);
        console.log(`🎭 Role Booster dihapus otomatis dari ${member.user.tag} (boost berakhir)`);
        return { ok: true, reason: 'removed' };
    } catch (err) {
        console.error(
            `❌ Gagal ${action === 'add' ? 'memberikan' : 'menghapus'} role Booster untuk ${member?.user?.tag}: ${err.message}\n` +
                `   Cek permission Manage Roles bot + posisi role Booster DI BAWAH role bot tertinggi.`
        );
        return { ok: false, reason: 'error' };
    }
}

/**
 * v3.9.59: sinkronisasi STATE role Booster (bukan event) — dipakai:
 *   - ready.js setelah reconcileBoosters: boost yang mulai/berhenti saat bot
 *     offline tetap kehilangan/dapat role-nya;
 *   - /set-role booster: penerapan retroaktif ke booster yang SUDAH ada.
 *
 * Aturan aman:
 *   - SETIAP member yang sedang boost tapi belum punya role → DIBERIKAN
 *     (mencakup boost saat offline, DAN penugasan live yang dulu gagal —
 *     mis. role sempat di atas role bot lalu diperbaiki).
 *   - userId di `removedUserIds` (boost berakhir saat offline) yang masih ada
 *     di cache & memegang role → DIHAPUS.
 *   - Member BIASA yang kebetulan punya role (diberi manual admin) TIDAK
 *     pernah disentuh — sinkronisasi tidak boleh merusak pemberian manual.
 *
 * @param {Object} guild - discord.js Guild (members.cache sebaiknya sudah di-fetch)
 * @param {string[]} [removedUserIds=[]] - dari boostManager.reconcileBoosters().removed
 * @returns {Promise<{applied: number, removed: number}>}
 */
async function syncBoostRoles(guild, removedUserIds = []) {
    const out = { applied: 0, removed: 0 };
    if (!guild?.id || !guild.members?.cache) return out;

    const config = getConfig();
    const roleId = config.roles && config.roles.booster;
    if (!roleId) return out; // fitur belum dinyalakan — no-op senyap
    const role = guild.roles.cache?.get?.(roleId);
    if (!role) {
        console.warn(
            `⚠️ Sinkron role Booster: role (ID: ${roleId}) tidak ditemukan — sudah dihapus, atau ID milik server lain. ` +
                `Solusi: /set-role booster @role`
        );
        return out;
    }

    // (1) Semua live booster tanpa role → berikan.
    for (const m of guild.members.cache.values()) {
        if (!m || m.user?.bot) continue;
        if (!m.premiumSinceTimestamp) continue;
        const has = typeof m.roles?.cache?.has === 'function' ? m.roles.cache.has(roleId) : false;
        if (!has) {
            const res = await applyBoostRole(m, 'add');
            if (res.ok) out.applied += 1;
        }
    }

    // (2) Boost yang berakhir saat offline (masih di server) → hapus role-nya.
    for (const uid of removedUserIds || []) {
        const m = guild.members.cache.get(uid);
        if (!m) continue; // sudah keluar server — role ikut hilang sendiri
        const has = typeof m.roles?.cache?.has === 'function' ? m.roles.cache.has(roleId) : false;
        if (has) {
            const res = await applyBoostRole(m, 'remove');
            if (res.ok) out.removed += 1;
        }
    }

    return out;
}

module.exports = {
    onBoostChange,
    buildBoostAddEmbed,
    buildBoostRemoveEmbed,
    buildBoostersEmbed,
    applyBoostRole,
    syncBoostRoles,
    BOOST_PINK,
    BOOST_GRAY
};
