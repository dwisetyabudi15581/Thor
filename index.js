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
const { getExpired, removeEntry, getAllActive, updateExpireAt } = require('./utils/roleScheduler');
const { removeExpiredKeys, getActiveKeysByUserAndRole, hasPermanentKey, getMaxExpireAtByUserAndRole } = require('./utils/keyManager');

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
            description: 'Atur channel (invoice / welcome / goodbye)',
            defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
            options: [
                { type: 3, name: 'tipe', description: 'Pilih tipe channel', required: true, choices: [
                    { name: 'Invoice', value: 'invoice' },
                    { name: 'Welcome', value: 'welcome' },
                    { name: 'Goodbye', value: 'goodbye' }
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

client.login(process.env.DISCORD_TOKEN);
