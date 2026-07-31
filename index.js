const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Events, ChannelType } = require('discord.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates   // v3.8.5: untuk temp voice
    ],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User]
});

// === HANDLERS ===
const commandHandler = require('./handlers/commandHandler');
const interactionHandler = require('./handlers/interactionHandler');
const { onMemberAdd, onMemberRemove } = require('./handlers/memberHandler');

// === UTILS — scheduler & data layer ===
const { getExpired, removeEntry, getAllActive } = require('./utils/roleScheduler');
const { removeExpiredKeys } = require('./utils/keyManager');
const { startAutoBackup } = require('./utils/backupManager');
const { getEnding: getEndingGiveaways } = require('./utils/giveawayManager');
const { getPending: getPendingAnns } = require('./utils/scheduledAnnouncements');
// v3.9.4: statsManager.init dipanggil di ClientReady untuk migrate legacy entries ke guild scoping.
const { incrementMessages: trackMessage, startAutoFlush: startStatsAutoFlush, shutdown: shutdownStats, init: initStats } = require('./utils/statsManager');
// P3-6 REFACTOR: definisi command & scheduler tasks dipisah ke file terpisah supaya index.js lebih lean.
const { getCommands } = require('./utils/commandDefinitions');
const { processExpiredRole, processGiveawayEnd, processScheduledAnnouncement, attachToClient } = require('./utils/schedulerTasks');
// v3.8.5: Temp Voice manager
const tempVoiceManager = require('./utils/tempVoiceManager');

// === ERROR HANDLER GLOBAL ===
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception:', err);
});

// === GUILD ID (untuk registrasi command instan ke server Anda) ===
// P3-13 FIX: hapus hard-coded fallback guild ID. GUILD_ID WAJIB di-set via .env.
// Kalau tidak di-set, bot fallback ke global commands (perlu ~1 jam propagasi).
const GUILD_ID = process.env.GUILD_ID || null;

// Attach scheduler tasks ke client supaya commandHandler bisa panggil
// `client.processGiveawayEnd()` & `client.announceRerollWinner()`.
attachToClient(client);

client.once(Events.ClientReady, async (c) => {
    console.log(`✅ Bot online sebagai ${c.user.tag}`);

    try {
        // === 1. Hapus SEMUA command global (anti duplikat) ===
        // Versi lama bot pakai registrasi global, jadi mungkin masih ada
        // command global tertinggal di cache Discord. Hapus supaya tidak dobel.
        try {
            const globalCmds = await c.application.commands.fetch();
            if (globalCmds.size > 0) {
                console.log(`🧹 Menghapus ${globalCmds.size} command global yang tersisa (anti duplikat)...`);
                await c.application.commands.set([]);
                console.log('✅ Command global dibersihkan.');
            }
        } catch (e) {
            console.warn('⚠️ Gagal bersihkan command global:', e.message);
        }

        // === 2. Daftar command ke GUILD SPESIFIK (instan, tidak perlu tunggu 1 jam) ===
        if (!GUILD_ID) {
            console.warn('⚠️ GUILD_ID belum di-set di .env. Bot fallback ke global commands.');
            console.warn('   Set GUILD_ID di file .env untuk registrasi instan (1 detik vs 1 jam).');
            await c.application.commands.set(getCommands());
        } else {
            const guild = c.guilds.cache.get(GUILD_ID);
            if (!guild) {
                console.warn(`⚠️ Guild dengan ID ${GUILD_ID} tidak ditemukan. Pastikan bot sudah di-invite ke server itu.`);
                console.warn('   Sementara fallback ke global commands (perlu ~1 jam untuk muncul).');
                await c.application.commands.set(getCommands());
            } else {
                // guild.commands.set() otomatis replace semua command guild yang ada,
                // jadi tidak akan ada duplikat di guild ini.
                await guild.commands.set(getCommands());
                console.log(`✅ Slash Commands terdaftar ke guild: ${guild.name} (instan!)`);
            }
        }
    } catch (err) {
        console.error('Gagal daftar slash command:', err);
    }

    // === RE-SCHEDULE AUTO-REMOVE ROLE (MODEL KEY-DRIVEN) ===
    // 1. Saat bot start: hapus key expired dulu, lalu proses schedule expired
    // 2. Setiap 60 detik: hapus key expired, lalu proses schedule expired
    //    Saat schedule fires, scheduler cek ulang key aktif → kalau masih ada key
    //    dengan expireAt > now, reschedule ke max; kalau ada key permanen, hapus schedule;
    //    kalau tidak ada key aktif, hapus role + schedule.
    try {
        // Bersihkan key expired yang tertinggal saat bot offline
        const removedKeys = removeExpiredKeys();
        if (removedKeys > 0) {
            console.log(`🧹 Membersihkan ${removedKeys} key expired dari keys.json.`);
        }

        const expired = getExpired();
        if (expired.length > 0) {
            console.log(`⏰ Ditemukan ${expired.length} role yang harus diproses (schedule expired saat bot offline).`);
            for (const entry of expired) {
                await processExpiredRole(client, entry);
            }
        }
        const active = getAllActive();
        if (active.length > 0) {
            console.log(`📋 ${active.length} auto-role terjadwal aktif.`);
        }

        // === 3. Start AUTO-BACKUP (saat start + tiap 24 jam) ===
        startAutoBackup(client);

        // === 4. Start AUTO-FLUSH stats cache (P0-1 fix) ===
        startStatsAutoFlush();

        // === v3.9.4: init statsManager dengan default guild untuk migrasi legacy entries ===
        // Kalau bot di 1 guild (mayoritas case), legacy entries (key tanpa `:`) akan di-assign ke guild ini.
        // Kalau bot multi-guild, pakai guild pertama yang ada di cache.
        const defaultStatsGuildId = GUILD_ID || (c.guilds.cache.size > 0 ? c.guilds.cache.first().id : null);
        if (defaultStatsGuildId) {
            try { initStats(defaultStatsGuildId); } catch (err) {
                console.warn('⚠️ Gagal init statsManager:', err.message);
            }
        }

        // === P0-2 FIX: Guard overlap pada scheduler interval ===
        // Sebelumnya: jika iterasi >60 detik (API Discord lambat),
        // iterasi berikutnya fire & proses entry yang sama → double DM.
        // Sekarang: pakai lock flag, skip iterasi kalau sebelumnya belum selesai.
        let schedulerRunning = false;
        setInterval(async () => {
            if (schedulerRunning) {
                console.log('⏭️ Scheduler tick di-skip (iterasi sebelumnya masih jalan).');
                return;
            }
            schedulerRunning = true;
            try {
                // 1. Bersihkan key expired
                const removed = removeExpiredKeys();
                if (removed > 0) {
                    console.log(`🧹 ${removed} key expired dihapus.`);
                }
                // 2. Proses schedule expired (dengan recheck key)
                const expiredNow = getExpired();
                for (const entry of expiredNow) {
                    await processExpiredRole(client, entry);
                }
                // 3. Auto-end giveaways yang sudah waktunya
                const endingGws = getEndingGiveaways();
                for (const gw of endingGws) {
                    await processGiveawayEnd(client, gw);
                }
                // 4. Auto-send scheduled announcements yang sudah waktunya
                const pendingAnns = getPendingAnns();
                for (const ann of pendingAnns) {
                    await processScheduledAnnouncement(client, ann);
                }
            } catch (err) {
                console.error('Scheduler tick error:', err);
            } finally {
                schedulerRunning = false;
            }
        }, 60 * 1000);
    } catch (err) {
        console.error('Error re-schedule role:', err);
    }
});

// === INTERACTION (command & button) ===
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            await commandHandler(interaction);
        } else {
            await interactionHandler(interaction);
        }
    } catch (err) {
        // FIX v3.7.1: klasifikasi error supaya logging tidak noisy untuk transient network issues.
        //   - Transient (timeout, 5xx, ECONNRESET, ETIMEDOUT): warning ringan, jangan full stack
        //   - DiscordAPIError known (4xx): warning + kode error
        //   - Lainnya: full error stack (kemungkinan bug kode)
        //
        // FIX v3.9.4: tambah klasifikasi untuk "ignorable reply errors":
        //   - 10008 Unknown Message: user menutup pesan ephemeral sebelum editReply jalan
        //   - 10062 Unknown Interaction: token interaction expired (>15 menit)
        //   - 40060 Interaction already acknowledged: race condition double-ack
        //   Error ini BUKAN bug — user behavior yang wajar. Cukup warning 1 baris,
        //   jangan full stack trace.
        const isTransient = isTransientNetworkError(err);
        const isIgnorableReply = isIgnorableReplyError(err);
        if (isTransient) {
            console.warn(`⚠️ Transient network error on interaction ${interaction.id}:`, err.code || err.name, '-', err.message?.slice(0, 100));
        } else if (isIgnorableReply) {
            console.warn(`⚠️ Interaction ${interaction.id} reply gagal (code ${err.code}): ${err.message?.slice(0, 100)}`);
        } else {
            console.error('Interaction Error:', err);
        }

        // FIX v3.7.1: kalau transient, jangan coba reply (kemungkinan juga timeout).
        // Coba reply hanya kalau bukan transient DAN belum replied/deferred.
        // v3.9.4: jangan coba reply kalau ignorable reply error (interaction sudah invalid).
        if (!isTransient && !isIgnorableReply && interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            interaction.reply({ content: '❌ Terjadi error. Coba lagi sebentar.', flags: 64 }).catch(()=>{});
        }
    }
});

/**
 * Deteksi apakah error adalah transient network issue (timeout, koneksi, 5xx).
 * Transient error tidak perlu full stack trace — cukup warning ringan.
 */
function isTransientNetworkError(err) {
    if (!err) return false;
    const name = err.name || '';
    const code = err.code || '';
    const status = err.status || 0;

    // Network / timeout errors
    if (name === 'ConnectTimeoutError') return true;
    if (name === 'WebSocketClosedError') return true;
    if (code === 'UND_ERR_CONNECT_TIMEOUT') return true;
    if (code === 'ETIMEDOUT') return true;
    if (code === 'ECONNRESET') return true;
    if (code === 'ECONNREFUSED') return true;
    if (code === 'EAI_AGAIN') return true; // DNS temp fail
    if (code === 'ENOTFOUND') return true;

    // Discord 5xx server errors (transient)
    if (status >= 500 && status < 600) return true;
    // Discord 429 rate limit (transient)
    if (status === 429) return true;

    return false;
}

/**
 * v3.9.4: Deteksi apakah error adalah "ignorable reply error" — yaitu error
 * yang terjadi karena user behavior (dismiss ephemeral, biarkan >15 menit)
 * BUKAN karena bug kode. Error ini cukup di-warning, tidak perlu stack trace.
 *
 * - 10008 Unknown Message: user menutup ephemeral reply sebelum editReply jalan
 * - 10062 Unknown Interaction: token interaction sudah expired (>15 menit)
 * - 40060 Interaction has already been acknowledged: race condition ack
 */
function isIgnorableReplyError(err) {
    if (!err) return false;
    const code = err.code;
    return code === 10008 || code === 10062 || code === 40060;
}

// === MEMBER EVENTS (welcome / goodbye / auto role) ===
client.on(Events.GuildMemberAdd, async (member) => {
    try {
        await onMemberAdd(member);
    } catch (err) {
        console.error('GuildMemberAdd Error:', err);
    }
});

client.on(Events.GuildMemberRemove, async (member) => {
    try {
        await onMemberRemove(member);
    } catch (err) {
        console.error('GuildMemberRemove Error:', err);
    }
});

// === MESSAGE TRACKING (untuk leaderboard stats) ===
// Track tiap pesan user di guild (count saja, tidak simpan content).
// Catatan: untuk dapat content pesan, butuh MessageContent intent (privileged).
// Tracking count tetap jalan tanpa intent itu — hanya event messageCreate yang fired.
client.on(Events.MessageCreate, async (message) => {
    try {
        if (message.author?.bot) return;
        if (!message.guild) return; // DM
        // v3.9.4: scoped per guild — sebelumnya bocor ke guild lain kalau bot multi-guild.
        trackMessage(message.guild.id, message.author.id);
    } catch (_) {}
});

// === v3.8.5: TEMP VOICE — voiceStateUpdate handler ===
// Logic:
//   1. Member join trigger channel "🔊 Buat Voice" → bikin voice baru, pindahkan member
//   2. Member join/leave channel temp voice → refresh panel global
//   3. Member leave channel temp voice → kalau channel kosong, hapus + refresh panel
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
        // Skip kalau bukan guild
        if (!newState.guild) return;

        const guildId = newState.guild.id;
        const userId = newState.id;
        const creatorChannelId = tempVoiceManager.getCreatorChannelId(guildId);
        if (!creatorChannelId) return; // temp voice belum di-setup

        const oldChannelId = oldState.channelId;
        const newChannelId = newState.channelId;

        // === CASE 1: Member join trigger channel → bikin voice baru ===
        if (newChannelId === creatorChannelId && oldChannelId !== creatorChannelId) {
            await handleCreateTempVoice(newState);
            return;
        }

        // === CASE 2: Member join/leave channel temp voice → refresh panel global ===
        // Cek apakah ada perubahan channel voice yang relevan untuk refresh panel
        if (oldChannelId !== newChannelId) {
            // Cek apakah channel yang ditinggalkan atau dituju adalah temp voice milik seseorang
            const involvedTempVoice = (
                (oldChannelId && tempVoiceManager.getChannel(guildId, oldChannelId)) ||
                (newChannelId && tempVoiceManager.getChannel(guildId, newChannelId))
            );
            if (involvedTempVoice) {
                await refreshGlobalControlPanel(newState.client, guildId);
            }
        }

        // === CASE 3: Member leave channel temp voice ===
        if (oldChannelId && oldChannelId !== newChannelId) {
            const channelInfo = tempVoiceManager.getChannel(guildId, oldChannelId);
            if (channelInfo) {
                const oldChannel = newState.guild.channels.cache.get(oldChannelId);

                // v3.8.4: AUTO-TRANSFER — kalau yang leave adalah OWNER dan masih ada member lain,
                // ownership otomatis pindah ke member lain (yang paling lama join).
                // Ini supaya channel tidak kehilangan owner yang bisa kontrol.
                if (channelInfo.ownerId === userId && oldChannel && oldChannel.members.size > 0) {
                    await handleAutoTransferOwnership(newState.client, guildId, oldChannelId, channelInfo, oldChannel, userId);
                }

                // v3.8.5: panel global — tidak lagi pakai focused owner concept

                if (oldChannel && oldChannel.members.size === 0) {
                    // Channel kosong → hapus
                    try {
                        await oldChannel.delete('Temp voice kosong');
                        tempVoiceManager.unregisterChannel(guildId, oldChannelId);
                        console.log(`🎤 Temp voice ${oldChannelId} dihapus (kosong).`);
                    } catch (err) {
                        if (err.code !== 10003) { // 10003 = Unknown Channel (sudah dihapus)
                            console.warn(`⚠️ Gagal hapus temp voice ${oldChannelId}:`, err.message);
                        }
                        tempVoiceManager.unregisterChannel(guildId, oldChannelId);
                    }
                }
                // Refresh panel setelah leave (member count, owner, atau channel hilang)
                await refreshGlobalControlPanel(newState.client, guildId);
            }
        }
    } catch (err) {
        console.error('VoiceStateUpdate Error:', err.message);
    }
});

/**
 * v3.8.4: AUTO-TRANSFER OWNERSHIP saat owner leave voice channel.
 * v3.8.5: Removed focused owner logic — panel is now fully global.
 *
 * Logic:
 *   1. Cari member lain yang masih di channel (selain owner lama)
 *   2. Pilih member dengan joinedAt paling lama (paling senior di channel)
 *   3. Update permission channel (lepas owner lama, beri owner baru)
 *   4. Update tempVoiceManager.transferOwnership
 *   5. Kirim notif ke owner baru via DM
 *   6. Refresh panel global
 *
 * @param {Client} client
 * @param {string} guildId
 * @param {string} channelId
 * @param {Object} channelInfo - info dari tempVoiceManager
 * @param {VoiceChannel} voiceChannel - channel object
 * @param {string} oldOwnerId - userId owner lama yang leave
 */
async function handleAutoTransferOwnership(client, guildId, channelId, channelInfo, voiceChannel, oldOwnerId) {
    try {
        // Cari member lain (selain owner lama) — pilih yang joinedAt paling lama
        // v3.9.4 FIX: exclude bot account. Sebelumnya music bot di channel bisa jadi owner baru.
        const otherMembers = voiceChannel.members.filter(m => m.id !== oldOwnerId && !m.user.bot);
        if (otherMembers.size === 0) return; // tidak ada member lain

        // Sort by joinedAt asc (paling lama join = paling senior)
        const sorted = [...otherMembers.values()].sort((a, b) => {
            const aTime = a.voice?.joinedTimestamp || a.joinedTimestamp || 0;
            const bTime = b.voice?.joinedTimestamp || b.joinedTimestamp || 0;
            return aTime - bTime;
        });
        const newOwner = sorted[0];
        if (!newOwner) return;

        const { PermissionFlagsBits: PFB } = require('discord.js');

        // Update permission: lepas owner lama, beri owner baru
        try {
            await voiceChannel.permissionOverwrites.edit(oldOwnerId, {
                [PFB.ManageChannels]: false,
                [PFB.MoveMembers]: false,
                [PFB.MuteMembers]: false,
                [PFB.DeafenMembers]: false
            });
            await voiceChannel.permissionOverwrites.edit(newOwner.id, {
                [PFB.ViewChannel]: true,
                [PFB.Connect]: true,
                [PFB.ManageChannels]: true,
                [PFB.MoveMembers]: true,
                [PFB.MuteMembers]: true,
                [PFB.DeafenMembers]: true
            });
        } catch (err) {
            console.warn(`⚠️ Gagal update permission saat auto-transfer: ${err.message}`);
            return;
        }

        // Update manager
        tempVoiceManager.transferOwnership(guildId, channelId, newOwner.id, newOwner.user.tag);

        // v3.8.5: panel global — tidak lagi pakai focused owner, refresh panel saja

        // Notif owner baru via DM
        try {
            await newOwner.send(
                `🎁 **Kamu sekarang owner voice channel: ${voiceChannel.name}**\n\n` +
                `Ownership otomatis dipindahkan ke kamu karena owner sebelumnya (<@${oldOwnerId}>) keluar dari voice.\n\n` +
                `🎛️ Kamu bisa kontrol channel ini lewat panel global temp voice di server. Klik tombol kontrol (Rename, Kick, Limit, dll) — bot akan otomatis deteksi channel kamu.`
            );
        } catch (_) {}

        console.log(`🔄 Auto-transfer ownership channel ${channelId}: ${oldOwnerId} → ${newOwner.id} (${newOwner.user.tag})`);
    } catch (err) {
        console.error('Error auto-transfer ownership:', err.message);
    }
}

/**
 * Handle saat member join trigger channel → bikin voice baru.
 */
async function handleCreateTempVoice(newState) {
    const guild = newState.guild;
    const member = newState.member;

    try {
        const config = tempVoiceManager.getGuildConfig(guild.id);
        if (!config?.categoryId) {
            console.warn('⚠️ Temp voice config tidak ada categoryId.');
            return;
        }

        // Cek apakah member sudah punya channel aktif
        const existingChannelId = tempVoiceManager.findChannelByOwner(guild.id, member.id);
        if (existingChannelId) {
            const existingChannel = guild.channels.cache.get(existingChannelId);
            if (existingChannel) {
                // Pindahkan member ke channel yang sudah ada
                try {
                    await member.voice.setChannel(existingChannelId);
                    return;
                } catch (_) {
                    // Kalau gagal pindah, biarkan di trigger channel
                }
            } else {
                // v3.9.4 FIX: channel sudah dihapus (oleh admin atau bot crash sebelum unregister).
                // Sebelumnya orphan entry tetap ada di tempVoice.json → findChannelByOwner selalu
                // return ID ini → setiap join trigger selalu bikin channel baru (leak).
                tempVoiceManager.unregisterChannel(guild.id, existingChannelId);
                console.log(`🧹 Temp voice orphan ${existingChannelId} dihapus (channel tidak ada).`);
            }
        }

        // Bikin voice channel baru
        const channelName = `🔊 ${member.user.username}'s Room`;
        const newChannel = await guild.channels.create({
            name: channelName.slice(0, 100),
            type: ChannelType.GuildVoice,
            parent: config.categoryId,
            bitrate: 64000,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
                { id: member.id, allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.Connect,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.MoveMembers,
                    PermissionFlagsBits.MuteMembers,
                    PermissionFlagsBits.DeafenMembers
                ]}
            ]
        });

        // Register ke manager
        tempVoiceManager.registerChannel(guild.id, newChannel.id, member.id, member.user.tag, newChannel.name);

        // v3.8.5: panel global — tidak lagi pakai focused owner, langsung refresh panel

        // Pindahkan member ke channel baru
        try {
            await member.voice.setChannel(newChannel.id);
        } catch (err) {
            console.warn(`⚠️ Gagal pindahkan member ke channel baru: ${err.message}`);
        }

        // Refresh panel global supaya menampilkan kontrol untuk owner baru
        await refreshGlobalControlPanel(newState.client, guild.id);

        console.log(`🎤 Temp voice dibuat: ${newChannel.name} (${newChannel.id}) oleh ${member.user.tag}`);
    } catch (err) {
        console.error('Error create temp voice:', err);
    }
}

/**
 * v3.8.5: Refresh panel kontrol global di control channel.
 *
 * Panel ini menampilkan daftar semua voice aktif + button kontrol.
 * - Kalau tidak ada voice aktif → tampilan idle (hanya tombol Buat Voice)
 * - Kalau ada voice aktif → tampilan global (daftar semua voice + kontrol buttons)
 *
 * Control buttons (Rename, Kick, Limit, Lock, Transfer, Delete, Info Room)
 * bekerja via auto-detect owner (bot otomatis deteksi channel user).
 *
 * Panel di-fetch berdasarkan controlMessageId yang disimpan di tempVoice.json.
 * Kalau pesan hilang (dihapus admin), bot tidak kirim ulang (admin harus
 * jalankan /setup-tempvoice lagi untuk membuat panel baru).
 */
async function refreshGlobalControlPanel(client, guildId) {
    try {
        const config = tempVoiceManager.getGuildConfig(guildId);
        if (!config?.controlChannelId || !config?.controlMessageId) return;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;

        const controlChannel = guild.channels.cache.get(config.controlChannelId);
        if (!controlChannel) return;

        const panelMsg = await controlChannel.messages.fetch(config.controlMessageId).catch(() => null);
        if (!panelMsg) {
            // Panel message hilang — log warning, admin harus re-setup
            console.warn(`⚠️ Panel global temp voice untuk guild ${guildId} tidak ditemukan. Jalankan /setup-tempvoice lagi.`);
            return;
        }

        // Kumpulkan semua owner voice aktif (urut dari yang paling baru dibuat)
        const activeOwners = [];
        if (config.channels) {
            for (const [channelId, channelInfo] of Object.entries(config.channels)) {
                const voiceChannel = guild.channels.cache.get(channelId);
                if (voiceChannel) {
                    activeOwners.push({ channelId, channelInfo, voiceChannel });
                }
            }
            // Sort by createdAt desc (paling baru pertama)
            activeOwners.sort((a, b) => (b.channelInfo.createdAt || 0) - (a.channelInfo.createdAt || 0));
        }

        // v3.8.5: panel global — tampilkan semua voice aktif tanpa focused owner
        const { buildGlobalControlPanel } = require('./utils/tempVoiceControlPanel');
        const { embed, components } = buildGlobalControlPanel({
            activeOwners,
            guildName: guild.name
        });

        await panelMsg.edit({ embeds: [embed], components }).catch(err => {
            console.warn(`⚠️ Gagal refresh panel global temp voice: ${err.message}`);
        });
    } catch (err) {
        console.warn('Gagal refresh panel global:', err.message);
    }
}

// Expose refreshGlobalControlPanel ke client supaya interactionHandler bisa panggil
// setelah rename/kick/limit/lock/transfer/delete.
client.refreshGlobalControlPanel = refreshGlobalControlPanel;

// === P0-1 FIX: Graceful shutdown — flush stats cache sebelum exit ===
function gracefulShutdown(signal) {
    console.log(`\n⚠️ Received ${signal}, flushing stats & shutting down...`);
    try { shutdownStats(); } catch (_) {}
    try { client.destroy(); } catch (_) {}
    process.exit(0);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

client.login(process.env.DISCORD_TOKEN);
