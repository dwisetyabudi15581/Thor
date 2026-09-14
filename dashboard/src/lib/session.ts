// Sesi login berbasis cookie bertanda tangan HMAC-SHA256 — ringan tanpa
// dependensi eksternal. Payload: { uid, iat, exp, p }.
//
// "p" (profil) menyimpan hasil login Discord: identitas + status admin
// saat login. Ini membuat sesi SELF-CONTAINED: di sandbox
// preview yang multi-instance (tiap instance bisa punya salinan DB berbeda),
// sesi tetap valid di instance mana pun selama SESSION_SECRET sama.
// currentUser() tetap DB-first; profil token dipakai sebagai fallback
// sekaligus benih self-healing untuk menanam ulang baris user (lihat
// api-auth.ts).

import crypto from "crypto";
import { cfg } from "./config";

const COOKIE_NAME = "thor_session";
const SESSION_DAYS = 7;

// Profil tertanam di token — bentuk JSON-safe (tanggal disimpan epoch ms)
export type SessionProfile = {
  discordId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  isAdmin: boolean;
};

export type SessionPayload = {
  uid: string;
  iat?: number;
  exp: number;
  p?: SessionProfile;
};

// Bentuk user minimal untuk membuat sesi — Prisma User memenuhi ini
export type SessionUser = {
  id: string;
  discordId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  isAdmin: boolean;
};

function sign(data: string): string {
  return crypto.createHmac("sha256", cfg.sessionSecret).update(data).digest("base64url");
}

export function createSessionToken(user: SessionUser): string {
  const now = Date.now();
  const payload: SessionPayload = {
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

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  // perbandingan konstan-waktu agar tidak bisa timing-attack
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.uid || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Rekonstruksi user dari payload sesi (fallback multi-instance).
// Token lama tanpa "p" menghasilkan null — pemilik token lama cukup
// login ulang SEKALI untuk mendapat token ber-profil yang tahan pindah
// instance.
export function userFromSession(session: SessionPayload): SessionUser | null {
  const p = session.p;
  if (!p) return null;
  return {
    id: session.uid,
    discordId: p.discordId,
    username: p.username,
    globalName: p.globalName,
    avatar: p.avatar,
    isAdmin: p.isAdmin,
  };
}

export function sessionCookie(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure: process.env.NODE_ENV === "production",
  };
}

export function clearedSessionCookie() {
  return {
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  };
}

// Baca payload sesi dari header cookie sebuah Request (route handler)
export function readSession(req: Request): SessionPayload | null {
  const raw = req.headers.get("cookie") ?? "";
  const match = raw
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  return verifySessionToken(match.slice(COOKIE_NAME.length + 1));
}
