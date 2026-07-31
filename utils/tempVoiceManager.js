/**
 * Temp Voice Manager — track temporary voice channels yang dibuat member.
 *
 * File: tempVoice.json
 * {
 *   "guildId": {
 *     "creatorChannelId": "123",   // voice channel trigger (member join → bikin baru)
 *     "categoryId": "456",         // kategori tempat channel baru dibuat
 *     "channels": {
 *       "channelId": {
 *         "ownerId": "userId",
 *         "ownerTag": "User#1234",
 *         "createdAt": 1735689600000,
 *         "locked": false,
 *         "limit": 0,              // 0 = unlimited
 *         "name": "🔊 User's Room"
 *       }
 *     }
 *   }
 * }
 *
 * Cara kerja:
 *   1. Admin setup via /setup-tempvoice → bot buat voice channel trigger + simpan config
 *   2. Member join trigger channel → bot bikin voice channel private untuk member tsb
 *   3. Member jadi owner, otomatis dipindah ke channel baru
 *   4. Bot kirim control panel (embed + button) ke channel teks (atau DM owner)
 *   5. Owner pakai button: rename, kick, limit, lock, unlock, transfer, delete
 *   6. Saat owner leave dan channel kosong → bot hapus channel otomatis
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'tempVoice.json');

function load() {
    try {
        if (!fs.existsSync(filePath)) return {};
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn('⚠️ tempVoice.json rusak:', err.message);
        return {};
    }
}

function save(data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Setup temp voice untuk guild: simpan trigger channel + category + control channel.
 *
 * @param {string} guildId
 * @param {string} creatorChannelId - voice channel trigger (member join → bikin baru)
 * @param {string} categoryId - kategori tempat channel baru dibuat
 * @param {string} controlChannelId - text channel tempat panel kontrol global dipasang
 */
function setupGuild(guildId, creatorChannelId, categoryId, controlChannelId) {
    const all = load();
    if (!all[guildId]) all[guildId] = { channels: {} };
    all[guildId].creatorChannelId = creatorChannelId;
    all[guildId].categoryId = categoryId;
    all[guildId].controlChannelId = controlChannelId;
    save(all);
    return all[guildId];
}

/**
 * Simpan controlMessageId (pesan panel global yang sudah dipasang).
 * Dipakai untuk edit panel yang sama (refresh) saat ada perubahan.
 */
function setControlMessageId(guildId, messageId) {
    const all = load();
    if (!all[guildId]) all[guildId] = { channels: {} };
    all[guildId].controlMessageId = messageId;
    save(all);
    return all[guildId];
}

function getControlChannelId(guildId) {
    const cfg = getGuildConfig(guildId);
    return cfg?.controlChannelId || null;
}

function getControlMessageId(guildId) {
    const cfg = getGuildConfig(guildId);
    return cfg?.controlMessageId || null;
}

/**
 * v3.8.2: Set owner yang sedang fokus di panel global.
 * Dipakai saat owner pilih channel mereka via switch select menu.
 * Panel global akan menampilkan channel milik focusedOwnerId.
 *
 * @param {string} guildId
 * @param {string} ownerId - userId owner yang sedang fokus (null = reset ke default terbaru)
 */
function setFocusedOwner(guildId, ownerId) {
    const all = load();
    if (!all[guildId]) all[guildId] = { channels: {} };
    all[guildId].focusedOwnerId = ownerId || null;
    all[guildId].focusedAt = Date.now();
    save(all);
    return all[guildId];
}

function getFocusedOwner(guildId) {
    const cfg = getGuildConfig(guildId);
    if (!cfg?.focusedOwnerId) return null;
    // Auto-expire setelah 5 menit kalau owner tidak ada di voice lagi
    if (cfg.focusedAt && (Date.now() - cfg.focusedAt) > 5 * 60 * 1000) {
        return null;
    }
    return cfg.focusedOwnerId;
}

function clearFocusedOwner(guildId) {
    const all = load();
    if (all[guildId]) {
        delete all[guildId].focusedOwnerId;
        delete all[guildId].focusedAt;
        save(all);
    }
}

/**
 * Hapus setup temp voice untuk guild.
 */
function removeGuild(guildId) {
    const all = load();
    if (all[guildId]) {
        delete all[guildId];
        save(all);
        return true;
    }
    return false;
}

function getGuildConfig(guildId) {
    const all = load();
    return all[guildId] || null;
}

function getCreatorChannelId(guildId) {
    const cfg = getGuildConfig(guildId);
    return cfg?.creatorChannelId || null;
}

/**
 * Daftarkan channel voice baru milik user.
 */
function registerChannel(guildId, channelId, ownerId, ownerTag, name) {
    const all = load();
    if (!all[guildId]) all[guildId] = { channels: {} };
    if (!all[guildId].channels) all[guildId].channels = {};
    all[guildId].channels[channelId] = {
        ownerId,
        ownerTag,
        createdAt: Date.now(),
        locked: false,
        limit: 0,
        name
    };
    save(all);
    return all[guildId].channels[channelId];
}

/**
 * Hapus channel dari registry (saat channel dihapus).
 */
function unregisterChannel(guildId, channelId) {
    const all = load();
    if (!all[guildId] || !all[guildId].channels) return false;
    if (all[guildId].channels[channelId]) {
        delete all[guildId].channels[channelId];
        save(all);
        return true;
    }
    return false;
}

function getChannel(guildId, channelId) {
    const cfg = getGuildConfig(guildId);
    return cfg?.channels?.[channelId] || null;
}

/**
 * Update field channel (locked, limit, name, ownerId).
 */
function updateChannel(guildId, channelId, updates) {
    const all = load();
    if (!all[guildId]?.channels?.[channelId]) return null;
    Object.assign(all[guildId].channels[channelId], updates);
    save(all);
    return all[guildId].channels[channelId];
}

/**
 * Transfer ownership ke member baru.
 */
function transferOwnership(guildId, channelId, newOwnerId, newOwnerTag) {
    return updateChannel(guildId, channelId, {
        ownerId: newOwnerId,
        ownerTag: newOwnerTag
    });
}

/**
 * Cek apakah user adalah owner channel tertentu.
 */
function isOwner(guildId, channelId, userId) {
    const ch = getChannel(guildId, channelId);
    return ch?.ownerId === userId;
}

/**
 * Cari channel temp voice milik user tertentu di guild.
 * Returns channelId atau null.
 */
function findChannelByOwner(guildId, userId) {
    const cfg = getGuildConfig(guildId);
    if (!cfg?.channels) return null;
    for (const [channelId, info] of Object.entries(cfg.channels)) {
        if (info.ownerId === userId) return channelId;
    }
    return null;
}

module.exports = {
    setupGuild,
    removeGuild,
    getGuildConfig,
    getCreatorChannelId,
    setControlMessageId,
    getControlChannelId,
    getControlMessageId,
    // v3.8.5: focused owner functions kept for backward compat (data migration) but no longer used
    setFocusedOwner,
    getFocusedOwner,
    clearFocusedOwner,
    registerChannel,
    unregisterChannel,
    getChannel,
    updateChannel,
    transferOwnership,
    isOwner,
    findChannelByOwner
};
