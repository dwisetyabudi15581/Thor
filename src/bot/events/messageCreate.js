/**
 * MessageCreate handler — hook untuk 4 fitur community (v3.9.13):
 *   1. Auto-Responder — keyword trigger → auto reply
 *   2. Anti-Spam & Auto-Mod — spam/link/word/mention filter
 *   3. AFK System — auto-reply saat mention user AFK + auto-clear AFK saat user chat
 *   4. Leveling System — XP per message + level up notification
 *
 * Hook ini jalan SETELAH trackMessage stats (yang lama).
 * Urutan eksekusi: anti-spam (delete dulu kalau perlu) → auto-responder → AFK clear → XP gain.
 */

const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { incrementMessages: trackMessage } = require('../../data/statsManager');
const { getConfig } = require('../../data/configManager');
const { isAdmin: checkIsAdmin } = require('../../infra/permissions');

// Data managers untuk fitur baru
const responderManager = require('../../data/responderManager');
const automodManager = require('../../data/automodManager');
const afkManager = require('../../data/afkManager');
const levelManager = require('../../data/levelManager');

async function onMessageCreate(message) {
    try {
        if (message.author?.bot) return;
        if (!message.guild) return;

        // === Track message untuk stats (existing) ===
        try {
            trackMessage(message.guild.id, message.author.id);
        } catch (_) {}

        // === v3.9.13: Hook 4 fitur community ===
        try {
            await hookAutoMod(message);
            await hookAutoResponder(message);
            await hookAfkSystem(message);
            await hookLeveling(message);
        } catch (err) {
            console.error('MessageCreate hook error:', err.message);
        }
    } catch (_) {}
}

/**
 * Hook 1: Anti-Spam & Auto-Mod
 * - Cek spam (N messages in window)
 * - Cek link blocking (with whitelist)
 * - Cek word filter
 * - Cek mass-mention
 * - Apply action: delete message, warn, mute, atau kick
 */
async function hookAutoMod(message) {
    const config = automodManager.getGuildConfig(message.guild.id);
    if (!config || !config.enabled) return;

    // Admin always whitelisted
    if (automodManager.isUserWhitelisted(message.member, config)) return;

    const content = message.content || '';
    let shouldDelete = false;
    let actionReason = null;
    let actionToTake = null;

    // 1. Spam check
    if (automodManager.checkSpam(message.guild.id, message.author.id, config)) {
        shouldDelete = true;
        actionReason = `Spam (${config.spamThreshold}+ pesan dalam ${config.spamWindowMs / 1000}s)`;
        actionToTake = config.spamAction;
        automodManager.resetSpamTracker(message.guild.id, message.author.id);
    }

    // 2. Link check (kalau blockLinks enabled & user not whitelisted)
    if (!shouldDelete && config.blockLinks && automodManager.containsLink(content)) {
        // Cek channel whitelist
        if (!config.linkAllowedChannels?.includes(message.channel.id)) {
            shouldDelete = true;
            actionReason = 'Link diblokir di channel ini';
            actionToTake = 'delete_only';
        }
    }

    // 3. Word filter
    if (!shouldDelete && config.blockWords?.length > 0) {
        const badWord = automodManager.containsBlockedWord(content, config.blockWords);
        if (badWord) {
            shouldDelete = true;
            actionReason = `Kata terlarang: "${badWord}"`;
            actionToTake = config.wordAction;
        }
    }

    // 4. Mass-mention check
    if (!shouldDelete && config.maxMentions) {
        const mentionCount = automodManager.countMentions(message);
        if (mentionCount > config.maxMentions) {
            shouldDelete = true;
            actionReason = `Mass-mention (${mentionCount} mentions, max ${config.maxMentions})`;
            actionToTake = config.mentionAction;
        }
    }

    if (!shouldDelete) return;

    // Apply action
    try {
        // Delete message dulu
        if (shouldDelete) {
            await message.delete().catch(() => {});
        }

        // Apply further action (warn/mute/kick)
        if (actionToTake && actionToTake !== 'delete_only') {
            const member = message.member;
            if (member) {
                if (actionToTake === 'warn') {
                    // Just warn via DM
                    try {
                        await member.send(`⚠️ Pesan kamu dihapus di **${message.guild.name}**: ${actionReason}`);
                    } catch (_) {}
                } else if (actionToTake === 'mute_10m' || actionToTake === 'mute_1h') {
                    const duration = actionToTake === 'mute_10m' ? 10 * 60 * 1000 : 60 * 60 * 1000;
                    try {
                        await member.timeout(duration, `Auto-mod: ${actionReason}`);
                        console.log(`🛡️ Auto-mod: ${message.author.tag} di-mute ${actionToTake} — ${actionReason}`);
                    } catch (err) {
                        console.warn(`⚠️ Auto-mod: gagal mute ${message.author.tag}: ${err.message}`);
                    }
                } else if (actionToTake === 'kick') {
                    try {
                        await member.kick(`Auto-mod: ${actionReason}`);
                        console.log(`🛡️ Auto-mod: ${message.author.tag} di-kick — ${actionReason}`);
                    } catch (err) {
                        console.warn(`⚠️ Auto-mod: gagal kick ${message.author.tag}: ${err.message}`);
                    }
                }
            }
        }

        console.log(`🛡️ Auto-mod action on ${message.author.tag}: ${actionToTake} — ${actionReason}`);
    } catch (err) {
        console.warn(`⚠️ Auto-mod apply error: ${err.message}`);
    }
}

/**
 * Hook 2: Auto-Responder
 * Kalau message diawali dengan trigger keyword, bot auto-reply.
 */
async function hookAutoResponder(message) {
    const responder = responderManager.findMatch(message.guild.id, message.content);
    if (!responder) return;

    // Don't trigger responder if message is in a thread about ticket (avoid noise)
    // Actually let's just send it — admin can configure cooldown

    try {
        if (responder.replyType === 'embed') {
            const embed = new EmbedBuilder()
                .setDescription(responder.reply)
                .setColor(0x5865F2)
                .setFooter({ text: `Auto-responder: ${responder.trigger}` });
            await message.reply({ embeds: [embed] });
        } else {
            await message.reply({ content: responder.reply, allowedMentions: { parse: [] } });
        }
        responderManager.markUsed(message.guild.id, responder.id);
    } catch (err) {
        console.warn(`⚠️ Auto-responder error: ${err.message}`);
    }
}

/**
 * Hook 3: AFK System
 * - Kalau user yang AFK kirim pesan → auto-clear AFK + announce "kembali"
 * - Kalau message mention user yang AFK → bot reply dengan reason
 */
async function hookAfkSystem(message) {
    // 3a. Clear AFK sender kalau dia lagi AFK
    if (afkManager.isAFK(message.guild.id, message.author.id)) {
        afkManager.clearAFK(message.guild.id, message.author.id);
        try {
            const welcomeBack = await message.reply({
                content: `👋 Welcome back, ${message.author}! Status AFK kamu sudah di-clear.`,
                allowedMentions: { users: [] }
            });
            // Auto-delete welcome back message after 5 seconds (avoid clutter)
            setTimeout(() => welcomeBack.delete().catch(() => {}), 5000);
        } catch (_) {}
    }

    // 3b. Reply kalau mention user yang AFK
    if (!message.mentions?.users || message.mentions.users.size === 0) return;

    const afkReplies = [];
    for (const [userId, user] of message.mentions.users) {
        if (userId === message.author.id) continue;  // skip self-mention
        if (user.bot) continue;

        const afkData = afkManager.getAFK(message.guild.id, userId);
        if (afkData) {
            const duration = afkManager.formatDuration(afkData.since);
            afkReplies.push(`💤 <@${userId}> sedang AFK: **${afkData.reason}** *(${duration})*`);
        }
    }

    if (afkReplies.length > 0) {
        try {
            const reply = await message.reply({
                content: afkReplies.join('\n'),
                allowedMentions: { users: [] }
            });
            // Auto-delete after 30 seconds
            setTimeout(() => reply.delete().catch(() => {}), 30000);
        } catch (_) {}
    }
}

/**
 * Hook 4: Leveling System
 * Tambah XP ke user. Kalau level up, announce + auto-assign role.
 */
async function hookLeveling(message) {
    const config = getConfig();
    const levelingConfig = config.leveling;
    if (!levelingConfig || !levelingConfig.enabled) return;

    const xpGain = levelingConfig.xpPerMessage || 15;
    const result = levelManager.addXp(message.guild.id, message.author.id, xpGain, levelingConfig);

    if (!result.leveledUp) return;

    const newLevel = result.newLevel;
    console.log(`📊 ${message.author.tag} level up to ${newLevel}!`);

    // Announce level up
    if (levelingConfig.announceLevelUp) {
        try {
            const levelUpEmbed = new EmbedBuilder()
                .setTitle('🎉 LEVEL UP!')
                .setDescription(`GG ${message.author}! Kamu naik ke **Level ${newLevel}**!`)
                .setColor(0xF1C40F)
                .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
                .setTimestamp();
            await message.channel.send({ embeds: [levelUpEmbed] });
        } catch (_) {}
    }

    // Auto-assign role kalau ada level role untuk level ini
    const roleId = levelManager.getRoleForLevel(newLevel, config);
    if (roleId && message.member) {
        try {
            if (!message.member.roles.cache.has(roleId)) {
                await message.member.roles.add(roleId);
                console.log(`📊 Auto-assign role ${roleId} to ${message.author.tag} (level ${newLevel})`);
                try {
                    await message.author.send(`🎉 Kamu dapat role baru di **${message.guild.name}** karena cap Level ${newLevel}!`);
                } catch (_) {}
            }
        } catch (err) {
            console.warn(`⚠️ Gagal auto-assign level role: ${err.message}`);
        }
    }
}

module.exports = {
    name: Events.MessageCreate,
    execute: onMessageCreate
};
