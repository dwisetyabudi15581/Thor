// Proxy tulis /api/guilds/[guildId]/[...action] — satu pintu untuk SEMUA
// operasi tulis dashboard ke DASH API bot (v3.16.0).
//
// Peta route → DASH API (bot):
//   PUT    config                                → PUT  /guilds/:id/config
//   PUT    automod                               → PUT  /guilds/:id/automod
//   POST   responders                            → POST /guilds/:id/responders
//   DELETE responders?trigger=...                → DELETE /guilds/:id/responders?trigger=...
//   POST   announce                              → POST /guilds/:id/announce
//   DELETE announce/:annId                       → DELETE /guilds/:id/announce/:annId
//   POST   selfroles                             → POST /guilds/:id/selfroles
//   POST   selfroles/:panelId/roles              → POST /guilds/:id/selfroles/:panelId/roles
//   DELETE selfroles/:panelId/roles?roleId=...   → DELETE .../roles?roleId=...
//   DELETE selfroles/:panelId                    → DELETE /guilds/:id/selfroles/:panelId
//   POST   serverstats/refresh                   → POST /guilds/:id/serverstats/refresh
//   DELETE tempvoice                             → DELETE /guilds/:id/tempvoice
//
// Keamanan:
//   1. Login sesi (currentUser) + verifikasi ManageGuild/owner LIVE ke
//      Discord (guild-access) — user tidak bisa menulis ke server lain.
//   2. Body dibaca, disuntik `actor: { id, tag }` user login (audit bot),
//      lalu diteruskan ke DASH API di localhost dengan token rahasia.
//   3. Bot memvalidasi ulang SEMUA field (whitelist section + tipe) —
//      web tidak pernah dipercaya soal bentuk data.

import { currentUser, json, jsonError } from "@/lib/api-auth";
import { botApi, BotOfflineError, BotApiError } from "@/lib/bot-api";
import { checkGuildAccess } from "@/lib/guild-access";

type Ctx = { params: Promise<{ guildId: string; action: string[] }> };

async function handle(req: Request, ctx: Ctx, method: "POST" | "PUT" | "DELETE") {
  const user = await currentUser(req);
  if (!user) return jsonError("Belum login.", 401);

  const { guildId, action } = await ctx.params;
  if (!/^\d{5,25}$/.test(guildId)) return jsonError("ID server tidak valid.", 400);
  const actionPath = action.join("/");
  if (!/^[a-zA-Z0-9_\/-]{1,80}$/.test(actionPath)) return jsonError("Aksi tidak valid.", 400);

  const access = await checkGuildAccess(user.id, guildId);
  if (!access.ok) return jsonError(access.error, access.status);

  // Baca body JSON (kalau ada) + suntik actor.
  let body: Record<string, unknown> = {};
  if (method !== "DELETE" && req.headers.get("content-type")?.includes("application/json")) {
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonError("Body bukan JSON valid.", 400);
    }
  }

  const url = new URL(req.url);
  const target = `/guilds/${guildId}/${actionPath}${url.search}`;

  try {
    const data = await botApi(target, {
      method,
      body: method === "DELETE" ? undefined : { ...body, actor: { id: user.discordId, tag: user.username } },
    });
    return json(data);
  } catch (err) {
    if (err instanceof BotOfflineError) {
      return jsonError("Bot sedang tidak terhubung — perubahan belum tersimpan.", 503);
    }
    if (err instanceof BotApiError) {
      return json({ error: err.message, details: err.details }, err.status >= 400 && err.status < 600 ? err.status : 502);
    }
    return jsonError("Kesalahan tak dikenal saat menghubungi bot.", 502);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  return handle(req, ctx, "POST");
}

export async function PUT(req: Request, ctx: Ctx) {
  return handle(req, ctx, "PUT");
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handle(req, ctx, "DELETE");
}
