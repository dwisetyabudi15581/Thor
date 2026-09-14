// Verifikasi akses guild untuk semua route /api/guilds/**.
//
// Aturan (standar ala Dyno): user hanya boleh mengelola server di mana dia
// owner ATAU punya permission MANAGE_GUILD di Discord — diverifikasi LIVE
// dari Discord API via token OAuth user, bukan sekadar klaim dari request.
//
// Cache in-memory 60 detik per user supaya form save yang rapid-fire tidak
// memukul Discord API berkali-kali (rate limit 50 guild-list/sek global).

import { getManageableGuilds } from "./discord-guilds";

type CacheEntry = { ids: Set<string>; ts: number };

const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export type GuildAccess =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 503; error: string; relogin?: boolean };

export async function checkGuildAccess(userId: string, guildId: string): Promise<GuildAccess> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && now - hit.ts < TTL_MS) {
    return hit.ids.has(guildId)
      ? { ok: true }
      : { ok: false, status: 403, error: "Kamu tidak punya izin mengelola server ini." };
  }

  const result = await getManageableGuilds(userId);
  if (!result.ok) {
    if (result.reason === "no-token") {
      return {
        ok: false,
        status: 401,
        error: "Sesi login belum punya akses daftar server — silakan login ulang.",
        relogin: true,
      };
    }
    if (result.reason === "relogin") {
      return { ok: false, status: 401, error: "Login Discord kedaluwarsa — silakan login ulang.", relogin: true };
    }
    return { ok: false, status: 503, error: "Discord sedang tidak merespons — coba lagi sebentar." };
  }

  const ids = new Set(result.guilds.map((g) => g.id));
  cache.set(userId, { ids, ts: now });
  return ids.has(guildId)
    ? { ok: true }
    : { ok: false, status: 403, error: "Kamu tidak punya izin mengelola server ini." };
}

/** Bersihkan cache guild user (dipakai kalau user men-switch akun). */
export function invalidateGuildAccessCache(userId: string): void {
  cache.delete(userId);
}
