// Konfigurasi runtime Thor Dashboard — semua nilai sensitif dari env.
// Prioritas: process.env (produksi/hosting) -> SANDBOX_DEFAULTS (fallback
// multi-instance sandbox, lihat thor-credentials.ts untuk alasannya).

import { SANDBOX_DEFAULTS } from "./thor-credentials";

function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  // string kosong dianggap "tidak diset" supaya fallback tetap dipakai
  return v && v.trim() !== "" ? v : fallback;
}

export const cfg = {
  // Discord OAuth2 (Developer Portal -> aplikasi bot -> OAuth2)
  discordClientId: envOr("DISCORD_CLIENT_ID", SANDBOX_DEFAULTS.DISCORD_CLIENT_ID),
  discordClientSecret: envOr("DISCORD_CLIENT_SECRET", SANDBOX_DEFAULTS.DISCORD_CLIENT_SECRET),

  // Kunci penanda tangan cookie sesi (ganti di produksi!)
  sessionSecret: envOr("SESSION_SECRET", SANDBOX_DEFAULTS.SESSION_SECRET),

  // Discord ID (dipisah koma) yang otomatis menjadi admin dashboard
  adminDiscordIds: envOr("ADMIN_DISCORD_IDS", SANDBOX_DEFAULTS.ADMIN_DISCORD_IDS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Link invite bot (default: Thor milik pemilik, permission least-privilege)
  inviteUrl:
    process.env.NEXT_PUBLIC_INVITE_URL ??
    "https://discord.com/oauth2/authorize?client_id=1548297613969985546&permissions=1099800112150&integration_type=0&scope=bot+applications.commands",

  // v3.16.0: DASH API — server HTTP kecil di proses bot (ala Dyno dashboard).
  // Semua baca/tulis config server dialihkan ke sini; token harus SAMA dengan
  // DASH_API_TOKEN di .env bot Thor.
  dashApiUrl: envOr("DASH_API_URL", SANDBOX_DEFAULTS.DASH_API_URL).replace(/\/$/, ""),
  dashApiToken: envOr("DASH_API_TOKEN", SANDBOX_DEFAULTS.DASH_API_TOKEN),
};

// OAuth Discord hanya aktif kalau kredensial terisi
export function isDiscordOAuthReady(): boolean {
  return Boolean(cfg.discordClientId && cfg.discordClientSecret);
}

// Mode demo aktif otomatis saat OAuth belum dikonfigurasi (agar dashboard
// tetap bisa dijelajahi sebelum kredensial Discord diisi)
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true" || !isDiscordOAuthReady();
}
