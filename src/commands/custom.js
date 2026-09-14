/**
 * Domain: custom
 * Handler: slash command buatan admin (dibuat dari web dashboard, v3.20.0).
 *
 * Router (index.js) memanggil file ini kalau nama command TIDAK ada di
 * COMMAND_TO_DOMAIN tapi cocok dengan custom command guild tersebut.
 * Balasan = teks (content) + embed, sesuai definisi yang dibuat admin di
 * web. Opsi `ephemeral` per-command: balasan cuma terlihat pemakai.
 */

const { EmbedBuilder, MessageFlags } = require('discord.js');
const customCommandManager = require('../data/customCommandManager');
const { buildEmbedFromDef, isEmbedEmpty } = require('../infra/embedPayload');

module.exports = async function (interaction) {
    const cmd = customCommandManager.getCommand(interaction.guildId, interaction.commandName);
    if (!cmd) {
        // Race: command dihapus tepat sebelum dipakai. Jangan error keras —
        // cukup info ephemeral (command lama masih nongol di cache Discord
        // sampai sinkronisasi berikutnya).
        if (interaction.deferred || interaction.replied) return;
        return interaction.reply({
            content: '⚠️ Command ini sudah dihapus admin. Tunggu sebentar sampai daftar command Discord menyegarkan diri.',
            flags: MessageFlags.Ephemeral
        });
    }

    const payload = {};
    if (cmd.content) payload.content = cmd.content;
    if (cmd.embed && !isEmbedEmpty(cmd.embed)) {
        payload.embeds = [buildEmbedFromDef(cmd.embed, EmbedBuilder)];
    }
    if (cmd.ephemeral === true) payload.flags = MessageFlags.Ephemeral;

    customCommandManager.incrementUse(interaction.guildId, cmd.name);

    return interaction.reply(payload);
};
