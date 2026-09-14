// GET /api/guilds/[guildId]/dashboard — payload lengkap semua modul untuk
// dashboard server (config, automod, responders, selfroles, tempvoice,
// announces, serverstats) + meta guild (channels/roles untuk picker).
//
// Akses: user HARUS owner / ManageGuild di server itu (verifikasi live ke
// Discord, lihat lib/guild-access.ts).

import { currentUser, json, jsonError } from "@/lib/api-auth";
import { botApi, BotOfflineError } from "@/lib/bot-api";
import { checkGuildAccess } from "@/lib/guild-access";
import type { DashboardPayload, GuildMeta } from "@/lib/bot-api";

export async function GET(req: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const user = await currentUser(req);
  if (!user) return jsonError("Belum login.", 401);

  const { guildId } = await params;
  if (!/^\d{5,25}$/.test(guildId)) return jsonError("ID server tidak valid.", 400);

  const access = await checkGuildAccess(user.id, guildId);
  if (!access.ok) {
    return jsonError(access.error, access.status);
  }

  try {
    const [payload, meta] = await Promise.all([
      botApi<DashboardPayload>(`/guilds/${guildId}/dashboard`),
      botApi<GuildMeta>(`/guilds/${guildId}/meta`),
    ]);
    return json({ ...payload, meta, botOnline: true });
  } catch (err) {
    if (err instanceof BotOfflineError) {
      return jsonError("Bot sedang tidak terhubung — cek status bot lalu coba lagi.", 503);
    }
    const message = err instanceof Error ? err.message : "Kesalahan tak dikenal";
    return jsonError(message, 502);
  }
}
