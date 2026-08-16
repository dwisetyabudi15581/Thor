/**
 * GuildMemberAdd handler — delegate ke handlers/memberHandler.js (legacy).
 *
 * Status: akan di-split ke src/bot/handlers/memberAdd.js setelah migration.
 */

const { Events } = require('discord.js');
const { onMemberAdd } = require('../memberHandler');

async function onEvent(member) {
    try {
        await onMemberAdd(member);
    } catch (err) {
        console.error('GuildMemberAdd Error:', err);
    }
}

module.exports = {
    name: Events.GuildMemberAdd,
    execute: onEvent
};
