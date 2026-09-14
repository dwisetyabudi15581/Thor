#!/usr/bin/env node
/**
 * Wrapper prisma yang DETERMINISTIK untuk DATABASE_URL SQLite.
 *
 * Kenapa ada: prisma CLI dan prisma client menyelesaikan path file: relatif
 * terhadap lokasi berbeda-beda (folder schema prisma/ saat CLI, lokasi
 * build standalone saat runtime) — file .env bisa "nyasar" tergantung
 * konteks. Wrapper ini mengubah path relatif jadi ABSOLUT (dipegang dari
 * folder dashboard/) sebelum mendelegasikan ke prisma, sehingga CLI,
 * runtime, dan mode dev SELALU menunjuk file yang sama:
 *
 *   file:db/custom.db  →  file:/.../dashboard/db/custom.db
 *
 * Pakai (dari folder dashboard/):
 *   node scripts/db.mjs db push --accept-data-loss
 *   node scripts/db.mjs studio
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2); // mis. ["db", "push", "--accept-data-loss"]
if (args.length === 0) {
  console.error('Pakai: node scripts/db.mjs <perintah prisma>  (mis. "db push")');
  process.exit(1);
}

const raw = process.env.DATABASE_URL || "file:db/custom.db";
let url = raw;
if (raw.startsWith("file:") && !raw.startsWith("file:/")) {
  // path relatif → absolut terhadap folder dashboard/ (CWD perintah ini)
  url = "file:" + path.resolve(process.cwd(), raw.slice(5));
}

const res = spawnSync("npx", ["prisma", ...args], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(res.status ?? 1);
