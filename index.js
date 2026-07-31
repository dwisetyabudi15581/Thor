const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Events } = require('discord.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers
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
const { incrementMessages: trackMessage, startAutoFlush: startStatsAutoFlush, shutdown: shutdownStats } = require('./utils/statsManager');
// P3-6 REFACTOR: definisi command & scheduler tasks dipisah ke file terpisah supaya index.js lebih lean.
const { getCommands } = require('./utils/commandDefinitions');
const { processExpiredRole, processGiveawayEnd, processScheduledAnnouncement, attachToClient } = require('./utils/schedulerTasks');

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
        console.error('Interaction Error:', err);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            interaction.reply({ content: '❌ Terjadi error.', flags: 64 }).catch(()=>{});
        }
    }
});

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
        trackMessage(message.author.id);
    } catch (_) {}
});

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
