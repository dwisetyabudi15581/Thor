/**
 * Temp Voice Manager — store & track temporary voice channels created by members.
 *
 * Model:
 *   - Admin setup hub channel + category via /setup-tempvoice
 *   - Saat member join hub channel → bot buat voice channel baru di category,
 *     member jadi owner, dan dipindahkan ke channel baru tsb.
 *   - Owner bisa rename/limit/lock/unlock/transfer/kick
 *   - Saat channel kosong → auto-delete + remove session
 *   - Saat owner leave tapi masih ada member → member lain bisa /tempvoice claim
 *
 * File: tempVoice.json
 * [
 *   {
 *     channelId: "123",
 *     ownerId: "456",
 *     ownerTag: "User#1234",
 *     guildId: "789",
 *     categoryId: "cat_...",
 *     createdAt: 1735689600000,
 *     locked: false,
 *     originalName: "User's Room"
 *   }
 * ]
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'tempVoice.json');

function load() {
    try {
        if (!fs.existsSync(filePath)) return [];
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn('⚠️ tempVoice.json rusak, mulai dari array kosong:', err.message);
        return [];
    }
}

function save(list) {
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2));
}

/**
 * Tambah session temp voice baru.
 * @param {Object} data - { channelId, ownerId, ownerTag, guildId, categoryId, originalName }
 * @returns {Object} session yang baru disimpan
 */
function addSession(data) {
    const list = load();
    const session = {
        channelId: data.channelId,
        ownerId: data.ownerId,
        ownerTag: data.ownerTag || '',
        guildId: data.guildId,
        categoryId: data.categoryId || null,
        originalName: data.originalName || 'Temp Room',
        locked: false,
        createdAt: Date.now()
    };
    // Hindari duplikat channelId
    const idx = list.findIndex(s => s.channelId === session.channelId);
    if (idx >= 0) list[idx] = session;
    else list.push(session);
    save(list);
    return session;
}

/**
 * Hapus session berdasarkan channelId.
 */
function removeSession(channelId) {
    const list = load();
    const filtered = list.filter(s => s.channelId !== channelId);
    if (filtered.length !== list.length) {
        save(filtered);
        return true;
    }
    return false;
}

/**
 * Ambil session berdasarkan channelId.
 */
function getByChannel(channelId) {
    return load().find(s => s.channelId === channelId) || null;
}

/**
 * Ambil semua session milik owner tertentu.
 */
function getByOwner(ownerId) {
    return load().filter(s => s.ownerId === ownerId);
}

/**
 * Ambil semua session di guild tertentu.
 */
function getByGuild(guildId) {
    return load().filter(s => s.guildId === guildId);
}

/**
 * Update session (partial update).
 * @returns {Object|null} session yang sudah di-update, atau null kalau tidak ketemu
 */
function updateSession(channelId, updates) {
    const list = load();
    const idx = list.findIndex(s => s.channelId === channelId);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...updates };
    save(list);
    return list[idx];
}

/**
 * Transfer ownership ke user baru.
 */
function transferOwnership(channelId, newOwnerId, newOwnerTag) {
    return updateSession(channelId, { ownerId: newOwnerId, ownerTag: newOwnerTag || '' });
}

/**
 * Cleanup session orphan (channel yang sudah tidak ada di Discord).
 * Dipanggil saat bot start untuk bersihkan data yang tertinggal.
 * @param {Client} client - Discord client
 * @returns {number} jumlah session yang dihapus
 */
function cleanupOrphans(client) {
    const list = load();
    const orphanIds = [];
    for (const s of list) {
        const guild = client.guilds.cache.get(s.guildId);
        if (!guild) { orphanIds.push(s.channelId); continue; }
        const ch = guild.channels.cache.get(s.channelId);
        if (!ch || ch.deleted) { orphanIds.push(s.channelId); }
    }
    if (orphanIds.length > 0) {
        const filtered = list.filter(s => !orphanIds.includes(s.channelId));
        save(filtered);
        console.log(`🧹 TempVoice: ${orphanIds.length} session orphan dibersihkan.`);
    }
    return orphanIds.length;
}

/**
 * Bikin temp voice room baru + pindahkan member ke room tsb.
 * Dipakai oleh:
 *   - voiceStateUpdate di index.js (saat member join hub)
 *   - "Test Create" button di panel setup
 *
 * @param {Client} client - Discord client
 * @param {Guild}   guild
 * @param {GuildMember} member - member yang trigger (akan jadi owner)
 * @param {Object}  tvConfig - { hubChannelId, categoryId, defaultName, defaultLimit }
 * @returns {Promise<{ ok: boolean, channelId?: string, error?: string }>}
 */
async function createRoom(client, guild, member, tvConfig) {
    const { ChannelType, PermissionFlagsBits } = require('discord.js');

    try {
        const categoryId = tvConfig.categoryId || null;
        const defaultName = tvConfig.defaultName || "{username}'s Room";
        const defaultLimit = typeof tvConfig.defaultLimit === 'number' ? tvConfig.defaultLimit : 0;

        // Resolve nama
        const roomName = defaultName
            .replace(/\{username\}/g, member.user.username)
            .replace(/\{tag\}/g, member.user.tag)
            .slice(0, 100);

        // Permission overwrites
        const overwrites = [
            {
                id: guild.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
                deny: []
            },
            {
                id: member.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.Connect,
                    PermissionFlagsBits.Speak,
                    PermissionFlagsBits.Stream,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.MoveMembers,
                    PermissionFlagsBits.PrioritySpeaker,
                    PermissionFlagsBits.MuteMembers,
                    PermissionFlagsBits.DeafenMembers
                ],
                deny: []
            },
            {
                id: client.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.Connect,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.MoveMembers
                ],
                deny: []
            }
        ];

        const newChannel = await guild.channels.create({
            name: roomName,
            type: ChannelType.GuildVoice,
            parent: categoryId || undefined,
            userLimit: defaultLimit > 0 && defaultLimit <= 99 ? defaultLimit : 0,
            permissionOverwrites: overwrites,
            reason: `Temp voice — created by ${member.user.tag}`
        });

        // Pindahkan member ke channel baru
        try {
            await member.voice.setChannel(newChannel);
        } catch (err) {
            try { await newChannel.delete('Failed to move member'); } catch (_) {}
            console.warn('TempVoice: gagal move member ke channel baru:', err.message);
            return { ok: false, error: 'Failed to move member: ' + err.message };
        }

        // Simpan session
        addSession({
            channelId: newChannel.id,
            ownerId: member.id,
            ownerTag: member.user.tag,
            guildId: guild.id,
            categoryId: categoryId,
            originalName: roomName
        });

        console.log(`🎤 TempVoice: room "${roomName}" dibuat oleh ${member.user.tag}.`);
        return { ok: true, channelId: newChannel.id };
    } catch (err) {
        console.error('Error createRoom (TempVoice):', err.message);
        // Kalau gagal total, coba kick member dari hub supaya tidak nyangkut
        try {
            if (member.voice.channelId) {
                await member.voice.disconnect('Temp voice creation failed');
            }
        } catch (_) {}
        return { ok: false, error: err.message };
    }
}

module.exports = {
    addSession,
    removeSession,
    getByChannel,
    getByOwner,
    getByGuild,
    updateSession,
    transferOwnership,
    cleanupOrphans,
    load,
    save,
    createRoom
};
