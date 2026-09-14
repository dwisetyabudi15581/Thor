/**
 * Custom Command Manager — slash command buatan admin, dibuat dari WEB (v3.20.0).
 *
 * Fitur "Custom Commands" ala Dyno: admin bikin command sendiri di web
 * dashboard (nama, deskripsi, balasan teks/embed), bot mendaftarkannya
 * sebagai slash command ASLI per-server → member tinggal pakai /nama.
 * Edit/hapus dari web → registrasi sinkron otomatis (customCommandSync.js).
 *
 * File: data/customCommands/<guildId>.json
 * {
 *   "commands": [
 *     {
 *       "name": "sosmed",                       // lowercase a-z 0-9 - _ , 1-32
 *       "description": "Link sosial media server", // 1-100
 *       "ephemeral": false,                     // true = balasan cuma terlihat pemakai
 *       "content": "Follow kita ya!",           // teks di luar embed, ≤2000, opsional
 *       "embed": { ...def embedPayload.js },    // opsional (minimal content ATAU embed)
 *       "createdBy": "userId",
 *       "createdByTag": "Admin",
 *       "createdAt": 1735689600000,
 *       "updatedAt": 1735689600000,
 *       "useCount": 0
 *     }
 *   ]
 * }
 *
 * Batas:
 *   - Maks 20 custom command per guild (biar daftar / tidak membengkak).
 *   - Nama tidak boleh bentrok dengan command bawaan (registry) — kalau
 *     bentrok, command bawaan yang menang dan admin dapat pesan error jelas.
 *
 * Pola: read-through cache 15 detik + invalidate-on-save (lihat
 * responderManager.js) — murah untuk dibaca tiap interaction.
 */

const fs = require('fs');
const path = require('path');
const { safeWriteJSON, quarantineCorruptFile } = require('../infra/safeWrite');
const { normalizeEmbedDef, isEmbedEmpty } = require('../infra/embedPayload');

const dirPath = path.join(__dirname, '..', '..', 'data', 'customCommands');
const MAX_CUSTOM_COMMANDS = 20;
const NAME_RE = /^[a-z0-9_-]{1,32}$/;
const MAX_CONTENT = 2000;

const CACHE_TTL_MS = 15 * 1000;
const _guildCache = new Map(); // guildId -> { data, at }

function guildFile(guildId) {
    return path.join(dirPath, `${guildId}.json`);
}

function loadGuild(guildId) {
    const cached = _guildCache.get(guildId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
    let data = { commands: [] };
    try {
        if (fs.existsSync(guildFile(guildId))) {
            const parsed = JSON.parse(fs.readFileSync(guildFile(guildId), 'utf8'));
            if (parsed && Array.isArray(parsed.commands)) data = parsed;
        }
    } catch (_err) {
        // Pola safeWrite: karantina file korup, lanjut dengan state kosong.
        quarantineCorruptFile(guildFile(guildId));
        data = { commands: [] };
    }
    _guildCache.set(guildId, { data, at: Date.now() });
    return data;
}

function saveGuild(guildId, data) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    safeWriteJSON(guildFile(guildId), data);
    _guildCache.set(guildId, { data, at: Date.now() });
}

/** Paksa read fresh berikutnya (restore backup / test). */
function invalidateCache() {
    _guildCache.clear();
}

/** Daftar command custom guild ini (array — jangan dimutasi langsung). */
function getGuildCommands(guildId) {
    return loadGuild(guildId).commands;
}

/** Cari satu command by name (lowercase). null kalau tidak ada. */
function getCommand(guildId, name) {
    const n = String(name || '').toLowerCase();
    return getGuildCommands(guildId).find((c) => c.name === n) || null;
}

/**
 * Def siap registrasi ke Discord (bentuk application command).
 * Semua orang boleh pakai (tanpa defaultMemberPermissions) — command
 * publik informasi; admin tetap bisa menonaktifkan via /commands toggle
 * atau Command Manager web (gate disabledCommands di router).
 */
function toApplicationCommands(guildId) {
    return getGuildCommands(guildId).map((c) => ({
        name: c.name,
        description: c.description
    }));
}

/**
 * Validasi + normalisasi definisi command dari input mentah (web / API).
 *
 * @param {*} input  { name, description, ephemeral, content, embed }
 * @param {string[]} builtinNames  nama command bawaan (anti bentrok)
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function validateDefinition(input, builtinNames = []) {
    if (!input || typeof input !== 'object') return { ok: false, error: 'Definisi command tidak valid' };

    const name = String(input.name || '').trim().toLowerCase();
    if (!NAME_RE.test(name)) {
        return { ok: false, error: 'Nama command hanya boleh huruf kecil, angka, - dan _ (1-32 karakter)' };
    }
    const builtins = new Set(builtinNames);
    if (builtins.has(name)) {
        return { ok: false, error: `Nama \`/${name}\` sudah dipakai command bawaan bot — pilih nama lain` };
    }

    const description = String(input.description || '').trim();
    if (!description || description.length > 100) {
        return { ok: false, error: 'Deskripsi wajib diisi (1-100 karakter)' };
    }

    const content = String(input.content || '').trim();
    if (content.length > MAX_CONTENT) {
        return { ok: false, error: `Teks balasan maksimal ${MAX_CONTENT} karakter` };
    }

    const embedRes = normalizeEmbedDef(input.embed);
    if (!embedRes.ok) return { ok: false, error: `Embed: ${embedRes.error}` };
    const embed = embedRes.value;

    if (!content && isEmbedEmpty(embed)) {
        return { ok: false, error: 'Minimal isi teks balasan ATAU embed — keduanya kosong' };
    }

    return {
        ok: true,
        value: {
            name,
            description,
            ephemeral: input.ephemeral === true,
            content,
            embed,
            updatedAt: Date.now()
        }
    };
}

/**
 * Buat / update command (upsert by name). `actor` = { id, tag } user web.
 * @returns {{ ok: true, command: object } | { ok: false, error: string }}
 */
function upsertCommand(guildId, input, builtinNames = [], actor = null) {
    const validated = validateDefinition(input, builtinNames);
    if (!validated.ok) return { ok: false, error: validated.error };
    const def = validated.value;

    const data = loadGuild(guildId);
    const existing = data.commands.find((c) => c.name === def.name);

    if (!existing && data.commands.length >= MAX_CUSTOM_COMMANDS) {
        return { ok: false, error: `Maksimal ${MAX_CUSTOM_COMMANDS} custom command per server` };
    }

    if (existing) {
        existing.description = def.description;
        existing.ephemeral = def.ephemeral;
        existing.content = def.content;
        existing.embed = def.embed;
        existing.updatedAt = def.updatedAt;
        existing.updatedBy = actor?.id || null;
        existing.updatedByTag = actor?.tag || null;
        saveGuild(guildId, data);
        return { ok: true, command: existing, created: false };
    }

    const command = {
        name: def.name,
        description: def.description,
        ephemeral: def.ephemeral,
        content: def.content,
        embed: def.embed,
        createdBy: actor?.id || null,
        createdByTag: actor?.tag || null,
        createdAt: def.updatedAt,
        updatedAt: def.updatedAt,
        updatedBy: null,
        updatedByTag: null,
        useCount: 0
    };
    data.commands.push(command);
    saveGuild(guildId, data);
    return { ok: true, command, created: true };
}

/** Hapus command by name. */
function deleteCommand(guildId, name) {
    const n = String(name || '').toLowerCase();
    const data = loadGuild(guildId);
    const before = data.commands.length;
    data.commands = data.commands.filter((c) => c.name !== n);
    if (data.commands.length === before) {
        return { ok: false, error: `Custom command \`/${n}\` tidak ditemukan` };
    }
    saveGuild(guildId, data);
    return { ok: true };
}

/** Catat pemakaian (best-effort, dari router saat command dipakai). */
function incrementUse(guildId, name) {
    try {
        const n = String(name || '').toLowerCase();
        const data = loadGuild(guildId);
        const cmd = data.commands.find((c) => c.name === n);
        if (!cmd) return;
        cmd.useCount = (cmd.useCount || 0) + 1;
        saveGuild(guildId, data);
    } catch (_err) {
        /* statistik tidak boleh menggagalkan balasan command */
    }
}

module.exports = {
    MAX_CUSTOM_COMMANDS,
    validateDefinition,
    getGuildCommands,
    getCommand,
    toApplicationCommands,
    upsertCommand,
    deleteCommand,
    incrementUse,
    invalidateCache
};
