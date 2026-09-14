import type { NextConfig } from "next";

import path from "node:path";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next 16 nests the standalone build under a subfolder when it detects a
  // parent workspace/git root (e.g. when dashboard/ lives inside the Thor
  // repo). Pinning the tracing root to this folder keeps server.js directly
  // under .next/standalone/ so `npm run start` stays simple.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  // Matikan tombol indikator dev (lingkaran "N" melayang) — di sandbox
  // preview user menjalankan `next dev`, badge ini bisa menutupi konten.
  devIndicators: false,
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // API & halaman utama tidak boleh di-cache oleh gateway/CDN/browser:
  // status demo/login harus selalu segar (mencegah "foto lama" mode demo)
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
