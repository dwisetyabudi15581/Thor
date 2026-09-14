#!/usr/bin/env node
/**
 * build.mjs — build dashboard production, portabel antar platform.
 *
 * Menggantikan script shell lama
 * (`prisma generate && next build && cp -r .next/static ... && cp -r public ...`)
 * karena dua alasan:
 *   1. Android/Termux: Turbopack (default build Next 16) butuh binary native
 *      yang tidak tersedia untuk android/arm64 — di sana build WAJIB pakai
 *      `--webpack` (pesan resmi dari Next.js: "use Webpack instead").
 *   2. `cp -r` hanya jalan di shell Unix — diganti fs.cpSync murni Node.
 *
 * Langkah (identik dengan script lama di Linux/VPS):
 *   prisma generate → next build → salin .next/static + public ke
 *   .next/standalone/ supaya `npm run start` (standalone server.js) siap.
 */
import { execSync } from "node:child_process";
import { cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const isAndroid = process.platform === "android";

// node_modules/.bin didahulukan supaya `node scripts/build.mjs` langsung
// (tanpa lewat npm run) pun menemukan binary prisma/next.
const PATH = `${path.join(root, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`;

function run(command) {
  console.log(`\n$ ${command}`);
  execSync(command, { stdio: "inherit", cwd: root, env: { ...process.env, PATH } });
}

run("prisma generate");

if (isAndroid) {
  console.log("Android (Termux) terdeteksi — build pakai Webpack (Turbopack tidak tersedia di Android).");
  run("next build --webpack");
} else {
  run("next build");
}

const nextDir = path.join(root, ".next");
const standalone = path.join(nextDir, "standalone");
cpSync(path.join(nextDir, "static"), path.join(standalone, ".next", "static"), { recursive: true, force: true });
cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true, force: true });

console.log("\nBuild selesai — dashboard/.next/standalone/server.js siap dijalankan.");
