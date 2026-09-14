// GET /api/auth/discord — redirect ke halaman otorisasi Discord OAuth2.
// State acak disimpan di cookie singkat untuk proteksi CSRF di callback.

import crypto from "crypto";
import { cfg } from "@/lib/config";
import { appOrigin } from "@/lib/origin";

function redirectUri(req: Request): string {
  return `${appOrigin(req)}/api/auth/discord/callback`;
}

export async function GET(req: Request) {
  const state = crypto.randomBytes(16).toString("hex");
  const uri = redirectUri(req);
  console.log(`[oauth] redirect_uri=${uri}`);
  const params = new URLSearchParams({
    client_id: cfg.discordClientId,
    redirect_uri: uri,
    response_type: "code",
    // v2: scope `guilds` — dashboard perlu daftar server user (ala Dyno)
    // untuk halaman "Pilih Server" + verifikasi permission ManageGuild.
    scope: "identify guilds",
    state,
  });
  const res = new Response(null, {
    status: 302,
    headers: { Location: `https://discord.com/oauth2/authorize?${params.toString()}` },
  });
  res.headers.append(
    "set-cookie",
    `thor_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`
  );
  return res;
}
