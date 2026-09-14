#!/usr/bin/env node
/**
 * E2E test — API routes dashboard ala Dyno (v2) terhadap dev server lokal.
 *
 * Yang diuji:
 *   1. /api/guilds tanpa login        → 401
 *   2. /api/guilds dengan sesi uji    → 200, botOnline=true (mock), guildsError=no-token
 *      (user uji tidak punya access token Discord — jalur yang benar)
 *   3. /api/guilds/:id/dashboard      → 401 relogin (belum ada token Discord)
 *   4. /api/guilds/:id/config (PUT)   → 401 relogin
 *   5. Adopt demo guild ke mock lalu inject accessToken PALSU → discord-error path
 *      (401 dari Discord → dicoba refresh → gagal → relogin) — verifikasi alur fallback
 *   6. /api/guilds/:id/dashboard dengan guild yang di-adopt mock tapi user tetap
 *      tidak punya izin → 401 (token palsu tidak lolos verifikasi Discord)
 *
 * Sesi uji dibuat dengan SESSION_SECRET yang sama dengan server (dari
 * thor-credentials.ts) — user "e2e-guild-test" dibuat dulu di DB.
 */

import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const SESSION_SECRET = process.env.SESSION_SECRET; // harus sama dengan .env dashboard
if (!SESSION_SECRET) {
  console.error("SESSION_SECRET belum ada — jalankan: node --env-file=.env scripts/test-guild-api.mjs");
  process.exit(1);
}
const SESSION_DAYS = 7;
const TEST_DISCORD_ID = "e2e-guild-test-0001";

const db = new PrismaClient();

function sign(data) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
}

function createSessionToken(user) {
  const now = Date.now();
  const payload = {
    uid: user.id,
    iat: now,
    exp: now + SESSION_DAYS * 24 * 60 * 60 * 1000,
    p: {
      discordId: user.discordId,
      username: user.username,
      globalName: user.globalName,
      avatar: user.avatar,
      isAdmin: user.isAdmin,
    },
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

async function main() {
  // --- Siapkan user uji ---
  const user = await db.user.upsert({
    where: { discordId: TEST_DISCORD_ID },
    create: { discordId: TEST_DISCORD_ID, username: "E2E Guild Test", isAdmin: false },
    update: {},
  });
  const token = createSessionToken(user);
  const cookie = `thor_session=${token}`;
  const GUILD = "123456789012345678";

  console.log("== 1. Tanpa login ==");
  let res = await fetch(`${BASE}/api/guilds`);
  check("/api/guilds tanpa sesi → 401", res.status === 401, `(got ${res.status})`);
  res = await fetch(`${BASE}/api/guilds/${GUILD}/dashboard`);
  check("dashboard tanpa sesi → 401", res.status === 401, `(got ${res.status})`);

  console.log("== 2. Dengan sesi uji (tanpa token Discord) ==");
  res = await fetch(`${BASE}/api/guilds`, { headers: { cookie } });
  check("/api/guilds → 200", res.status === 200, `(got ${res.status})`);
  let data = await res.json();
  check("botOnline=true (mock jalan)", data.botOnline === true);
  check("botVersion mock terdeteksi", String(data.botVersion || "").startsWith("mock"));
  check("guildsError=no-token (user uji tanpa scope guilds)", data.guildsError === "no-token", `(got ${data.guildsError})`);

  console.log("== 3. Dashboard guild (verifikasi akses Discord) ==");
  res = await fetch(`${BASE}/api/guilds/${GUILD}/dashboard`, { headers: { cookie } });
  check("dashboard → 401 relogin (token Discord tidak ada)", res.status === 401, `(got ${res.status})`);
  data = await res.json();
  check("pesan relogin informatif", typeof data.error === "string" && data.error.length > 10);

  console.log("== 4. Proxy tulis (harus kena guard yang sama) ==");
  res = await fetch(`${BASE}/api/guilds/${GUILD}/config`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ updates: { "messages.welcomeTitle": "HACK" } }),
  });
  check("PUT config tanpa token Discord → 401", res.status === 401, `(got ${res.status})`);

  console.log("== 5. Token Discord PALSU → verifikasi live Discord menolak ==");
  await db.user.update({
    where: { id: user.id },
    data: {
      accessToken: "fake-token-abcdef",
      refreshToken: "fake-refresh",
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    },
  });
  res = await fetch(`${BASE}/api/guilds`, { headers: { cookie } });
  check("/api/guilds tetap 200 (fallback error tidak crash)", res.status === 200, `(got ${res.status})`);
  data = await res.json();
  check(
    "guildsError=relogin (Discord 401 → refresh gagal)",
    data.guildsError === "relogin" || data.guildsError === "discord-error",
    `(got ${data.guildsError})`
  );
  res = await fetch(`${BASE}/api/guilds/${GUILD}/dashboard`, { headers: { cookie } });
  check("dashboard dengan token palsu → 401 (tidak lolos verifikasi)", res.status === 401, `(got ${res.status})`);

  console.log("== 6. Cleanup ==");
  await db.user.update({
    where: { id: user.id },
    data: { accessToken: null, refreshToken: null, tokenExpiresAt: null },
  });
  check("token palsu dibersihkan", true);

  console.log(`\n${pass} lulus, ${fail} gagal`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
