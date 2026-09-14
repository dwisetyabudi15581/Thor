#!/usr/bin/env node
/**
 * Dev/Sandbox helper — pratinjau dashboard penuh TANPA Discord OAuth asli.
 *
 * Dua mode pemakaian (bisa digabung):
 *
 * 1) Interceptor Discord (via --require — HANYA jalan kalau dimuat eksplisit):
 *      NODE_OPTIONS="--require ./scripts/dev-sandbox.cjs" npm run dev
 *    Mematikan fetch ke https://discord.com/api/users/@me/guilds dan
 *    mengembalikan 1 guild sandbox (owner) — supaya halaman /app bisa
 *    membuka guild dashboard. TANPA dimuat via --require, file ini TIDAK
 *    melakukan apa pun (aman tersimpan di repo).
 *
 * 2) Seeder user demo (dijalankan langsung):
 *      node scripts/dev-sandbox.cjs seed
 *    Memberi user demo-admin accessToken sandbox (belum kadaluarsa) supaya
 *    jalur getManageableGuilds → checkGuildAccess lolos dengan interceptor.
 *
 * Kombinasi lengkap untuk pratinjau sandbox:
 *   node scripts/mock-dash-api.mjs                                # terminal 1
 *   node scripts/dev-sandbox.cjs seed                             # sekali saja
 *   NODE_OPTIONS="--require ./scripts/dev-sandbox.cjs" npm run dev # terminal 2
 *
 * Produksi: TIDAK dipakai — tidak ada env yang menyalakan interceptor
 * secara diam-diam; harus --require eksplisit dari developer.
 */

// === Mode 1: interceptor (aktif hanya saat dimuat via --require) ===
if (process.env.NODE_OPTIONS && process.env.NODE_OPTIONS.includes("dev-sandbox")) {
  // Env sandbox — diset dari dalam --require karena beberapa supervisor
  // sandbox membersihkan env proses background (terbukti: NODE_OPTIONS
  // terkonsumsi node saat start, tapi process.env route handler kosong).
  // File ini hanya aktif via --require EKSPLISIT — aman untuk produksi.
  const SANDBOX_ENV = {
    DATABASE_URL: "file:/home/z/my-project/Thor/dashboard/db/custom.db",
    SESSION_SECRET: "sandbox-dev-secret-thor-0123456789abcdef",
    DEMO_MODE: "true",
    DASH_API_URL: "http://127.0.0.1:8788",
    DASH_API_TOKEN: "dash-dev-token-thor-local-8788",
  };
  for (const [k, v] of Object.entries(SANDBOX_ENV)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const ORIG_FETCH = globalThis.fetch;
  const SANDBOX_GUILD = {
    id: "111222333444555666",
    name: "Sandbox Preview Server",
    icon: null,
    owner: true,
    permissions: "2147483647", // semua permission termasuk MANAGE_GUILD
  };
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (url === "https://discord.com/api/users/@me/guilds") {
      console.log("[dev-sandbox] intercept GET /users/@me/guilds → 1 guild sandbox");
      return new Response(JSON.stringify([SANDBOX_GUILD]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return ORIG_FETCH(input, init);
  };
  console.log("[dev-sandbox] interceptor Discord API aktif (sandbox only)");
}

// === Mode 2: seeder user demo ===
if (process.argv[2] === "seed") {
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient();
  const user = db.user.upsert({
    where: { discordId: "demo-admin" },
    create: {
      discordId: "demo-admin",
      username: "Demo Admin",
      isAdmin: true,
      accessToken: "sandbox-demo-token",
      refreshToken: null,
      tokenExpiresAt: new Date(Date.now() + 24 * 3600_000),
    },
    update: {
      accessToken: "sandbox-demo-token",
      tokenExpiresAt: new Date(Date.now() + 24 * 3600_000),
    },
  });
  user
    .then((u) => {
      console.log(`✓ user demo-admin siap (id ${u.id}, token sandbox aktif 24 jam)`);
      return db.$disconnect();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("seed gagal:", err.message);
      process.exit(1);
    });
}
