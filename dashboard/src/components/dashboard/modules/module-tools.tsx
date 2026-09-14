"use client";

// Modul-alat dashboard v3.19.0 — Command Manager (ala Dyno) + modul baru:
// Giveaway, Poll, Embed, Backup, Moderasi (warn/modlog), Keys (VIP).
//
// Semua aksi LANGSUNG lewat call() → proxy web → DASH API bot (tanpa
// SaveBar), mengikuti kontrak ModuleActionProps di module-actions.tsx.
// Paritas penuh dengan Discord: setiap aksi di sini punya command
// padanan (/commands, /giveaway, /poll, /embed-builder, /backup-now,
// /warn-list, /set-key) — satu data, dua interface.

import { useMemo, useState } from "react";
import {
  Plus, Trash2, Loader2, RefreshCw, Search, ToggleLeft, ToggleRight,
  CheckCircle2, XCircle, KeyRound, Gift, BarChart3, ShieldAlert, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field, Section, TextInput, TextArea, Toggle, Select, ChannelSelect,
  RoleSelect, ColorInput, Pill, channelLabel, roleLabel,
} from "../fields";
import type { DashboardPayload, GuildMeta } from "@/lib/bot-api";
import type { ModuleActionProps } from "./module-actions";

/* ============================================================
 * Label domain command (grouping ala Dyno)
 * ============================================================ */

const DOMAIN_META: Array<{ key: string; label: string }> = [
  { key: "help", label: "Bantuan" },
  { key: "commands", label: "Manajemen Command" },
  { key: "config", label: "Pengaturan Server" },
  { key: "categories", label: "Kategori Tiket" },
  { key: "panels", label: "Panel Tiket" },
  { key: "panels-mgmt", label: "Kelola Panel" },
  { key: "products", label: "Produk" },
  { key: "keys", label: "Kunci VIP" },
  { key: "midman", label: "Rekber" },
  { key: "moderation", label: "Moderasi" },
  { key: "warn", label: "Peringatan" },
  { key: "automod", label: "AutoMod" },
  { key: "responder", label: "Auto-Responder" },
  { key: "selfrole", label: "Self Role" },
  { key: "leveling", label: "Leveling" },
  { key: "announce", label: "Pengumuman" },
  { key: "embed", label: "Embed Builder" },
  { key: "send-message", label: "Kirim Pesan" },
  { key: "giveaway", label: "Giveaway" },
  { key: "poll", label: "Poll" },
  { key: "backup", label: "Backup" },
  { key: "stats", label: "Statistik" },
  { key: "serverstats", label: "Server Stats" },
  { key: "tempvoice", label: "Temp Voice" },
  { key: "afk", label: "AFK" },
];

function domainLabel(key: string) {
  return DOMAIN_META.find((d) => d.key === key)?.label ?? "Lainnya";
}

function fmtDate(ts: number | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function fmtDuration(ms: number) {
  const menit = Math.round(ms / 60000);
  if (menit < 60) return `${menit} menit`;
  const jam = Math.round(menit / 60);
  if (jam < 24) return `${jam} jam`;
  return `${Math.round(jam / 24)} hari`;
}

/* ============================================================
 * MODUL: Command Manager (ala Dyno)
 * ============================================================ */

export function CommandManagerModule({ draft, call, refresh, toast }: ModuleActionProps) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const disabled = useMemo(() => new Set(draft.commands.disabled), [draft.commands]);
  const protectedSet = useMemo(() => new Set(draft.commands.protected), [draft.commands]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = draft.commands.list.filter(
      (c) => !q || c.name.includes(q) || c.description.toLowerCase().includes(q) || domainLabel(c.domain).toLowerCase().includes(q)
    );
    const map = new Map<string, typeof filtered>();
    for (const c of filtered) {
      if (!map.has(c.domain)) map.set(c.domain, []);
      map.get(c.domain)!.push(c);
    }
    // Urutkan sesuai DOMAIN_META; domain tak dikenal di belakang.
    const order = DOMAIN_META.map((d) => d.key);
    return [...map.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }, [draft.commands.list, query]);

  async function save(next: Iterable<string>, okMsg: string) {
    setBusy(true);
    try {
      await call("commands", "PUT", { disabled: [...new Set(next)] });
      await refresh();
      toast(okMsg);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menyimpan.", "err");
    } finally {
      setBusy(false);
    }
  }

  function toggle(name: string) {
    if (protectedSet.has(name)) return;
    const next = new Set(disabled);
    if (next.has(name)) {
      next.delete(name);
      void save(next, `/` + name + ` diaktifkan.`);
    } else {
      next.add(name);
      void save(next, `/` + name + ` dinonaktifkan — bot akan menolak command ini di Discord.`);
    }
  }

  function toggleGroup(domain: string, commands: Array<{ name: string }>, targetDisabled: boolean) {
    const next = new Set(disabled);
    for (const c of commands) {
      if (protectedSet.has(c.name)) continue;
      if (targetDisabled) next.add(c.name);
      else next.delete(c.name);
    }
    void save(next, `Grup "${domainLabel(domain)}" ${targetDisabled ? "dinonaktifkan" : "diaktifkan"}.`);
  }

  return (
    <div className="space-y-5">
      <Section
        title="Command Manager"
        desc={
          <>
            Nonaktifkan command yang tidak dipakai di server ini — persis filosofi Dyno. Command nonaktif ditolak bot
            dengan pesan jelas ke member.{" "}
            <span className="text-zinc-400">Atur juga lewat Discord: </span>
            <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-amber-200">/commands toggle</code>
          </>
        }
      >
        <div className="md:col-span-2">
          <Field label="Cari Command" hint={`${draft.commands.list.length} command total · ${disabled.size} dinonaktifkan`}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="mis. giveaway, warn, backup…"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400/50 focus:outline-none"
              />
            </div>
          </Field>
        </div>
        <div className="flex items-end gap-2 md:col-span-2">
          <Button
            onClick={() => void save([], "Semua command diaktifkan kembali.")}
            disabled={busy || disabled.size === 0}
            className="bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Aktifkan Semua
          </Button>
          {disabled.size > 0 ? (
            <Pill tone="amber">{disabled.size} dinonaktifkan</Pill>
          ) : (
            <Pill tone="green">Semua aktif</Pill>
          )}
        </div>
      </Section>

      {grouped.map(([domain, commands]) => {
        const disabledCount = commands.filter((c) => disabled.has(c.name)).length;
        return (
          <section key={domain} className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-100">
                {domainLabel(domain)}{" "}
                <span className="font-normal text-zinc-500">
                  ({commands.length} command{disabledCount > 0 ? `, ${disabledCount} off` : ""})
                </span>
              </h3>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleGroup(domain, commands, false)}
                  disabled={busy || disabledCount === 0}
                  className="h-7 border-zinc-700 bg-transparent px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                >
                  Aktifkan grup
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleGroup(domain, commands, true)}
                  disabled={busy || disabledCount === commands.filter((c) => !protectedSet.has(c.name)).length}
                  className="h-7 border-zinc-700 bg-transparent px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                >
                  Nonaktifkan grup
                </Button>
              </div>
            </div>
            <div className="mt-3 divide-y divide-zinc-800/60">
              {commands.map((c) => {
                const isOn = !disabled.has(c.name);
                const isProtected = protectedSet.has(c.name);
                return (
                  <div key={c.name} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[13px] font-medium text-zinc-100">
                        <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[12px] text-amber-200">/{c.name}</code>
                        {isProtected ? <Pill tone="green">kebal disable</Pill> : null}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">{c.description}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(c.name)}
                      disabled={busy || isProtected}
                      title={isProtected ? "Command manajemen tidak bisa dinonaktifkan (anti-lockout)" : isOn ? "Nonaktifkan" : "Aktifkan"}
                      className={`shrink-0 transition-colors ${isProtected ? "cursor-not-allowed opacity-60" : ""} ${
                        isOn ? "text-emerald-400 hover:text-emerald-300" : "text-zinc-600 hover:text-zinc-400"
                      }`}
                      aria-label={`${isOn ? "Nonaktifkan" : "Aktifkan"} /${c.name}`}
                    >
                      {isOn ? <ToggleRight className="h-6 w-6" aria-hidden="true" /> : <ToggleLeft className="h-6 w-6" aria-hidden="true" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {grouped.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
          Tidak ada command yang cocok dengan pencarian &ldquo;{query}&rdquo;.
        </p>
      ) : null}
    </div>
  );
}

/* ============================================================
 * MODUL: Giveaway
 * ============================================================ */

export function GiveawayModule({ draft, meta, call, refresh, toast }: ModuleActionProps) {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [prize, setPrize] = useState("");
  const [winners, setWinners] = useState("1");
  const [durationMin, setDurationMin] = useState("60");
  const [requiredRoleId, setRequiredRoleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const aktif = draft.giveaways.filter((g) => !g.ended);
  const selesai = draft.giveaways.filter((g) => g.ended);

  async function create() {
    setBusy(true);
    try {
      await call("giveaway", "POST", {
        channelId,
        prize: prize.trim(),
        winners: Math.max(1, parseInt(winners) || 1),
        durationMin: Math.max(1, parseInt(durationMin) || 60),
        requiredRoleId,
      });
      setPrize("");
      await refresh();
      toast("Giveaway dibuat — pesan terkirim ke channel.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal membuat giveaway.", "err");
    } finally {
      setBusy(false);
    }
  }

  function renderRow(g: (typeof draft.giveaways)[number]) {
    return (
      <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] font-medium text-zinc-100">
            <Gift className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
            {g.prize}
            {g.ended ? <Pill tone="zinc">selesai</Pill> : <Pill tone="green">berjalan</Pill>}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {g.winnersCount} pemenang · {g.participantIds.length} peserta · {channelLabel(meta.channels, g.channelId)} ·{" "}
            {g.ended ? `selesai ${fmtDate(g.endsAt)}` : `berakhir ${fmtDate(g.endsAt)}`} · host {g.hostTag}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Section title="Buat Giveaway" desc="Sama seperti /giveaway create — pesan + tombol Join/Leave dikirim bot ke channel.">
        <Field label="Channel">
          <ChannelSelect value={channelId} onChange={setChannelId} channels={meta.channels} />
        </Field>
        <Field label="Hadiah">
          <TextInput value={prize} onChange={setPrize} placeholder="mis. VIP 30 Hari" />
        </Field>
        <Field label="Jumlah Pemenang">
          <TextInput value={winners} onChange={(v) => setWinners(v.replace(/[^0-9]/g, ""))} placeholder="1" />
        </Field>
        <Field label="Durasi (menit)" hint="1 menit sampai 30 hari (43200).">
          <TextInput value={durationMin} onChange={(v) => setDurationMin(v.replace(/[^0-9]/g, ""))} placeholder="60" />
        </Field>
        <Field label="Syarat Role (opsional)">
          <RoleSelect value={requiredRoleId} onChange={setRequiredRoleId} roles={meta.roles} />
        </Field>
        <div className="flex items-end">
          <Button
            onClick={create}
            disabled={busy || !channelId || !prize.trim()}
            className="w-full bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            Mulai Giveaway
          </Button>
        </div>
      </Section>

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <h3 className="text-sm font-semibold text-zinc-100">Berjalan ({aktif.length})</h3>
        <div className="mt-4 space-y-2">
          {aktif.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
              Tidak ada giveaway aktif. Buat lewat form di atas atau /giveaway create.
            </p>
          ) : (
            aktif.map(renderRow)
          )}
        </div>
        {selesai.length > 0 ? (
          <>
            <h3 className="mt-6 text-sm font-semibold text-zinc-400">Riwayat ({selesai.length})</h3>
            <div className="mt-3 space-y-2">{selesai.slice(0, 10).map(renderRow)}</div>
          </>
        ) : null}
      </section>
    </div>
  );
}

/* ============================================================
 * MODUL: Poll
 * ============================================================ */

export function PollModule({ draft, meta, call, refresh, toast }: ModuleActionProps) {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [multiple, setMultiple] = useState(false);
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);

  async function create() {
    const clean = options.map((o) => o.trim()).filter(Boolean);
    setBusy(true);
    try {
      await call("poll", "POST", { channelId, question: question.trim(), multiple, options: clean.map((label) => ({ label })) });
      setQuestion("");
      setOptions(["", ""]);
      await refresh();
      toast("Poll dibuat — pesan + tombol vote terkirim.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal membuat poll.", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Section title="Buat Poll" desc="Sama seperti /poll create — member vote lewat tombol, hasil live di pesan.">
        <div className="md:col-span-2">
          <Field label="Channel">
            <ChannelSelect value={channelId} onChange={setChannelId} channels={meta.channels} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Pertanyaan" hint="Maks 250 karakter.">
            <TextInput value={question} onChange={setQuestion} placeholder="mis. Event berikutnya main apa?" />
          </Field>
        </div>
        <Field label="Mode Vote">
          <Select
            value={multiple ? "multi" : "single"}
            onChange={(v) => setMultiple(v === "multi")}
            options={[
              { value: "single", label: "Single — pilih satu" },
              { value: "multi", label: "Multi — boleh banyak" },
            ]}
          />
        </Field>
        <div className="md:col-span-2 space-y-2">
          <p className="text-xs font-medium text-zinc-300">Opsi (2–10)</p>
          {options.map((opt, i) => (
            <div key={i} className="flex gap-2">
              <TextInput
                value={opt}
                onChange={(v) => setOptions((prev) => prev.map((p, j) => (j === i ? v : p)))}
                placeholder={`Opsi ${i + 1}`}
              />
              {options.length > 2 ? (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                  className="shrink-0 border-zinc-700 bg-transparent hover:bg-zinc-800"
                  aria-label={`Hapus opsi ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          ))}
          {options.length < 10 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOptions((prev) => [...prev, ""])}
              className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Tambah opsi
            </Button>
          ) : null}
        </div>
        <div className="flex items-end">
          <Button
            onClick={create}
            disabled={busy || !channelId || !question.trim() || options.map((o) => o.trim()).filter(Boolean).length < 2}
            className="w-full bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <BarChart3 className="h-4 w-4" aria-hidden="true" />}
            Kirim Poll
          </Button>
        </div>
      </Section>

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <h3 className="text-sm font-semibold text-zinc-100">Poll di Server Ini ({draft.polls.length})</h3>
        <div className="mt-4 space-y-2">
          {draft.polls.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
              Belum ada poll. Buat lewat form di atas atau /poll create.
            </p>
          ) : (
            draft.polls.slice(0, 15).map((p) => {
              const total = p.options.reduce((s, o) => s + o.votes.length, 0);
              return (
                <div key={p.id} className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3">
                  <p className="flex items-center gap-2 text-[13px] font-medium text-zinc-100">
                    {p.question}
                    {p.closed ? <Pill tone="zinc">ditutup</Pill> : <Pill tone="green">terbuka</Pill>}
                    {p.multiple ? <Pill tone="amber">multi</Pill> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {p.options.length} opsi · {total} votes · {channelLabel(meta.channels, p.channelId)} · oleh {p.creatorTag} · {fmtDate(p.createdAt)}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

/* ============================================================
 * MODUL: Embed Builder (kirim embed)
 * ============================================================ */

export function EmbedModule({ meta, call, toast }: ModuleActionProps) {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [footer, setFooter] = useState("");
  const [color, setColor] = useState(0x5865f2);
  const [busy, setBusy] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    try {
      const res = (await call("embed", "POST", { channelId, title: title.trim(), description: description.trim(), footer: footer.trim() || undefined, color })) as {
        url?: string;
      };
      setLastUrl(res?.url ?? null);
      setTitle("");
      setDescription("");
      setFooter("");
      toast("Embed terkirim ke channel.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal mengirim embed.", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Section title="Kirim Embed" desc="Alternatif cepat /embed-builder & /send-message — cocok untuk pengumuman satu kali.">
        <Field label="Channel">
          <ChannelSelect value={channelId} onChange={setChannelId} channels={meta.channels} />
        </Field>
        <Field label="Judul" hint="Opsional kalau description diisi. Maks 256.">
          <TextInput value={title} onChange={setTitle} placeholder="Judul embed" />
        </Field>
        <Field label="Warna">
          <ColorInput value={color} onChange={setColor} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Isi (description)" hint="Mendukung **bold**, *italic*, dan baris baru. Maks 4096.">
            <TextArea value={description} onChange={setDescription} rows={5} placeholder="Tulis isi pesan di sini…" />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Footer (opsional)">
            <TextInput value={footer} onChange={setFooter} placeholder="mis. Dari Admin" />
          </Field>
        </div>
        <div className="flex items-end md:col-span-2">
          <Button
            onClick={send}
            disabled={busy || !channelId || (!title.trim() && !description.trim())}
            className="w-full bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            Kirim Embed
          </Button>
        </div>
      </Section>

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <h3 className="text-sm font-semibold text-zinc-100">Pratinjau</h3>
        <div className="mt-4 overflow-hidden rounded-lg border-l-4 bg-zinc-800/40 p-4" style={{ borderColor: `#${color.toString(16).padStart(6, "0")}` }}>
          <p className="text-sm font-semibold text-zinc-100">{title.trim() || <span className="text-zinc-600">(tanpa judul)</span>}</p>
          <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-300">
            {description.trim() || <span className="text-zinc-600">(tanpa isi)</span>}
          </p>
          {footer.trim() ? <p className="mt-3 text-[11px] text-zinc-500">{footer.trim()}</p> : null}
        </div>
        {lastUrl ? (
          <a href={lastUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs text-amber-300 hover:underline">
            Lihat pesan terakhir di Discord
          </a>
        ) : null}
      </section>
    </div>
  );
}

/* ============================================================
 * MODUL: Backup
 * ============================================================ */

export function BackupModule({ draft, call, refresh, toast }: ModuleActionProps) {
  const [busy, setBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  async function createNow() {
    setBusy(true);
    try {
      const res = (await call("backups", "POST", {})) as { backupName?: string };
      await refresh();
      toast(`Backup dibuat: ${res?.backupName ?? "OK"}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal membuat backup.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function restore(name: string) {
    setBusy(true);
    try {
      await call(`backups/${encodeURIComponent(name)}/restore`, "POST", {});
      await refresh();
      toast(`Backup ${name} dipulihkan. Muat ulang halaman untuk melihat data yang di-restore.`);
      setConfirmRestore(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal restore.", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Section
        title="Backup Data Bot"
        desc={
          <>
            Sama seperti <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-amber-200">/backup-now</code> —
            backup otomatis juga berjalan tiap 24 jam (maks 7 slot, terlama terdorong keluar).
          </>
        }
      >
        <div className="flex items-end">
          <Button onClick={createNow} disabled={busy} className="w-full bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            Backup Sekarang
          </Button>
        </div>
      </Section>

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <h3 className="text-sm font-semibold text-zinc-100">Slot Backup ({draft.backups.length})</h3>
        <div className="mt-4 space-y-2">
          {draft.backups.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
              Belum ada backup. Tekan &ldquo;Backup Sekarang&rdquo; di atas.
            </p>
          ) : (
            draft.backups.map((b) => (
              <div key={b.name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[13px] font-medium text-zinc-100">
                    {b.name.startsWith("pre-restore_") ? <Pill tone="amber">pre-restore</Pill> : null}
                    <code className="text-[12px] text-zinc-200">{b.name}</code>
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {fmtDate(b.mtime)} · {b.fileCount} file · {(b.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                {confirmRestore === b.name ? (
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => setConfirmRestore(null)} disabled={busy} className="h-7 border-zinc-700 bg-transparent px-2.5 text-[11px]">
                      Batal
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void restore(b.name)}
                      disabled={busy}
                      className="h-7 bg-red-500 px-2.5 text-[11px] font-semibold text-white hover:bg-red-400"
                    >
                      Ya, pulihkan
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmRestore(b.name)}
                    disabled={busy}
                    className="h-7 border-zinc-700 bg-transparent px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Restore
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
          Restore menimpa data bot dengan kondisi saat backup dibuat. Bot otomatis membuat backup pengaman
          (&ldquo;pre-restore&rdquo;) sebelum menimpa — selalu bisa mundur.
        </p>
      </section>
    </div>
  );
}

/* ============================================================
 * MODUL: Moderasi (warn + modlog viewer)
 * ============================================================ */

const MODLOG_LABEL: Record<string, string> = {
  timeout: "🔇 Timeout",
  untimeout: "🔊 Timeout lepas",
  kick: "👢 Kick",
  ban: "🔨 Ban",
  unban: "♻️ Unban",
};

export function ModerationModule({ draft, toast }: ModuleActionProps) {
  const [warnFilter, setWarnFilter] = useState("");

  const warns = useMemo(() => {
    const q = warnFilter.trim().toLowerCase();
    if (!q) return draft.warns;
    return draft.warns.filter((w) => w.reason.toLowerCase().includes(q) || w.userId.includes(q) || w.warnedByTag.toLowerCase().includes(q));
  }, [draft.warns, warnFilter]);

  return (
    <div className="space-y-5">
      <Section
        title="Riwayat Moderasi"
        desc={
          <>
            Gabungan <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-amber-200">/warn-list</code> dan
            tindakan moderator (timeout/kick/ban) — 50 entri terbaru, read-only. Tindakan tetap dari Discord.
          </>
        }
      >
        <div className="md:col-span-2">
          <Field label="Cari Warn" hint="Saring berdasarkan alasan, ID user, atau moderator.">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
              <input
                value={warnFilter}
                onChange={(e) => setWarnFilter(e.target.value)}
                placeholder="mis. spam, 123456789…"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400/50 focus:outline-none"
              />
            </div>
          </Field>
        </div>
      </Section>

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <ShieldAlert className="h-4 w-4 text-amber-300" aria-hidden="true" />
          Warn ({warns.length} terbaru)
        </h3>
        <div className="mt-4 space-y-2">
          {warns.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
              {draft.warns.length === 0 ? "Tidak ada warn tercatat di server ini. Server yang bersih adalah server yang bahagia." : "Tidak ada warn yang cocok dengan pencarian."}
            </p>
          ) : (
            warns.map((w) => (
              <div key={w.id} className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3">
                <p className="text-[13px] text-zinc-100">
                  <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">{w.userId}</code>{" "}
                  — {w.reason}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  oleh {w.warnedByTag} · {fmtDate(w.createdAt)}
                  {w.actionTaken ? ` · aksi otomatis: ${w.actionTaken}` : ""}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <h3 className="text-sm font-semibold text-zinc-100">Tindakan Moderator ({draft.modlogs.length} terbaru)</h3>
        <div className="mt-4 space-y-2">
          {draft.modlogs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
              Belum ada tindakan timeout/kick/ban tercatat.
            </p>
          ) : (
            draft.modlogs.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] text-zinc-100">
                    {MODLOG_LABEL[m.type] ?? m.type} — <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">{m.userId}</code>
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {m.reason} · oleh {m.moderatorTag} · {fmtDate(m.createdAt)}
                  </p>
                </div>
                {m.durationMs ? <Pill tone="amber">{fmtDuration(m.durationMs)}</Pill> : null}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

/* ============================================================
 * MODUL: Keys (Kunci VIP)
 * ============================================================ */

export function KeysModule({ draft, meta, call, refresh, toast }: ModuleActionProps) {
  const [userId, setUserId] = useState("");
  const [value, setValue] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);

  const produkBerrole = draft.config.products.filter((p) => p.roleId);

  async function generate() {
    setBusy(true);
    try {
      const res = (await call("keys", "POST", {
        userId: userId.trim(),
        value,
        key: customKey.trim() || undefined,
      })) as { key?: string; warnings?: string[] };
      setLastKey(res?.key ?? null);
      setUserId("");
      setCustomKey("");
      await refresh();
      toast(res?.warnings?.length ? `Key dibuat, tapi: ${res.warnings.join(" ")}` : `Key dibuat & role diberikan.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal membuat key.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function clearUser(uid: string) {
    setBusy(true);
    try {
      await call(`keys?userId=${encodeURIComponent(uid)}`, "DELETE");
      await refresh();
      toast(`Semua key milik ${uid} dihapus + role produk dilepas.`);
      setConfirmClear(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menghapus key.", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Section
        title="Beri Kunci VIP"
        desc={
          <>
            Sama seperti <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-amber-200">/set-key</code> —
            key dibuat, role produk diberikan ke member, dan auto-expire dijadwalkan otomatis.
          </>
        }
      >
        <Field label="ID Discord User" hint="Klik kanan user di Discord → Salin ID User (aktifkan Mode Developer).">
          <TextInput value={userId} onChange={(v) => setUserId(v.replace(/[^0-9]/g, ""))} placeholder="mis. 123456789012345678" />
        </Field>
        <Field label="Produk" hint={produkBerrole.length === 0 ? "Belum ada produk dengan role — atur dulu di modul Tiket & Produk." : undefined}>
          <Select
            value={value}
            onChange={setValue}
            options={[
              { value: "", label: "— pilih produk —" },
              ...produkBerrole.map((p) => ({ value: p.value, label: `${p.label} (${p.days ? `${p.days} hari` : "permanen"})` })),
            ]}
          />
        </Field>
        <Field label="Kode Key Custom (opsional)" hint="Kosong = dibuat otomatis format XXXXX-XXXXX-XXXXX.">
          <TextInput value={customKey} onChange={setCustomKey} placeholder="GIFT-2026-THOR" />
        </Field>
        <div className="flex items-end">
          <Button
            onClick={generate}
            disabled={busy || !userId.trim() || !value}
            className="w-full bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
            Buat Key
          </Button>
        </div>
      </Section>

      {lastKey ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4">
          <p className="text-xs text-emerald-300">Key terakhir yang dibuat — kirim ke member:</p>
          <code className="mt-1.5 block select-all rounded-lg bg-zinc-900 px-3 py-2 font-mono text-sm text-emerald-200">{lastKey}</code>
        </div>
      ) : null}

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <h3 className="text-sm font-semibold text-zinc-100">Key Aktif di Server Ini ({draft.keys.length})</h3>
        <div className="mt-4 space-y-2">
          {draft.keys.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
              Belum ada key untuk server ini. Buat lewat form di atas atau /set-key.
            </p>
          ) : (
            draft.keys.map((k) => {
              const expired = k.expireAt !== null && k.expireAt < Date.now();
              return (
                <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[13px] text-zinc-100">
                      <code className="select-all rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[12px] text-amber-200">{k.key}</code>
                      {k.expireAt === null ? <Pill tone="green">permanen</Pill> : expired ? <Pill tone="red">kedaluwarsa</Pill> : <Pill tone="zinc">{fmtDate(k.expireAt)}</Pill>}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {k.username || k.userId} · {k.productName} · {roleLabel(meta.roles, k.roleId)} · dibuat {fmtDate(k.createdAt)}
                    </p>
                  </div>
                  {confirmClear === k.userId ? (
                    <div className="flex items-center gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => setConfirmClear(null)} disabled={busy} className="h-7 border-zinc-700 bg-transparent px-2.5 text-[11px]">
                        Batal
                      </Button>
                      <Button size="sm" onClick={() => void clearUser(k.userId)} disabled={busy} className="h-7 bg-red-500 px-2.5 text-[11px] font-semibold text-white hover:bg-red-400">
                        Ya, hapus semua
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmClear(k.userId)}
                      disabled={busy}
                      className="h-7 border-zinc-700 bg-transparent px-2.5 text-[11px] text-red-300 hover:bg-red-950/30"
                      title="Hapus semua key user ini + lepas role produk (paritas /clear-schedule)"
                    >
                      <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Bersihkan
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
