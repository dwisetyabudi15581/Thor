// Daftar guild user via Discord OAuth (scope `guilds`) — untuk halaman
// "Pilih Server" ala Dyno. Guild diambil LIVE dari Discord (bukan disalin ke
// DB) supaya server yang baru dibuat/ditinggalkan user langsung akurat.
//
// Alur:
//   1. GET /users/@me/guilds dengan access token user (disimpan saat login).
//   2. Token kadaluarsa → refresh otomatis sekali (grant refresh_token).
//   3. Filter guild yang bisa dikelola: owner ATAU punya permission
//      MANAGE_GUILD (0x20) — standar yang sama dipakai Dyno/dashboard bot lain.
//   4. Interseksi dengan daftar guild milik bot (DASH API) → tandai mana yang
//      sudah ada bot-nya (bisa langsung kelola) vs belum (tombol invite).

import { db } from "./db";
import { cfg } from "./config";

const MANAGE_GUILD = 0x20;

export type UserGuild = {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  manageable: boolean; // owner || MANAGE_GUILD
};

type DiscordGuildEntry = {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string; // bitfield string
};

type TokenRow = { id: string; accessToken: string | null; refreshToken: string | null; tokenExpiresAt: Date | null };

async function fetchUserGuilds(accessToken: string): Promise<DiscordGuildEntry[]> {
  const res = await fetch("https://discord.com/api/users/@me/guilds", {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw Object.assign(new Error(`discord_guilds_${res.status}`), { status: res.status });
  }
  return (await res.json()) as DiscordGuildEntry[];
}

/** Refresh access token via refresh_token grant; update DB. Return token baru. */
async function refreshAccessToken(userId: string, refreshToken: string): Promise<string> {
  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.discordClientId,
      client_secret: cfg.discordClientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`discord_refresh_${res.status}`), { status: res.status });
  }
  const tok = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!tok.access_token) throw new Error("discord_refresh_kosong");
  await db.user.update({
    where: { id: userId },
    data: {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? refreshToken,
      tokenExpiresAt: new Date(Date.now() + (tok.expires_in ?? 604800) * 1000),
    },
  });
  return tok.access_token;
}

export type GuildListResult =
  | { ok: true; guilds: UserGuild[] }
  | { ok: false; reason: "no-token" | "relogin" | "discord-error" };

/**
 * Ambil guild yang bisa dikelola user. Kalau access token user belum ada
 * (login era lama tanpa scope guilds) → reason "no-token" (UI minta re-login).
 * Kalau refresh gagal (token dicabut) → "relogin".
 */
export async function getManageableGuilds(userId: string): Promise<GuildListResult> {
  const row: TokenRow | null = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, accessToken: true, refreshToken: true, tokenExpiresAt: true },
  });
  if (!row?.accessToken) return { ok: false, reason: "no-token" };

  const expired = row.tokenExpiresAt ? row.tokenExpiresAt.getTime() < Date.now() + 30_000 : false;

  let entries: DiscordGuildEntry[];
  try {
    if (!expired) {
      entries = await fetchUserGuilds(row.accessToken);
    } else {
      // Access token kedaluwarsa → refresh dulu (sekali).
      if (!row.refreshToken) return { ok: false, reason: "relogin" };
      const fresh = await refreshAccessToken(userId, row.refreshToken);
      entries = await fetchUserGuilds(fresh);
    }
  } catch (err) {
    const status = (err as { status?: number }).status;
    // 401 = access token hangus sebelum expiry-nya → coba refresh sekali lagi.
    if (status === 401 && row.refreshToken) {
      try {
        const fresh = await refreshAccessToken(userId, row.refreshToken);
        entries = await fetchUserGuilds(fresh);
      } catch {
        return { ok: false, reason: "relogin" };
      }
    } else if (status === 403) {
      // Scope guilds belum di-grant (sesi lama) → user harus login ulang.
      return { ok: false, reason: "relogin" };
    } else {
      return { ok: false, reason: "discord-error" };
    }
  }

  const guilds: UserGuild[] = entries
    .map((g) => {
      const perms = BigInt(g.permissions || "0");
      const manageable = g.owner || (perms & BigInt(MANAGE_GUILD)) !== BigInt(0);
      return { id: g.id, name: g.name, icon: g.icon, owner: g.owner, manageable };
    })
    .filter((g) => g.manageable)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { ok: true, guilds };
}

/** Ikon guild dari CDN Discord (fallback huruf awal di UI). */
export function guildIconUrl(guildId: string, icon: string | null, size = 64): string | null {
  if (!icon) return null;
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=${size}`;
}
