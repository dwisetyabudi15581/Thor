/**
 * GuildMemberRemove handler — delegate ke handlers/memberHandler.js (legacy).
 */

const { Events } = require('discord.js');
const { onMemberRemove } = require('../../../handlers/memberHandler');

async function onEvent(member) {
    try {
        await onMemberRemove(member);
    } catch (err) {
        console.error('GuildMemberRemove Error:', err);
    }
}

module.exports = {
    name: Events.GuildMemberRemove,
    execute: onEvent
};
