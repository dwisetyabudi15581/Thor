const { PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('./configManager');

/**
 * Cek apakah seorang member adalah admin/staff bot.
 * Member dianggap admin kalau:
 *   1. Punya role Admin (yang sudah di-set via /set-role admin), ATAU
 *   2. Punya Discord permission ManageGuild, ATAU
 *   3. Punya Discord permission Administrator (super admin Discord)
 *
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
function isAdmin(member) {
    if (!member) return false;

    // Cek Discord permission langsung (paling andal)
    if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
    if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;

    // Cek role admin dari config
    const config = getConfig();
    if (config.roles?.admin && member.roles?.cache?.has(config.roles.admin)) return true;

    return false;
}

module.exports = { isAdmin };
