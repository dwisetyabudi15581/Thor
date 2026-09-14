// Helper origin aplikasi di balik reverse proxy.
// Gateway/hosting umumnya mengakhiri TLS sebelum request sampai ke server
// (server hanya melihat "http"), padahal browser pengunjung memakai https.
// Karena itu: host non-localhost SELALU dianggap https; localhost tetap
// http agar pengembangan lokal tetap berjalan.
// PUBLIC_ORIGIN (opsional) mengunci origin tetap, mis.
//   PUBLIC_ORIGIN=https://thor.example.com
// berguna saat deploy di hosting dengan domain sendiri atau alamat LAN.
// Di sandbox, preview panel me-rewrite Host ke domain FC internal, padahal
// browser pengunjung ada di domain preview — jadi fallback PUBLIC_ORIGIN
// dari thor-credentials mengunci origin ke domain preview tersebut.

import { SANDBOX_DEFAULTS } from "./thor-credentials";

export function appOrigin(req: Request): string {
  const fixed = process.env.PUBLIC_ORIGIN?.trim() || SANDBOX_DEFAULTS.PUBLIC_ORIGIN;
  if (fixed) return fixed.replace(/\/+$/, "");

  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  return `${isLocal ? "http" : "https"}://${host}`;
}
