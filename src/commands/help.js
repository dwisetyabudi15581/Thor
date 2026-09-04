/**
 * Domain: help
 * Slash commands: /help [search]
 *
 * v3.9.39 REDESIGN (user request: "/help satu embed utuh, nyari harus scroll"):
 *   /help kini menampilkan navigator interaktif — BUKAN lagi satu embed raksasa:
 *     - 🏠 Home   : index 19 kategori + dropdown 📂 + tombol 🔍/📖
 *     - 📂 Kategori: detail command per kategori (embed kecil)
 *     - 🔍 Search : modal kata kunci ATAU `/help search:<keyword>` langsung
 *     - 📖 All    : daftar lengkap (tampilan lama, tetap tersedia)
 *   Semua navigasi lewat interaction.update() di SATU pesan ephemeral.
 *   Handler interaksinya: src/interactions/help.js (prefix customId `help_`).
 *
 * v3.9.38: (sejarah) auto-split 2 embed saat > 5800 char — kini logic split
 * pindah ke helpCatalog.buildAllEmbeds() (view 📖 Semua Command).
 * v3.9.37: versi dinamis dari package.json.
 */

const { MessageFlags } = require('./_shared');
const { buildHomeEmbed, buildSearchEmbed, buildHelpComponents } = require('../ui/helpCatalog');

module.exports = async function (interaction) {
    // /help search:<keyword> → langsung tampilkan hasil pencarian.
    // (optional chaining: mock unit-test lama tidak punya interaction.options)
    const query = interaction.options?.getString?.('search');

    if (query && query.trim()) {
        return interaction.reply({
            embeds: [buildSearchEmbed(query.trim())],
            components: buildHelpComponents('search'),
            flags: MessageFlags.Ephemeral
        });
    }

    return interaction.reply({
        embeds: [buildHomeEmbed(interaction.client, interaction.user)],
        components: buildHelpComponents('home'),
        flags: MessageFlags.Ephemeral
    });
};
