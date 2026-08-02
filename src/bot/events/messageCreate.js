/**
 * Handler pas ada pesan masuk. Jalanin 4 fitur community:
 *   1. Auto-Responder — kalo ada yang ketik trigger keyword, bot auto-reply
 *   2. Anti-Spam & Auto-Mod — deteksi spam/link/kata kasar/mass-mention
 *   3. AFK System — auto-reply pas ada yang mention user AFK + clear AFK pas user AFK balik chat
 *   4. Leveling System — kasih XP per pesan + announce level up
 *
 * Urutan: anti-spam duluan (soalnya kalo pesan ke-delete, hook lainnya gak usah jalan).
 */

const { Events, EmbedBuilder } = require('discord.js');
const { incrementMessages: trackMessage } = require('../../data/statsManager');
const { getConfig } = require('../../data/configManager');

// Data managers untuk fitur baru
const responderManager = require('../../data/responderManager');
const automodManager = require('../../data/automodManager');
const afkManager = require('../../data/afkManager');
const levelManager = require('../../data/levelManager');

// Buat nge-warning admin kalo lupa enable Message Content Intent.
// Discord bakal kirim message.content kosong kalo intentnya belum di-on.
// Akibatnya: auto-responder, anti-spam, AFK reply gak jalan.
// Set ini cuma buat nge-warning sekali per server biar console gak kebanjiran.
const _intentWarnedGuilds = new Set();
function debugLogIntentMissing(message) {
    const gid = message.guild.id;
    if (_intentWarnedGuilds.has(gid)) return;
    _intentWarnedGuilds.add(gid);
    console.warn(
        `⚠️ [HINT] Pesan dari ${message.author?.tag} di server "${message.guild.name}" isinya kosong.\n` +
            `   Biasanya karena "Message Content Intent" belum di-enable di Developer Portal.\n` +
            `   Cek: https://discord.com/developers/applications → Bot → Privileged Gateway Intents\n` +
            `   Akibatnya: auto-responder, anti-spam kata/link, dan AFK mention reply gak bakal jalan.\n` +
            `   (warning ini cuma muncul sekali per server, sampai bot direstart)`
    );
}

async function onMessageCreate(message) {
    try {
        if (message.author?.bot) return;
        if (!message.guild) return;

        // Deteksi kalo Message Content Intent belum di-enable.
        // Kalo pesan user lain isinya kosong padahal bukan attachment/sticker, kemungkinan besar intent missing.
        // Skip warning kalau pesan cuma berisi attachment/sticker (memang gak ada content-nya).
        if (!message.content && message.author.id !== message.client.user.id) {
            if (!message.attachments?.size && !message.stickers?.size && !message.components?.length) {
                debugLogIntentMissing(message);
            }
        }

        // Catat pesan ke stats leaderboard
        try {
            trackMessage(message.guild.id, message.author.id);
        } catch (_) {}

        // Jalanin 4 hook community. Urutan: automod dulu (kalo pesan ke-delete, hook lainnya diskip).
        // Soalnya kalo pesan udah ke-delete, message.reply bakal error "Unknown Message".
        // Dulu error ini tertelan diam-diam, jadi auto-responder/AFK reply kelihatan rusak padahal bukan.
        try {
            const deleted = await hookAutoMod(message);
            if (deleted) return;
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
 * Cek 4 hal: spam, link, kata terlarang, mass-mention.
 * Kalo ada yang nabrak, hapus pesannya + kasih action (warn/mute/kick sesuai config).
 */
async function hookAutoMod(message) {
    const config = automodManager.getGuildConfig(message.guild.id);
    if (!config || !config.enabled) return false;

    // Admin always whitelisted
    if (automodManager.isUserWhitelisted(message.member, config)) return false;

    const content = message.content || '';
    let shouldDelete = false;
    let actionReason = null;
    let actionToTake = null;

    // 1. Cek spam (terlalu banyak pesan dalam waktu singkat)
    if (automodManager.checkSpam(message.guild.id, message.author.id, config)) {
        shouldDelete = true;
        actionReason = `Spam (${config.spamThreshold}+ pesan dalam ${config.spamWindowMs / 1000}s)`;
        actionToTake = config.spamAction;
        automodManager.resetSpamTracker(message.guild.id, message.author.id);
    }

    // 2. Cek link (kalo blockLinks aktif & channel bukan whitelist)
    if (!shouldDelete && config.blockLinks && automodManager.containsLink(content)) {
        if (!config.linkAllowedChannels?.includes(message.channel.id)) {
            shouldDelete = true;
            actionReason = 'Link diblokir di channel ini';
            actionToTake = 'delete_only';
        }
    }

    // 3. Cek kata terlarang
    if (!shouldDelete && config.blockWords?.length > 0) {
        const badWord = automodManager.containsBlockedWord(content, config.blockWords);
        if (badWord) {
            shouldDelete = true;
            actionReason = `Kata terlarang: "${badWord}"`;
            actionToTake = config.wordAction;
        }
    }

    // 4. Cek mass-mention (mention terlalu banyak orang/role)
    if (!shouldDelete && config.maxMentions) {
        const mentionCount = automodManager.countMentions(message);
        if (mentionCount > config.maxMentions) {
            shouldDelete = true;
            actionReason = `Mass-mention (${mentionCount} mentions, max ${config.maxMentions})`;
            actionToTake = config.mentionAction;
        }
    }

    if (!shouldDelete) return false;

    // Eksekusi: hapus pesan dulu, terus kasih action tambahan kalo perlu
    let deleted = false;
    try {
        if (shouldDelete) {
            await message.delete().catch(() => {});
            deleted = true;
        }

        // Action tambahan (warn/mute/kick) — kalo bukan cuma delete
        if (actionToTake && actionToTake !== 'delete_only') {
            const member = message.member;
            if (member) {
                if (actionToTake === 'warn') {
                    // DM doang sebagai peringatan
                    try {
                        await member.send(`⚠️ Pesan kamu dihapus di **${message.guild.name}**: ${actionReason}`);
                    } catch (_) {}
                } else if (actionToTake === 'mute_10m' || actionToTake === 'mute_1h') {
                    const duration = actionToTake === 'mute_10m' ? 10 * 60 * 1000 : 60 * 60 * 1000;
                    try {
                        await member.timeout(duration, `Auto-mod: ${actionReason}`);
                        console.log(`🛡️ ${message.author.tag} di-mute ${actionToTake} — ${actionReason}`);
                    } catch (err) {
                        console.warn(`⚠️ Gagal mute ${message.author.tag}: ${err.message}`);
                    }
                } else if (actionToTake === 'kick') {
                    try {
                        await member.kick(`Auto-mod: ${actionReason}`);
                        console.log(`🛡️ ${message.author.tag} di-kick — ${actionReason}`);
                    } catch (err) {
                        console.warn(`⚠️ Gagal kick ${message.author.tag}: ${err.message}`);
                    }
                }
            }
        }

        console.log(`🛡️ Auto-mod action on ${message.author.tag}: ${actionToTake} — ${actionReason}`);
    } catch (err) {
        console.warn(`⚠️ Auto-mod apply error: ${err.message}`);
    }
    return deleted;
}

/**
 * Hook 2: Auto-Responder
 * Kalo pesan diawali trigger keyword (mis. "!sosmed"), bot auto-reply.
 */
async function hookAutoResponder(message) {
    // Kirim userId biar cooldown-nya per-user (bukan global per-trigger)
    const responder = responderManager.findMatch(message.guild.id, message.content, message.author.id);
    if (!responder) return;

    // Don't trigger responder if message is in a thread about ticket (avoid noise)
    // Actually let's just send it — admin can configure cooldown

    try {
        if (responder.replyType === 'embed') {
            const embed = new EmbedBuilder()
                .setDescription(responder.reply)
                .setColor(0x5865f2)
                .setFooter({ text: `Auto-responder: ${responder.trigger}` });
            await message.reply({ embeds: [embed] });
        } else {
            await message.reply({ content: responder.reply, allowedMentions: { parse: [] } });
        }
        responderManager.markUsed(message.guild.id, responder.id, message.author.id);
    } catch (err) {
        console.warn(`⚠️ Auto-responder error: ${err.message}`);
    }
}

/**
 * Hook 3: AFK System
 * - Kalo user yang AFK kirim pesan → clear AFK + sapa "welcome back"
 * - Kalo ada yang mention user AFK → reply kasih tau dia lagi AFK
 */
async function hookAfkSystem(message) {
    // Cek: kalo sender lagi AFK, clear dulu
    let senderWasAFK = false;
    if (afkManager.isAFK(message.guild.id, message.author.id)) {
        afkManager.clearAFK(message.guild.id, message.author.id);
        senderWasAFK = true;
    }

    // Kumpulkan info user AFK yang di-mention di pesan ini
    const afkReplies = [];
    if (message.mentions?.users && message.mentions.users.size > 0) {
        for (const [userId, user] of message.mentions.users) {
            if (userId === message.author.id) continue; // skip mention diri sendiri
            if (user.bot) continue;

            const afkData = afkManager.getAFK(message.guild.id, userId);
            if (afkData) {
                const duration = afkManager.formatDuration(afkData.since);
                afkReplies.push(`💤 <@${userId}> lagi AFK: **${afkData.reason}** *(${duration})*`);
            }
        }
    }

    // Kalau sender AFK DAN ada user AFK yang di-mention, gabung jadi 1 pesan biar gak double-reply
    if (senderWasAFK && afkReplies.length > 0) {
        try {
            const reply = await message.reply({
                content: `👋 Welcome back, ${message.author}! Status AFK kamu sudah di-clear.\n\n${afkReplies.join('\n')}`,
                allowedMentions: { users: [] }
            });
            setTimeout(() => reply.delete().catch(() => {}), 30000);
        } catch (_) {}
        return;
    }

    // Cuma sender AFK (tanpa mention user AFK lain)
    if (senderWasAFK) {
        try {
            const welcomeBack = await message.reply({
                content: `👋 Welcome back, ${message.author}! Status AFK kamu sudah di-clear.`,
                allowedMentions: { users: [] }
            });
            // Hapus pesan welcome back setelah 5 detik biar channel gak berantakan
            setTimeout(() => welcomeBack.delete().catch(() => {}), 5000);
        } catch (_) {}
        return;
    }

    // Cuma ada mention user AFK (sender sendiri gak AFK)
    if (afkReplies.length > 0) {
        try {
            const reply = await message.reply({
                content: afkReplies.join('\n'),
                allowedMentions: { users: [] }
            });
            setTimeout(() => reply.delete().catch(() => {}), 30000);
        } catch (_) {}
    }
}

/**
 * Hook 4: Leveling
 * Tambah XP ke user. Kalo naik level, announce + kasih role reward (kalau ada).
 */
async function hookLeveling(message) {
    const config = getConfig();
    const levelingConfig = config.leveling;
    if (!levelingConfig || !levelingConfig.enabled) return;

    const xpGain = levelingConfig.xpPerMessage || 15;
    const result = levelManager.addXp(message.guild.id, message.author.id, xpGain, levelingConfig);

    if (!result.leveledUp) return;

    const newLevel = result.newLevel;
    console.log(`📊 ${message.author.tag} naik ke level ${newLevel}!`);

    // Announce level up di channel tempat user chat
    if (levelingConfig.announceLevelUp) {
        try {
            const levelUpEmbed = new EmbedBuilder()
                .setTitle('🎉 LEVEL UP!')
                .setDescription(`GG ${message.author}! Kamu naik ke **Level ${newLevel}**!`)
                .setColor(0xf1c40f)
                .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
                .setTimestamp();
            await message.channel.send({ embeds: [levelUpEmbed] });
        } catch (_) {}
    }

    // Auto-assign role reward. Support stacking — user level 50 dapet semua role level 10, 20, 50 sekaligus.
    const roleIds = levelManager.getRoleForLevel(newLevel, config);
    if (roleIds.length > 0 && message.member) {
        // Cek role mana yang belum dimiliki user
        const toAdd = roleIds.filter(id => !message.member.roles.cache.has(id));
        if (toAdd.length > 0) {
            try {
                await message.member.roles.add(toAdd);
                console.log(
                    `📊 Kasih ${toAdd.length} role ke ${message.author.tag} (level ${newLevel}): ${toAdd.join(', ')}`
                );
                try {
                    await message.author.send(
                        `🎉 Kamu dapat role baru di **${message.guild.name}** karena cap Level ${newLevel}!`
                    );
                } catch (_) {}
            } catch (err) {
                console.warn(`⚠️ Gagal kasih role level: ${err.message}`);
            }
        }
    }
}

module.exports = {
    name: Events.MessageCreate,
    execute: onMessageCreate
};
