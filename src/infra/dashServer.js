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
    verifyButton: (key, value) => {
        if (key === 'label') {
            if (!isStr(value, 80)) return { ok: false, error: 'Label tombol 1-80 karakter' };
            return { ok: true, value };
        }
        if (key === 'emoji') {
            if (!isStr(value, 64)) return { ok: false, error: 'Emoji tidak valid' };
            return { ok: true, value };
        }
        if (key === 'style') {
            if (!BUTTON_STYLES.includes(value)) return { ok: false, error: `Style harus salah satu: ${BUTTON_STYLES.join(', ')}` };
            return { ok: true, value };
        }
        return { ok: false, error: `verifyButton.${key} tidak dikenal` };
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
    if (['levelRoles', 'ticketCategories', 'products'].includes(section)) {
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
            config[v.section] = v.value; // array utuh
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
        return {
            config: getConfig(guildId),
            automod: automodManager.getGuildConfig(guildId),
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
            }
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
