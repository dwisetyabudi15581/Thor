/**
 * Auto-Responder Manager — keyword trigger → auto reply.
 *
 * File: data/responders.json
 * {
 *   "<guildId>": [
 *     {
 *       "id": "resp_<timestamp>_<rand>",
 *       "trigger": "beli",              // case-insensitive
 *       "matchMode": "contains",        // v3.9.47: "contains" | "exact"
 *                                        //   contains (DEFAULT, termasuk entri lama): trigger cocok
 *                                        //     sebagai KATA UTUH di mana saja dalam pesan —
 *                                        //     "beli" cocok dgn "bagaimana cara beli", BUKAN "belian"
 *                                        //   exact (perilaku lama): pesan harus DIAWALI trigger
 *                                        //     ("!sosmed" cocok dgn "!sosmed halo")
 *       "reply": "Instagram: @chronos\nTikTok: @chronos",
 *       "replyType": "text",            // "text" | "embed"
 *       "createdBy": "userId",
 *       "createdByTag": "User#1234",
 *       "createdAt": 1735689600000,
 *       "useCount": 0,
 *       "lastUsedAt": null,
 *       "cooldownMs": 3000,             // jeda antar trigger yang sama per user (3 detik default)
 *       "lastFiredAt": null,            // legacy: timestamp global terakhir dipakai (udah gak dipake, tapi tetap disimpen untuk jaga-jaga)
 *       "userCooldowns": {}             // daftar timestamp per-user: { "userId": timestamp }
 *     }
 *   ]
 * }
 *
 * v3.9.13: generic community bot feature.
 *
 * v3.9.47: match mode (permintaan user). Perilaku lama: trigger hanya aktif
 * kalau pesan DIAWALI trigger — trigger "beli" tidak pernah cocok dengan
 * "bagaimana cara beli". Sekarang tiap responder punya matchMode:
 *   - "contains" (default, juga diterapkan ke entri lama tanpa field ini —
 *      inilah perilaku yang admin minta): cocok sebagai KATA UTUH di mana
 *      saja dalam pesan. Batas kata sadar huruf/angka (\p{L}\p{N}), jadi
 *      "beli" cocok dengan "bagaimana cara beli" / "mau beli?" tapi TIDAK
 *      dengan "belian"/"membeli" — tidak ada alarm palsu dari kata panjang
 *      yang sekadar MENGANDUNG trigger sebagai substring.
 *   - "exact": perilaku awal-pesan yang lama — pesan == trigger, atau trigger
 *      diikuti spasi/newline ("!sosmed" cocok dgn "!sosmed halo").
 */

const fs = require('fs');
const path = require('path');
const { safeWriteJSON, quarantineCorruptFile } = require('../infra/safeWrite');

const filePath = path.join(__dirname, '..', '..', 'data', 'responders.json');

// v3.9.47: escape semua karakter meta regex supaya trigger seperti "!sos.med"
// diperlakukan sebagai teks literal saat mode contains membangun regex
// word-boundary-nya.
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * v3.9.47: matcher murni — apakah pesan ini cocok dengan trigger ini pada mode
 * ini? Di-ekspor untuk unit test. Input di-lowercase SECARA INTERNAL di sini
 * supaya aman untuk pemanggil mana pun (case-insensitive by contract).
 *
 * @param {string} message      isi pesan (huruf besar/kecil bebas)
 * @param {string} trig         trigger (huruf besar/kecil bebas)
 * @param {string} [matchMode]  'contains' (default) | 'exact'
 * @returns {boolean}
 */
function messageMatchesTrigger(message, trig, matchMode) {
    if (typeof message !== 'string' || typeof trig !== 'string' || !trig) return false;

    const lowerMessage = message.toLowerCase();
    const lowerTrig = trig.toLowerCase();

    if (matchMode === 'exact') {
        // Perilaku lama: pesan harus DIAWALI trigger.
        return (
            lowerMessage === lowerTrig ||
            lowerMessage.startsWith(lowerTrig + ' ') ||
            lowerMessage.startsWith(lowerTrig + '\n')
        );
    }

    // contains (default): trigger muncul sebagai KATA UTUH di mana saja.
    // Whitespace diratakan supaya trigger multi-kata ("cara beli") tetap cocok
    // dengan pesan yang spasinya dobel. "Batas kata" = apa pun yang bukan
    // huruf/angka/underscore — tanda baca ("beli?", "beli!") dianggap batas,
    // sedangkan huruf yang menempel ("belian", "membeli") TIDAK cocok.
    const normalizedMsg = lowerMessage.trim().replace(/\s+/g, ' ');
    const normalizedTrig = lowerTrig.trim().replace(/\s+/g, ' ');
    const re = new RegExp(
        `(^|[^\\p{L}\\p{N}_])${escapeRegExp(normalizedTrig)}([^\\p{L}\\p{N}_]|$)`,
        'u'
    );
    return re.test(normalizedMsg);
}

// v3.9.26: read-through cache (pola panelManager). findMatch dibaca di
// messageCreate PER PESAN — sebelumnya 1 readFileSync sync per pesan walau
// tidak ada responder sama sekali. Cache 15s TTL + update-on-save.
const CACHE_TTL_MS = 15 * 1000;
let _cache = null; // { data, at }

function load() {
    try {
        if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.data;
        if (!fs.existsSync(filePath)) {
            _cache = { data: {}, at: Date.now() };
            return _cache.data;
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        _cache = { data, at: Date.now() };
        return data;
    } catch (_err) {
        // v3.9.26: karantina file korup SEBELUM fallback (lihat safeWrite.js).
        quarantineCorruptFile(filePath);
        _cache = { data: {}, at: Date.now() };
        return _cache.data;
    }
}

function save(data) {
    safeWriteJSON(filePath, data);
    // v3.9.26: update cache supaya read berikutnya konsisten dengan yang baru di-write
    _cache = { data, at: Date.now() };
}

/** v3.9.26: paksa read fresh berikutnya (restore backup / test). */
function invalidateCache() {
    _cache = null;
}

function genId() {
    return `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getGuildResponders(guildId) {
    const all = load();
    return all[guildId] || [];
}

function addResponder(guildId, data) {
    const all = load();
    if (!all[guildId]) all[guildId] = [];

    // Validate trigger: tidak boleh kosong, maks 50 char, tidak duplicate
    const trigger = data.trigger.trim();
    if (!trigger || trigger.length > 50) {
        return { ok: false, error: 'Trigger tidak valid (1-50 char).' };
    }
    if (all[guildId].some(r => r.trigger.toLowerCase() === trigger.toLowerCase())) {
        return { ok: false, error: `Trigger "${trigger}" sudah ada. Pakai /remove-responder dulu.` };
    }

    // Max 50 responders per guild
    if (all[guildId].length >= 50) {
        return { ok: false, error: 'Maksimal 50 responder per guild.' };
    }

    const entry = {
        id: genId(),
        trigger,
        // v3.9.47: mode pencocokan — 'contains' (default: kata utuh di mana saja
        // dalam pesan) atau 'exact' (pesan harus diawali trigger). Dinormalisasi
        // eksplisit: apa pun yang bukan 'exact' disimpan sebagai 'contains'.
        matchMode: data.matchMode === 'exact' ? 'exact' : 'contains',
        reply: data.reply,
        replyType: data.replyType === 'embed' ? 'embed' : 'text',
        createdBy: data.createdBy,
        createdByTag: data.createdByTag,
        createdAt: Date.now(),
        useCount: 0,
        lastUsedAt: null,
        // v3.9.38 FIX: cooldownMs 0 = cooldown MATI (sesuai dok registry). `||`
        // menelan 0 → diam-diam jadi 3000; nullish coalescing menjaga 0 tetap 0.
        cooldownMs: data.cooldownMs ?? 3000,
        lastFiredAt: null, // legacy — gak dipake lagi, disimpen untuk backward compat
        userCooldowns: {} // map cooldown per-user
    };
    all[guildId].push(entry);
    save(all);
    return { ok: true, responder: entry };
}

function removeResponder(guildId, trigger) {
    const all = load();
    if (!all[guildId]) return { ok: false, error: 'Trigger tidak ditemukan.' };

    const before = all[guildId].length;
    all[guildId] = all[guildId].filter(r => r.trigger.toLowerCase() !== trigger.toLowerCase());
    if (all[guildId].length === before) {
        return { ok: false, error: `Trigger "${trigger}" tidak ditemukan.` };
    }
    save(all);
    return { ok: true };
}

/**
 * Cari responder yang cocok dengan sebuah pesan.
 * v3.9.47: pencocokan menghormati matchMode tiap responder —
 *   - 'exact'    : pesan diawali trigger (perilaku lama)
 *   - 'contains' : trigger muncul sebagai kata utuh di mana saja dalam pesan
 *     (default, termasuk entri lama yang tersimpan sebelum v3.9.47)
 *
 * Cooldown per-user: user A yang baru trigger gak bakal ngelarang user B dapet reply.
 * v3.9.47: responder yang sedang cooldown tidak lagi membatalkan seluruh
 * scan (dulu `return null`) — loop LANJUT supaya trigger kedua yang overlap
 * (mis. "beli" + "cara beli") tetap bisa membalas.
 *
 * @param {string} guildId
 * @param {string} messageContent
 * @param {string} [userId]  kirim userId biar cooldown per-user (recommended)
 * @returns {Object|null} responder entry, atau null kalau gak match / lagi cooldown
 */
function findMatch(guildId, messageContent, userId) {
    const responders = getGuildResponders(guildId);
    if (responders.length === 0) return null;

    const lower = String(messageContent || '').toLowerCase();
    const now = Date.now();

    for (const r of responders) {
        const trig = r.trigger.toLowerCase();
        if (!messageMatchesTrigger(lower, trig, r.matchMode)) continue;

        // Cek cooldown per-user. cooldownMs = 0 artinya cooldown dimatikan.
        // v3.9.38 FIX: `??` (bukan `||`) supaya 0 tetap 0 — sebelumnya
        // 0 diam-diam jadi 3000, opsi "matiin cooldown" gak pernah bisa.
        const cooldownMs = r.cooldownMs ?? 3000;
        if (cooldownMs > 0) {
            const lastFired = userId
                ? r.userCooldowns?.[userId]
                : r.lastFiredAt; // fallback: cooldown global lama kalau caller gak kirim userId
            if (lastFired && now - lastFired < cooldownMs) {
                continue; // user ini masih cooldown — coba responder berikutnya
            }
        }
        return r;
    }
    return null;
}

/**
 * Tandai responder sudah dipakai (update useCount + catat timestamp cooldown).
 * Kirim userId biar cooldown-nya per-user.
 */
function markUsed(guildId, responderId, userId) {
    const all = load();
    if (!all[guildId]) return;
    const r = all[guildId].find(x => x.id === responderId);
    if (!r) return;
    r.useCount = (r.useCount || 0) + 1;
    r.lastUsedAt = Date.now();
    r.lastFiredAt = Date.now(); // legacy — tetap diisi untuk jaga-jaga
    // Catat cooldown per-user
    if (userId) {
        if (!r.userCooldowns || typeof r.userCooldowns !== 'object') r.userCooldowns = {};
        r.userCooldowns[userId] = Date.now();
        // Cleanup: simpan maksimal 100 user terakhir biar file gak bengkak
        const entries = Object.entries(r.userCooldowns);
        if (entries.length > 100) {
            entries.sort((a, b) => b[1] - a[1]);
            r.userCooldowns = Object.fromEntries(entries.slice(0, 100));
        }
    }
    save(all);
}

module.exports = {
    getGuildResponders,
    addResponder,
    removeResponder,
    findMatch,
    markUsed,
    invalidateCache,
    // v3.9.47: matcher murni diekspor untuk unit test
    messageMatchesTrigger
};
