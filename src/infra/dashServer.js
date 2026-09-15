/**
 * Dashboard API Server (v3.16.0) — HTTP API kecil untuk DASHBOARD WEB.
 *
 * Konsep (ala Dyno): semua setting bot bisa dikendalikan lewat DUA jalur —
 * slash command langsung di Discord, ATAU dashboard web. Dua-duanya
 * menulis ke sumber data yang sama (data/config/<guildId>.json dkk.),
 * jadi tidak pernah ada perbedaan state.
 *
 * Arsitektur:
 *   [Browser] ⇄ [Dashboard Next.js] ⇄ DASH API (file ini, di proses bot) ⇄ data/*.json
 *
 * Keamanan:
 *   - Bind default 127.0.0.1 — hanya dashboard (same host) yang bisa akses.
 *     JANGAN expose ke publik; dashboard web yang menjadi pintu publiknya
 *     (dengan login Discord + cek permission ManageGuild per server).
 *   - Header `x-dash-token` wajib, dibanding timing-safe dengan DASH_API_TOKEN.
 *   - Tanpa DASH_API_TOKEN di .env → server TIDAK jalan (aman default).
 *   - Validasi ketat setiap field: whitelist section, tipe data, panjang
 *     string, format snowflake — plus guard prototype pollution (pola
 *     configManager.setField).
 *
 * Endpoint (semua JSON):
 *   GET    /health                              → status bot + jumlah guild
 *   GET    /guilds                              → daftar guild tempat bot ada
 *   GET    /guilds/:id/meta                     → channels + roles (untuk picker web)
 *   GET    /guilds/:id/dashboard                → SEMUA data modul sekali tarik
 *   PUT    /guilds/:id/config                   → { updates: { dotPath: value } }
 *   PUT    /guilds/:id/automod                  → merge partial automod config
 *   POST   /guilds/:id/responders               → tambah auto-responder
 *   DELETE /guilds/:id/responders?trigger=...   → hapus responder (by trigger)
 *   POST   /guilds/:id/announce                 → jadwalkan announcement
 *   DELETE /guilds/:id/announce/:annId          → batalkan announcement
 *   POST   /guilds/:id/selfroles                → bikin panel self-role (kirim message)
 *   POST   /guilds/:id/selfroles/:panelId/roles → tambah role ke panel (re-render)
 *   DELETE /guilds/:id/selfroles/:panelId/roles?roleId=... → lepas role dari panel
 *   DELETE /guilds/:id/selfroles/:panelId       → hapus panel + message
 *   POST   /guilds/:id/serverstats/refresh      → paksa refresh counter
 *   DELETE /guilds/:id/tempvoice                → lepas setup temp voice (config saja)
 *   POST   /guilds/:id/panels                   → pasang panel tiket ke channel (v3.21.0)
 *   POST   /guilds/:id/verify-panel             → DIHAPUS v3.22.0 (verifikasi kini panel self-role)
 *
 * Actor audit: setiap operasi tulis menerima `actor: { id, tag }` (user
 * dashboard yang login) — dicatat ke console + audit log kalau memungkinkan,
 * supaya jejak "siapa mengubah apa dari web" tetap ada.
 */

const http = require('http');
const crypto = require('crypto');

// Data layer — SATU sumber kebenaran yang sama dengan slash command.
const { getConfig, saveConfig, DEFAULTS } = require('../data/configManager');
const automodManager = require('../data/automodManager');
const responderManager = require('../data/responderManager');
const selfRoleManager = require('../data/selfRoleManager');
const tempVoiceManager = require('../data/tempVoiceManager');
const announcements = require('../data/scheduledAnnouncements');
const serverstatsManager = require('../data/serverstatsManager');
const { buildPanelEmbed, buildPanelComponents } = require('../ui/selfRolePanelBuilder');
const { normalizeNewlines } = require('./text');
// v3.19.0: modul-modul baru untuk Command Manager + modul web Giveaway /
// Poll / Embed / Backup / Moderasi / Keys.
const giveawayManager = require('../data/giveawayManager');
const pollManager = require('../data/pollManager');
const backupManager = require('../data/backupManager');
const warnManager = require('../data/warnManager');
const modLogManager = require('../data/modLogManager');
const keyManager = require('../data/keyManager');
const roleScheduler = require('../data/roleScheduler');
const { getCommands } = require('../commands/registry');
const { normalizeDisabledList, PROTECTED_COMMANDS } = require('../commands/commands');
const { COMMAND_TO_DOMAIN } = require('../commands/index.js');
// v3.20.0: Custom Commands (dibuat dari web → slash command asli di server)
// + embed builder lengkap (validasi terpusat di embedPayload.js).
const customCommandManager = require('../data/customCommandManager');
const { syncGuildCustomCommands } = require('../services/customCommandSync');
const { normalizeEmbedDef, buildEmbedFromDef, isEmbedEmpty } = require('./embedPayload');
// v3.21.0: modul Panduan Cepat (web) — pasang panel tiket + verifikasi.
// Builder + storage yang SAMA dengan slash command (paritas penuh dua arah:
// panel dipasang dari web = panel dipasang dari /setup-ticket-panel).
const panelManager = require('../data/panelManager');
const { buildTicketPanel } = require('../commands/panels');
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType
} = require('discord.js');

// Versi langsung dari package.json — tidak pernah basi (v3.17.0).
const BOT_VERSION = require('../../package.json').version;

const MAX_BODY_BYTES = 256 * 1024; // 256KB — cukup untuk messages panjang, kecil untuk abuse
const SNOWFLAKE_RE = /^\d{5,25}$/;
const BUTTON_STYLES = ['Primary', 'Secondary', 'Success', 'Danger'];

// ============================================================
// === Validasi field config (whitelist per section) ===
// ============================================================

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isSnowflakeOrNull(v) {
    return v === null || v === '' || (typeof v === 'string' && SNOWFLAKE_RE.test(v));
}

function isStr(v, max) {
    return typeof v === 'string' && v.length > 0 && v.length <= max;
}

/**
 * Validator per top-level section config. Setiap validator mengembalikan
 * { ok: true, value } (nilai ternormalisasi) atau { ok: false, error }.
 */
const SECTION_VALIDATORS = {
    roles: (key, value) => {
        // v3.23.0: konsep role verify/unverified DIHAPUS — tolak dengan pesan
        // yang mengarahkan ke penggantinya (dashboard lama masih bisa
        // mengirim key ini dari state basi).
        if (key === 'verified' || key === 'unverified') {
            return { ok: false, error: `roles.${key} dihapus di v3.23.0 — role join kini via autorole (daftar + toggle removeOnNewRole)` };
        }
        if (!/^[a-z][a-zA-Z0-9_-]{0,39}$/.test(key)) return { ok: false, error: `Nama role key tidak valid: ${key}` };
        if (!isSnowflakeOrNull(value)) return { ok: false, error: `roles.${key} harus ID Discord atau null` };
        return { ok: true, value: value || null };
    },
    channels: (key, value) => {
        if (!/^[a-z][a-zA-Z0-9_-]{0,39}$/.test(key)) return { ok: false, error: `Nama channel key tidak valid: ${key}` };
        if (!isSnowflakeOrNull(value)) return { ok: false, error: `channels.${key} harus ID Discord atau null` };
        return { ok: true, value: value || null };
    },
    messages: (key, value) => {
        if (!/^[a-zA-Z0-9_-]{1,60}$/.test(key)) return { ok: false, error: `Nama pesan tidak valid: ${key}` };
        if (!isStr(value, 4000)) return { ok: false, error: `messages.${key} harus teks 1-4000 karakter` };
        return { ok: true, value };
    },
    colors: (key, value) => {
        if (!/^(success|danger|primary|warning|info)$/.test(key)) return { ok: false, error: `Warna tidak dikenal: ${key}` };
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0 || n > 0xffffff) return { ok: false, error: `colors.${key} harus integer 0-16777215` };
        return { ok: true, value: n };
    },
    // v3.22.0: section verifyButton DIHAPUS — fitur verifikasi dihapus (kini
    // panel self-role). Dashboard lama yang masih mengirim verifyButton.*
    // dapat 422 "Unknown section" yang bersih.
    // v3.23.0: autorole — daftar auto-role saat join (paritas web
    // /set-autorole) + toggle removeOnNewRole (path keyed, lihat
    // validateUpdate).
    autorole: (key, value) => {
        if (key !== '__array__') return { ok: false, error: 'autorole hanya bisa di-set sebagai array utuh (autorole.roleIds) atau toggle autorole.removeOnNewRole' };
        if (!Array.isArray(value)) return { ok: false, error: 'autorole harus array of role ID' };
        if (value.length > 10) return { ok: false, error: 'autorole maksimal 10 role' };
        for (const id of value) {
            if (!isSnowflakeOrNull(id) || !id) return { ok: false, error: 'autorole harus berisi Discord role ID (tanpa null)' };
        }
        return { ok: true, value: { roleIds: value } };
    },
    leveling: (key, value) => {
        switch (key) {
            case 'enabled':
                return { ok: true, value: !!value };
            case 'xpPerMessage': {
                const n = Number(value);
                if (!Number.isInteger(n) || n < 1 || n > 1000) return { ok: false, error: 'xpPerMessage 1-1000' };
                return { ok: true, value: n };
            }
            case 'cooldownMs': {
                const n = Number(value);
                if (!Number.isInteger(n) || n < 1000 || n > 3600000) return { ok: false, error: 'cooldownMs 1000-3600000' };
                return { ok: true, value: n };
            }
            case 'announceLevelUp':
                return { ok: true, value: !!value };
            case 'levelUpChannel':
                if (!isSnowflakeOrNull(value)) return { ok: false, error: 'levelUpChannel harus ID channel atau null' };
                return { ok: true, value: value || null };
            default:
                return { ok: false, error: `leveling.${key} tidak dikenal` };
        }
    },
    levelRoles: (key, value) => {
        // levelRoles di-set SELALU sebagai array utuh (dotPath "levelRoles")
        if (key !== '__array__') return { ok: false, error: 'levelRoles hanya bisa di-set sebagai array utuh' };
        if (!Array.isArray(value)) return { ok: false, error: 'levelRoles harus array' };
        if (value.length > 50) return { ok: false, error: 'Maksimal 50 level role' };
        for (const entry of value) {
            if (!entry || typeof entry !== 'object') return { ok: false, error: 'Entry levelRoles tidak valid' };
            const lvl = Number(entry.level);
            if (!Number.isInteger(lvl) || lvl < 1 || lvl > 1000) return { ok: false, error: 'Level harus 1-1000' };
            if (!SNOWFLAKE_RE.test(String(entry.roleId || ''))) return { ok: false, error: 'roleId tidak valid' };
        }
        return { ok: true, value: value.map(e => ({ level: Number(e.level), roleId: String(e.roleId) })) };
    },
    midman: (key, value) => {
        if (key === 'feeMode') {
            if (!['percent', 'flat'].includes(value)) return { ok: false, error: 'feeMode: percent | flat' };
            return { ok: true, value };
        }
        if (key === 'feeValue') {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0 || n > 1e9) return { ok: false, error: 'feeValue 0 - 1 miliar' };
            return { ok: true, value: n };
        }
        if (key === 'category') {
            if (!isStr(value, 100)) return { ok: false, error: 'Nama kategori 1-100 karakter' };
            return { ok: true, value };
        }
        return { ok: false, error: `midman.${key} tidak dikenal` };
    },
    ticketCategories: (key, value) => {
        if (key !== '__array__') return { ok: false, error: 'ticketCategories hanya bisa di-set sebagai array utuh' };
        if (!Array.isArray(value)) return { ok: false, error: 'ticketCategories harus array' };
        if (value.length === 0) return { ok: false, error: 'Minimal 1 kategori tiket' };
        if (value.length > 25) return { ok: false, error: 'Maksimal 25 kategori' };
        const seen = new Set();
        for (const cat of value) {
            if (!cat || typeof cat !== 'object') return { ok: false, error: 'Kategori tidak valid' };
            if (!/^[a-z0-9_-]{2,32}$/.test(String(cat.id || ''))) return { ok: false, error: `ID kategori harus slug 2-32 char: ${cat.id}` };
            if (seen.has(cat.id)) return { ok: false, error: `ID kategori duplikat: ${cat.id}` };
            seen.add(cat.id);
            if (!isStr(String(cat.label || ''), 80)) return { ok: false, error: `Label kategori ${cat.id} 1-80 karakter` };
            if (cat.emoji && !isStr(String(cat.emoji), 64)) return { ok: false, error: 'Emoji kategori tidak valid' };
            if (cat.style && !BUTTON_STYLES.includes(cat.style)) return { ok: false, error: `Style kategori ${cat.id} tidak dikenal` };
            if (cat.requiresKey !== undefined && typeof cat.requiresKey !== 'boolean') return { ok: false, error: 'requiresKey harus boolean' };
        }
        return {
            ok: true,
            value: value.map(c => ({
                id: String(c.id),
                label: String(c.label),
                emoji: String(c.emoji || '🎫'),
                style: c.style || 'Primary',
                requiresKey: !!c.requiresKey,
                ...(c.isDefault !== undefined ? { isDefault: !!c.isDefault } : {})
            }))
        };
    },
    products: (key, value) => {
        if (key !== '__array__') return { ok: false, error: 'products hanya bisa di-set sebagai array utuh' };
        if (!Array.isArray(value)) return { ok: false, error: 'products harus array' };
        if (value.length > 25) return { ok: false, error: 'Maksimal 25 produk (batas dropdown Discord)' };
        for (const p of value) {
            if (!p || typeof p !== 'object') return { ok: false, error: 'Produk tidak valid' };
            if (!isStr(String(p.label || ''), 100)) return { ok: false, error: 'Label produk 1-100 karakter' };
            if (!isStr(String(p.value || ''), 100)) return { ok: false, error: 'Value produk 1-100 karakter' };
            if (!isStr(String(p.price || ''), 100)) return { ok: false, error: 'Harga produk 1-100 karakter' };
            if (p.duration && !isStr(String(p.duration), 100)) return { ok: false, error: 'Durasi tidak valid' };
            if (p.category && !/^[a-z0-9_-]{2,32}$/.test(String(p.category))) return { ok: false, error: 'Kategori produk tidak valid' };
            if (p.requiresKey !== undefined && typeof p.requiresKey !== 'boolean') return { ok: false, error: 'requiresKey harus boolean' };
            // v3.19.0 FIX (data loss): roleId + days sebelumnya DIHAPUS saat
            // produk disimpan dari web — padahal /set-product-role menyimpannya
            // di objek produk. Edit price list via web diam-diam melepas semua
            // auto-role mapping. Sekarang keduanya dipertahankan + divalidasi
            // (paritas penuh antara interface Discord dan web).
            if (p.roleId !== undefined && p.roleId !== null && !SNOWFLAKE_RE.test(String(p.roleId))) {
                return { ok: false, error: 'roleId produk harus ID Discord yang valid' };
            }
            if (p.days !== undefined && p.days !== null && (!Number.isInteger(Number(p.days)) || Number(p.days) < 0 || Number(p.days) > 3650)) {
                return { ok: false, error: 'days produk harus integer 0-3650 (0 = permanen)' };
            }
        }
        return {
            ok: true,
            value: value.map(p => {
                const out = {
                    label: String(p.label),
                    value: String(p.value),
                    price: String(p.price),
                    category: p.category ? String(p.category) : 'transaction',
                    requiresKey: !!p.requiresKey
                };
                if (p.duration) out.duration = String(p.duration);
                // v3.19.0: pertahankan mapping role (set via /set-product-role).
                if (p.roleId) out.roleId = String(p.roleId);
                if (p.days !== undefined && p.days !== null) out.days = Number(p.days);
                return out;
            })
        };
    }
};

/**
 * Validasi satu update { dotPath, value }.
 * @returns {{ ok: true, section, key, value } | { ok: false, error }}
 */
function validateUpdate(dotPath, value) {
    if (typeof dotPath !== 'string' || dotPath.length > 120 || !/^[a-zA-Z0-9_.-]+$/.test(dotPath)) {
        return { ok: false, error: 'dotPath tidak valid' };
    }
    const parts = dotPath.split('.');
    for (const p of parts) {
        if (FORBIDDEN_KEYS.has(p)) return { ok: false, error: `Path terlarang: ${dotPath}` };
    }
    const section = parts[0];
    const validator = SECTION_VALIDATORS[section];
    if (!validator) return { ok: false, error: `Section tidak dikenal: ${section}` };

    // Section array (levelRoles / ticketCategories / products) — selalu array utuh.
    // v3.23.0: autorole punya DUA bentuk: array utuh (daftar role join) dan
    // path keyed `autorole.removeOnNewRole` (toggle boolean). Keduanya bisa
    // datang bersamaan dalam satu PUT dari SaveBar.
    if (section === 'autorole' && parts.length === 2 && parts[1] === 'removeOnNewRole') {
        if (typeof value !== 'boolean') return { ok: false, error: 'autorole.removeOnNewRole harus boolean (true/false)' };
        return { ok: true, section: 'autorole', key: 'removeOnNewRole', value };
    }
    if (['levelRoles', 'ticketCategories', 'products', 'autorole'].includes(section)) {
        if (parts.length !== 1) return { ok: false, error: `${section} hanya bisa di-set sebagai array utuh` };
        const r = validator('__array__', value);
        return r.ok ? { ok: true, section, key: null, value: r.value } : r;
    }
    if (parts.length !== 2) return { ok: false, error: `Path harus ${section}.<field>` };

    const r = validator(parts[1], value);
    return r.ok ? { ok: true, section, key: parts[1], value: r.value } : r;
}

/** Terapkan kumpulan update tervalidasi ke objek config in-memory + simpan sekali. */
function applyUpdates(config, updates) {
    const errors = [];
    const applied = [];
    for (const [dotPath, rawValue] of Object.entries(updates)) {
        const v = validateUpdate(dotPath, rawValue);
        if (!v.ok) {
            errors.push(`${dotPath}: ${v.error}`);
            continue;
        }
        if (v.key === null) {
            // v3.23.0: set array utuh autorole TIDAK boleh menghapus toggle
            // removeOnNewRole — kedua path (autorole + autorole.removeOnNewRole)
            // bisa datang bersamaan dalam satu PUT; merge, bukan replace.
            if (v.section === 'autorole') {
                config.autorole = { ...(config.autorole || {}), ...v.value };
            } else {
                config[v.section] = v.value; // array utuh
            }
            // Semantik /remove-category: kategori bawaan claim_giveaway &
            // midman otomatis di-re-add oleh getConfig() selama flag dismissal
            // tidak diset. Dashboard harus set/unset flag yang sama supaya
            // hasil save PERSIS seperti yang admin lihat di web.
            if (v.section === 'ticketCategories') {
                const ids = new Set(v.value.map((c) => c.id));
                if (ids.has('claim_giveaway')) delete config.claimGiveawayDismissed;
                else config.claimGiveawayDismissed = true;
                if (ids.has('midman')) delete config.midmanCategoryDismissed;
                else config.midmanCategoryDismissed = true;
            }
        } else if (config[v.section] && typeof config[v.section] === 'object') {
            config[v.section][v.key] = v.value;
        } else {
            config[v.section] = { [v.key]: v.value };
        }
        applied.push(dotPath);
    }
    return { errors, applied };
}

// ============================================================
// === Validasi automod (merge partial) ===
// ============================================================

function validateAutomodPatch(patch) {
    const out = {};
    const errs = [];
    const boolKeys = ['enabled', 'blockLinks'];
    const intRules = {
        spamThreshold: [1, 100],
        spamWindowMs: [1000, 600000],
        maxMentions: [1, 50]
    };
    const actionValues = ['warn', 'mute_10m', 'mute_1h', 'kick', 'delete_only'];
    const arrayStrKeys = ['linkAllowedChannels', 'linkAllowedRoles', 'exemptWords'];

    for (const [k, v] of Object.entries(patch)) {
        if (boolKeys.includes(k)) {
            if (typeof v !== 'boolean') { errs.push(`${k} harus boolean`); continue; }
            out[k] = v;
        } else if (intRules[k]) {
            const n = Number(v);
            const [min, max] = intRules[k];
            if (!Number.isInteger(n) || n < min || n > max) { errs.push(`${k} harus integer ${min}-${max}`); continue; }
            out[k] = n;
        } else if (k === 'spamAction' || k === 'wordAction' || k === 'mentionAction') {
            if (!actionValues.includes(v)) { errs.push(`${k} tidak dikenal`); continue; }
            out[k] = v;
        } else if (arrayStrKeys.includes(k)) {
            if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || x.length > 200)) { errs.push(`${k} harus array string`); continue; }
            out[k] = v;
        } else if (k === 'wordMatchMode') {
            if (!['whole_word', 'substring'].includes(v)) { errs.push('wordMatchMode: whole_word | substring'); continue; }
            out[k] = v;
        } else if (k === 'wordRules') {
            // Array utuh wordRules: [{ word, action, addedBy? }]
            if (!Array.isArray(v) || v.length > 500) { errs.push('wordRules harus array (maks 500)'); continue; }
            const rules = [];
            for (const w of v) {
                if (!w || !isStr(String(w.word || ''), 100)) { errs.push('wordRules: kata tidak valid (1-100 char)'); continue; }
                const action = w.action && actionValues.includes(w.action) ? w.action : null;
                rules.push({ word: String(w.word).toLowerCase(), action, addedBy: w.addedBy ? String(w.addedBy) : 'dash', addedAt: w.addedAt || Date.now() });
            }
            out.wordRules = rules;
        } else {
            errs.push(`Field automod tidak dikenal: ${k}`);
        }
    }
    return { out, errs };
}

// ============================================================
// === Handler inti ===
// ============================================================

/**
 * Bikin request handler (pure — mudah di-unit-test tanpa listen).
 * @param {Object} opts
 *   - client: instance Client discord.js (dipakai untuk meta guild + kirim/edit
 *     message panel self-role; unit test menyuntikkan mock).
 *   - token: string secret (wajib; handler mati kalau kosong).
 *   - log: fungsi log opsional (default console.log).
 * @returns {(req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>}
 */
function createDashHandler({ client, token, log = () => {} }) {
    if (!token || typeof token !== 'string') {
        throw new Error('createDashHandler: token wajib (tanpa token server tidak boleh jalan)');
    }

    const expected = Buffer.from(token);

    function authOk(req) {
        const got = req.headers['x-dash-token'];
        if (!got || typeof got !== 'string') return false;
        const b = Buffer.from(got);
        if (b.length !== expected.length) return false;
        return crypto.timingSafeEqual(b, expected);
    }

    function sendJson(res, code, obj) {
        const body = JSON.stringify(obj);
        res.writeHead(code, {
            'content-type': 'application/json; charset=utf-8',
            'content-length': Buffer.byteLength(body),
            'cache-control': 'no-store'
        });
        res.end(body);
    }

    function readBody(req) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            let size = 0;
            req.on('data', (c) => {
                size += c.length;
                if (size > MAX_BODY_BYTES) {
                    reject(new Error('Body terlalu besar'));
                    req.destroy();
                    return;
                }
                chunks.push(c);
            });
            req.on('end', () => {
                if (chunks.length === 0) return resolve({});
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                } catch {
                    reject(new Error('Body bukan JSON valid'));
                }
            });
            req.on('error', reject);
        });
    }

    /** Guild dari cache client; null kalau bot tidak ada di guild itu. */
    function getGuild(guildId) {
        if (!client?.guilds?.cache) return null;
        return client.guilds.cache.get(guildId) || null;
    }

    function guildSummaries() {
        if (!client?.guilds?.cache) return [];
        return [...client.guilds.cache.values()].map((g) => ({
            id: g.id,
            name: g.name,
            icon: g.icon ?? null,
            memberCount: typeof g.memberCount === 'number' ? g.memberCount : null,
            ownerId: g.ownerId ?? null
        }));
    }

    function guildMeta(g) {
        const channels = [...(g.channels?.cache?.values() || [])]
            .map((c) => ({ id: c.id, name: c.name, type: c.type, position: c.rawPosition ?? 0 }))
            .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
        const roles = [...(g.roles?.cache?.values() || [])]
            .map((r) => ({ id: r.id, name: r.name, color: r.color ?? 0, position: r.position ?? 0 }))
            .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name));
        return {
            id: g.id,
            name: g.name,
            icon: g.icon ?? null,
            memberCount: typeof g.memberCount === 'number' ? g.memberCount : null,
            channels,
            roles
        };
    }

    function dashboardPayload(guildId) {
        const tempVoiceCfg = tempVoiceManager.getGuildConfig(guildId);
        const config = getConfig(guildId);
        return {
            config,
            // v3.23.1: guild yang belum pernah mengatur AutoMod membuat
            // getGuildConfig() mengembalikan null — payload null ini membuat
            // halaman Overview & AutoMod di web crash (a.enabled pada null).
            // Fallback: config default dengan enabled=false (jujur: untuk
            // guild baru, messageCreate memang melewati automod karena cfg
            // null, jadi tampilkan "mati", bukan default enabled=true).
            automod:
                automodManager.getGuildConfig(guildId) ||
                { ...automodManager.getDefaultConfig(), enabled: false },
            responders: responderManager.getGuildResponders(guildId),
            selfroles: selfRoleManager.getPanelsByGuild(guildId),
            tempvoice: tempVoiceCfg
                ? {
                      creatorChannelId: tempVoiceCfg.creatorChannelId || null,
                      categoryId: tempVoiceCfg.categoryId || null,
                      activeChannels: tempVoiceCfg.channels ? Object.keys(tempVoiceCfg.channels).length : 0
                  }
                : null,
            announces: announcements.getByGuild(guildId),
            serverstats: {
                enabled: serverstatsManager.isEnabled(),
                config: serverstatsManager.getConfig()
            },
            // v3.19.0: Command Manager — daftar command (dari registry, satu
            // sumber kebenaran) + status disabled per guild. `protected` =
            // command yang tidak bisa didisable (pintu manajemen).
            commands: {
                // v3.20.0: custom command guild ini ditambahkan ke daftar
                // (domain 'custom') supaya bisa di-toggle dari Command Manager
                // web — paritas penuh dengan /commands toggle di Discord.
                list: [
                    ...getCommands().map((c) => ({
                        name: c.name,
                        description: c.description,
                        domain: COMMAND_TO_DOMAIN[c.name] || 'other'
                    })),
                    ...customCommandManager.getGuildCommands(guildId).map((c) => ({
                        name: c.name,
                        description: c.description,
                        domain: 'custom',
                        custom: true
                    }))
                ],
                disabled: Array.isArray(config?.disabledCommands) ? config.disabledCommands : [],
                protected: PROTECTED_COMMANDS
            },
            // v3.20.0: definisi lengkap custom command (modul Custom Command —
            // create/edit/delete di sini, aksi tulis via endpoint di bawah).
            customCommands: customCommandManager.getGuildCommands(guildId),
            // v3.19.0: data modul baru (read-only; aksi tulis via endpoint).
            giveaways: giveawayManager.getByGuild(guildId),
            polls: pollManager.getByGuild(guildId),
            backups: backupManager.listBackups().slice(0, 25),
            warns: warnManager.getGuildWarns(guildId, 50),
            modlogs: modLogManager.getGuildModLogs(guildId, 50),
            keys: keyManager
                .getAllKeys()
                .filter((k) => k.guildId === guildId)
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                .slice(0, 100),
            // v3.21.0: panel tiket terpasang — dipakai modul Panduan Cepat
            // sebagai status checklist (langkah "pasang panel tiket").
            // Bentuk slim supaya payload tetap ringan (body panel bisa 4000 char).
            panels: panelManager
                .getPanelsByGuild(guildId)
                .slice(0, 50)
                .map((p) => ({
                    id: p.id,
                    channelId: p.channelId,
                    messageId: p.messageId,
                    title: p.title,
                    categoryIds: Array.isArray(p.categoryIds) ? p.categoryIds : [],
                    useDropdown: !!p.useDropdown,
                    createdAt: p.createdAt || null
                }))
        };
    }

    /** Re-render panel message setelah role berubah (best-effort). */
    async function reRenderPanel(panelId) {
        const panel = selfRoleManager.getPanel(panelId);
        if (!panel || !panel.messageId || !panel.channelId) return;
        try {
            const channel = await client.channels.fetch(panel.channelId);
            const msg = await channel.messages.fetch(panel.messageId);
            await msg.edit({ embeds: [buildPanelEmbed(panel, client)], components: buildPanelComponents(panel) });
        } catch (err) {
            log(`[dash] re-render panel ${panelId} gagal (best-effort): ${err.message}`);
        }
    }

    return async function handler(req, res) {
        const url = new URL(req.url, 'http://localhost');
        const parts = url.pathname.split('/').filter(Boolean); // ["guilds", id, ...]
        const method = req.method;

        // Health endpoint TANPA auth (untuk cek hidup dari same-host; tidak
        // membocorkan data apa pun selain angka).
        if (method === 'GET' && url.pathname === '/health') {
            return sendJson(res, 200, {
                ok: true,
                ready: !!client?.isReady?.() || !!client?.ws?.status,
                guildCount: guildSummaries().length,
                uptimeSec: Math.floor(process.uptime()),
                version: BOT_VERSION
            });
        }

        if (!authOk(req)) return sendJson(res, 401, { error: 'Token tidak valid' });

        try {
            // ---- GET /guilds ----
            if (method === 'GET' && parts[0] === 'guilds' && parts.length === 1) {
                return sendJson(res, 200, { guilds: guildSummaries() });
            }

            // ---- /guilds/:id/... ----
            if (parts[0] === 'guilds' && parts.length >= 2) {
                const guildId = parts[1];
                if (!SNOWFLAKE_RE.test(guildId)) return sendJson(res, 400, { error: 'guildId tidak valid' });
                const g = getGuild(guildId);
                const rest = parts.slice(2); // mis. ["meta"] / ["responders"]

                // GET meta — bot harus ada di guild
                if (method === 'GET' && rest[0] === 'meta') {
                    if (!g) return sendJson(res, 404, { error: 'Bot tidak ada di server ini' });
                    return sendJson(res, 200, guildMeta(g));
                }

                // GET dashboard — data modul bisa dibaca walau cache guild
                // belum hangat (config tidak tergantung cache Discord).
                if (method === 'GET' && rest[0] === 'dashboard') {
                    if (!g) return sendJson(res, 404, { error: 'Bot tidak ada di server ini' });
                    return sendJson(res, 200, dashboardPayload(guildId));
                }

                // ---- PUT /guilds/:id/config ----
                if (method === 'PUT' && rest[0] === 'config') {
                    const body = await readBody(req);
                    const updates = body?.updates;
                    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
                        return sendJson(res, 400, { error: 'Body harus { updates: { dotPath: value } }' });
                    }
                    const keys = Object.keys(updates);
                    if (keys.length === 0) return sendJson(res, 400, { error: 'updates kosong' });
                    if (keys.length > 100) return sendJson(res, 400, { error: 'Maksimal 100 field per request' });

                    const config = getConfig(guildId);
                    const { errors, applied } = applyUpdates(config, updates);
                    if (errors.length > 0) {
                        return sendJson(res, 422, { error: 'Validasi gagal', details: errors });
                    }
                    saveConfig(guildId, config);

                    // Inval cache permission kalau admin role berubah (pola setField).
                    if (applied.some((p) => p.startsWith('roles.admin'))) {
                        try {
                            const { invalidateAdminRoleCache } = require('./permissions');
                            invalidateAdminRoleCache();
                        } catch (_) { /* belum ter-load — abaikan */ }
                    }
                    log(`[dash] config ${guildId} diupdate (${applied.length} field) oleh ${body?.actor?.tag || body?.actor?.id || 'unknown'}`);
                    return sendJson(res, 200, { ok: true, applied, config: getConfig(guildId) });
                }

                // ---- PUT /guilds/:id/automod ----
                if (method === 'PUT' && rest[0] === 'automod') {
                    const body = await readBody(req);
                    if (!body || typeof body !== 'object' || Array.isArray(body)) {
                        return sendJson(res, 400, { error: 'Body harus object automod' });
                    }
                    delete body.actor; // actor bukan field automod
                    const { out, errs } = validateAutomodPatch(body);
                    if (errs.length > 0) return sendJson(res, 422, { error: 'Validasi gagal', details: errs });
                    const merged = automodManager.setGuildConfig(guildId, out);
                    log(`[dash] automod ${guildId} diupdate oleh ${out.__actor || 'unknown'}`);
                    return sendJson(res, 200, { ok: true, automod: merged });
                }

                // ---- Responders ----
                if (rest[0] === 'responders') {
                    if (method === 'POST' && rest.length === 1) {
                        const body = await readBody(req);
                        const trigger = String(body?.trigger || '').trim();
                        const reply = String(body?.reply || '').trim();
                        if (!isStr(trigger, 50)) return sendJson(res, 400, { error: 'Trigger 1-50 karakter' });
                        if (!isStr(reply, 2000)) return sendJson(res, 400, { error: 'Reply 1-2000 karakter' });
                        const matchMode = ['contains', 'exact'].includes(body?.matchMode) ? body.matchMode : 'contains';
                        const replyType = ['text', 'embed'].includes(body?.replyType) ? body.replyType : 'text';
                        const cooldownMs = Number(body?.cooldownMs ?? 3000);
                        if (!Number.isInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 600000) {
                            return sendJson(res, 400, { error: 'cooldownMs 0-600000' });
                        }
                        const result = responderManager.addResponder(guildId, {
                            trigger,
                            reply,
                            matchMode,
                            replyType,
                            cooldownMs,
                            createdBy: body?.actor?.id || 'dash',
                            createdByTag: body?.actor?.tag || 'Dashboard'
                        });
                        if (!result.ok) return sendJson(res, 409, { error: result.error });
                        log(`[dash] responder "${trigger}" ditambah di ${guildId}`);
                        return sendJson(res, 201, { ok: true, responders: responderManager.getGuildResponders(guildId) });
                    }
                    if (method === 'DELETE' && rest.length === 1) {
                        const trigger = url.searchParams.get('trigger');
                        if (!trigger) return sendJson(res, 400, { error: 'Parameter trigger wajib' });
                        const result = responderManager.removeResponder(guildId, trigger);
                        if (!result.ok) return sendJson(res, 404, { error: result.error });
                        return sendJson(res, 200, { ok: true, responders: responderManager.getGuildResponders(guildId) });
                    }
                }

                // ---- Announce (scheduled) ----
                if (rest[0] === 'announce') {
                    if (method === 'POST' && rest.length === 1) {
                        const body = await readBody(req);
                        const channelId = String(body?.channelId || '');
                        if (!SNOWFLAKE_RE.test(channelId)) return sendJson(res, 400, { error: 'channelId tidak valid' });
                        if (!isStr(String(body?.title || ''), 256)) return sendJson(res, 400, { error: 'Judul 1-256 karakter' });
                        if (!isStr(String(body?.description || ''), 4000)) return sendJson(res, 400, { error: 'Deskripsi 1-4000 karakter' });
                        // sendAt: epoch ms atau ISO string; harus masa depan.
                        let sendAt = body?.sendAt;
                        if (typeof sendAt === 'string' && sendAt) {
                            const parsed = Date.parse(sendAt);
                            if (Number.isNaN(parsed)) return sendJson(res, 400, { error: 'sendAt tidak valid' });
                            sendAt = parsed;
                        }
                        sendAt = Number(sendAt);
                        if (!Number.isFinite(sendAt) || sendAt < Date.now() - 60000 || sendAt > Date.now() + 1000 * 60 * 60 * 24 * 365) {
                            return sendJson(res, 400, { error: 'Waktu kirim harus antara sekarang dan 1 tahun ke depan' });
                        }
                        const recurring = [null, 'daily', 'weekly', 'monthly'].includes(body?.recurring ?? null)
                            ? (body?.recurring ?? null)
                            : null;
                        const entry = announcements.create({
                            guildId,
                            channelId,
                            sendAt,
                            title: String(body.title),
                            description: String(body.description),
                            color: Number.isInteger(body?.color) ? body.color : 0x5865f2,
                            image: body?.image ? String(body.image).slice(0, 500) : null,
                            thumbnail: body?.thumbnail ? String(body.thumbnail).slice(0, 500) : null,
                            mention: body?.mention ? String(body.mention).slice(0, 200) : null,
                            recurring,
                            authorId: body?.actor?.id || 'dash',
                            authorTag: body?.actor?.tag || 'Dashboard'
                        });
                        log(`[dash] announcement dijadwalkan di ${guildId} (${entry.id})`);
                        return sendJson(res, 201, { ok: true, announcement: entry });
                    }
                    if (method === 'DELETE' && rest.length === 2) {
                        const ok = announcements.remove(rest[1]);
                        if (!ok) return sendJson(res, 404, { error: 'Announcement tidak ditemukan' });
                        return sendJson(res, 200, { ok: true });
                    }
                }

                // ---- Self-role panels ----
                if (rest[0] === 'selfroles') {
                    if (method === 'POST' && rest.length === 1) {
                        const body = await readBody(req);
                        const channelId = String(body?.channelId || '');
                        if (!SNOWFLAKE_RE.test(channelId)) return sendJson(res, 400, { error: 'channelId tidak valid' });
                        const type = body?.type === 'select' ? 'select' : 'button';
                        const roles = Array.isArray(body?.roles) ? body.roles : [];
                        if (roles.length === 0 || roles.length > 25) return sendJson(res, 400, { error: 'Panel butuh 1-25 role' });

                        // Buat panel + isi roles SEBELUM kirim message.
                        const panel = selfRoleManager.createPanel({
                            guildId,
                            channelId,
                            title: String(body?.title || '🎭 Self Role').slice(0, 200),
                            description: normalizeNewlines(String(body?.description || 'Klik untuk ambil / lepas role.').slice(0, 2000)),
                            type,
                            exclusive: !!body?.exclusive
                        });
                        for (const r of roles) {
                            if (!SNOWFLAKE_RE.test(String(r?.roleId || ''))) {
                                selfRoleManager.deletePanel(panel.id);
                                return sendJson(res, 400, { error: 'roleId tidak valid' });
                            }
                            const added = selfRoleManager.addRoleToPanel(panel.id, {
                                roleId: String(r.roleId),
                                label: String(r.label || 'Role').slice(0, 80),
                                emoji: r.emoji ? String(r.emoji).slice(0, 64) : undefined,
                                description: r.description ? String(r.description).slice(0, 100) : undefined,
                                style: BUTTON_STYLES.includes(r.style) ? r.style : 'Secondary'
                            });
                            if (!added.ok) {
                                selfRoleManager.deletePanel(panel.id);
                                return sendJson(res, 400, { error: added.error });
                            }
                        }

                        // Kirim message panel (rollback entry kalau gagal — P0-5).
                        try {
                            const channel = await client.channels.fetch(channelId);
                            const fresh = selfRoleManager.getPanel(panel.id);
                            const panelMsg = await channel.send({
                                embeds: [buildPanelEmbed(fresh, client)],
                                components: buildPanelComponents(fresh)
                            });
                            selfRoleManager.setMessageId(panel.id, panelMsg.id);
                        } catch (err) {
                            selfRoleManager.deletePanel(panel.id);
                            return sendJson(res, 502, { error: `Gagal kirim panel ke channel: ${err.message}` });
                        }
                        log(`[dash] panel self-role dibuat di ${guildId} (${panel.id})`);
                        return sendJson(res, 201, { ok: true, panel: selfRoleManager.getPanel(panel.id) });
                    }

                    if (method === 'POST' && rest.length === 3 && rest[2] === 'roles') {
                        const body = await readBody(req);
                        if (!SNOWFLAKE_RE.test(String(body?.roleId || ''))) return sendJson(res, 400, { error: 'roleId tidak valid' });
                        const added = selfRoleManager.addRoleToPanel(rest[1], {
                            roleId: String(body.roleId),
                            label: String(body?.label || 'Role').slice(0, 80),
                            emoji: body?.emoji ? String(body.emoji).slice(0, 64) : undefined,
                            description: body?.description ? String(body.description).slice(0, 100) : undefined,
                            style: BUTTON_STYLES.includes(body?.style) ? body.style : 'Secondary'
                        });
                        if (!added.ok) return sendJson(res, 409, { error: added.error });
                        await reRenderPanel(rest[1]);
                        return sendJson(res, 200, { ok: true, panel: selfRoleManager.getPanel(rest[1]) });
                    }

                    if (method === 'DELETE' && rest.length === 3 && rest[2] === 'roles') {
                        const roleId = url.searchParams.get('roleId');
                        if (!roleId) return sendJson(res, 400, { error: 'Parameter roleId wajib' });
                        const removed = selfRoleManager.removeRoleFromPanel(rest[1], roleId);
                        if (!removed.ok) return sendJson(res, 404, { error: removed.error });
                        await reRenderPanel(rest[1]);
                        return sendJson(res, 200, { ok: true, panel: selfRoleManager.getPanel(rest[1]) });
                    }

                    if (method === 'DELETE' && rest.length === 2) {
                        const panel = selfRoleManager.getPanel(rest[1]);
                        if (!panel) return sendJson(res, 404, { error: 'Panel tidak ditemukan' });
                        // Hapus message best-effort (panel entry tetap dibersihkan).
                        if (panel.messageId && panel.channelId) {
                            try {
                                const channel = await client.channels.fetch(panel.channelId);
                                const msg = await channel.messages.fetch(panel.messageId);
                                await msg.delete();
                            } catch (err) {
                                log(`[dash] hapus message panel gagal (lanjut hapus entry): ${err.message}`);
                            }
                        }
                        selfRoleManager.deletePanel(rest[1]);
                        return sendJson(res, 200, { ok: true });
                    }
                }

                // ---- Serverstats: force refresh ----
                if (method === 'POST' && rest[0] === 'serverstats' && rest[1] === 'refresh') {
                    if (!g) return sendJson(res, 404, { error: 'Bot tidak ada di server ini' });
                    const result = await serverstatsManager.refreshServerStats(g, { force: true });
                    return sendJson(res, 200, { ok: true, result });
                }

                // ---- Tempvoice: lepas setup ----
                if (method === 'DELETE' && rest[0] === 'tempvoice') {
                    const ok = tempVoiceManager.removeGuild(guildId);
                    if (!ok) return sendJson(res, 404, { error: 'Setup temp voice tidak ditemukan' });
                    return sendJson(res, 200, { ok: true, note: 'Config dilepas; channel fisik tidak dihapus — hapus manual bila perlu.' });
                }

                // ========================================================
                // ==== v3.19.0: COMMAND MANAGER + MODUL BARU (WEB)     ====
                // ========================================================

                // ---- Command Manager: simpan daftar disabled ----
                // Aturan identik dengan /commands toggle (normalizeDisabledList
                // dipakai bersama — single source of truth antar interface).
                if (method === 'PUT' && rest[0] === 'commands' && rest.length === 1) {
                    const body = await readBody(req);
                    // v3.20.0: custom command guild ini ikut diizinkan di daftar
                    // disabled (aturan yang sama dengan /commands toggle).
                    const customNames = customCommandManager.getGuildCommands(guildId).map((c) => c.name);
                    const normalized = normalizeDisabledList(body?.disabled ?? [], customNames);
                    if (!normalized.ok) return sendJson(res, 422, { error: normalized.error });
                    const config = getConfig(guildId);
                    config.disabledCommands = normalized.value;
                    saveConfig(guildId, config);
                    log(`[dash] command manager ${guildId}: ${normalized.value.length} command dinonaktifkan oleh ${body?.actor?.tag || 'unknown'}`);
                    return sendJson(res, 200, {
                        ok: true,
                        disabled: normalized.value,
                        total: getCommands().length + customNames.length
                    });
                }

                // ---- v3.20.0: Custom Commands — buat/update dari web ----
                // Definisi → data/customCommands/<guildId>.json → sinkron
                // registrasi ke Discord (guild.commands.set) → command muncul
                // sebagai slash command ASLI di server dalam hitungan detik.
                if (method === 'POST' && rest[0] === 'custom-commands' && rest.length === 1) {
                    if (!g) return sendJson(res, 404, { error: 'Bot tidak ada di server ini' });
                    const body = await readBody(req);
                    const builtinNames = getCommands().map((c) => c.name);
                    const result = customCommandManager.upsertCommand(guildId, body, builtinNames, {
                        id: String(body?.actor?.id || 'web'),
                        tag: String(body?.actor?.tag || 'web dashboard')
                    });
                    if (!result.ok) return sendJson(res, 422, { error: result.error });

                    // Sinkron ke Discord (best-effort: data sudah tersimpan;
                    // kegagalan sinkron dilaporkan tapi tidak membatalkan).
                    const sync = await syncGuildCustomCommands(client, guildId);
                    log(
                        `[dash] custom command ${result.created ? 'dibuat' : 'diperbarui'}: /${result.command.name} (${guildId}) oleh ${body?.actor?.tag || 'unknown'}` +
                            (sync.ok ? '' : ` — SINKRON GAGAL: ${sync.error}`)
                    );
                    return sendJson(res, result.created ? 201 : 200, {
                        ok: true,
                        command: result.command,
                        synced: sync.ok,
                        syncError: sync.ok ? undefined : sync.error
                    });
                }

                // ---- v3.20.0: Custom Commands — hapus dari web ----
                if (method === 'DELETE' && rest[0] === 'custom-commands' && rest.length === 2) {
                    if (!g) return sendJson(res, 404, { error: 'Bot tidak ada di server ini' });
                    const name = decodeURIComponent(rest[1]);
                    const result = customCommandManager.deleteCommand(guildId, name);
                    if (!result.ok) return sendJson(res, 404, { error: result.error });
                    const sync = await syncGuildCustomCommands(client, guildId);
                    log(`[dash] custom command dihapus: /${name} (${guildId})` + (sync.ok ? '' : ` — SINKRON GAGAL: ${sync.error}`));
                    return sendJson(res, 200, { ok: true, synced: sync.ok, syncError: sync.ok ? undefined : sync.error });
                }

                // ---- Giveaway: buat dari web (paritas /giveaway create) ----
                if (method === 'POST' && rest[0] === 'giveaway' && rest.length === 1) {
                    if (!g) return sendJson(res, 404, { error: 'Bot tidak ada di server ini' });
                    const body = await readBody(req);
                    const channelId = String(body?.channelId || '');
                    const prize = String(body?.prize || '').trim();
                    const winners = Number(body?.winners ?? 1);
                    const durationMin = Number(body?.durationMin);
                    const requiredRoleId = body?.requiredRoleId ? String(body.requiredRoleId) : null;

                    // Validasi identik dengan /giveaway create (supaya perilaku
                    // web dan Discord tidak bisa berbeda).
                    if (!SNOWFLAKE_RE.test(channelId)) return sendJson(res, 400, { error: 'channelId tidak valid' });
                    if (!isStr(prize, 200)) return sendJson(res, 400, { error: 'Prize wajib diisi, maksimal 200 karakter' });
                    if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 60 * 24 * 30) {
                        return sendJson(res, 400, { error: 'Durasi 1 menit sampai 30 hari (43200 menit)' });
                    }
                    if (!Number.isInteger(winners) || winners < 1 || winners > 20) {
                        return sendJson(res, 400, { error: 'Jumlah pemenang 1-20' });
                    }
                    if (requiredRoleId && !SNOWFLAKE_RE.test(requiredRoleId)) {
                        return sendJson(res, 400, { error: 'requiredRoleId tidak valid' });
                    }

                    const channel = await client.channels.fetch(channelId).catch(() => null);
                    if (!channel || channel.type !== ChannelType.GuildText) {
                        return sendJson(res, 400, { error: 'Channel harus berupa text channel' });
                    }

                    const endsAt = Date.now() + durationMin * 60000;
                    const gw = giveawayManager.create({
                        guildId,
                        channelId,
                        prize,
                        winnersCount: winners,
                        endsAt,
                        hostId: String(body?.actor?.id || 'dash'),
                        hostTag: String(body?.actor?.tag || 'Dashboard'),
                        requiredRoleId
                    });

                    // Embed + tombol identik dengan versi Discord.
                    const embed = new EmbedBuilder()
                        .setTitle('🎉 GIVEAWAY!')
                        .setDescription(
                            `🎁 **Prize:** ${prize}\n\n` +
                                `👥 **Pemenang:** ${winners}\n` +
                                `⏰ **Berakhir:** <t:${Math.floor(endsAt / 1000)}:R> (<t:${Math.floor(endsAt / 1000)}:F>)\n` +
                                `🎟️ **Peserta:** 0\n` +
                                (requiredRoleId ? `🔐 **Syarat:** Punya role <@&${requiredRoleId}>\n` : '') +
                                `\n👇 Klik tombol **🎉 Join** di bawah untuk ikut!`
                        )
                        .setColor(0xf1c40f)
                        .setFooter({ text: `Host: ${body?.actor?.tag || 'Dashboard'} | ID: ${gw.id}` })
                        .setTimestamp();
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`gw_join:${gw.id}`).setLabel('🎉 Join').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`gw_leave:${gw.id}`).setLabel('🚪 Leave').setStyle(ButtonStyle.Secondary)
                    );
                    const msg = await channel
                        .send({ embeds: [embed], components: [row], content: '🎉 **GIVEAWAY BARU!**' })
                        .catch(() => null);
                    if (!msg) {
                        // Rollback entry (pola P0-5 — sama dengan /giveaway create).
                        try {
                            giveawayManager.remove(gw.id);
                        } catch (_) { /* best-effort */ }
                        return sendJson(res, 502, { error: 'Gagal kirim pesan giveaway — cek permission bot di channel itu. Entry dibatalkan.' });
                    }
                    giveawayManager.setMessageId(gw.id, msg.id);
                    log(`[dash] giveaway dibuat di ${guildId} (${gw.id}) oleh ${body?.actor?.tag || 'unknown'}`);
                    return sendJson(res, 201, { ok: true, giveaway: giveawayManager.get(gw.id) });
                }

                // ---- Poll: buat dari web (paritas /poll create via modal) ----
                if (method === 'POST' && rest[0] === 'poll' && rest.length === 1) {
                    if (!g) return sendJson(res, 404, { error: 'Bot tidak ada di server ini' });
                    const body = await readBody(req);
                    const channelId = String(body?.channelId || '');
                    const question = String(body?.question || '').trim();
                    const multiple = !!body?.multiple;
                    const rawOptions = Array.isArray(body?.options) ? body.options : [];

                    if (!SNOWFLAKE_RE.test(channelId)) return sendJson(res, 400, { error: 'channelId tidak valid' });
                    if (!isStr(question, 250)) return sendJson(res, 400, { error: 'Pertanyaan wajib diisi, maksimal 250 karakter' });
                    if (rawOptions.length < 2 || rawOptions.length > 10) {
                        return sendJson(res, 400, { error: 'Poll butuh 2-10 opsi' });
                    }
                    const options = [];
                    for (const [i, o] of rawOptions.entries()) {
                        const label = String(o?.label || '').trim();
                        const emoji = o?.emoji ? String(o.emoji).slice(0, 64) : `${i + 1}️⃣`;
                        if (!isStr(label, 80)) return sendJson(res, 400, { error: `Opsi #${i + 1}: label wajib 1-80 karakter` });
                        options.push({ label, emoji });
                    }

                    const channel = await client.channels.fetch(channelId).catch(() => null);
                    if (!channel || channel.type !== ChannelType.GuildText) {
                        return sendJson(res, 400, { error: 'Channel harus berupa text channel' });
                    }

                    // Render-first (pola v3.9.26): entry persist SETELAH embed
                    // berhasil dibangun; id dibuat di depan supaya tombol konsisten.
                    const pollId = `poll_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    const createdAt = Date.now();
                    const lines = options
                        .map((opt) => `${opt.emoji} **${opt.label}** — 0 votes (0%)\n\`${'░'.repeat(10)}\``)
                        .join('\n\n');
                    const embed = new EmbedBuilder()
                        .setTitle(`📊 ${question}`)
                        .setDescription(
                            `${lines}\n\n` +
                                `🗳️ Total votes: **0**\n` +
                                `🔄 Mode: ${multiple ? 'Multi-vote (boleh pilih banyak)' : 'Single-vote (pilih satu)'}\n` +
                                `⏰ Dibuat: <t:${Math.floor(createdAt / 1000)}:R>\n\n` +
                                `👇 Klik tombol di bawah untuk vote (toggle)`
                        )
                        .setColor(0x5865f2)
                        .setFooter({ text: `Poll by ${body?.actor?.tag || 'Dashboard'} | ID: ${pollId}` })
                        .setTimestamp();
                    const rows = [];
                    for (let i = 0; i < options.length; i += 5) {
                        const row = new ActionRowBuilder();
                        for (let j = i; j < Math.min(i + 5, options.length); j++) {
                            row.addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`poll_vote:${pollId}:${j}`)
                                    .setLabel(options[j].label.slice(0, 80))
                                    .setEmoji(options[j].emoji)
                                    .setStyle(ButtonStyle.Primary)
                            );
                        }
                        rows.push(row);
                    }

                    const poll = pollManager.create({
                        id: pollId,
                        guildId,
                        channelId,
                        question,
                        options,
                        multiple,
                        creatorId: String(body?.actor?.id || 'dash'),
                        creatorTag: String(body?.actor?.tag || 'Dashboard')
                    });
                    const msg = await channel
                        .send({
                            embeds: [embed],
                            components: rows,
                            content: `📊 **POLL BARU** oleh ${body?.actor?.tag || 'Dashboard'}`
                        })
                        .catch(() => null);
                    if (!msg) {
                        try {
                            pollManager.remove(poll.id);
                        } catch (_) { /* best-effort */ }
                        return sendJson(res, 502, { error: 'Gagal kirim pesan poll — cek permission bot di channel itu. Entry dibatalkan.' });
                    }
                    pollManager.setMessageId(poll.id, msg.id);
                    log(`[dash] poll dibuat di ${guildId} (${poll.id}) oleh ${body?.actor?.tag || 'unknown'}`);
                    return sendJson(res, 201, { ok: true, poll: pollManager.get(poll.id) });
                }

                // ---- Embed: kirim embed LENGKAP ke channel (paritas /embed-builder) ----
                // v3.20.0: menerima bentuk penuh (content + embed {title,
                // description, color, authorName, authorIconURL, fields[],
                // thumbnail, image, footerText, footerIconURL, timestamp}).
                // Field datar lama (title/description/footer/color/image/
                // thumbnail di body root) tetap diterima — modul web versi
                // lama dan client pihak ketiga tidak rusak.
                if (method === 'POST' && rest[0] === 'embed' && rest.length === 1) {
                    if (!g) return sendJson(res, 404, { error: 'Bot tidak ada di server ini' });
                    const body = await readBody(req);
                    const channelId = String(body?.channelId || '');
                    if (!SNOWFLAKE_RE.test(channelId)) return sendJson(res, 400, { error: 'channelId tidak valid' });

                    const content = body?.content ? String(body.content).slice(0, 2000).trim() : '';

                    // Bentuk lama → digabung ke embed baru (backward compat).
                    const rawEmbed =
                        body?.embed && typeof body.embed === 'object'
                            ? body.embed
                            : {
                                  title: body?.title,
                                  description: body?.description,
                                  color: body?.color,
                                  footerText: body?.footer ? String(body.footer).slice(0, 2048) : undefined,
                                  image: body?.image,
                                  thumbnail: body?.thumbnail
                              };

                    const embedRes = normalizeEmbedDef(rawEmbed);
                    if (!embedRes.ok) return sendJson(res, 400, { error: embedRes.error });
                    const def = embedRes.value;

                    if (!content && isEmbedEmpty(def)) {
                        return sendJson(res, 400, { error: 'Minimal title, description, atau content harus diisi' });
                    }

                    const channel = await client.channels.fetch(channelId).catch(() => null);
                    if (!channel || channel.type !== ChannelType.GuildText) {
                        return sendJson(res, 400, { error: 'Channel harus berupa text channel' });
                    }

                    const embed = buildEmbedFromDef(def, EmbedBuilder);
                    // Fallback warna kalau embed sama sekali tanpa warna eksplisit
                    // (normalizeEmbedDef selalu set default 0x5865f2, jadi ini
                    // cuma jaring pengaman).
                    const payload = {};
                    if (content) payload.content = normalizeNewlines(content);
                    if (!isEmbedEmpty(def)) payload.embeds = [embed];

                    const msg = await channel.send(payload).catch(() => null);
                    if (!msg) return sendJson(res, 502, { error: 'Gagal kirim embed — cek permission bot di channel itu' });
                    log(`[dash] embed dikirim ke ${channelId} (${guildId}) oleh ${body?.actor?.tag || 'unknown'}`);
                    return sendJson(res, 201, { ok: true, messageId: msg.id, url: msg.url });
                }

                // ---- Backup: buat sekarang + restore (paritas /backup-now, /restore-backup) ----
                if (rest[0] === 'backups') {
                    if (method === 'POST' && rest.length === 1) {
                        const body = await readBody(req);
                        const result = backupManager.createBackup();
                        if (!result.ok) {
                            return sendJson(res, 500, {
                                error: `Backup ${result.partial ? 'sebagian gagal' : 'gagal total'}: ${result.errors.join('; ') || 'tidak diketahui'}`
                            });
                        }
                        log(`[dash] backup dibuat untuk ${guildId} (${result.backupName}) oleh ${body?.actor?.tag || 'unknown'}`);
                        return sendJson(res, 201, { ok: true, backupName: result.backupName, filesCopied: result.filesCopied });
                    }
                    if (method === 'POST' && rest.length === 3 && rest[2] === 'restore') {
                        const body = await readBody(req);
                        const result = await backupManager.restoreBackup(rest[1]);
                        if (!result.ok) {
                            return sendJson(res, 422, { error: `Restore gagal: ${result.errors.join('; ') || 'backup tidak ditemukan / format nama salah'}` });
                        }
                        log(`[dash] backup ${rest[1]} di-restore (guild ${guildId}) oleh ${body?.actor?.tag || 'unknown'}`);
                        return sendJson(res, 200, { ok: true, filesRestored: result.filesRestored, note: 'Data bot sudah di-restore dari backup. Dashboard memuat ulang otomatis saat refresh.' });
                    }
                }

                // ---- Keys: kelola VIP key dari web (paritas /set-key & /clear-schedule) ----
                if (rest[0] === 'keys') {
                    if (method === 'POST' && rest.length === 1) {
                        if (!g) return sendJson(res, 404, { error: 'Bot tidak ada di server ini' });
                        const body = await readBody(req);
                        const userId = String(body?.userId || '');
                        const value = String(body?.value || '');
                        if (!SNOWFLAKE_RE.test(userId)) return sendJson(res, 400, { error: 'userId (ID Discord) tidak valid' });

                        // Produk harus terdaftar + punya role (aturan sama dengan
                        // /set-key — web tidak bisa membuat role dari udara).
                        const config = getConfig(guildId);
                        const product = (config.products || []).find((p) => p.value === value);
                        if (!product) return sendJson(res, 404, { error: `Produk value "${value}" tidak ditemukan` });
                        if (!product.roleId) {
                            return sendJson(res, 422, { error: `Produk ${product.label} belum punya role — atur dulu di modul Tiket & Produk` });
                        }

                        const member = await g.members.fetch(userId).catch(() => null);
                        if (!member) return sendJson(res, 404, { error: 'User tidak ada di server ini' });

                        // Key custom (opsional) atau auto-generate format XXXXX-XXXXX-XXXXX.
                        const keyValue = (typeof body?.key === 'string' ? body.key.trim() : '') ||
                            Array.from({ length: 3 }, () =>
                                Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')
                            ).join('-');

                        let keyEntry;
                        try {
                            keyEntry = keyManager.addKey({
                                key: keyValue,
                                userId: member.id,
                                username: member.user?.tag || member.id,
                                roleId: product.roleId,
                                productName: product.label,
                                days: product.days || 0,
                                guildId
                            });
                        } catch (err) {
                            return sendJson(res, 500, { error: `Gagal simpan key: ${err.message}` });
                        }

                        // Beri role (kalau bot punya izin) + schedule expire —
                        // best-effort dengan warning di response (pola /set-key).
                        const warnings = [];
                        try {
                            if (!member.roles.cache.has(product.roleId)) await member.roles.add(product.roleId);
                        } catch (_) {
                            warnings.push('Key tersimpan TANPA role — posisi role bot harus di ATAS role produk.');
                        }
                        try {
                            roleScheduler.scheduleRoleRemoval({
                                userId: member.id,
                                roleId: product.roleId,
                                guildId,
                                days: product.days || 0,
                                expireAt: keyEntry.expireAt,
                                productName: product.label
                            });
                        } catch (err) {
                            warnings.push(`Schedule auto-expire gagal: ${err.message}`);
                        }

                        log(`[dash] key dibuat untuk user ${userId} di ${guildId} oleh ${body?.actor?.tag || 'unknown'}`);
                        return sendJson(res, 201, { ok: true, key: keyEntry.key, expireAt: keyEntry.expireAt, warnings });
                    }

                    if (method === 'DELETE' && rest.length === 1) {
                        if (!g) return sendJson(res, 404, { error: 'Bot tidak ada di server ini' });
                        const userId = url.searchParams.get('userId');
                        if (!userId || !SNOWFLAKE_RE.test(userId)) {
                            return sendJson(res, 400, { error: 'Parameter userId (ID Discord) wajib' });
                        }
                        const removedSched = roleScheduler.removeAllByUser(userId, guildId);
                        const removedKeys = keyManager.removeAllKeysByUser(userId, guildId);
                        if (removedKeys === 0 && removedSched === 0) {
                            return sendJson(res, 404, { error: 'Tidak ada key / schedule untuk user ini di server itu' });
                        }
                        // Lepas role produk user (best-effort) — pola /clear-schedule.
                        const warnings = [];
                        try {
                            const member = await g.members.fetch(userId).catch(() => null);
                            const config = getConfig(guildId);
                            if (member) {
                                const productRoleIds = new Set((config.products || []).map((p) => p.roleId).filter(Boolean));
                                for (const roleId of member.roles.cache.map((r) => r.id)) {
                                    if (productRoleIds.has(roleId)) {
                                        await member.roles.remove(roleId).catch(() => {
                                            warnings.push(`Gagal melepas role <@&${roleId}> — lepaskan manual.`);
                                        });
                                    }
                                }
                            }
                        } catch (_) { /* best-effort */ }
                        log(`[dash] ${removedKeys} key + ${removedSched} schedule dihapus untuk user ${userId} di ${guildId}`);
                        return sendJson(res, 200, { ok: true, removedKeys, removedSchedules: removedSched, warnings });
                    }
                }

                // ========================================================
                // ==== v3.21.0: PANDUAN CEPAT (WEB)                    ====
                // ==== Paritas /setup-ticket-panel              ====
                // ========================================================

                // ---- Pasang panel tiket ke channel (paritas /setup-ticket-panel) ----
                // Validasi bisnis IDENTIK dengan slash command: roles.admin wajib,
                // minimal 1 kategori, channel harus text channel. Builder yang
                // sama (buildTicketPanel) → panel web = panel Discord, satu storage.
                if (method === 'POST' && rest[0] === 'panels' && rest.length === 1) {
                    if (!g) return sendJson(res, 404, { error: 'Bot tidak ada di server ini' });
                    const body = await readBody(req);
                    const config = getConfig(guildId);

                    if (!config.roles.admin) {
                        return sendJson(res, 422, { error: 'Role Admin Bot belum di-set — isi dulu langkah 1 Panduan Cepat (Role Admin).' });
                    }
                    const allCategories = config.ticketCategories || [];
                    if (allCategories.length === 0) {
                        return sendJson(res, 422, { error: 'Belum ada kategori tiket — tambahkan dulu di langkah 3 Panduan Cepat / modul Tiket & Produk.' });
                    }

                    const channelId = String(body?.channelId || '');
                    if (!SNOWFLAKE_RE.test(channelId)) return sendJson(res, 400, { error: 'channelId tidak valid' });

                    // Filter kategori opsional (array id); tanpa filter = semua.
                    const requested = Array.isArray(body?.categoryIds) ? body.categoryIds.map(String) : null;
                    const categoriesToShow = requested ? allCategories.filter((c) => requested.includes(c.id)) : allCategories;
                    if (categoriesToShow.length === 0) {
                        return sendJson(res, 400, { error: 'Tidak ada kategori yang cocok dengan categoryIds yang diminta' });
                    }

                    // Kustomisasi opsional (semua aman-default persis slash command).
                    const title = body?.title ? String(body.title).slice(0, 256) : null;
                    const panelBody = body?.body ? normalizeNewlines(String(body.body).slice(0, 4000)) : null;
                    const useDropdown = body?.useDropdown === true;
                    let color = null;
                    if (body?.color !== undefined && body?.color !== null && body?.color !== '') {
                        const raw = String(body.color).replace('#', '');
                        if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
                            return sendJson(res, 400, { error: 'color harus hex 6 digit (mis. #e67e22)' });
                        }
                        color = parseInt(raw, 16);
                    }

                    const channel = await client.channels.fetch(channelId).catch(() => null);
                    if (!channel || channel.type !== ChannelType.GuildText) {
                        return sendJson(res, 400, { error: 'Channel harus berupa text channel' });
                    }

                    const panelMeta = {
                        guildId,
                        channelId,
                        title,
                        body: panelBody,
                        color,
                        imageUrl: null,
                        thumbnailUrl: null,
                        footerText: null,
                        categoryIds: categoriesToShow.map((c) => c.id),
                        useDropdown,
                        createdBy: String(body?.actor?.id || 'dash')
                    };

                    let build;
                    try {
                        build = buildTicketPanel(panelMeta, { guild: g, client, config });
                    } catch (err) {
                        return sendJson(res, 422, { error: `Gagal build panel: ${err.message}` });
                    }

                    // Render-first + rollback (pola P0-5): entry hanya tersimpan
                    // kalau pesan benar-benar terkirim — tidak ada panel hantu.
                    const sent = await channel
                        .send({ embeds: [build.embed], components: build.components })
                        .catch(() => null);
                    if (!sent) {
                        return sendJson(res, 502, { error: 'Gagal kirim panel — pastikan bot punya permission Send Messages + Embed Links di channel itu.' });
                    }
                    const saved = panelManager.upsertPanel({ ...panelMeta, messageId: sent.id });
                    log(`[dash] panel tiket dipasang di ${channelId} (${guildId}, panel ${saved.id}) oleh ${body?.actor?.tag || 'unknown'}`);
                    return sendJson(res, 201, { ok: true, panel: saved, url: sent.url });
                }

                // ---- v3.22.0: POST /guilds/:id/verify-panel DIHAPUS ----
                // Fitur verifikasi khusus dihapus — "verified" kini role di
                // panel self-role (pasang lewat pola panel tiket atau
                // /setup-selfrole). Dashboard lama yang masih memanggil endpoint
                // ini mendapat 404 generik di bawah.
            }

            return sendJson(res, 404, { error: 'Endpoint tidak ditemukan' });
        } catch (err) {
            log(`[dash] error ${method} ${url.pathname}: ${err.message}`);
            return sendJson(res, 500, { error: `Kesalahan internal: ${err.message}` });
        }
    };
}

// ============================================================
// === Lifecycle (produksi) ===
// ============================================================

let activeServer = null;

/**
 * Jalankan DASH API server. Tanpa DASH_API_TOKEN → tidak jalan (aman default).
 * @param {import('discord.js').Client} client
 * @returns {http.Server | null}
 */
function startDashServer(client) {
    if (activeServer) return activeServer; // idempotent — jangan double-listen
    const token = (process.env.DASH_API_TOKEN || '').trim();
    if (!token) {
        console.log('ℹ️  DASH API tidak aktif (DASH_API_TOKEN kosong). Dashboard web tidak bisa terhubung.');
        return null;
    }
    const host = process.env.DASH_API_HOST || '127.0.0.1';
    const port = Number(process.env.DASH_API_PORT) || 8788;

    const handler = createDashHandler({ client, token, log: (m) => console.log(m) });
    activeServer = http.createServer(handler);
    activeServer.on('error', (err) => {
        console.error(`❌ DASH API error: ${err.message}`);
        activeServer = null;
    });
    activeServer.listen(port, host, () => {
        console.log(`🔌 DASH API siap: http://${host}:${port} (untuk dashboard web, token-secured)`);
    });
    return activeServer;
}

function stopDashServer() {
    if (!activeServer) return;
    activeServer.close();
    activeServer = null;
}

module.exports = {
    createDashHandler,
    startDashServer,
    stopDashServer,
    // Ekspor untuk unit test
    _internal: { validateUpdate, applyUpdates, validateAutomodPatch, SECTION_VALIDATORS, DEFAULTS }
};
