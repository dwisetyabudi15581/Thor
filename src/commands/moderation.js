/**
 * Domain: moderation
 * Slash commands: /timeout, /untimeout, /purge, /kick, /ban, /unban (v3.9.43)
 *
 * Paket moderasi lengkap — nyambung ke sistem yang sudah ada:
 *   - Tiap tindakan → tercatat di RIWAYAT MODERASI user (data/modlogs.json)
 *     dan tampil di /warn-list sebagai seksi "Catatan Moderasi" (tanpa
 *     memengaruhi threshold warn 3=mute/5=mute/7=kick — sanksi tidak ganda).
 *   - Tiap tindakan → logAudit ke channel audit-log (label MOD_*).
 *   - Target di-DM alasannya (best-effort, silent fail).
 *
 * Guard (src/infra/moderationGuards.js, unit-tested):
 *   - Tidak bisa menindak diri sendiri / bot sendiri / target bot.
 *   - Hierarki: role moderator & bot HARUS lebih tinggi dari target
 *     (setingkat = ditolak, konsisten /warn v3.9.8).
 *   - Timeout maks 28 hari (limit Discord), purge 1–100 + filter pesan
 *     >14 hari (limit API bulk delete), ban delete-days 0–7.
 *   - Permission bot dicek duluan (ModerateMembers/KickMembers/BanMembers/
 *     ManageMessages) supaya error-nya jelas, bukan "Missing Permissions"
 *     dari API.
 *
 * Router: command ini boleh dipakai moderator non-admin yang punya Discord
 * permission sesuai (ModerateMembers dst) — lihat MODERATION_COMMANDS di
 * src/commands/index.js.
 */

const {
    MessageFlags,
    PermissionFlagsBits,
    safeEditReply,
    logAudit,
    addModLog,
    getModLogCount
} = require('./_shared');
const { normalizeNewlines } = require('../infra/text');
const {
    validateModerationTarget,
    validateTimeoutDuration,
    validatePurgeAmount,
    filterBulkDeletable,
    formatDurationMinutes,
    isValidUserId,
    TIMEOUT_MAX_MINUTES,
    BAN_DELETE_DAYS_MAX
} = require('../infra/moderationGuards');

/** Mapping kode guard → pesan user (Bahasa Indonesia). */
const GUARD_MESSAGES = {
    'self': '❌ Tidak bisa menindak diri sendiri. Coba ketuk kepala dulu.',
    'bot-self': '❌ Tidak bisa menindak bot ini sendiri.',
    'target-bot': '❌ Tidak bisa menindak bot. (Konsisten dengan /warn — bot bukan objek moderasi.)',
    'not-in-guild': '❌ User tidak ada di server ini.',
    'hierarchy': '❌ Kamu tidak bisa menindak member dengan role setingkat/lebih tinggi dari kamu.',
    'bot-hierarchy': '❌ Role bot lebih rendah dari target — bot tidak bisa eksekusi tindakan ini. Naikkan role bot di Server Settings → Roles.'
};

function guardMessage(code) {
    return GUARD_MESSAGES[code] || `❌ Tindakan ditolak (${code}).`;
}

/**
 * Helper: DM target (best effort — DM ditutup = silent, jangan gagalkan command).
 */
async function dmTarget(user, text) {
    try {
        await user.send(text);
        return true;
    } catch (_) {
        return false;
    }
}

module.exports = async function (interaction) {
    const guild = interaction.guild;
    const botMember = guild.members.me;

    // ====================================================
    // === /timeout — mute sementara (maks 28 hari) ===
    // ====================================================
    if (interaction.commandName === 'timeout') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user');
        const minutes = interaction.options.getInteger('duration');
        const reason = normalizeNewlines(interaction.options.getString('reason') || '(tanpa alasan)');

        const dur = validateTimeoutDuration(minutes);
        if (!dur.ok) {
            return safeEditReply(interaction, {
                content:
                    dur.error === 'too-long'
                        ? `❌ Durasi maksimal timeout adalah **28 hari** (${TIMEOUT_MAX_MINUTES} menit).`
                        : '❌ Durasi minimal 1 menit.'
            });
        }

        const member = await guild.members.fetch(user.id).catch(() => null);
        const guard = validateModerationTarget({
            moderatorMember: interaction.member,
            targetMember: member,
            botMember
        });
        if (!guard.ok) return safeEditReply(interaction, { content: guardMessage(guard.error) });

        if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return safeEditReply(interaction, { content: '❌ Bot tidak punya permission **Timeout Members**.' });
        }

        await member.timeout(dur.ms, ` oleh ${interaction.user.tag}: ${reason}`.slice(0, 512));

        addModLog(guild.id, user.id, {
            type: 'timeout',
            reason,
            durationMs: dur.ms,
            moderatorId: interaction.user.id,
            moderatorTag: interaction.user.tag
        });
        await logAudit(interaction.client, {
            action: 'MOD_TIMEOUT',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Timeout <@${user.id}> (${user.tag}) — ${formatDurationMinutes(minutes)} — Alasan: "${reason}"`,
            guildId: guild.id
        });
        const dmOk = await dmTarget(
            user,
            `🔇 **Kamu di-mute (timeout) di ${guild.name}**\n\nDurasi: ${formatDurationMinutes(minutes)}\nAlasan: ${reason}\nOleh: ${interaction.user.tag}\n\nSampai mute berakhir, kamu tidak bisa kirim pesan / join voice.`
        );

        return safeEditReply(interaction, {
            content:
                `🔇 **<@${user.id}> di-timeout ${formatDurationMinutes(minutes)}.**\n\n` +
                `📝 Alasan: ${reason}\n👤 Oleh: ${interaction.user.tag}\n` +
                `📊 Riwayat moderasi user: **${getModLogCount(guild.id, user.id)}** tindakan${dmOk ? '' : '\n⚠️ DM gagal dikirim (DM user ditutup) — beri tahu dia di chat.'}`
        });
    }

    // ====================================================
    // === /untimeout — lepas mute lebih awal ===
    // ====================================================
    if (interaction.commandName === 'untimeout') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user');
        const reason = normalizeNewlines(interaction.options.getString('reason') || '(tanpa alasan)');

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) {
            return safeEditReply(interaction, { content: guardMessage('not-in-guild') });
        }
        if (user.id === interaction.user.id) {
            return safeEditReply(interaction, { content: guardMessage('self') });
        }
        if (member.isCommunicationDisabled()) {
            if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                return safeEditReply(interaction, { content: '❌ Bot tidak punya permission **Timeout Members**.' });
            }
            await member.timeout(null, ` oleh ${interaction.user.tag}: ${reason}`.slice(0, 512));
            addModLog(guild.id, user.id, {
                type: 'untimeout',
                reason,
                moderatorId: interaction.user.id,
                moderatorTag: interaction.user.tag
            });
            await logAudit(interaction.client, {
                action: 'MOD_UNTIMEOUT',
                actorId: interaction.user.id,
                actorTag: interaction.user.tag,
                details: `Lepas timeout <@${user.id}> (${user.tag}) — Alasan: "${reason}"`,
                guildId: guild.id
            });
            await dmTarget(user, `🔊 **Timeout kamu di ${guild.name} sudah dihapus.**\n\nAlasan: ${reason}\nOleh: ${interaction.user.tag}`);
            return safeEditReply(interaction, {
                content: `🔊 **Timeout <@${user.id}> dihapus.**\n\n📝 Alasan: ${reason}\n👤 Oleh: ${interaction.user.tag}`
            });
        }
        return safeEditReply(interaction, { content: `ℹ️ <@${user.id}> sedang tidak dalam timeout.` });
    }

    // ====================================================
    // === /purge — hapus pesan massal (1–100) ===
    // ====================================================
    if (interaction.commandName === 'purge') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const amount = interaction.options.getInteger('amount');
        const user = interaction.options.getUser('user'); // optional filter

        const check = validatePurgeAmount(amount);
        if (!check.ok) {
            return safeEditReply(interaction, {
                content: check.error === 'too-large' ? '❌ Maksimal 100 pesan per purge (limit Discord).' : '❌ Minimal 1 pesan.'
            });
        }
        if (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return safeEditReply(interaction, { content: '❌ Bot tidak punya permission **Manage Messages**.' });
        }
        if (interaction.channel.type !== 0) {
            // 0 = GuildText — purge hanya untuk text channel (bukan thread/voice).
            return safeEditReply(interaction, { content: '❌ Purge hanya bisa di text channel.' });
        }

        // Fetch 100 pesan terakhir, filter by user kalau ada, ambil sejumlah amount.
        const fetched = await interaction.channel.messages.fetch({ limit: 100 });
        let pool = [...fetched.values()];
        if (user) pool = pool.filter(m => m.author?.id === user.id);
        pool = pool.slice(0, amount);
        const deletable = filterBulkDeletable(pool);
        const skippedOld = pool.length - deletable.length;

        if (deletable.length === 0) {
            return safeEditReply(interaction, {
                content: user
                    ? `ℹ️ Tidak ada pesan <@${user.id}> (dari 100 pesan terakhir) yang bisa dihapus.`
                    : 'ℹ️ Tidak ada pesan yang bisa dihapus (pesan >14 hari tidak bisa bulk-delete).'
            });
        }

        // Bulk API butuh ≥2 pesan; 1 pesan → delete tunggal.
        if (deletable.length === 1) {
            await deletable[0].delete().catch(() => null);
        } else {
            await interaction.channel.bulkDelete(deletable, true);
        }

        await logAudit(interaction.client, {
            action: 'MOD_PURGE',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Purge ${deletable.length} pesan di #${interaction.channel.name}${user ? ` (hanya pesan <@${user.id}>)` : ''}${skippedOld > 0 ? ` — ${skippedOld} pesan dilewati (>14 hari)` : ''}`,
            guildId: guild.id
        });

        return safeEditReply(interaction, {
            content:
                `🧹 **${deletable.length} pesan dihapus** dari #${interaction.channel.name}${user ? ` (hanya pesan <@${user.id}>)` : ''}.` +
                (skippedOld > 0 ? `\n⚠️ ${skippedOld} pesan >14 hari dilewati (limit bulk delete Discord — harus dihapus manual).` : '')
        });
    }

    // ====================================================
    // === /kick — keluarkan member ===
    // ====================================================
    if (interaction.commandName === 'kick') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user');
        const reason = normalizeNewlines(interaction.options.getString('reason') || '(tanpa alasan)');

        const member = await guild.members.fetch(user.id).catch(() => null);
        const guard = validateModerationTarget({
            moderatorMember: interaction.member,
            targetMember: member,
            botMember
        });
        if (!guard.ok) return safeEditReply(interaction, { content: guardMessage(guard.error) });
        if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) {
            return safeEditReply(interaction, { content: '❌ Bot tidak punya permission **Kick Members**.' });
        }

        // DM SEBELUM kick — setelah keluar server, DM tetap bisa, tapi
        // konteks member (roles) sudah hilang; pesan "kamu di-kick dari X"
        // paling pasti terkirim kalau dikirim selagi member masih ada.
        const dmOk = await dmTarget(
            user,
            `👢 **Kamu di-kick dari ${guild.name}**\n\nAlasan: ${reason}\nOleh: ${interaction.user.tag}\n\nKamu bisa join lagi lewat invite link server.`
        );

        await member.kick(` oleh ${interaction.user.tag}: ${reason}`.slice(0, 512));

        addModLog(guild.id, user.id, {
            type: 'kick',
            reason,
            moderatorId: interaction.user.id,
            moderatorTag: interaction.user.tag
        });
        await logAudit(interaction.client, {
            action: 'MOD_KICK',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Kick <@${user.id}> (${user.tag}) — Alasan: "${reason}"`,
            guildId: guild.id
        });

        return safeEditReply(interaction, {
            content:
                `👢 **<@${user.id}> di-kick.**\n\n📝 Alasan: ${reason}\n👤 Oleh: ${interaction.user.tag}\n` +
                `📊 Riwayat moderasi user: **${getModLogCount(guild.id, user.id)}** tindakan${dmOk ? '' : '\n⚠️ DM gagal dikirim (DM user ditutup).'}`
        });
    }

    // ====================================================
    // === /ban — ban member (hapus pesan opsional 0–7 hari) ===
    // ====================================================
    if (interaction.commandName === 'ban') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user');
        const reason = normalizeNewlines(interaction.options.getString('reason') || '(tanpa alasan)');
        const deleteDays = interaction.options.getInteger('delete_days') || 0;

        if (deleteDays < 0 || deleteDays > BAN_DELETE_DAYS_MAX) {
            return safeEditReply(interaction, { content: `❌ Hapus pesan maksimal ${BAN_DELETE_DAYS_MAX} hari (limit Discord).` });
        }

        const member = await guild.members.fetch(user.id).catch(() => null);
        const guard = validateModerationTarget({
            moderatorMember: interaction.member,
            targetMember: member,
            botMember
        });
        if (!guard.ok) return safeEditReply(interaction, { content: guardMessage(guard.error) });
        if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
            return safeEditReply(interaction, { content: '❌ Bot tidak punya permission **Ban Members**.' });
        }

        const dmOk = await dmTarget(
            user,
            `🔨 **Kamu di-BAN dari ${guild.name}**\n\nAlasan: ${reason}\nOleh: ${interaction.user.tag}${deleteDays > 0 ? `\nPesan kamu ${deleteDays} hari terakhir ikut dihapus.` : ''}`
        );

        await member.ban({
            deleteMessageSeconds: deleteDays * 86400, // v14: detik, maks 7 hari
            reason: ` oleh ${interaction.user.tag}: ${reason}`.slice(0, 512)
        });

        addModLog(guild.id, user.id, {
            type: 'ban',
            reason,
            moderatorId: interaction.user.id,
            moderatorTag: interaction.user.tag
        });
        await logAudit(interaction.client, {
            action: 'MOD_BAN',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Ban <@${user.id}> (${user.tag})${deleteDays > 0 ? ` + hapus pesan ${deleteDays} hari` : ''} — Alasan: "${reason}"`,
            guildId: guild.id
        });

        return safeEditReply(interaction, {
            content:
                `🔨 **<@${user.id}> di-ban.**\n\n📝 Alasan: ${reason}\n🗑️ Hapus pesan: ${deleteDays > 0 ? `${deleteDays} hari terakhir` : 'tidak'}\n👤 Oleh: ${interaction.user.tag}\n` +
                `📊 Riwayat moderasi user: **${getModLogCount(guild.id, user.id)}** tindakan${dmOk ? '' : '\n⚠️ DM gagal dikirim (DM user ditutup).'}`
        });
    }

    // ====================================================
    // === /unban — cabut ban via user ID ===
    // ====================================================
    if (interaction.commandName === 'unban') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const rawId = interaction.options.getString('user_id');
        const reason = normalizeNewlines(interaction.options.getString('reason') || '(tanpa alasan)');

        if (!isValidUserId(rawId)) {
            return safeEditReply(interaction, { content: '❌ User ID tidak valid — format-nya 17–20 digit angka (User Settings → Advanced → Developer Mode → klik kanan user → Copy User ID).' });
        }
        const userId = rawId.trim();
        if (userId === interaction.user.id) {
            return safeEditReply(interaction, { content: guardMessage('self') });
        }
        if (userId === botMember.id) {
            return safeEditReply(interaction, { content: guardMessage('bot-self') });
        }
        if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
            return safeEditReply(interaction, { content: '❌ Bot tidak punya permission **Ban Members**.' });
        }

        // Cek dulu apakah user memang di-ban (memberikan pesan error yang jelas).
        const banInfo = await guild.bans.fetch(userId).catch(() => null);
        if (!banInfo) {
            return safeEditReply(interaction, { content: `ℹ️ User \`${userId}\` tidak ada di ban list server ini.` });
        }

        await guild.bans.remove(userId, ` oleh ${interaction.user.tag}: ${reason}`.slice(0, 512));
        addModLog(guild.id, userId, {
            type: 'unban',
            reason,
            moderatorId: interaction.user.id,
            moderatorTag: interaction.user.tag
        });
        await logAudit(interaction.client, {
            action: 'MOD_UNBAN',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Unban \`${userId}\`${banInfo.user?.tag ? ` (${banInfo.user.tag})` : ''} — Alasan: "${reason}"`,
            guildId: guild.id
        });

        return safeEditReply(interaction, {
            content: `♻️ **Ban \`${userId}\`${banInfo.user ? ` (${banInfo.user.tag})` : ''} dicabut.**\n\n📝 Alasan: ${reason}\n👤 Oleh: ${interaction.user.tag}`
        });
    }
};
