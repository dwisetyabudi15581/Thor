/**
 * Unit tests v3.9.45 — hotfix PermissionFlagsBits + jaring pengaman _shared.
 *
 * Kronologi bug: v3.9.43 menambah paket moderasi; moderation.js mendestrukturisasi
 * PermissionFlagsBits dari './_shared', tapi _shared.js TIDAK pernah mengekspornya
 * → undefined saat runtime → tiap /purge /timeout /untimeout /kick /ban crash:
 *   TypeError: Cannot read properties of undefined (reading 'ManageMessages')
 * Kenapa lolos semua jalur QC (457 test hijau + ESLint bersih): destructuring
 * export yang hilang TIDAK error saat require — variabelnya jadi undefined
 * secara senyap, dan tidak ada test yang mengeksekusi path cek permission
 * moderasi dengan modul asli. Test ini menutup lubang itu permanen.
 *
 * Yang dijaga:
 *   A. PermissionFlagsBits diekspor _shared dan identik dengan objek asli
 *      discord.js (referensi sama), plus bit yang dipakai moderasi ada:
 *      ModerateMembers / ManageMessages / KickMembers / BanMembers / ViewChannel.
 *   B. JARING PENGAMAN (kelas bug, bukan instance): semua file src/** yang
 *      mendestrukturisasi apapun dari _shared — setiap identifier binding-nya
 *      HARUS ada di runtime exports _shared. Import yang hilang di masa depan
 *      langsung gagal test di sini, bukan crash di production saat command
 *      pertama dijalankan user.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { PermissionFlagsBits, MessageFlags } = require('../../src/commands/_shared');
const { PermissionFlagsBits: RealPermissionFlagsBits } = require('discord.js');

test('A. _shared mengekspor PermissionFlagsBits asli discord.js + bit moderasi lengkap', () => {
    assert.ok(PermissionFlagsBits, 'PermissionFlagsBits harus terdefinisi di _shared (bug v3.9.44: undefined)');
    assert.strictEqual(PermissionFlagsBits, RealPermissionFlagsBits, 'harus objek discord.js yang sama, bukan tiruan');
    for (const bit of ['ModerateMembers', 'ManageMessages', 'KickMembers', 'BanMembers', 'ViewChannel']) {
        assert.ok(PermissionFlagsBits[bit], `bit ${bit} harus ada (dipakai cek permission bot di moderasi/midman)`);
    }
    assert.ok(MessageFlags, 'MessageFlags tetap diekspor (jaga kontrak lama)');
});

test('B. jaring pengaman: semua identifier dari require(..._shared) ada di exports runtime', () => {
    const shared = require('../../src/commands/_shared');
    const ROOT = path.resolve(__dirname, '../../src');
    const re = /const\s*\{([^{}]*)\}\s*=\s*require\(\s*['"][^'"]*_shared['"]\s*\)/g;

    const violations = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.name.endsWith('.js') || entry.name === '_shared.js') continue;
            // buang line comments supaya komentar dalam blok destructure tidak
            // ikut keparse jadi identifier palsu.
            const src = fs.readFileSync(full, 'utf8').replace(/^[ \t]*\/\/.*$/gm, '');
            for (const m of src.matchAll(re)) {
                for (const raw of m[1].split(',')) {
                    let name = raw.trim();
                    if (!name) continue;
                    if (name.includes(':')) name = name.split(':')[1].trim(); // { kunci: binding }
                    if (name.includes('=')) name = name.split('=')[0].trim(); // { binding = default }
                    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
                    if (!(name in shared)) {
                        violations.push(`${path.relative(ROOT, full)} → "${name}" di-destructure tapi TIDAK diekspor _shared`);
                    }
                }
            }
        }
    };
    walk(ROOT);
    assert.deepStrictEqual(violations, [],
        `destructure dari _shared yang senyap undefined (bakal crash runtime):\n${violations.join('\n')}`);
});
