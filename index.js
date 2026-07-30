const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Events, ChannelType } = require('discord.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User]
});

// === HANDLERS ===
const commandHandler = require('./handlers/commandHandler');
const interactionHandler = require('./handlers/interactionHandler');
const { onMemberAdd, onMemberRemove } = require('./handlers/memberHandler');
const { getExpired, removeEntry, getAllActive, updateExpireAt } = require('./utils/roleScheduler');
const { removeExpiredKeys, getActiveKeysByUserAndRole, hasPermanentKey, getMaxExpireAtByUserAndRole } = require('./utils/keyManager');
const { startAutoBackup } = require('./utils/backupManager');
const { getEnding: getEndingGiveaways, end: endGiveaway, pickWinners: pickGiveawayWinners } = require('./utils/giveawayManager');
const { getPending: getPendingAnns, markSent: markAnnSent } = require('./utils/scheduledAnnouncements');
const { incrementMessages: trackMessage, recordJoin: trackJoin, recordPurchase: trackPurchase, recordGiveawayWin: trackGiveawayWin, parsePrice: parsePriceNum } = require('./utils/statsManager');
const { addSession: addTempVoiceSession, removeSession: removeTempVoiceSession, getByChannel: getTempVoiceByChannel, cleanupOrphans: cleanupTempVoiceOrphans, createRoom: createTempVoiceRoom } = require('./utils/tempVoice');
const { getConfig } = require('./utils/configManager');

// === ERROR HANDLER GLOBAL ===
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception:', err);
});

// === GUILD ID (untuk registrasi command instan ke server Anda) ===
// Ambil dari .env (GUILD_ID) — kalau tidak ada, fallback ke guild ID default
const GUILD_ID = process.env.GUILD_ID || '1531304604162068511';

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

        // === 4. Cleanup Temp Voice orphans (channel yang kehapus saat bot offline) ===
        const orphanRemoved = cleanupTempVoiceOrphans(client);
        if (orphanRemoved > 0) {
            console.log(`🧹 TempVoice: ${orphanRemoved} session orphan dibersihkan.`);
        }
        const tvList = require('./utils/tempVoice').load();
        if (tvList.length > 0) {
            console.log(`🎤 ${tvList.length} temp voice channel aktif terdaftar.`);
        }

        // Cek setiap 1 menit
        setInterval(async () => {
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
        }, 60 * 1000);
    } catch (err) {
        console.error('Error re-schedule role:', err);
    }
});

/**
 * Proses schedule yang sudah expired — MODEL KEY-DRIVEN dengan recheck.
 *
 * Logic:
 *   1. Cek apakah user masih ada di guild. Kalau tidak → hapus schedule.
 *   2. Cek key aktif untuk user+role:
 *      a. Kalau ada key PERMANEN → hapus schedule, role tetap (permanen).
 *      b. Kalau ada key aktif dengan expireAt > now → reschedule ke max(expireAt).
 *         Role tetap. (ini kunci MAX EXTEND — schedule tidak boleh lebih pendek dari key terpanjang)
 *      c. Kalau tidak ada key aktif → hapus role + hapus schedule.
 */
async function processExpiredRole(client, entry) {
    try {
        const guild = await client.guilds.fetch(entry.guildId).catch(() => null);
        if (!guild) {
            removeEntry(entry.id);
            return;
        }
        const member = await guild.members.fetch(entry.userId).catch(() => null);
        if (!member) {
            // User sudah leave, hapus entry
            removeEntry(entry.id);
            return;
        }
        const role = guild.roles.cache.get(entry.roleId);
        const now = Date.now();

        // === 1. Cek key PERMANEN ===
        if (hasPermanentKey(entry.userId, entry.roleId)) {
            console.log(`♾️ ${member.user.tag}: schedule ${role?.name || entry.roleId} dihapus (ada key permanen). Role tetap.`);
            removeEntry(entry.id);
            return;
        }

        // === 2. Cek key aktif lain dengan expireAt > now ===
        const maxExpireAt = getMaxExpireAtByUserAndRole(entry.userId, entry.roleId, now);
        if (maxExpireAt !== null && maxExpireAt > now) {
            // Masih ada key aktif dengan sisa waktu → reschedule ke max
            updateExpireAt(entry.id, maxExpireAt);
            const days = Math.ceil((maxExpireAt - now) / 86400000);
            console.log(`⏰ ${member.user.tag}: schedule ${role?.name || entry.roleId} di-reschedule ke ${days} hari lagi (mengikuti key terpanjang).`);
            return;
        }

        // === 3. Tidak ada key aktif → hapus role + hapus schedule ===
        if (role && member.roles.cache.has(entry.roleId)) {
            try {
                await member.roles.remove(entry.roleId);
                console.log(`✅ Auto-remove role ${role.name} dari ${member.user.tag} (semua key sudah expired).`);
                // Kirim DM notifikasi
                try {
                    await member.send({
                        content: `⏰ Role **${role.name}** kamu di server **${guild.name}** sudah dihapus karena semua key sudah expired.\n\nKalau merasa ini salah, hubungi admin.`
                    });
                } catch (_) {}
            } catch (err) {
                console.error(`Gagal hapus role ${entry.roleId} dari ${member.user.tag}:`, err.message);
            }
        }
        removeEntry(entry.id);
    } catch (err) {
        console.error(`Error process expired role ${entry.id}:`, err.message);
        removeEntry(entry.id);
    }
}

function getCommands() {
    return [
        // === HELP ===
        {
            name: 'help',
            description: 'Lihat semua command & cara pakai bot',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === PANEL SETUP ===
        {
            name: 'setup-verify',
            description: 'Pasang panel verifikasi',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'setup-ticket',
            description: 'Pasang panel tiket & price list',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === SET ROLE ===
        {
            name: 'set-role',
            description: 'Atur role (verified / unverified / admin)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'tipe', description: 'Pilih tipe role', required: true, choices: [
                    { name: 'Verified', value: 'verified' },
                    { name: 'Unverified', value: 'unverified' },
                    { name: 'Admin', value: 'admin' }
                ]},
                { type: 8, name: 'role', description: 'Role yang akan dipakai', required: true }
            ]
        },

        // === SET CHANNEL ===
        {
            name: 'set-channel',
            description: 'Atur channel (invoice / welcome / goodbye / audit-log)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'tipe', description: 'Pilih tipe channel', required: true, choices: [
                    { name: 'Invoice', value: 'invoice' },
                    { name: 'Welcome', value: 'welcome' },
                    { name: 'Goodbye', value: 'goodbye' },
                    { name: 'Audit Log (catat admin action)', value: 'audit-log' }
                ]},
                { type: 7, name: 'channel', description: 'Channel text yang dipakai', required: true }
            ]
        },

        // === SET PESAN ===
        {
            name: 'set-message',
            description: 'Ubah teks embed welcome / goodbye / verify / ticket',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'tipe', description: 'Pilih pesan yang diubah', required: true, choices: [
                    { name: 'Welcome Title', value: 'welcomeTitle' },
                    { name: 'Welcome Body', value: 'welcomeBody' },
                    { name: 'Goodbye Title', value: 'goodbyeTitle' },
                    { name: 'Goodbye Body', value: 'goodbyeBody' },
                    { name: 'Verify Title', value: 'verifyTitle' },
                    { name: 'Verify Body', value: 'verifyBody' },
                    { name: 'Ticket Title', value: 'ticketTitle' },
                    { name: 'Ticket Body', value: 'ticketBody' }
                ]},
                { type: 3, name: 'teks', description: 'Teks baru. Pakai {user} {username} {server} {count} {action}', required: true }
            ]
        },

        // === MANAJEMEN PRODUK ===
        {
            name: 'add-product',
            description: 'Tambah produk baru ke price list',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'label', description: 'Nama produk (mis. 7 Days)', required: true },
                { type: 3, name: 'value', description: 'ID unik (mis. 7d)', required: true },
                { type: 3, name: 'price', description: 'Harga (mis. Rp. 50.000)', required: true },
                { type: 3, name: 'duration', description: 'Opsional. Keterangan durasi (mis. 7 Hari). Kosong = pakai label.', required: false }
            ]
        },
        {
            name: 'remove-product',
            description: 'Hapus produk dari price list',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'value', description: 'Value produk yang ingin dihapus (mis. 7d)', required: true }
            ]
        },
        {
            name: 'list-products',
            description: 'Lihat semua produk saat ini',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === CONFIG SHOW ===
        {
            name: 'config-show',
            description: 'Lihat semua konfigurasi bot saat ini',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === REMOVE ROLE (hapus role dari config) ===
        {
            name: 'remove-role',
            description: 'Hapus role dari config (verified / unverified / admin)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'tipe', description: 'Pilih tipe role yang dihapus', required: true, choices: [
                    { name: 'Verified', value: 'verified' },
                    { name: 'Unverified', value: 'unverified' },
                    { name: 'Admin', value: 'admin' }
                ]}
            ]
        },

        // === REMOVE CHANNEL (hapus channel dari config) ===
        {
            name: 'remove-channel',
            description: 'Hapus channel dari config (invoice / welcome / goodbye)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'tipe', description: 'Pilih tipe channel yang dihapus', required: true, choices: [
                    { name: 'Invoice', value: 'invoice' },
                    { name: 'Welcome', value: 'welcome' },
                    { name: 'Goodbye', value: 'goodbye' }
                ]}
            ]
        },

        // === LIST MESSAGES (lihat semua teks pesan) ===
        {
            name: 'list-messages',
            description: 'Lihat semua teks pesan embed saat ini',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === RESET MESSAGE (kembalikan pesan ke default) ===
        {
            name: 'reset-message',
            description: 'Reset teks pesan embed kembali ke default',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'tipe', description: 'Pilih pesan yang direset (atau ALL untuk semua)', required: true, choices: [
                    { name: 'Welcome Title', value: 'welcomeTitle' },
                    { name: 'Welcome Body', value: 'welcomeBody' },
                    { name: 'Goodbye Title', value: 'goodbyeTitle' },
                    { name: 'Goodbye Body', value: 'goodbyeBody' },
                    { name: 'Verify Title', value: 'verifyTitle' },
                    { name: 'Verify Body', value: 'verifyBody' },
                    { name: 'Ticket Title', value: 'ticketTitle' },
                    { name: 'Ticket Body', value: 'ticketBody' },
                    { name: '⚡ Reset SEMUA', value: 'ALL' }
                ]}
            ]
        },

        // === RESET CONFIG (reset semua setting ke kondisi kosong) ===
        {
            name: 'reset-config',
            description: '⚠️ Hapus SEMUA setting (role, channel, pesan) - tidak bisa di-undo!',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === AUTO-ROLE PRODUCT (VIP role per produk) ===
        {
            name: 'set-product-role',
            description: 'Set role & durasi auto-expire untuk produk tertentu',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'value', description: 'Value produk (mis. 30d)', required: true },
                { type: 8, name: 'role', description: 'Role yang akan diberikan saat pembeli sukses', required: true },
                { type: 4, name: 'days', description: 'Durasi hari sebelum role otomatis dihapus (0 = permanen)', required: true }
            ]
        },
        {
            name: 'remove-product-role',
            description: 'Hapus auto-role dari produk tertentu',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'value', description: 'Value produk (mis. 30d)', required: true }
            ]
        },
        {
            name: 'list-product-roles',
            description: 'Lihat semua mapping produk → role + durasi',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },

        // === KEY MANAGER (model key-driven) ===
        {
            name: 'set-key',
            description: 'Beri key ke user + grant role + extend schedule (MAX EXTEND)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 6, name: 'user', description: 'User penerima key', required: true },
                { type: 3, name: 'value', description: 'Value produk (mis. 30d)', required: true },
                { type: 3, name: 'key', description: 'Key yang akan dikirim ke user', required: true }
            ]
        },
        {
            name: 'list-keys',
            description: 'Lihat semua key (aktif & expired) milik user',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 6, name: 'user', description: 'User yang ingin dilihat key-nya', required: true }
            ]
        },
        {
            name: 'clear-schedule',
            description: 'Hapus semua schedule role user (+ opsional hapus semua key & lepas role VIP)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 6, name: 'user', description: 'User yang di-clear', required: true },
                { type: 5, name: 'clear_keys', description: 'True = hapus SEMUA key user + lepas role VIP (full reset). Default: false.', required: false }
            ]
        },

        // === SELF-ROLE FLEKSIBEL ===
        {
            name: 'setup-selfrole',
            description: 'Buat panel self-role baru (member bisa ambil/lepas role sendiri)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'title', description: 'Judul panel (mis. Pilih Role Notif)', required: true },
                { type: 3, name: 'description', description: 'Deskripsi panel', required: true },
                { type: 3, name: 'type', description: 'Tipe UI panel', required: true, choices: [
                    { name: 'Button (≤25 role, klik toggle)', value: 'button' },
                    { name: 'Select Menu (dropdown, ≤25 role)', value: 'select' }
                ]},
                { type: 5, name: 'exclusive', description: 'True = hanya boleh 1 role pada satu waktu (mis. color role). Default false.', required: false }
            ]
        },
        {
            name: 'selfrole-add',
            description: 'Tambah role ke panel self-role yang sudah ada',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'panel_id', description: 'Panel ID (lihat di /selfrole-list atau footer panel)', required: true },
                { type: 8, name: 'role', description: 'Role yang akan ditambahkan ke panel', required: true },
                { type: 3, name: 'label', description: 'Label tombol / option (maks 80 char)', required: true },
                { type: 3, name: 'emoji', description: 'Emoji (opsional, mis. 🔔)', required: false },
                { type: 3, name: 'description', description: 'Deskripsi (opsional, hanya untuk select menu)', required: false }
            ]
        },
        {
            name: 'selfrole-remove',
            description: 'Hapus role dari panel self-role',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'panel_id', description: 'Panel ID', required: true },
                { type: 8, name: 'role', description: 'Role yang akan dihapus dari panel', required: true }
            ]
        },
        {
            name: 'selfrole-list',
            description: 'Lihat semua panel self-role di guild ini',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'selfrole-delete',
            description: 'Hapus panel self-role (hapus pesan + config)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'panel_id', description: 'Panel ID yang akan dihapus', required: true }
            ]
        },

        // === ANNOUNCE & EMBED BUILDER ===
        {
            name: 'announce',
            description: 'Quick announce — kirim embed ke channel (1 command, 1 embed)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 7, name: 'channel', description: 'Channel tujuan announce', required: true },
                { type: 3, name: 'title', description: 'Judul announce', required: true },
                { type: 3, name: 'description', description: 'Isi announce (support newline \\n)', required: true },
                { type: 3, name: 'color', description: 'Warna hex (mis. #FF0000). Default: blurple', required: false },
                { type: 3, name: 'image', description: 'URL gambar besar (opsional)', required: false },
                { type: 3, name: 'thumbnail', description: 'URL gambar kecil pojok (opsional)', required: false },
                { type: 3, name: 'mention', description: 'Mention: @everyone, @here, atau <@&role_id>', required: false }
            ]
        },
        {
            name: 'embed-builder',
            description: 'Interactive embed builder dengan live preview (untuk embed kompleks)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'embed-list',
            description: 'Lihat semua session embed builder aktif kamu (+ link ke draft message)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'embed-cancel',
            description: 'Batalkan session embed builder berdasarkan ID (jika draft kehapus/bug)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'session_id', description: 'Session ID (lihat di /embed-list)', required: true }
            ]
        },

        // === BACKUP SYSTEM ===
        {
            name: 'backup-now',
            description: 'Buat backup manual sekarang (config, keys, scheduledRoles, selfRoles, dll)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'backup-list',
            description: 'Lihat semua backup yang tersimpan (maks 7 terbaru)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'restore-backup',
            description: 'Restore backup berdasarkan nama (auto-buat safety backup sebelum restore)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'name', description: 'Nama folder backup (lihat /backup-list, format: YYYY-MM-DD_HH-mm-ss)', required: true }
            ]
        },

        // === GIVEAWAY SYSTEM ===
        {
            name: 'giveaway',
            description: 'Kelola giveaway komunitas (create, list, end, reroll)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                {
                    type: 1, name: 'create', description: 'Buat giveaway baru', required: false,
                    options: [
                        { type: 7, name: 'channel', description: 'Channel untuk giveaway', required: true },
                        { type: 3, name: 'prize', description: 'Hadiah (mis. VIP 30 Hari)', required: true },
                        { type: 4, name: 'winners', description: 'Jumlah pemenang (1-20, default 1)', required: false },
                        { type: 4, name: 'duration', description: 'Durasi dalam menit (min 1)', required: true },
                        { type: 8, name: 'required_role', description: 'Role yang wajib dimiliki peserta (opsional)', required: false }
                    ]
                },
                {
                    type: 1, name: 'list', description: 'Lihat semua giveaway di guild ini', required: false
                },
                {
                    type: 1, name: 'end', description: 'Akhiri giveaway lebih awal + pick winners', required: false,
                    options: [
                        { type: 3, name: 'id', description: 'Giveaway ID (lihat /giveaway list)', required: true }
                    ]
                },
                {
                    type: 1, name: 'reroll', description: 'Reroll winner giveaway yang sudah berakhir', required: false,
                    options: [
                        { type: 3, name: 'id', description: 'Giveaway ID (lihat /giveaway list)', required: true }
                    ]
                }
            ]
        },

        // === SCHEDULED ANNOUNCEMENTS ===
        {
            name: 'announce-schedule',
            description: 'Jadwalkan announce ke channel pada waktu tertentu (one-shot atau recurring)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 7, name: 'channel', description: 'Channel tujuan', required: true },
                { type: 3, name: 'title', description: 'Judul announce', required: true },
                { type: 3, name: 'description', description: 'Isi announce (support \\n untuk newline)', required: true },
                { type: 3, name: 'at', description: 'Waktu kirim. Format: "30m", "2h", "1d", atau "2026-01-15 20:00"', required: true },
                { type: 3, name: 'color', description: 'Warna hex (mis. #FF0000). Default: blurple', required: false },
                { type: 3, name: 'image', description: 'URL gambar besar (opsional)', required: false },
                { type: 3, name: 'thumbnail', description: 'URL gambar kecil pojok (opsional)', required: false },
                { type: 3, name: 'mention', description: 'Mention: @everyone, @here, atau <@&role_id>', required: false },
                { type: 3, name: 'recurring', description: 'Ulangi (opsional)', required: false, choices: [
                    { name: 'Daily (tiap hari)', value: 'daily' },
                    { name: 'Weekly (tiap minggu)', value: 'weekly' },
                    { name: 'Monthly (tiap bulan)', value: 'monthly' }
                ]}
            ]
        },
        {
            name: 'announce-list',
            description: 'Lihat semua announce terjadwal yang pending',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'announce-cancel',
            description: 'Batalkan announce terjadwal berdasarkan ID',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'id', description: 'Announce ID (lihat di /announce-list)', required: true }
            ]
        },

        // === WARN SYSTEM ===
        {
            name: 'warn',
            description: 'Beri warning ke member (auto-action: 3=mute 1h, 5=mute 1d, 7=kick)',
            defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
            options: [
                { type: 6, name: 'user', description: 'Member yang diwarn', required: true },
                { type: 3, name: 'reason', description: 'Alasan warning', required: true }
            ]
        },
        {
            name: 'warn-list',
            description: 'Lihat semua warning milik user',
            defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
            options: [
                { type: 6, name: 'user', description: 'User yang ingin dicek', required: true }
            ]
        },
        {
            name: 'warn-remove',
            description: 'Hapus 1 warning berdasarkan ID',
            defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
            options: [
                { type: 6, name: 'user', description: 'User pemilik warning', required: true },
                { type: 3, name: 'warn_id', description: 'Warn ID (lihat di /warn-list)', required: true }
            ]
        },
        {
            name: 'warn-clear',
            description: 'Hapus SEMUA warning milik user',
            defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
            options: [
                { type: 6, name: 'user', description: 'User yang ingin di-clear warn-nya', required: true }
            ]
        },

        // === STATS & LEADERBOARD ===
        {
            name: 'stats',
            description: 'Lihat statistik agregat server (admin only)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'leaderboard',
            description: 'Lihat top 10 member (public — boleh dipakai member biasa)',
            options: [
                { type: 3, name: 'metric', description: 'Metric leaderboard', required: false, choices: [
                    { name: '💬 Pesan Terbanyak', value: 'messages' },
                    { name: '🛒 Top Buyer (transaksi)', value: 'vipPurchases' },
                    { name: '💰 Top Spender (belanja)', value: 'totalSpent' },
                    { name: '🎉 Top Winner (giveaway)', value: 'giveawaysWon' }
                ]}
            ]
        },
        {
            name: 'my-stats',
            description: 'Lihat statistik pribadi kamu (public — boleh dipakai member biasa)'
        },

        // === POLL SYSTEM ===
        {
            name: 'poll',
            description: 'Kelola poll komunitas (create, list, close)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                {
                    type: 1, name: 'create', description: 'Buat poll baru (modal input untuk options)', required: false,
                    options: [
                        { type: 7, name: 'channel', description: 'Channel untuk poll', required: true },
                        { type: 3, name: 'question', description: 'Pertanyaan poll', required: true },
                        { type: 5, name: 'multiple', description: 'True = member boleh pilih banyak. Default false (single)', required: false }
                    ]
                },
                {
                    type: 1, name: 'list', description: 'Lihat semua poll di guild ini', required: false
                },
                {
                    type: 1, name: 'close', description: 'Tutup poll + tampilkan hasil akhir', required: false,
                    options: [
                        { type: 3, name: 'id', description: 'Poll ID (lihat di /poll list)', required: true }
                    ]
                }
            ]
        },

        // === TEMP VOICE CHANNELS ===
        {
            name: 'setup-tempvoice',
            description: 'Setup temp voice — member join hub channel → auto-bikin voice room sendiri',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 7, name: 'hub_channel', description: 'Voice channel yang jadi "trigger" (member join → bikin room)', required: true },
                { type: 7, name: 'category', description: 'Category tempat room baru dibuat (opsional, default = same as hub)', required: false },
                { type: 3, name: 'default_name', description: 'Nama default room. Placeholder: {username} {tag}. Default: "{username}\'s Room"', required: false },
                { type: 4, name: 'default_limit', description: 'User limit default (0 = tanpa limit, maks 99). Default: 0', required: false }
            ]
        },
        {
            name: 'tempvoice-panel',
            description: 'Buka panel interaktif untuk setup Temp Voice (alternatif /setup-tempvoice)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild
        },
        {
            name: 'tempvoice',
            description: 'Kelola temp voice room kamu (rename, limit, lock, transfer, dll)',
            options: [
                {
                    type: 1, name: 'rename', description: 'Ganti nama room kamu', required: false,
                    options: [
                        { type: 3, name: 'name', description: 'Nama baru (maks 100 char)', required: true }
                    ]
                },
                {
                    type: 1, name: 'limit', description: 'Set user limit (0 = tanpa limit, maks 99)', required: false,
                    options: [
                        { type: 4, name: 'limit', description: 'Jumlah maksimal user (0-99)', required: true }
                    ]
                },
                {
                    type: 1, name: 'lock', description: 'Kunci room — hanya owner yang bisa join', required: false
                },
                {
                    type: 1, name: 'unlock', description: 'Buka kunci room — member bebas join lagi', required: false
                },
                {
                    type: 1, name: 'transfer', description: 'Transfer ownership room ke member lain', required: false,
                    options: [
                        { type: 6, name: 'user', description: 'Member baru yang akan jadi owner', required: true }
                    ]
                },
                {
                    type: 1, name: 'kick', description: 'Keluarkan member dari room kamu', required: false,
                    options: [
                        { type: 6, name: 'user', description: 'Member yang akan di-kick dari voice', required: true }
                    ]
                },
                {
                    type: 1, name: 'claim', description: 'Klaim ownership room (kalau owner sudah leave tapi room masih aktif)', required: false
                },
                {
                    type: 1, name: 'info', description: 'Lihat info room temp voice kamu saat ini', required: false
                }
            ]
        }
    ];
}

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

/**
 * Proses giveaway yang sudah berakhir — pick winners + edit message + announce.
 */
async function processGiveawayEnd(client, gw) {
    try {
        const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
        const guild = await client.guilds.fetch(gw.guildId).catch(() => null);
        if (!guild) return;

        const channel = guild.channels.cache.get(gw.channelId);
        if (!channel) return;

        // Pick winners
        const winnerIds = pickGiveawayWinners(gw.participantIds, gw.winnersCount);
        endGiveaway(gw.id, winnerIds);

        // Edit message
        const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
        const winnersStr = winnerIds.length > 0 ? winnerIds.map(id => `<@${id}>`).join(', ') : '_(tidak ada peserta)_';
        if (msg) {
            const embed = new EmbedBuilder()
                .setTitle('🎉 GIVEAWAY BERAKHIR!')
                .setDescription(
                    `🎁 **Prize:** ${gw.prize}\n\n` +
                    `🏆 **Pemenang:** ${winnersStr}\n` +
                    `👥 **Peserta:** ${gw.participantIds.length}\n` +
                    `⏰ **Berakhir:** <t:${Math.floor(gw.endsAt / 1000)}:R>\n\n` +
                    (winnerIds.length > 0 ? '🎊 Selamat kepada pemenang! Host akan DM kalian untuk klaim hadiah.' : '_(Tidak ada peserta yang ikut)_')
                )
                .setColor(winnerIds.length > 0 ? 0x57F287 : 0x95A5A6)
                .setFooter({ text: `Host: ${gw.hostTag} | ID: ${gw.id}` })
                .setTimestamp();
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`gw_join:${gw.id}`).setLabel('🎉 Join (Ended)').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId(`gw_leave:${gw.id}`).setLabel('🚪 Leave (Ended)').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );
            await msg.edit({ embeds: [embed], components: [row] }).catch(()=>{});
        }

        // Announce winners
        if (winnerIds.length > 0) {
            await channel.send({ content: `🎊 **GIVEAWAY WINNERS!** 🎊\n\nPrize: **${gw.prize}**\nPemenang: ${winnersStr}\n\nSelamat! 🎉` }).catch(()=>{});

            // DM winners
            for (const wid of winnerIds) {
                const user = await client.users.fetch(wid).catch(() => null);
                if (user) {
                    await user.send(`🎊 **Selamat! Kamu menang giveaway!**\n\nPrize: **${gw.prize}**\nHost: ${gw.hostTag}\nServer: ${guild.name}\n\nHubungi host untuk klaim hadiahmu.`).catch(()=>{});
                }
                // Track giveaway win untuk leaderboard
                try { trackGiveawayWin(wid); } catch (_) {}
            }
        } else {
            await channel.send({ content: `📭 Giveaway **${gw.prize}** berakhir tanpa pemenang (tidak ada peserta).` }).catch(()=>{});
        }

        console.log(`🎉 Giveaway ${gw.id} (${gw.prize}) berakhir. Winners: ${winnerIds.length}`);
    } catch (err) {
        console.error('Error processGiveawayEnd:', err);
    }
}

/**
 * Proses scheduled announcement yang sudah waktunya dikirim.
 */
async function processScheduledAnnouncement(client, ann) {
    try {
        const { EmbedBuilder } = require('discord.js');
        const guild = await client.guilds.fetch(ann.guildId).catch(() => null);
        if (!guild) { markAnnSent(ann.id); return; }

        const channel = guild.channels.cache.get(ann.channelId);
        if (!channel) { markAnnSent(ann.id); return; }

        const d = ann.data;
        const embed = new EmbedBuilder()
            .setTitle(d.title)
            .setDescription(d.description.replace(/\\n/g, '\n'))
            .setColor(d.color || 0x5865F2)
            .setFooter({ text: `Dijadwalkan oleh ${d.authorTag}` })
            .setTimestamp();
        if (d.image) embed.setImage(d.image);
        if (d.thumbnail) embed.setThumbnail(d.thumbnail);

        await channel.send({
            content: d.mention || null,
            embeds: [embed]
        }).catch(err => console.warn('Gagal kirim scheduled ann:', err.message));

        markAnnSent(ann.id);
        console.log(`📢 Scheduled announce ${ann.id} terkirim ke ${channel.name}.`);
    } catch (err) {
        console.error('Error processScheduledAnnouncement:', err);
    }
}

// ====================================================
// === TEMP VOICE — voiceStateUpdate event handler ===
// ====================================================
// Logic:
//   - Member join HUB channel → bikin voice channel baru di category, pindahkan
//     member ke channel baru tsb, set member sebagai owner.
//   - Member leave temp voice channel → kalau channel kosong, hapus + remove session.
//   - Member pindah antar temp voice channel → anggap leave dari channel lama.
//   - Owner leave tapi channel masih ada member → session tetap (member lain bisa claim).
//
// Catatan: oldState dan newState mungkin punya channelId null (kalau disconnect total).
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
        // Abaikan bot
        if (oldState.member?.user?.bot || newState.member?.user?.bot) return;

        const guild = newState.guild || oldState.guild;
        if (!guild) return;

        const oldChId = oldState.channelId;
        const newChId = newState.channelId;
        const userId = newState.id;
        const member = newState.member || oldState.member;
        if (!member) return;

        const config = getConfig();
        const tvConfig = config.tempVoice || {};
        const hubChannelId = tvConfig.hubChannelId;
        const tvEnabled = tvConfig.enabled !== false; // default true kalau sudah di-setup

        // === 1. Member JOIN HUB channel → bikin temp voice room baru ===
        // (skip kalau system disabled)
        if (tvEnabled && hubChannelId && newChId === hubChannelId && oldChId !== hubChannelId) {
            await createTempVoiceRoom(client, guild, member, tvConfig);
            return;
        }

        // === 2. Member LEAVE temp voice channel (either disconnect atau pindah channel lain) ===
        if (oldChId && oldChId !== newChId) {
            const session = getTempVoiceByChannel(oldChId);
            if (session) {
                const oldChannel = guild.channels.cache.get(oldChId);
                if (!oldChannel) {
                    // Channel sudah hilang — hapus session
                    removeTempVoiceSession(oldChId);
                    return;
                }
                // Hitung sisa member (exclude bot)
                const remainingHumans = oldChannel.members.filter(m => !m.user.bot).size;
                if (remainingHumans === 0) {
                    // Channel kosong → hapus
                    try {
                        await oldChannel.delete('Temp voice empty — auto cleanup');
                        console.log(`🗑️ TempVoice: channel ${oldChannel.name} dihapus (kosong).`);
                    } catch (err) {
                        // Mungkin sudah kehapus
                    }
                    removeTempVoiceSession(oldChId);
                } else {
                    // Channel masih ada member → keep session, biar member bisa claim
                    // Kalau owner leave, beri notif di channel (kalau memungkinkan)
                    if (session.ownerId === userId) {
                        try {
                            // Coba kirim pesan ke text chat terdekat? Voice channel tidak punya chat.
                            // Skip — info bisa di-claim lewat /tempvoice info
                        } catch (_) {}
                    }
                }
            }
        }
    } catch (err) {
        console.error('VoiceStateUpdate Error:', err);
    }
});

// createTempVoiceRoom() sekarang di-import dari utils/tempVoice.js (createRoom)
// supaya bisa dipakai ulang oleh panel setup (Test Create button).

client.login(process.env.DISCORD_TOKEN);
