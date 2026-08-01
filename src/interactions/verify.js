/**
 * Verify domain handler — tombol `btn_verify`.
 *
 * Di-ekstrak dari handlers/interactionHandler.js (v3.9.9 refactor).
 * Behavior dipertahankan apa adanya — hanya pindah file.
 *
 * Router (src/interactions/index.js) sudah apply:
 *   - dedup (checkAndMark)
 *   - guard `replied/deferred`
 *   - cek tipe interaction (button/select/modal)
 *   - routing by customId prefix
 * Jadi domain handler fokus ke logic-nya saja.
 */

const { MessageFlags } = require('discord.js');
const { getConfig } = require('../commands/_shared');

module.exports = async function (interaction) {
    // Router memanggil handler ini HANYA untuk customId === 'btn_verify'.
    const config = getConfig();

    if (!config.roles.verified) {
        return interaction.reply({ content: '❌ Role Verified belum di-set. Minta admin jalankan `/set-role verified @role`.', flags: MessageFlags.Ephemeral });
    }
    if (interaction.member.roles.cache.has(config.roles.verified)) {
        return interaction.reply({ content: '✅ Kamu sudah terverifikasi!', flags: MessageFlags.Ephemeral });
    }
    try {
        await interaction.member.roles.add(config.roles.verified);
    } catch (err) {
        console.error('Gagal add role verified:', err.message);
        return interaction.reply({ content: '❌ Bot tidak bisa memberi role Verified. Pastikan role bot ada di ATAS role Verified.', flags: MessageFlags.Ephemeral });
    }
    if (config.roles.unverified) {
        try { await interaction.member.roles.remove(config.roles.unverified); } catch (err) { console.error('Gagal hapus role unverified:', err.message); }
    }
    return interaction.reply({ content: '✅ Verifikasi berhasil! Role Verified telah diberikan, role Unverified telah dihapus.', flags: MessageFlags.Ephemeral });
};
