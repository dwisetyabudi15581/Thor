/**
 * Verify domain handler — STUB DEPRECATED untuk tombol `btn_verify`.
 *
 * v3.22.0: fitur verifikasi khusus DIHAPUS. "Verified" kini hanya role
 * biasa di panel self-role (/setup-selfrole + /selfrole-add).
 * v3.23.0: konsep role penanda Unverified ikut dihapus — penggantinya
 * auto-role saat join + toggle "hapus saat dapat role lain"
 * (/set-autorole action:toggle).
 *
 * Kenapa stub ini ada: server yang memasang panel verify sebelum upgrade
 * masih punya tombol `btn_verify` hidup di channel-nya. Tanpa handler ini
 * klik tombol itu menampilkan "This interaction failed" generik — kini
 * member dapat penjelasan yang jelas dan admin dapat perintah persis untuk
 * migrasi ke panel self-role.
 */

const { MessageFlags } = require('discord.js');

module.exports = async function (interaction) {
    return interaction.reply({
        content:
            '⚠️ Tombol verifikasi ini sudah tidak berfungsi — fiturnya diganti **panel self-role**.\n\n' +
            '👤 *Member:* ambil role-mu dari panel self-role server.\n' +
            '🛠️ *Admin:* hapus panel lama ini lalu buat panel self-role:\n' +
            '```\n/setup-selfrole title:Verifikasi description:Klik di bawah untuk verifikasi\n' +
            '/selfrole-add panel_id:<id> role:@Verified label:Verifikasi Saya emoji:✅ style:Success\n```\n' +
            '💡 Tips: untuk role "member baru", pakai `/set-autorole action:add` lalu `action:toggle` — role join hilang otomatis begitu member mendapatkan role lain.',
        flags: MessageFlags.Ephemeral
    });
};
