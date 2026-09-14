// GET /api/me — identitas user aktif + info publik konfigurasi.
// Dipakai halaman utama untuk memutuskan tampilan landing vs dashboard.

import { db } from "@/lib/db";
import { currentUser, json } from "@/lib/api-auth";
import { isDiscordOAuthReady, isDemoMode, cfg } from "@/lib/config";
import { appOrigin } from "@/lib/origin";
import os from "os";

export async function GET(req: Request) {
  // Log domain akses (diagnosis OAuth redirect + onboarding)
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host && host !== "localhost:3000") console.log(`[host] ${host}`);

  const user = await currentUser(req);

  // Diagnostik instance (hanya mode development / sandbox — otomatis hilang
  // di build produksi). Dipakai untuk memetakan instance mana yang sedang
  // melayani jalur preview multi-instance.
  const diag =
    process.env.NODE_ENV === "development"
      ? {
          host: os.hostname(),
          users: await db.user.count(),
          uptimeMin: Math.round(process.uptime() / 60),
        }
      : undefined;

  const config = {
    authReady: isDiscordOAuthReady(),
    demoMode: isDemoMode(),
    inviteUrl: cfg.inviteUrl,
    // Stempel waktu server (diagnosis cache): jika jam di sini lebih tua dari
    // waktu browser membuka halaman, berarti ada lapisan cache basi di jalur.
    serverTime: new Date().toISOString(),
    // URI redirect OAuth yang BENAR-BENAR dipakai server (terkunci ke
    // PUBLIC_ORIGIN) — ditampilkan di kotak "Pemilik bot" supaya yang
    // didaftarkan user di portal Discord selalu persis sama dengan yang
    // dikirim saat login.
    oauthRedirectUri: `${appOrigin(req)}/api/auth/discord/callback`,
  };

  if (!user) return json({ user: null, config, diag });

  return json({
    user: {
      id: user.id,
      discordId: user.discordId,
      username: user.username,
      globalName: user.globalName,
      avatar: user.avatar,
      isAdmin: user.isAdmin,
    },
    config,
    diag,
  });
}
