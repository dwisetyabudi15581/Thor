/**
 * Safe interaction reply helpers.
 *
 * Masalah yang dipecahkan:
 * - Setelah `interaction.deferReply()`, bot melakukan task lama (hapus banyak
 *   channel, restore backup, dll), lalu memanggil `interaction.editReply()`.
 * - Kalau user menutup pesan ephemeral "Bot is thinking..." sebelum editReply
 *   jalan, Discord kembalikan `DiscordAPIError[10008]: Unknown Message`.
 * - Sebelum v3.9.4, error ini gaib ke global error handler dan muncul sebagai
 *   stack trace penuh di log — padahal user-nya yang dismiss.
 *
 * Solusi:
 * - `safeEditReply` mencoba editReply; kalau dapat 10008/10062, fallback ke
 *   `followUp` (yang bikin pesan baru di channel yang sama).
 * - `safeFollowUp` sama, tapi untuk followUp yang dipakai langsung tanpa
 *   editReply dulu.
 *
 * Kapan pakai:
 * - SETIAP command yang deferReply lalu melakukan >1 detik kerjaan API Discord
 *   (hapus multiple channel, kirim banyak DM, restore backup) WAJIB pakai
 *   `safeEditReply` di akhir, bukan `interaction.editReply` langsung.
 *
 * Kapan TIDAK perlu pakai:
 * - Command sinkron cepat (<1s) tanpa deferReply → interaction.reply() cukup.
 * - Handler yang sudah pakai .catch(()=>{}) di editReply dan tidak peduli
 *   konfirmasinya sampe atau tidak.
 */

const { MessageFlags } = require('discord.js');

/**
 * Discord error codes yang berarti "original reply tidak bisa di-edit":
 * - 10008: Unknown Message (user dismissed ephemeral, atau message dihapus)
 * - 10062: Unknown Interaction (token interaction expired, >15 menit)
 * - 40060: Interaction has already been acknowledged (race condition)
 */
const IGNORABLE_REPLY_CODES = new Set([10008, 10062, 40060]);

/**
 * Edit interaction reply dengan fallback ke followUp kalau original hilang.
 *
 * @param {import('discord.js').BaseInteraction} interaction
 * @param {import('discord.js').InteractionReplyOptions} options - sama seperti options untuk editReply
 * @returns {Promise<import('discord.js').Message|null>} Message kalau sukses, null kalau gagal total (silent)
 */
async function safeEditReply(interaction, options) {
    try {
        return await interaction.editReply(options);
    } catch (err) {
        if (!IGNORABLE_REPLY_CODES.has(err.code)) {
            throw err; // unexpected error — re-throw supaya caller tau
        }

        // Original reply hilang. Coba followUp (bikin pesan baru).
        // Preserve ephemeral flag kalau original deferReply ephemeral.
        const wasEphemeral = interaction.ephemeral === true ||
            options?.flags === MessageFlags.Ephemeral ||
            options?.flags === 64;

        try {
            return await interaction.followUp({
                ...options,
                ...(wasEphemeral ? { flags: MessageFlags.Ephemeral } : {})
            });
        } catch (_) {
            // followUp juga gagal — kemungkinan interaction token expired (>15 menit).
            // Tidak ada yang bisa dilakukan; silent return.
            return null;
        }
    }
}

/**
 * Follow up interaction dengan handling error silent.
 * Pakai kalau caller tidak peduli apakah followUp sampe atau tidak (e.g., notifikasi
 * opsional setelah command utama selesai).
 *
 * @param {import('discord.js').BaseInteraction} interaction
 * @param {import('discord.js').InteractionReplyOptions} options
 * @returns {Promise<import('discord.js').Message|null>}
 */
async function safeFollowUp(interaction, options) {
    try {
        return await interaction.followUp(options);
    } catch (err) {
        if (!IGNORABLE_REPLY_CODES.has(err.code)) {
            throw err;
        }
        return null;
    }
}

/**
 * Reply interaction dengan handling error silent.
 * Pakai untuk initial reply kalau kemungkinan interaction sudah expired (jarang).
 *
 * @param {import('discord.js').BaseInteraction} interaction
 * @param {import('discord.js').InteractionReplyOptions} options
 * @returns {Promise<import('discord.js').Message|null>}
 */
async function safeReply(interaction, options) {
    try {
        return await interaction.reply(options);
    } catch (err) {
        if (!IGNORABLE_REPLY_CODES.has(err.code)) {
            throw err;
        }
        return null;
    }
}

module.exports = {
    safeEditReply,
    safeFollowUp,
    safeReply,
    IGNORABLE_REPLY_CODES
};
