#!/usr/bin/env node
/**
 * Start server production — prisma db push (URL absolut) + Next standalone.
 *
 * Dijalankan oleh `npm run start` dari folder dashboard/. Langkah:
 *   1. DATABASE_URL relatif diubah jadi ABSOLUT (dipegang dari folder
 *      dashboard/) — menetralkan perbedaan resolusi path antara prisma CLI
 *      (schema-relative) dan runtime standalone (chdir saat boot).
 *   2. prisma db push — membuat/migrasi tabel di SQLite.
 *   3. Menjalankan .next/standalone/server.js dengan URL absolut yang sama.
 */
import { spawnSync, spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd(); // folder dashboard/ (npm run start selalu di sini)

const raw = process.env.DATABASE_URL || "file:db/custom.db";
let dbUrl = raw;
if (raw.startsWith("file:") && !raw.startsWith("file:/")) {
  dbUrl = "file:" + path.resolve(root, raw.slice(5));
}

// 1) Siapkan database (buat tabel bila belum ada)
const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: dbUrl },
});
if (push.status !== 0) process.exit(push.status ?? 1);

// 2) Jalankan server standalone Next (mewarisi PORT dari env bila di-set)
const server = spawn(process.execPath, [".next/standalone/server.js"], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production", DATABASE_URL: dbUrl },
});
server.on("exit", (code) => process.exit(code ?? 0));
server.on("error", (err) => {
  console.error("Gagal menjalankan .next/standalone/server.js — jalankan `npm run build` dulu.", err);
  process.exit(1);
});
