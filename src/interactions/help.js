/**
 * Domain: help — navigasi interaktif /help (v3.9.39).
 *
 * Handle semua interaksi komponen pesan /help (ephemeral):
 *   - help_cat            (StringSelectMenu) → tampilkan detail kategori
 *   - help_search         (button)           → buka modal pencarian
 *   - help_search_modal   (modal submit)     → tampilkan hasil pencarian
 *   - help_home           (button)           → kembali ke menu utama
 *   - help_all            (button)           → daftar lengkap semua command
 *
 * Semua navigasi memakai interaction.update() → SATU pesan yang sama
 * di-edit ulang (tidak ada spam pesan baru saat ganti-ganti kategori).
 *
 * customId STABIL (tanpa id user/message) → pesan /help lama yang masih
 * terbuka tetap bisa diklik setelah bot restart.
 */

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const {
    HELP_IDS,
    buildHomeEmbed,
    buildCategoryEmbed,
    buildAllEmbeds,
    buildSearchEmbed,
    buildHelpComponents
} = require('../ui/helpCatalog');

function makeSearchModal() {
    const input = new TextInputBuilder()
        .setCustomId(HELP_IDS.SEARCH_INPUT)
        .setLabel('Kata kunci')
        .setPlaceholder('contoh: key, rekber, panel, giveaway')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);
    return new ModalBuilder()
        .setCustomId(HELP_IDS.SEARCH_MODAL)
        .setTitle('🔍 Cari Command')
        .addComponents(new ActionRowBuilder().addComponents(input));
}

module.exports = async function handleHelpInteraction(interaction) {
    const id = interaction.customId;

    // === 📂 Dropdown kategori ===
    if (id === HELP_IDS.SELECT) {
        const catId = interaction.values?.[0];
        const embed = buildCategoryEmbed(interaction.client, catId);
        if (!embed) {
            // Kategori tidak dikenal (pesan lama pasca-update katalog) →
            // jangan error diam-diam, kembalikan ke menu utama.
            return interaction.update({
                embeds: [buildHomeEmbed(interaction.client, interaction.user)],
                components: buildHelpComponents('home')
            });
        }
        return interaction.update({ embeds: [embed], components: buildHelpComponents('cat') });
    }

    // === 🔍 Tombol cari → buka modal ===
    if (id === HELP_IDS.SEARCH_BUTTON) {
        return interaction.showModal(makeSearchModal());
    }

    // === 🔍 Submit modal pencarian ===
    if (id === HELP_IDS.SEARCH_MODAL) {
        const query = (interaction.fields?.getTextInputValue?.(HELP_IDS.SEARCH_INPUT) || '').trim();
        // Query kosong tidak mungkin dari modal (input required) — tapi tetap
        // defensive: embed search sudah handle emptyQuery.
        return interaction.update({
            embeds: [buildSearchEmbed(query)],
            components: buildHelpComponents('search')
        });
    }

    // === 🏠 Menu utama ===
    if (id === HELP_IDS.HOME_BUTTON) {
        return interaction.update({
            embeds: [buildHomeEmbed(interaction.client, interaction.user)],
            components: buildHelpComponents('home')
        });
    }

    // === 📖 Semua command ===
    if (id === HELP_IDS.ALL_BUTTON) {
        return interaction.update({ embeds: buildAllEmbeds(), components: buildHelpComponents('all') });
    }

    // customId help_* lainnya (tidak seharusnya terjadi) — v3.9.40: di-ack
    // dengan pesan ephemeral, bukan warn-only. Tanpa ack, user lihat
    // "This interaction failed" merah di Discord (komponen pesan help lama
    // dari versi bot sebelumnya yang customId-nya sudah tidak dikenal).
    console.warn(`[help] customId help tidak dikenali: ${id}`);
    if (typeof interaction.reply === 'function' && !interaction.replied) {
        return interaction
            .reply({ content: '❓ Komponen help tidak dikenal (mungkin pesan dari versi lama). Jalankan `/help` lagi untuk menu terbaru.', flags: MessageFlags.Ephemeral })
            .catch(() => {});
    }
};
