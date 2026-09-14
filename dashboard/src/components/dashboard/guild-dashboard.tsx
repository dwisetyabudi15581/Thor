"use client";

// GuildDashboard — shell utama dashboard per-server (ala Dyno).
// Arsitektur state:
//   payload  — data segar dari bot (via /api/guilds/:id/dashboard)
//   draft    — salinan editable (config + automod). Setter menandai dirty
//              lewat kumpulan dotPath; SaveBar menyimpan sekaligus:
//              PUT config {updates} lalu PUT automod (patch) bila berubah.
//   Aksi CRUD (responder/announce/selfrole/dll) TIDAK lewat draft —
//   langsung call() ke proxy lalu refresh payload dari bot.
//
// Dua jaminan UX:
//   1. Tidak ada perubahan yang hilang diam-diam: SaveBar selalu terlihat
//      saat dirty > 0; pindah modul tidak membuang draft.
//   2. Error bot ditampilkan apa adanya (pesan bisnis dari validasi bot),
//      payload TIDAK di-reset saat save gagal.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Hammer, Loader2, ArrowLeft, Save, X, CheckCircle2, AlertTriangle,
  LayoutDashboard, Settings2, Ticket, Hash, TrendingUp, MessageSquareReply,
  Palette, Mic, Megaphone, Handshake, BarChart3, Terminal, Archive,
  ShieldAlert, KeyRound, Gift, SquarePen, Vote, Wand2, Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AutoModConfig, DashboardPayload, GuildMeta } from "@/lib/bot-api";
import {
  GeneralModule, TicketsModule, AutoModModule, LevelingModule, MidmanModule, type ModuleFormProps,
} from "./modules/module-forms";
// v3.21.0: Panduan Cepat — checklist setup server dari web (mirror kategori
// 🚀 di /help): form per langkah → bot menerapkan langsung ke server.
import { QuickStartModule } from "./modules/module-quickstart";
import {
  RespondersModule, SelfRolesModule, AnnounceModule, TempVoiceModule, ServerStatsModule, ModuleOverview,
  type ModuleActionProps,
} from "./modules/module-actions";
// v3.19.0: modul baru — Command Manager (ala Dyno) + Giveaway/Poll/Embed/
// Backup/Moderasi/Keys. Semua aksi langsung via call() (paritas Discord↔web).
// v3.20.0: + CustomCommandsModule — bikin command sendiri dari web, otomatis
// jadi slash command asli di Discord.
import {
  CommandManagerModule, GiveawayModule, PollModule, EmbedModule,
  BackupModule, ModerationModule, KeysModule, CustomCommandsModule,
} from "./modules/module-tools";

type ToastState = { msg: string; tone: "ok" | "err"; id: number } | null;

type ModuleId =
  | "overview" | "quickstart" | "general" | "tickets" | "automod" | "leveling"
  | "responders" | "selfroles" | "announce" | "tempvoice" | "midman" | "serverstats"
  // v3.19.0
  | "commands" | "backup" | "moderation" | "keys" | "giveaway" | "embed" | "poll"
  // v3.20.0
  | "custom";

const MODULES: Array<{ id: ModuleId; label: string; icon: typeof LayoutDashboard; group: string }> = [
  { id: "overview", label: "Ringkasan", icon: LayoutDashboard, group: "Server" },
  // v3.21.0: mirror kategori 🚀 Panduan Cepat (/help) — form setup langsung dari web.
  { id: "quickstart", label: "Panduan Cepat", icon: Rocket, group: "Server" },
  { id: "general", label: "Umum", icon: Settings2, group: "Server" },
  { id: "commands", label: "Command Manager", icon: Terminal, group: "Server" },
  { id: "backup", label: "Backup", icon: Archive, group: "Server" },
  { id: "automod", label: "AutoMod", icon: Hash, group: "Proteksi" },
  { id: "midman", label: "Rekber", icon: Handshake, group: "Proteksi" },
  { id: "moderation", label: "Moderasi", icon: ShieldAlert, group: "Proteksi" },
  { id: "tickets", label: "Tiket & Produk", icon: Ticket, group: "Komunitas" },
  { id: "keys", label: "Kunci VIP", icon: KeyRound, group: "Komunitas" },
  { id: "leveling", label: "Leveling", icon: TrendingUp, group: "Komunitas" },
  { id: "responders", label: "Auto-Responder", icon: MessageSquareReply, group: "Komunitas" },
  { id: "selfroles", label: "Self Roles", icon: Palette, group: "Komunitas" },
  { id: "announce", label: "Announce", icon: Megaphone, group: "Komunitas" },
  { id: "giveaway", label: "Giveaway", icon: Gift, group: "Komunitas" },
  { id: "tempvoice", label: "Temp Voice", icon: Mic, group: "Komunitas" },
  { id: "serverstats", label: "Server Stats", icon: BarChart3, group: "Komunitas" },
  { id: "embed", label: "Embed", icon: SquarePen, group: "Alat" },
  { id: "custom", label: "Custom Command", icon: Wand2, group: "Alat" },
  { id: "poll", label: "Poll", icon: Vote, group: "Alat" },
];

const MODULE_DESC: Record<ModuleId, { title: string; desc: string }> = {
  overview: { title: "Ringkasan", desc: "Gambaran status seluruh modul server ini." },
  quickstart: { title: "Panduan Cepat", desc: "Setup server dari nol lewat checklist 6 langkah — role (pilih atau tempel ID), produk, panel tiket & verifikasi, channel log. Tiap form langsung diterapkan bot ke server, persis kategori 🚀 di /help." },
  general: { title: "Pengaturan Umum", desc: "Role penting, channel sistem, pesan otomatis, dan warna embed." },
  tickets: { title: "Tiket & Produk", desc: "Panel tiket, kategori, dan daftar produk/price list." },
  automod: { title: "AutoMod", desc: "Anti-spam, blokir link & kata, batas mention." },
  leveling: { title: "Leveling", desc: "XP, pengumuman level up, dan role reward." },
  responders: { title: "Auto-Responder", desc: "Kata pemicu → balasan otomatis dari bot." },
  selfroles: { title: "Self Roles", desc: "Panel member mengambil role sendiri." },
  announce: { title: "Pengumuman Terjadwal", desc: "Kirim embed otomatis pada waktu tertentu." },
  tempvoice: { title: "Temporary Voice", desc: "Channel suara privat per member." },
  midman: { title: "Rekber / Escrow", desc: "Fee dan kategori deal 3-pihak." },
  serverstats: { title: "Server Stats", desc: "Counter live di nama channel." },
  commands: { title: "Command Manager", desc: "Aktif/nonaktifkan tiap slash command di server ini — persis ala Dyno. Berlaku untuk penggunaan lewat Discord." },
  backup: { title: "Backup", desc: "Buat backup sekarang dan pulihkan slot lama." },
  moderation: { title: "Moderasi", desc: "Riwayat warn dan tindakan moderator (timeout/kick/ban)." },
  keys: { title: "Kunci VIP", desc: "Beri key produk ke member — role + auto-expire otomatis." },
  giveaway: { title: "Giveaway", desc: "Mulai giveaway dengan tombol Join/Leave langsung dari web." },
  embed: { title: "Embed Builder", desc: "Bikin embed lengkap (author, fields, gambar, footer) dengan pratinjau live ala Discord, lalu kirim ke channel mana pun." },
  custom: { title: "Custom Command", desc: "Bikin slash command sendiri dari web — otomatis terdaftar di Discord dan bisa dipakai semua member (ala Custom Commands Dyno)." },
  poll: { title: "Poll", desc: "Buat poll dengan tombol vote interaktif." },
};

function setPath(obj: Record<string, unknown>, dotPath: string, value: unknown) {
  const parts = dotPath.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (typeof next !== "object" || next === null) cur[parts[i]] = {};
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

export function GuildDashboard({ guildId }: { guildId: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [meta, setMeta] = useState<GuildMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [module, setModule] = useState<ModuleId>("overview");
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // v3.21.0: auto-landing Panduan Cepat — hanya sekali per kunjungan.
  const landingChecked = useRef(false);

  // Draft + dirty tracking
  const [draft, setDraft] = useState<DashboardPayload | null>(null);
  const [configUpdates, setConfigUpdates] = useState<Record<string, unknown>>({});
  const [automodPatch, setAutomodPatch] = useState<Partial<AutoModConfig>>({});
  const [saving, setSaving] = useState(false);

  const showToast = useCallback((msg: string, tone: "ok" | "err" = "ok") => {
    setToast({ msg, tone, id: Date.now() });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3800);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/guilds/${guildId}/dashboard?_=${Date.now()}`, { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/");
      return;
    }
    if (res.status === 403) {
      setLoadError("Kamu tidak punya izin mengelola server ini.");
      setLoading(false);
      return;
    }
    if (res.status === 503) {
      setLoadError("Bot sedang tidak terhubung — pastikan bot berjalan lalu muat ulang.");
      setLoading(false);
      return;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setLoadError(data?.error ?? `Gagal memuat dashboard (${res.status}).`);
      setLoading(false);
      return;
    }
    const data = (await res.json()) as DashboardPayload & { meta: GuildMeta };
    setPayload(data);
    setMeta(data.meta);
    // Draft = salinan dalam; dirty di-reset (draft baru selalu dari bot).
    setDraft({ ...data, meta: undefined } as DashboardPayload);
    setConfigUpdates({});
    setAutomodPatch({});
    setLoadError(null);

    // v3.21.0: auto-landing Panduan Cepat — server yang belum di-setup (belum
    // ada role admin & belum ada produk) langsung dibawa ke checklist setup.
    // Sekali per kunjungan — refresh/save berikutnya tidak menimpa pilihan
    // modul yang sudah dipilih user.
    if (!landingChecked.current) {
      landingChecked.current = true;
      if (!data.config.roles?.admin && (data.config.products?.length ?? 0) === 0) {
        setModule("quickstart");
      }
    }
  }, [guildId, router]);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  // ---- Setter draft (menandai dirty) ----
  const setConfig = useCallback((dotPath: string, value: unknown) => {
    setDraft((d) => {
      if (!d) return d;
      const next: DashboardPayload = structuredClone(d);
      setPath(next.config as unknown as Record<string, unknown>, dotPath, value);
      return next;
    });
    setConfigUpdates((u) => ({ ...u, [dotPath]: value }));
  }, []);

  const setAutomod = useCallback((patch: Partial<AutoModConfig>) => {
    setDraft((d) => {
      if (!d) return d;
      return { ...d, automod: { ...d.automod, ...patch } };
    });
    setAutomodPatch((p) => ({ ...p, ...patch }));
  }, []);

  // ---- Aksi langsung (CRUD) ----
  const call = useCallback(
    async (action: string, method: "POST" | "PUT" | "DELETE", body?: unknown) => {
      const res = await fetch(`/api/guilds/${guildId}/${action}`, {
        method,
        headers: body !== undefined ? { "content-type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] };
      if (!res.ok) {
        const details = data.details?.length ? ` (${data.details.slice(0, 3).join("; ")})` : "";
        throw new Error(`${data.error ?? `Gagal (${res.status})`}${details}`);
      }
      return data;
    },
    [guildId]
  );

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  // ---- Save ----
  const dirtyCount = Object.keys(configUpdates).length + (Object.keys(automodPatch).length > 0 ? 1 : 0);

  async function save() {
    setSaving(true);
    try {
      if (Object.keys(configUpdates).length > 0) {
        await call("config", "PUT", { updates: configUpdates });
      }
      if (Object.keys(automodPatch).length > 0) {
        await call("automod", "PUT", automodPatch);
      }
      await load();
      showToast("Perubahan tersimpan — langsung efektif di bot.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Gagal menyimpan.", "err");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (!payload) return;
    setDraft({ ...payload });
    setConfigUpdates({});
    setAutomodPatch({});
    showToast("Draft dibuang — kembali ke data bot.");
  }

  const formProps: ModuleFormProps | null = useMemo(
    () => (draft && meta ? { draft, meta, setConfig, setAutomod, toast: showToast } : null),
    [draft, meta, setConfig, setAutomod, showToast]
  );
  const actionProps: ModuleActionProps | null = useMemo(
    () => (draft && meta ? { draft, meta, call, refresh, toast: showToast } : null),
    [draft, meta, call, refresh, showToast]
  );

  // ---- Render ----
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-100 gap-4">
        <Loader2 className="h-8 w-8 text-amber-400 animate-spin" aria-hidden="true" />
        <p className="text-sm text-zinc-400">Memuat data server…</p>
      </div>
    );
  }

  if (loadError || !payload || !draft || !meta) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-100 gap-4 px-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-950/40 border border-red-900/50">
          <AlertTriangle className="h-5 w-5 text-red-400" aria-hidden="true" />
        </div>
        <p className="max-w-md text-center text-sm leading-relaxed text-zinc-300">{loadError ?? "Data tidak tersedia."}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/app")} className="border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-zinc-100">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Kembali
          </Button>
          <Button onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }} className="bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold">
            Coba Lagi
          </Button>
        </div>
      </div>
    );
  }

  const groups = [...new Set(MODULES.map((m) => m.group))];
  const currentDesc = MODULE_DESC[module];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header guild */}
      <header className="sticky top-0 z-40 border-b border-zinc-900/80 bg-zinc-950/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push("/app")} className="h-9 w-9 shrink-0 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60" title="Pilih server lain">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            {meta.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`https://cdn.discordapp.com/icons/${guildId}/${meta.icon}.png?size=64`} alt="" className="h-9 w-9 rounded-lg" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-xs font-semibold text-zinc-300">
                {meta.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-zinc-100">{meta.name}</p>
              <p className="hidden sm:block text-[10px] text-zinc-500">
                Thor Dashboard · {meta.memberCount?.toLocaleString("id-ID") ?? "—"} member
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => void refresh()} className="h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60" title="Muat ulang data">
              <Hammer className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 md:px-6">
        {/* Sidebar modul (desktop) */}
        <aside className="sticky top-[88px] hidden h-fit w-56 shrink-0 lg:block">
          <nav className="space-y-5">
            {groups.map((g) => (
              <div key={g}>
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{g}</p>
                <div className="space-y-0.5">
                  {MODULES.filter((m) => m.group === g).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setModule(m.id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                        module === m.id
                          ? "bg-amber-400/10 text-amber-300 border border-amber-400/25"
                          : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200 border border-transparent"
                      }`}
                    >
                      <m.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* Konten */}
        <main className="min-w-0 flex-1 pb-28">
          {/* Nav modul mobile */}
          <div className="-mx-4 mb-5 overflow-x-auto px-4 lg:hidden">
            <div className="flex w-max gap-1.5">
              {MODULES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModule(m.id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    module === m.id
                      ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                      : "border-zinc-800 bg-zinc-900/40 text-zinc-400"
                  }`}
                >
                  <m.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-5">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-50">{currentDesc.title}</h1>
            <p className="mt-1 text-sm text-zinc-400">{currentDesc.desc}</p>
          </div>

          {module === "overview" ? <ModuleOverview draft={draft} meta={meta} /> : null}
          {/* v3.21.0: Panduan Cepat — semua aksi langsung (call → refresh). */}
          {module === "quickstart" && actionProps ? <QuickStartModule {...actionProps} goTo={(m) => setModule(m as ModuleId)} /> : null}
          {module === "general" && formProps ? <GeneralModule {...formProps} /> : null}
          {module === "tickets" && formProps ? <TicketsModule {...formProps} /> : null}
          {module === "automod" && formProps ? <AutoModModule {...formProps} /> : null}
          {module === "leveling" && formProps ? <LevelingModule {...formProps} /> : null}
          {module === "midman" && formProps ? <MidmanModule {...formProps} /> : null}
          {module === "responders" && actionProps ? <RespondersModule {...actionProps} /> : null}
          {module === "selfroles" && actionProps ? <SelfRolesModule {...actionProps} /> : null}
          {module === "announce" && actionProps ? <AnnounceModule {...actionProps} /> : null}
          {module === "tempvoice" && actionProps ? <TempVoiceModule {...actionProps} /> : null}
          {module === "serverstats" && actionProps ? <ServerStatsModule {...actionProps} /> : null}
          {/* v3.19.0 */}
          {module === "commands" && actionProps ? <CommandManagerModule {...actionProps} /> : null}
          {module === "backup" && actionProps ? <BackupModule {...actionProps} /> : null}
          {module === "moderation" && actionProps ? <ModerationModule {...actionProps} /> : null}
          {module === "keys" && actionProps ? <KeysModule {...actionProps} /> : null}
          {module === "giveaway" && actionProps ? <GiveawayModule {...actionProps} /> : null}
          {module === "embed" && actionProps ? <EmbedModule {...actionProps} /> : null}
          {/* v3.20.0 */}
          {module === "custom" && actionProps ? <CustomCommandsModule {...actionProps} /> : null}
          {module === "poll" && actionProps ? <PollModule {...actionProps} /> : null}
        </main>
      </div>

      {/* SaveBar */}
      {dirtyCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-amber-400/25 bg-zinc-950/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
            <p className="text-[13px] text-zinc-300">
              <span className="font-semibold text-amber-300">{dirtyCount}</span> perubahan belum disimpan
              <span className="hidden sm:inline text-zinc-500"> — perubahan baru efektif setelah disimpan.</span>
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={discard} disabled={saving} className="text-zinc-400 hover:text-zinc-100">
                <X className="h-4 w-4" aria-hidden="true" /> Buang
              </Button>
              <Button onClick={save} disabled={saving} className="bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                Simpan Perubahan
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Toast */}
      {toast ? (
        <div
          key={toast.id}
          className={`fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-xl ${
            toast.tone === "ok"
              ? "border-emerald-500/40 bg-zinc-900 text-emerald-200"
              : "border-red-500/40 bg-zinc-900 text-red-200"
          }`}
          role="status"
        >
          {toast.tone === "ok" ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />}
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}
