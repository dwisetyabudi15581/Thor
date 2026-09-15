/**
 * Role Engine — SATU gerbang untuk semua grant/revoke role di Thor.
 *
 * v3.22.0: sebelumnya 13+ call site melakukan `member.roles.add/remove`
 * mentah masing-masing dengan try/catch dan pesan errornya sendiri (tombol
 * verify, panel self-role, auto-role saat join, role booster, key VIP,
 * pengiriman produk, leveling, scheduler role temporer, DASH API…).
 * Engine memusatkan yang mereka duplikasi semua:
 *
 *   - resolve role (skip dengan anggun saat cache guild tidak tersedia)
 *   - tolak @everyone, role integration-managed, dan role yang posisinya
 *     di atas role tertinggi bot (laporan support "silent failure" #1)
 *   - skip role yang sudah dimiliki / tidak dimiliki (idempotent)
 *   - log SATU baris konsol yang bisa ditindaklanjuti per kegagalan
 *
 * Caller tetap memakai pesan user-facing-nya sendiri — engine hanya
 * mengembalikan hasil terstruktur:
 *
 *   grantRoles(member, ['id1','id2'], { reason }) →
 *     { ok: boolean, granted: Role[]|string[], skipped: [...], failed: [...] }
 *
 * `ok` true saat TIDAK ADA yang gagal (skip bukan kegagalan). Test-friendly:
 * saat `member.guild.roles.cache` tidak ada (fake unit-test), cek objek role
 * dilewati dan id mentah diteruskan ke discord.js.
 */

// ---------- helper internal ----------

/** Resolve objek role dari cache guild — null saat tidak tersedia. */
function resolveRole(member, roleId) {
    try {
        return member?.guild?.roles?.cache?.get(roleId) || null;
    } catch (_) {
        return null;
    }
}

/**
 * Posisi role tertinggi bot di guild — null saat TIDAK DIKETAHUI
 * (members.me belum ter-cache / state partial). Cek hierarki hanya
 * ditegakkan saat posisi benar-benar diketahui — null harus fallback ke
 * "biarkan API Discord yang memutuskan" (perilaku pra-engine), kalau tidak
 * semua grant akan ditolak begitu bot baru menyala saat cache member
 * masih menghangat.
 */
function botHighestPosition(member) {
    try {
        const pos = member?.guild?.members?.me?.roles?.highest?.position;
        return typeof pos === 'number' ? pos : null;
    } catch (_) {
        return null;
    }
}

/** Validasi standar per role, dipakai grant & revoke. */
function validateRole(member, roleId, role) {
    if (role && role.id === member.guild.id) return '@everyone tidak bisa dipakai.';
    if (role && role.managed) return `"${role.name}" dikelola integration/bot lain — bot tidak bisa memberikannya.`;
    // Hierarki: hanya dicek saat posisi bot DIKETAHUI (lihat
    // botHighestPosition) — tidak diketahui → biarkan API Discord memutuskan.
    const botPos = botHighestPosition(member);
    if (role && botPos !== null && (role.position ?? 0) >= botPos) {
        return `"${role.name}" posisinya DI ATAS role tertinggi bot — naikkan role bot dulu.`;
    }
    return null; // valid
}

/**
 * Terapkan add/remove untuk daftar id role lewat SATU panggilan discord.js
 * per aksi. `mode` = 'add' | 'remove'. Tidak pernah throw — kegagalan masuk
 * ke `failed`.
 */
async function apply(member, roleIds, mode, options = {}) {
    const reason = options.reason ? String(options.reason).slice(0, 400) : undefined;
    const quiet = options.quiet === true;
    const result = { ok: true, granted: [], revoked: [], skipped: [], failed: [] };

    if (!member || !member.roles || typeof member.roles[mode] !== 'function') {
        result.ok = false;
        result.failed.push({ roleId: String(roleIds || ''), error: 'member object is not usable' });
        return result;
    }
    if (!Array.isArray(roleIds) || roleIds.length === 0) return result;

    // Dedupe while preserving order (a join list may repeat an id).
    const seen = new Set();
    const ids = roleIds.filter(id => {
        if (id == null || seen.has(id)) return false;
        seen.add(id);
        return true;
    });

    const toApply = [];
    for (const roleId of ids) {
        const role = resolveRole(member, roleId);

        // Idempotency: already-has (add) / doesn't-have (remove) → skip silently.
        try {
            const has = member.roles.cache?.has?.(roleId);
            if (has === true && mode === 'add') {
                result.skipped.push(roleId);
                continue;
            }
            if (has === false && mode === 'remove') {
                result.skipped.push(roleId);
                continue;
            }
        } catch (_) {
            /* cache unavailable → let discord.js decide */
        }

        const invalid = validateRole(member, roleId, role);
        if (invalid) {
            result.ok = false;
            result.failed.push({ roleId, error: invalid });
            continue;
        }
        toApply.push(roleId);
    }

    let appliedViaRetry = false;
    if (toApply.length > 0) {
        try {
            await member.roles[mode](toApply.length === 1 ? toApply[0] : toApply, reason ? { reason } : undefined);
        } catch (err) {
            // Satu role rusak dalam batch bisa menggagalkan seluruh panggilan
            // API — retry per-role supaya role yang bagus tetap masuk.
            if (toApply.length > 1) {
                appliedViaRetry = true;
                for (const roleId of toApply) {
                    try {
                        await member.roles[mode](roleId, reason ? { reason } : undefined);
                        if (mode === 'add') result.granted.push(roleId);
                        else result.revoked.push(roleId);
                    } catch (perErr) {
                        result.ok = false;
                        result.failed.push({ roleId, error: perErr.message });
                    }
                }
            } else {
                result.ok = false;
                result.failed.push({ roleId: toApply[0], error: err.message });
            }
        }
    }

    // Panggilan batch tunggal sukses → semua yang ada di toApply masuk.
    if (!appliedViaRetry) {
        if (mode === 'add') result.granted.push(...toApply);
        else result.revoked.push(...toApply);
    }

    if (!quiet && result.failed.length > 0) {
        console.error(
            `❌ [roleEngine] ${mode} failed for ${member.user?.tag ?? member.id ?? '?'}: ` +
                result.failed.map(f => `${f.roleId} (${f.error})`).join(', ')
        );
    }
    return result;
}

// ---------- API publik ----------

/** Berikan role ke member. Return { ok, granted, skipped, failed }. */
function grantRoles(member, roleIds, options = {}) {
    return apply(member, roleIds, 'add', options);
}

/** Cabut role dari member. Return { ok, revoked, skipped, failed }. */
function revokeRoles(member, roleIds, options = {}) {
    return apply(member, roleIds, 'remove', options);
}

/**
 * Daftar role saat join untuk config sebuah guild — isi `autorole.roleIds`
 * (daftar /set-autorole), dedupe, urutan terjaga. v3.23.0: konsep role
 * penanda Unverified DIHAPUS — daftar ini kini murni auto-role join, dan
 * aturan "role join hilang saat member dapat role lain" dikendalikan toggle
 * `autorole.removeOnNewRole` (guildMemberUpdate). Role yang sistem berikan
 * sendiri saat join tidak boleh dihitung sebagai "role lain" oleh aturan itu
 * — memberi @Member saat join tidak boleh langsung melepasnya sendiri.
 */
function joinRoleIds(config) {
    const ids = [];
    const autorole = Array.isArray(config?.autorole?.roleIds) ? config.autorole.roleIds.filter(Boolean) : [];
    for (const id of autorole) if (!ids.includes(id)) ids.push(id);
    return ids;
}

module.exports = { grantRoles, revokeRoles, joinRoleIds };
