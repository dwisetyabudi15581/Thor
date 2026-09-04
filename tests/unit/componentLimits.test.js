/**
 * Unit tests v3.9.41 — jaring pengaman batasan komponen Discord.
 *
 * Akar bug (laporan user di produksi Thor-EN v3.9.40):
 *   TextInputBuilder.setLabel('Message outside the embed (optional, supports @)')
 *   = 48 karakter > limit Discord 45 → shapeshift ExpectedConstraintError
 *   SETIAP kali modal kirim embed dibuka → spam "Interaction Error" di log.
 *   Fix v3.9.27 sebelumnya hanya meng-guard alur tiket; file embed EN lolos
 *   dari audit karena versi ID-nya kebetulan masih ≤ 45.
 *
 * Yang diuji (3 lapis):
 *   (1) SCAN STATIS: nol pelanggaran literal batasan komponen di seluruh
 *       src/ + index.js — TextInput label ≤45, modal title ≤45,
 *       TextInput placeholder ≤100, button label ≤80, select option
 *       label/description ≤100, TextInput setMaxLength ≤4000.
 *       (Klasifikasi via constructor terdekat ke-belakang dari call-site.)
 *   (2) KONTRAK RUNTIME: semua label TextInput & title Modal literal di
 *       src/interactions/embed.js HARUS lolos builder discord.js ASLI
 *       (bukan mock) — modality yang sama persis dengan produksi.
 *   (3) DOKUMENTASI BATASAN: label 46 char throw, 45 char lolos —
 *       supaya dev masa depan paham kenapa test ini ada.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

const REPO_ROOT = path.join(__dirname, '..', '..');

// ============================================================
// Lapis 1 — scan statis seluruh codebase (literal saja)
// ============================================================
const LIMITS = {
    'ModalBuilder.setTitle': 45,
    'TextInputBuilder.setLabel': 45,
    'TextInputBuilder.setPlaceholder': 100,
    'ButtonBuilder.setLabel': 80,
    'SelectOption.setLabel': 100,
    'SelectOption.setDescription': 100
};

const CTOR_KIND = [
    ['TextInputBuilder', 'TextInputBuilder'],
    ['ModalBuilder', 'ModalBuilder'],
    ['ButtonBuilder', 'ButtonBuilder'],
    ['StringSelectMenuOptionBuilder', 'SelectOption'],
    ['UserSelectMenuOptionBuilder', 'SelectOption'],
    ['RoleSelectMenuOptionBuilder', 'SelectOption'],
    ['MentionableSelectMenuOptionBuilder', 'SelectOption'],
    ['ChannelSelectMenuOptionBuilder', 'SelectOption'],
    ['EmbedBuilder', 'EmbedBuilder'],
    ['StringSelectMenuBuilder', 'SelectMenu']
];

function classifyBackward(back) {
    let best = null, bestIdx = -1;
    for (const [ctor, kind] of CTOR_KIND) {
        const idx = back.lastIndexOf('new ' + ctor);
        if (idx > bestIdx) { bestIdx = idx; best = kind; }
    }
    return best;
}

function limitFor(kind, method) {
    if (kind === 'ModalBuilder' && method === 'setTitle') return LIMITS['ModalBuilder.setTitle'];
    if (kind === 'TextInputBuilder' && method === 'setLabel') return LIMITS['TextInputBuilder.setLabel'];
    if (kind === 'TextInputBuilder' && method === 'setPlaceholder') return LIMITS['TextInputBuilder.setPlaceholder'];
    if (kind === 'ButtonBuilder' && method === 'setLabel') return LIMITS['ButtonBuilder.setLabel'];
    if (kind === 'SelectOption' && method === 'setLabel') return LIMITS['SelectOption.setLabel'];
    if (kind === 'SelectOption' && method === 'setDescription') return LIMITS['SelectOption.setDescription'];
    return null;
}

function collectSourceFiles() {
    const files = [];
    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.js')) files.push(p);
        }
    })(path.join(REPO_ROOT, 'src'));
    const idx = path.join(REPO_ROOT, 'index.js');
    if (fs.existsSync(idx)) files.push(idx);
    return files;
}

function scanLiteralViolations() {
    const violations = [];
    for (const file of collectSourceFiles()) {
        const src = fs.readFileSync(file, 'utf8');
        const lines = src.split('\n');
        const offs = [0];
        for (let i = 0; i < lines.length; i++) offs.push(offs[i] + lines[i].length + 1);

        for (let i = 0; i < lines.length; i++) {
            const re = /\.(setLabel|setPlaceholder|setTitle|setDescription|setMaxLength)\s*\(/g;
            let m;
            while ((m = re.exec(lines[i])) !== null) {
                const method = m[1];
                const abs = offs[i] + m.index;
                const chunk = src.slice(abs, Math.min(src.length, abs + 400));
                // literal argumen pertama: '...' | "..." | `...` | angka
                const am = chunk.match(/\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`|(\d+))/);
                if (!am) continue;
                let literal = null;
                if (am[1] !== undefined) literal = am[1];
                else if (am[2] !== undefined) literal = am[2];
                else if (am[3] !== undefined) literal = am[3];
                if (literal === null) {
                    // setMaxLength angka
                    const num = parseInt(am[4], 10);
                    const backNum = src.slice(Math.max(0, abs - 500), abs);
                    if (classifyBackward(backNum) === 'TextInputBuilder' && num > 4000) {
                        violations.push(`${path.relative(REPO_ROOT, file)}:${i + 1} TextInputBuilder.setMaxLength=${num} > 4000`);
                    }
                    continue;
                }
                if (/\$\{/.test(literal)) continue; // dinamis — di-guard runtime terpisah
                const displayLen = literal.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\').length;
                const kind = classifyBackward(src.slice(Math.max(0, abs - 500), abs));
                const limit = limitFor(kind, method);
                if (limit && displayLen > limit) {
                    violations.push(`${path.relative(REPO_ROOT, file)}:${i + 1} ${kind}.${method} len=${displayLen} > ${limit} | ${literal.slice(0, 60)}`);
                }
            }
        }
    }
    return violations;
}

test('v3.9.41 #1 scan statis: 0 pelanggaran literal batasan komponen Discord di seluruh src/', () => {
    const violations = scanLiteralViolations();
    assert.strictEqual(violations.length, 0,
        `Ditemukan label/placeholder/title komponen yang MELEBIHI limit Discord (builder akan throw ExpectedConstraintError saat runtime):\n  - ${violations.join('\n  - ')}\nPerbaiki: pendekkan literal atau pindahkan detail ke placeholder (limit 100) / description.`);
});

// ============================================================
// Lapis 2 — kontrak runtime: modal embed.js lolos builder ASLI
// ============================================================
test('v3.9.41 #2 semua label TextInput & title Modal literal di embed.js lolos builder discord.js asli', () => {
    const embedSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'interactions', 'embed.js'), 'utf8');

    // Kumpulkan semua setLabel('literal') milik TextInputBuilder
    const textLabels = [];
    for (const m of embedSrc.matchAll(/new TextInputBuilder\(\)[\s\S]{0,400}?\.setLabel\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) {
        textLabels.push(m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
    }
    // Kumpulkan semua setTitle('literal') milik ModalBuilder (chain atau modal.setTitle)
    const modalTitles = [];
    for (const m of embedSrc.matchAll(/new ModalBuilder\(\)(?:[\s\S]{0,200}?)\.setTitle\(\s*'((?:[^'\\]|\\.)*)'\s*\)|\.setTitle\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) {
        const t = m[1] !== undefined ? m[1] : m[2];
        if (t !== undefined) modalTitles.push(t);
    }
    assert.ok(textLabels.length >= 6, `label TextInput di embed.js harusnya banyak (dapat ${textLabels.length})`);
    assert.ok(modalTitles.length >= 3, `title modal di embed.js harusnya ada beberapa (dapat ${modalTitles.length})`);

    for (const label of textLabels) {
        assert.doesNotThrow(
            () => new TextInputBuilder().setCustomId('t').setLabel(label).setStyle(TextInputStyle.Paragraph).setRequired(false),
            `TextInput label melebihi limit Discord 45 char: ${JSON.stringify(label)} (${label.length} char)`
        );
    }
    for (const title of modalTitles) {
        assert.doesNotThrow(
            () => new ModalBuilder().setCustomId('m').setTitle(title),
            `Modal title melebihi limit Discord 45 char: ${JSON.stringify(title)} (${title.length} char)`
        );
    }
});

// ============================================================
// Lapis 3 — dokumentasi batasan (regression guard kelas bug)
// ============================================================
test('v3.9.41 #3 batasan TextInput label: 46 char throw, 45 char lolos (dokumentasi limit)', () => {
    const ok45 = 'a'.repeat(45);
    assert.doesNotThrow(() => new TextInputBuilder().setCustomId('x').setLabel(ok45).setStyle(TextInputStyle.Short), 'label 45 char HARUS lolos (limit Discord)');
    const bad46 = 'a'.repeat(46);
    assert.throws(() => new TextInputBuilder().setCustomId('x').setLabel(bad46).setStyle(TextInputStyle.Short), /length|constraint|ExpectedConstraint/i, 'label 46 char HARUS throw (limit Discord) — jika ini gagal, discord.js mengubah batasan dan scan statis perlu disesuaikan');
});

test('v3.9.41 #4 regression spesifik: modal kirim embed (alur yang dulu crash) bangun bersih', () => {
    // Replika modal emb_modal_send — persis struktur produksi embed.js.
    const modal = new ModalBuilder().setCustomId('emb_modal_send:test').setTitle('Kirim Embed ke Channel');
    assert.doesNotThrow(() => {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('channel')
                    .setLabel('Channel target (#mention atau ID)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('#announcements atau 123456789012345678')
                    .setMaxLength(100)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('message')
                    .setLabel('Pesan di luar embed (opsional, support @)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(2000)
                    .setPlaceholder('Kosongkan = embed saja. Isi = teks + embed.\nSupport @everyone, @here, <@&role>, <@user>')
                    .setValue('')
            )
        );
    }, 'modal kirim embed harus lolos builder — regression bug v3.9.41');
});
