// GET /api/auth/discord/callback — tukar code jadi token, ambil profil,
// upsert user, lalu pasang cookie sesi dan kembali ke halaman utama.

import { db } from "@/lib/db";
import { cfg, isDiscordOAuthReady } from "@/lib/config";
import { appOrigin } from "@/lib/origin";
import { createSessionToken, sessionCookie } from "@/lib/session";

function redirectUri(req: Request): string {
  return `${appOrigin(req)}/api/auth/discord/callback`;
}

function fail(req: Request, reason: string): Response {
  return Response.redirect(new URL(`/?error=${reason}`, appOrigin(req)), 302);
}

function readStateCookie(req: Request): string | null {
  const raw = req.headers.get("cookie") ?? "";
  const match = raw
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("thor_oauth_state="));
  return match ? match.slice("thor_oauth_state=".length) : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!isDiscordOAuthReady()) {
    return fail(req, "oauth_belum_disiapkan");
  }
  if (!code) {
    return fail(req, "login_dibatalkan");
  }

  // Validasi state CSRF
  const expected = readStateCookie(req);
  if (!state || !expected || state !== expected) {
    return fail(req, "sesi_kedaluwarsa");
  }

  // Tukar code -> access token
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.discordClientId,
      client_secret: cfg.discordClientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(req),
    }),
  });
  if (!tokenRes.ok) {
    return fail(req, "login_gagal");
  }
  const token = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number; // detik
  };
  if (!token.access_token) {
    return fail(req, "login_gagal");
  }

  // Ambil profil Discord
  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!meRes.ok) {
    return fail(req, "profil_tidak_terbaca");
  }
  const profile = (await meRes.json()) as {
    id: string;
    username: string;
    global_name?: string;
    avatar?: string;
  };

  // Daftar ADMIN_DISCORD_IDS di env adalah sumber kebenaran: login ulang
  // menyegarkan status admin (dihapus dari env = turun otomatis saat login)
  const isAdmin = cfg.adminDiscordIds.includes(profile.id);
  // v2: simpan token OAuth user (scope identify+guilds) untuk halaman
  // "Pilih Server" — daftar guild diambil live dari Discord, bukan disalin.
  const tokenExpiresAt = new Date(Date.now() + (token.expires_in ?? 604800) * 1000);
  const user = await db.user.upsert({
    where: { discordId: profile.id },
    create: {
      discordId: profile.id,
      username: profile.username,
      globalName: profile.global_name ?? null,
      avatar: profile.avatar ?? null,
      isAdmin,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      tokenExpiresAt,
    },
    update: {
      username: profile.username,
      globalName: profile.global_name ?? null,
      avatar: profile.avatar ?? null,
      isAdmin,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      tokenExpiresAt,
    },
  });

  // Token ber-profil: sesi tetap valid lintas instance sandbox (lihat
  // session.ts) — callback bisa diselesaikan instance mana pun
  const cookie = sessionCookie(createSessionToken(user));
  const res = new Response(null, { status: 302, headers: { Location: "/" } });
  res.headers.append(
    "set-cookie",
    `${cookie.name}=${cookie.value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cookie.maxAge}${
      cookie.secure ? "; Secure" : ""
    }`
  );
  // Bersihkan cookie state
  res.headers.append("set-cookie", "thor_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  return res;
}
