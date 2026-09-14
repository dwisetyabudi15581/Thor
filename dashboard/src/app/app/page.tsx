"use client";

// /app — Pilih Server (ala Dyno): daftar guild Discord tempat user admin
// (owner / ManageGuild), dibedakan mana yang sudah ada bot-nya (bisa langsung
// dikelola) vs belum (tombol invite). Ini gerbang utama dashboard.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Hammer,
  Loader2,
  LogOut,
  Search,
  Plus,
  Settings2,
  Bot as BotIcon,
  AlertTriangle,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { MeResponse } from "@/components/dashboard/types";

type GuildItem = {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  botIn: boolean;
};

type GuildsResponse = {
  botOnline: boolean;
  botVersion?: string;
  guilds: GuildItem[];
  inviteUrl: string;
  guildsError?: "no-token" | "relogin" | "discord-error";
};

function guildIcon(guild: GuildItem, size: number): string | null {
  if (!guild.icon) return null;
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=${size}`;
}

export default function ServerPickerPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [data, setData] = useState<GuildsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  const loadGuilds = useCallback(async () => {
    const res = await fetch(`/api/guilds?_=${Date.now()}`, { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/");
      return;
    }
    setData((await res.json()) as GuildsResponse);
  }, [router]);

  useEffect(() => {
    void (async () => {
      const meRes = await fetch(`/api/me?_=${Date.now()}`, { cache: "no-store" });
      const meData = (await meRes.json()) as MeResponse;
      setMe(meData);
      if (!meData.user) {
        router.replace("/");
        return;
      }
      await loadGuilds();
      setLoading(false);
    })();
  }, [loadGuilds, router]);

  async function refresh() {
    setRefreshing(true);
    try {
      await loadGuilds();
    } finally {
      setRefreshing(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
  }

  const filtered = useMemo(() => {
    const list = data?.guilds ?? [];
    if (!query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter((g) => g.name.toLowerCase().includes(q));
  }, [data, query]);

  const withBot = filtered.filter((g) => g.botIn);
  const withoutBot = filtered.filter((g) => !g.botIn);

  if (loading || !me?.user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-100 gap-4">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/10 border border-amber-400/25">
          <Loader2 className="h-6 w-6 text-amber-400 animate-spin" aria-hidden="true" />
        </div>
        <p className="text-sm text-zinc-400">Memuat daftar server…</p>
      </div>
    );
  }

  const u = me.user;
  const avatar = u.avatar
    ? `https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.png?size=64`
    : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-900/80 bg-zinc-950/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <button
            type="button"
            onClick={() => router.replace("/")}
            className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 border border-amber-400/25">
              <Hammer className="h-4 w-4 text-amber-400" aria-hidden="true" />
            </div>
            <div className="leading-tight text-left">
              <p className="text-sm font-semibold text-zinc-100">Thor Dashboard</p>
              <p className="text-[10px] text-zinc-500">Pilih server untuk mulai</p>
            </div>
          </button>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2.5 rounded-full border border-zinc-800/80 bg-zinc-900/40 pl-1 pr-3 py-1">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="" className="h-7 w-7 rounded-full" />
              ) : (
                <div className="h-7 w-7 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-semibold text-zinc-300">
                  {(u.globalName || u.username).slice(0, 1).toUpperCase()}
                </div>
              )}
              <span className="text-xs text-zinc-300 max-w-[140px] truncate">{u.globalName || u.username}</span>
              {u.isAdmin ? <Badge className="bg-amber-400/15 text-amber-300 border-amber-400/30 text-[10px]">Admin</Badge> : null}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Keluar</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Server Kamu</h1>
            <p className="mt-1.5 text-sm text-zinc-400">
              Hanya server tempat kamu punya izin <span className="text-zinc-300">Manage Server</span> yang tampil di sini.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari server…"
                className="h-10 w-full sm:w-64 rounded-lg border border-zinc-800 bg-zinc-900/50 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-400/50"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={refresh}
              disabled={refreshing}
              className="h-10 w-10 shrink-0 border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800"
              title="Muat ulang daftar"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            </Button>
          </div>
        </div>

        {/* Banner status */}
        {data && !data.botOnline ? (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-amber-200">Bot sedang offline.</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-200/70">
                Dashboard web terhubung ke bot lewat jaringan lokal. Pastikan bot Thor berjalan
                (dan <code className="text-amber-300">DASH_API_TOKEN</code> di .env-nya sama dengan web)
                lalu muat ulang daftar.
              </p>
            </div>
          </div>
        ) : null}
        {data?.guildsError === "relogin" || data?.guildsError === "no-token" ? (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-red-900/60 bg-red-950/30 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-red-200">Perlu login ulang untuk melihat daftar server.</p>
              <p className="mt-1 text-xs leading-relaxed text-red-200/70">
                Sesi kamu belum mencakup izin daftar server (scope Discord baru). Keluar lalu login
                lagi — hanya butuh beberapa detik.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 border-red-800/60 bg-transparent text-red-200 hover:bg-red-900/30 hover:text-red-100"
                onClick={() => (window.location.href = "/api/auth/discord")}
              >
                Login ulang
              </Button>
            </div>
          </div>
        ) : null}
        {data?.botVersion?.startsWith("mock") ? (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
            <BotIcon className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-sky-200">Mode pratinjau (data demo).</p>
              <p className="mt-1 text-xs leading-relaxed text-sky-200/70">
                Bot asli belum terhubung — kamu melihat data contoh di server aslimu. Semua tampilan
                dan formulir berfungsi normal; perubahan tidak memengaruhi server Discord-mu.
              </p>
            </div>
          </div>
        ) : null}

        {/* Grid server: bot sudah ada */}
        {withBot.length > 0 ? (
          <>
            <h2 className="mt-10 text-xs font-medium uppercase tracking-widest text-zinc-500">
              Bot aktif — bisa dikelola
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {withBot.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => router.push(`/app/servers/${g.id}`)}
                  className="group flex items-center gap-4 rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-4 text-left transition-all hover:border-amber-400/40 hover:bg-zinc-900/60"
                >
                  {guildIcon(g, 64) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={guildIcon(g, 64)!} alt="" className="h-12 w-12 rounded-xl" />
                  ) : (
                    <div className="h-12 w-12 rounded-xl bg-zinc-800 flex items-center justify-center text-base font-semibold text-zinc-300">
                      {g.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-100">{g.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-400/90">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Bot aktif
                    </p>
                  </div>
                  <Settings2 className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-amber-400" aria-hidden="true" />
                </button>
              ))}
            </div>
          </>
        ) : null}

        {/* Grid server: bot belum ada */}
        {withoutBot.length > 0 ? (
          <>
            <h2 className="mt-10 text-xs font-medium uppercase tracking-widest text-zinc-500">
              Belum ada bot — invite dulu
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {withoutBot.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center gap-4 rounded-2xl border border-zinc-800/60 bg-zinc-900/20 p-4"
                >
                  {guildIcon(g, 64) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={guildIcon(g, 64)!} alt="" className="h-12 w-12 rounded-xl grayscale-[35%] opacity-80" />
                  ) : (
                    <div className="h-12 w-12 rounded-xl bg-zinc-800/70 flex items-center justify-center text-base font-semibold text-zinc-400">
                      {g.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-300">{g.name}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">Bot belum di-invite</p>
                  </div>
                  <a href={data?.inviteUrl ?? "#"} target="_blank" rel="noreferrer" className="shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Invite
                    </Button>
                  </a>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {/* Kosong */}
        {filtered.length === 0 && !data?.guildsError ? (
          <div className="mt-16 flex flex-col items-center text-center gap-3 rounded-2xl border border-dashed border-zinc-800 py-16">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900">
              <Search className="h-5 w-5 text-zinc-500" aria-hidden="true" />
            </div>
            <p className="text-sm text-zinc-300">
              {query ? `Tidak ada server yang cocok dengan “${query}”.` : "Belum ada server yang bisa kamu kelola."}
            </p>
            <p className="max-w-sm text-xs leading-relaxed text-zinc-500">
              {query
                ? "Coba kata kunci lain atau muat ulang daftar."
                : "Kamu perlu izin Manage Server di sebuah server Discord untuk mengelolanya dari sini."}
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
