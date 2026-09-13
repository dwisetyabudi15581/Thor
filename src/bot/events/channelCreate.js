/**
 * Event: channelCreate — menandai counter server stats dirty (v3.9.51).
 *
 * Channel dibuat mengubah counter "Channel" → tandai dirty dan biarkan tick
 * scheduler 60 detik melakukan rename-nya (aman rate-limit: rename hanya
 * terjadi saat angkanya benar-benar berubah + cooldown per-channel
 * mengizinkan). No-op murah saat counter belum di-setup.
 */

const { Events } = require('discord.js');
const { markStatsDirty } = require('../../data/serverstatsManager');

module.exports = {
    name: Events.ChannelCreate,
    execute(channel) {
        try {
            markStatsDirty(channel?.guild?.id);
        } catch (_) {} // jangan sampai memutus pipeline event karena counter
    }
};
