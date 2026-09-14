#!/usr/bin/env node
/**
 * dev.mjs — `next dev` dengan fallback Webpack untuk Android/Termux.
 *
 * Next 16 memakai Turbopack untuk dev server; binary native-nya tidak
 * tersedia di android/arm64 (Termux). Di Android otomatis ditambahkan
 * `--webpack`; platform lain tetap Turbopack (default).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const isAndroid = process.platform === "android";
const port = process.env.PORT || "3000";

const command = isAndroid
  ? `next dev -p ${port} --webpack`
  : `next dev -p ${port}`;

// shell: true supaya `next` terresolve lewat PATH di platform mana pun.
const PATH = `${path.join(root, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`;
console.log(`$ ${command}`);
const child = spawn(command, { stdio: "inherit", cwd: root, shell: true, env: { ...process.env, PATH } });
child.on("exit", (code) => process.exit(code ?? 0));
