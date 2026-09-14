// Helper autentikasi untuk route handler API: baca sesi -> muat user,
// plus util respons JSON yang konsisten.
//
// Urutan resolusi user ( currentUser ):
// 1. Baris user di database instance ini — by id sesi, lalu by discordId.
//    Sumber utama: status admin selalu terbarui dari DB.
// 2. Fallback multi-instance: profil tertanam di token sesi. Sandbox preview
//    platform bisa menjalankan lebih dari satu instance server dengan
//    salinan DB yang berbeda; profil token membuat login tetap hidup di
//    instance mana pun (cukup SESSION_SECRET sama — sudah terkunci di
//    thor-credentials.ts).
// 3. Self-healing: saat fallback dipakai, baris user ditanam ulang ke DB
//    instance ini dengan id yang sama, supaya fitur redeem/admin/riwayat
//    ikut hidup. Token lama (tanpa profil) tidak bisa dipulihkan — user
//    login ulang sekali untuk mendapat token baru yang ber-profil.

import { db } from "@/lib/db";
import { readSession, userFromSession, type SessionUser } from "@/lib/session";
import type { User } from "@prisma/client";

// Bentuk turunan token untuk kasus penanaman baris gagal (DB read-only
// atau race dengan instance lain) — identitas tetap terbaca; baris user
// akan hidup penuh begitu benar-benar tersedia.
function shadowUser(profile: SessionUser): User {
  const stamp = new Date();
  return {
    id: profile.id,
    discordId: profile.discordId,
    username: profile.username,
    globalName: profile.globalName,
    avatar: profile.avatar,
    isAdmin: profile.isAdmin,
    // v2: token OAuth tidak tertanam di sesi — shadow user tidak bisa
    // memanggil /users/@me/guilds (UI akan minta re-login bila perlu).
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  } as User;
}

export async function currentUser(req: Request): Promise<User | null> {
  const session = readSession(req);
  if (!session) return null;

  // 1) DB-first: cari baris user di instance ini
  const byId = await db.user.findUnique({ where: { id: session.uid } });
  if (byId) return byId;

  // 2) Fallback: profil tertanam di token
  const profile = userFromSession(session);
  if (!profile) return null;

  // DB lokal mungkin sudah punya baris yang sama dengan id berbeda (login
  // pertama terjadi di instance ini lewat jalur lain) — cocokkan via
  // discordId supaya tidak dobel
  const byDiscordId = await db.user.findUnique({
    where: { discordId: profile.discordId },
  });
  if (byDiscordId) return byDiscordId;

  // 3) Self-healing: tanam ulang baris user (id sama persis supaya relasi
  //    redeem tetap konsisten). Kegagalan ditelan — shadow user dipakai.
  try {
    const created = await db.user.create({
      data: {
        id: profile.id,
        discordId: profile.discordId,
        username: profile.username,
        globalName: profile.globalName,
        avatar: profile.avatar,
        isAdmin: profile.isAdmin,
      },
    });
    return created;
  } catch {
    return shadowUser(profile);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function jsonError(message: string, status = 400): Response {
  return json({ error: message }, status);
}
