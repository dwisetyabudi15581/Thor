/**
 * MessageCreate handler — track pesan user untuk leaderboard stats.
 *
 * Tracking hanya count (tidak simpan content). Butuh MessageContent intent
 * untuk content, tapi count tetap jalan tanpa intent itu.
 *
 * v3.9.4: scoped per guild (sebelumnya bocor cross-guild).
 * v3.9.8: catch rejection dari trackMessage supaya tidak unhandledRejection.
 */

const { Events } = require('discord.js');
const { incrementMessages: trackMessage } = require('../../data/statsManager');

async function onMessageCreate(message) {
    try {
        if (message.author?.bot) return;
        if (!message.guild) return; // DM
        try {
            trackMessage(message.guild.id, message.author.id);
        } catch (e) { /* trackMessage sync, defensive catch */ }
    } catch (_) {}
}

module.exports = {
    name: Events.MessageCreate,
    execute: onMessageCreate
};
