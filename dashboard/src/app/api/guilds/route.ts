// GET /api/guilds — daftar server yang bisa dikelola user (ala Dyno).
//
// Menggabungkan TIGA sumber:
//   1. Discord API (token user) — guild + permission ManageGuild/owner.
//   2. DASH API bot — guild tempat bot sudah ada (untuk badge + tombol
//      "Kelola" vs "Invite").
//   3. Health bot — banner status koneksi.
//
// Respons: { botOnline, botVersion?, guilds: [{id,name,icon,owner,botIn}],
//            inviteUrl, guildsError?: "no-token" | "relogin" | "discord-error" }

import { currentUser, json, jsonError } from "@/lib/api-auth";
import { cfg } from "@/lib/config";
import { botApi, BotOfflineError, type BotGuild } from "@/lib/bot-api";
import { getManageableGuilds } from "@/lib/discord-guilds";

/**
 * Demo adoption (sandbox): kalau yang jalan di DASH_API_URL adalah MOCK
 * (scripts/mock-dash-api.mjs), daftarkan guild user supaya server aslinya
 * bisa dipratinjau di dashboard. Bot ASLI tidak punya endpoint /__demo/adopt
 * → 404 → diam-diam diabaikan (self-detecting, aman untuk produksi).
 */
async function tryDemoAdopt(guilds: Array<{ id: string; name: string; icon: string | null }>): Promise<void> {
  if (guilds.length === 0) return;
  try {
    await botApi("/__demo/adopt", {
      method: "POST",
      body: { guilds },
      timeoutMs: 2500,
    });
  } catch {
    // Bot asli / offline — abaikan (bukan error).
  }
}

export async function GET(req: Request) {
  const user = await currentUser(req);
  if (!user) return jsonError("Belum login.", 401);

  // Bot health + daftar guild bot (paralel, toleran offline).
  let botOnline = false;
  let botVersion: string | undefined;
  let botGuildIds = new Set<string>();
  try {
    const [health, guildsRes] = await Promise.all([
      botApi<{ ok: boolean; version: string }>("/health", { timeoutMs: 4000 }),
      botApi<{ guilds: BotGuild[] }>("/guilds", { timeoutMs: 4000 }),
    ]);
    botOnline = Boolean(health?.ok);
    botVersion = health?.version;
    if (Array.isArray(guildsRes?.guilds)) {
      botGuildIds = new Set(guildsRes.guilds.map((g) => g.id));
    }
  } catch (err) {
    if (!(err instanceof BotOfflineError)) {
      console.error("[api/guilds] DASH API error:", err instanceof Error ? err.message : err);
    }
  }

  const result = await getManageableGuilds(user.id);

  // Sandbox demo: kalau target DASH API adalah mock, adopt guild user
  // supaya pratinjau realistis (bot asli → 404 → no-op).
  if (botOnline && botVersion?.startsWith("mock") && result.ok) {
    await tryDemoAdopt(result.guilds);
    // Ambil ulang daftar guild mock yang kini memuat guild user.
    try {
      const guildsRes = await botApi<{ guilds: BotGuild[] }>("/guilds", { timeoutMs: 4000 });
      if (Array.isArray(guildsRes?.guilds)) {
        botGuildIds = new Set(guildsRes.guilds.map((g) => g.id));
      }
    } catch { /* keep */ }
  }
  if (!result.ok) {
    // Tetap kirim info bot supaya UI bisa menampilkan banner status,
    // tapi guilds kosong + flag error (UI minta re-login bila perlu).
    return json({
      botOnline,
      botVersion,
      guilds: [],
      inviteUrl: cfg.inviteUrl,
      guildsError: result.reason,
    });
  }

  const guilds = result.guilds.map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.icon,
    owner: g.owner,
    botIn: botGuildIds.has(g.id),
  }));

  return json({ botOnline, botVersion, guilds, inviteUrl: cfg.inviteUrl });
}
