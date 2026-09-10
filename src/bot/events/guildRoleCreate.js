/**
 * Event: guildRoleCreate — menandai counter server stats dirty (v3.9.51).
 *
 * Role dibuat mengubah counter "Role" → tandai dirty, tick scheduler 60
 * detik me-rename channel-nya (aman rate-limit). No-op murah saat counter
 * belum di-setup.
 */

const { Events } = require('discord.js');
const { markStatsDirty } = require('../../data/serverstatsManager');

module.exports = {
    name: Events.GuildRoleCreate,
    execute(role) {
        try {
            markStatsDirty(role?.guild?.id);
        } catch (_) {}
    }
};
