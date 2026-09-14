// Klien DASH API — jembatan dashboard Next.js ⇄ bot Thor (v3.16.0, ala Dyno).
//
// Bot menjalankan HTTP API kecil (src/infra/dashServer.js, default
// 127.0.0.1:8788). Dashboard TIDAK pernah menulis file bot secara langsung —
// semua baca/tulis lewat sini supaya:
//   1. Validasi bisnis tetap SATU tempat (di bot — dipakai bersama slash
//      command), tidak pernah terjadi perbedaan aturan antara web vs Discord.
//   2. Hot-reload: bot membaca config fresh per operasi, perubahan dari web
//      langsung efektif tanpa restart.
//   3. Token rahasia DASH_API_TOKEN tidak pernah keluar dari server.

import { cfg } from "./config";

export class BotOfflineError extends Error {
  constructor(message = "Bot sedang tidak terhubung.") {
    super(message);
    this.name = "BotOfflineError";
  }
}

export class BotApiError extends Error {
  status: number;
  details?: string[];

  constructor(message: string, status: number, details?: string[]) {
    super(message);
    this.name = "BotApiError";
    this.status = status;
    this.details = details;
  }
}

type BotApiOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
};

/** Panggil DASH API bot. Throw BotOfflineError kalau unreachable. */
export async function botApi<T = unknown>(pathname: string, opts: BotApiOptions = {}): Promise<T> {
  const { method = "GET", body, timeoutMs = 8000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.dashApiUrl}${pathname}`, {
      method,
      headers: {
        "x-dash-token": cfg.dashApiToken,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await res.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (!res.ok) {
      const message = typeof data.error === "string" ? data.error : `Bot API error ${res.status}`;
      throw new BotApiError(message, res.status, Array.isArray(data.details) ? (data.details as string[]) : undefined);
    }
    return data as T;
  } catch (err) {
    if (err instanceof BotApiError) throw err;
    // abort / fetch failure / connection refused → bot offline
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("abort") || msg.includes("aborted")) {
      throw new BotOfflineError();
    }
    throw new BotApiError(msg, 500);
  } finally {
    clearTimeout(timer);
  }
}

/** Cek kesehatan bot tanpa melempar (untuk banner status). */
export async function botHealth(): Promise<{ online: boolean; guildCount?: number; version?: string }> {
  try {
    const data = await botApi<{ ok: boolean; guildCount: number; version: string }>("/health", { timeoutMs: 4000 });
    return { online: true, guildCount: data.guildCount, version: data.version };
  } catch {
    return { online: false };
  }
}

// === Bentuk data bot (subset yang dipakai UI) ===

export type BotGuild = {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number | null;
  ownerId: string | null;
};

export type BotChannel = { id: string; name: string; type: number; position: number };
export type BotRole = { id: string; name: string; color: number; position: number };

export type TicketCategory = {
  id: string;
  label: string;
  emoji: string;
  style: string;
  requiresKey: boolean;
  isDefault?: boolean;
};

export type Product = {
  label: string;
  value: string;
  price: string;
  duration?: string;
  category: string;
  requiresKey: boolean;
  /** v3.19.0: mapping auto-role dari /set-product-role — dipertahankan saat disimpan dari web. */
  roleId?: string;
  days?: number;
};

export type LevelRole = { level: number; roleId: string };

export type GuildConfig = {
  roles: Record<string, string | null>;
  channels: Record<string, string | null>;
  messages: Record<string, string>;
  colors: Record<string, number>;
  verifyButton: { label: string; emoji: string; style: string };
  ticketCategories: TicketCategory[];
  leveling: {
    enabled: boolean;
    xpPerMessage: number;
    cooldownMs: number;
    announceLevelUp: boolean;
    levelUpChannel: string | null;
  };
  levelRoles: LevelRole[];
  midman: { feeMode: "percent" | "flat"; feeValue: number; category: string };
  products: Product[];
};

export type WordRule = { word: string; action: string | null; addedBy?: string; addedAt?: number };

export type AutoModConfig = {
  enabled: boolean;
  spamThreshold: number;
  spamWindowMs: number;
  spamAction: string;
  blockLinks: boolean;
  linkAllowedChannels: string[];
  linkAllowedRoles: string[];
  wordRules: WordRule[];
  exemptWords: string[];
  wordMatchMode: string;
  wordAction: string;
  maxMentions: number;
  mentionAction: string;
};

export type Responder = {
  id: string;
  trigger: string;
  matchMode: string;
  reply: string;
  replyType: string;
  cooldownMs: number;
  useCount?: number;
};

export type SelfRolePanel = {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  title: string;
  description: string;
  type: string;
  exclusive: boolean;
  roles: Array<{ roleId: string; label: string; emoji?: string; description?: string; style?: string }>;
};

export type Announcement = {
  id: string;
  guildId: string;
  channelId: string;
  sendAt: number;
  sent: boolean;
  sentAt: number | null;
  recurring: string | null;
  data: {
    title: string;
    description: string;
    color?: number;
    image?: string | null;
    thumbnail?: string | null;
    mention?: string | null;
    authorId?: string;
    authorTag?: string;
  };
};

// ==== v3.19.0: modul baru (Command Manager, Giveaway, Poll, Backup, Moderasi, Keys) ====

export type CommandInfo = { name: string; description: string; domain: string; custom?: boolean };

export type CommandsSection = {
  list: CommandInfo[];
  disabled: string[];
  protected: string[];
};

export type Giveaway = {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  prize: string;
  winnersCount: number;
  endsAt: number;
  ended: boolean;
  winnerIds: string[];
  participantIds: string[];
  hostId: string;
  hostTag: string;
  requiredRoleId: string | null;
  createdAt: number;
};

export type Poll = {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  question: string;
  options: Array<{ label: string; emoji: string; votes: string[] }>;
  multiple: boolean;
  closed: boolean;
  createdAt: number;
  closedAt: number | null;
  creatorId: string;
  creatorTag: string;
};

export type BackupEntry = { name: string; size: number; fileCount: number; mtime: number };

export type WarnRecord = {
  id: string;
  reason: string;
  warnedBy: string;
  warnedByTag: string;
  guildId: string;
  userId: string;
  createdAt: number;
  actionTaken: string | null;
};

export type ModLogRecord = {
  id: string;
  type: string;
  reason: string;
  durationMs: number | null;
  moderatorId: string;
  moderatorTag: string;
  guildId: string;
  userId: string;
  createdAt: number;
};

export type KeyRecord = {
  id: string;
  key: string;
  userId: string;
  username: string;
  roleId: string;
  productName: string;
  days: number;
  expireAt: number | null;
  createdAt: number;
  guildId: string;
};

// ==== v3.20.0: Custom Commands + Embed Builder lengkap ====

/** Def embed ternormalisasi — bentuk yang sama dipakai bot (embedPayload.js). */
export type EmbedDef = {
  title: string;
  description: string;
  color: number;
  authorName: string;
  authorIconURL: string;
  thumbnail: string;
  image: string;
  footerText: string;
  footerIconURL: string;
  timestamp: boolean;
  fields: Array<{ name: string; value: string; inline: boolean }>;
};

/** Custom command buatan admin (dibuat dari web → slash command asli di server). */
export type CustomCommand = {
  name: string;
  description: string;
  ephemeral: boolean;
  content: string;
  embed: EmbedDef;
  createdBy: string | null;
  createdByTag: string | null;
  createdAt: number;
  updatedAt: number;
  useCount?: number;
};

// ==== v3.21.0: Panduan Cepat — panel tiket terpasang (status checklist) ====

/** Panel tiket terpasang (bentuk slim — tanpa body besar; untuk checklist). */
export type TicketPanelInfo = {
  id: string;
  channelId: string;
  messageId: string | null;
  title: string | null;
  categoryIds: string[];
  useDropdown: boolean;
  createdAt: number | null;
};

export type DashboardPayload = {
  config: GuildConfig;
  automod: AutoModConfig;
  responders: Responder[];
  selfroles: SelfRolePanel[];
  tempvoice: { creatorChannelId: string | null; categoryId: string | null; activeChannels: number } | null;
  announces: Announcement[];
  serverstats: { enabled: boolean; config: unknown };
  commands: CommandsSection;
  giveaways: Giveaway[];
  polls: Poll[];
  backups: BackupEntry[];
  warns: WarnRecord[];
  modlogs: ModLogRecord[];
  keys: KeyRecord[];
  // v3.20.0
  customCommands: CustomCommand[];
  // v3.21.0: panel tiket terpasang — status langkah "pasang panel tiket".
  panels: TicketPanelInfo[];
};

export type GuildMeta = {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number | null;
  channels: BotChannel[];
  roles: BotRole[];
};
