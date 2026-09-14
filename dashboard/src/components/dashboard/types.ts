// Tipe bersama untuk data /api/me yang dipakai komponen dashboard.
// v3 (bot gratis): tidak ada lagi premium/redemptions/key — dashboard murni
// alat kelola server (ala Dyno), identitas user cukup untuk login + guard.

export type UserInfo = {
  id: string;
  discordId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  isAdmin: boolean;
};

export type MeConfig = {
  authReady: boolean;
  demoMode: boolean;
  inviteUrl: string;
  serverTime?: string;
  oauthRedirectUri?: string;
};

export type MeResponse = {
  user: UserInfo | null;
  config: MeConfig;
};
