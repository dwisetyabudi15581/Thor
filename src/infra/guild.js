/**
 * Guild helpers — v3.10.0 multi-guild.
 *
 * resolveGuildId(interaction): ambil ID guild dari interaction Discord.
 * Discord asli menyediakan `interaction.guildId` (selalu ada di context
 * server); `interaction.guild?.id` tersedia kalau guild ter-cache. Dua-duanya
 * dicek supaya:
 *   - production: guildId langsung terpakai (guild.id cuma fallback),
 *   - unit test: mock interaction yang hanya punya `guild: { id }` tetap
 *     jalan tanpa harus meniru kelas interaction discord.js lengkap.
 *
 * Return null untuk DM / tanpa konteks guild — caller wajib men-guard null
 * (atau membiarkan configManager throw dengan pesan yang jelas).
 */
function resolveGuildId(interaction) {
    if (!interaction) return null;
    return interaction.guildId || (interaction.guild && interaction.guild.id) || null;
}

module.exports = { resolveGuildId };
