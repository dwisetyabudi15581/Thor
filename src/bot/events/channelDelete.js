/**
 * Event: channelDelete — menandai counter server stats dirty (v3.9.51).
 *
 * Dua efek:
 *   1. Channel dihapus mengubah counter "Channel" → tandai dirty (tick
 *      scheduler yang melakukan rename).
 *   2. Kalau channel yang dihapus adalah SALAH SATU channel counter,
 *      refresh berikutnya mendeteksinya hilang (warning + perintah solusi)
 *      dan fitur auto-disable begitu SEMUA counter hilang.
 */

const { Events } = require('discord.js');
const { markStatsDirty } = require('../../data/serverstatsManager');

module.exports = {
    name: Events.ChannelDelete,
    execute(channel) {
        try {
            markStatsDirty(channel?.guild?.id);
        } catch (_) {}
    }
};
