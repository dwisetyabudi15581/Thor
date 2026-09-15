"use client";

// Modul-aksi dashboard: panel dengan operasi LANGSUNG (CRUD lewat API bot,
// tanpa SaveBar) — responder, panel self-role, pengumuman terjadwal,
// temp voice, server stats.
//
// Kontrak: call(action, method, body) → promise hasil proxy web ke DASH API,
// diikuti refresh() untuk menarik ulang payload dari bot.

import { useState } from "react";
import { Plus, Trash2, Loader2, RefreshCw, Clock, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field, Section, TextInput, TextArea, Toggle, Select, ChannelSelect, RoleSelect, Pill, channelLabel, roleLabel,
} from "../fields";
import type { DashboardPayload, GuildMeta } from "@/lib/bot-api";

export type ModuleActionProps = {
  draft: DashboardPayload;
  meta: GuildMeta;
  call: (action: string, method: "POST" | "PUT" | "DELETE", body?: unknown) => Promise<unknown>;
  refresh: () => Promise<void>;
  toast: (msg: string, tone?: "ok" | "err") => void;
};

/* ============================================================
 * MODUL: Auto-Responder
 * ============================================================ */

export function RespondersModule({ draft, call, refresh, toast }: ModuleActionProps) {
  const [trigger, setTrigger] = useState("");
  const [reply, setReply] = useState("");
  const [matchMode, setMatchMode] = useState("contains");
  const [replyType, setReplyType] = useState("text");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!trigger.trim() || !reply.trim()) {
      toast("Trigger dan balasan wajib diisi.", "err");
      return;
    }
    setBusy(true);
    try {
      await call("responders", "POST", { trigger: trigger.trim(), reply: reply.trim(), matchMode, replyType, cooldownMs: 3000 });
      setTrigger("");
      setReply("");
      await refresh();
      toast("Responder ditambahkan.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menambah responder.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: string) {
    try {
      await call(`responders?trigger=${encodeURIComponent(t)}`, "DELETE");
      await refresh();
      toast(`Responder "${t}" dihapus.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menghapus.", "err");
    }
  }

  return (
    <div className="space-y-5">
      <Section title="Tambah Responder" desc="Kata pemicu → bot membalas otomatis. Cooldown 3 detik per user agar tidak di-spam.">
        <Field label="Kata Pemicu" hint="Case-insensitive. “contains” = cocok sebagai kata utuh di mana saja.">
          <TextInput value={trigger} onChange={setTrigger} placeholder="mis. harga" />
        </Field>
        <Field label="Mode Cocok">
          <Select
            value={matchMode}
            onChange={setMatchMode}
            options={[
              { value: "contains", label: "Mengandung kata (utuh)" },
              { value: "exact", label: "Diawali kata (persis)" },
            ]}
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Balasan Bot" hint="Bisa multi-baris. Embed = tampil sebagai kartu rapi.">
            <TextArea value={reply} onChange={setReply} rows={3} placeholder="Cek channel #harga ya!" />
          </Field>
        </div>
        <Field label="Bentuk Balasan">
          <Select
            value={replyType}
            onChange={setReplyType}
            options={[
              { value: "text", label: "Teks biasa" },
              { value: "embed", label: "Embed" },
            ]}
          />
        </Field>
        <div className="flex items-end">
          <Button onClick={add} disabled={busy} className="w-full bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            Tambah Responder
          </Button>
        </div>
      </Section>

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <h3 className="text-sm font-semibold text-zinc-100">Daftar Responder ({draft.responders.length})</h3>
        <div className="mt-4 space-y-2">
          {draft.responders.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
              Belum ada responder otomatis.
            </p>
          ) : null}
          {draft.responders.map((r) => (
            <div key={r.id} className="flex items-start gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-xs text-amber-300">{r.trigger}</code>
                  <Pill>{r.matchMode === "exact" ? "persis" : "mengandung"}</Pill>
                  <Pill>{r.replyType}</Pill>
                  {r.useCount ? <Pill tone="green">{r.useCount}× terpakai</Pill> : null}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-zinc-400 line-clamp-3">{r.reply}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => remove(r.trigger)}
                className="h-8 w-8 shrink-0 text-zinc-500 hover:text-red-400 hover:bg-red-950/30"
                title="Hapus responder"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ============================================================
 * MODUL: Self Roles
 * ============================================================ */

const STYLE_OPTS = [
  { value: "Primary", label: "Biru" },
  { value: "Secondary", label: "Abu" },
  { value: "Success", label: "Hijau" },
  { value: "Danger", label: "Merah" },
];

export function SelfRolesModule({ draft, meta, call, refresh, toast }: ModuleActionProps) {
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [title, setTitle] = useState("🎭 Pilih Role Kamu");
  const [description, setDescription] = useState("Klik tombol untuk ambil / lepas role.");
  const [type, setType] = useState("button");
  const [exclusive, setExclusive] = useState(false);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [roleLabel, setRoleLabel] = useState("");
  const [roleEmoji, setRoleEmoji] = useState("");
  const [roles, setRoles] = useState<Array<{ roleId: string; label: string; emoji?: string; style: string }>>([]);
  const [busy, setBusy] = useState(false);

  async function createPanel() {
    if (!channelId) {
      toast("Pilih channel tujuan panel.", "err");
      return;
    }
    if (roles.length === 0) {
      toast("Tambahkan minimal 1 role ke panel.", "err");
      return;
    }
    setBusy(true);
    try {
      await call("selfroles", "POST", { channelId, title, description, type, exclusive, roles });
      setOpen(false);
      setRoles([]);
      await refresh();
      toast("Panel self-role terkirim.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal membuat panel.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function deletePanel(id: string) {
    try {
      await call(`selfroles/${id}`, "DELETE");
      await refresh();
      toast("Panel dihapus.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menghapus panel.", "err");
    }
  }

  return (
    <div className="space-y-5">
      {!open ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Panel Self-Role</h3>
            <p className="mt-1 text-xs text-zinc-500">Buat panel tombol/select — member mengambil role sendiri tanpa admin.</p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)} className="bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold">
            <Plus className="h-4 w-4" aria-hidden="true" /> Panel Baru
          </Button>
        </div>
      ) : (
        <Section title="Panel Self-Role Baru" desc="Panel dikirim sebagai message ke channel pilihanmu — member tinggal klik.">
          <Field label="Channel Tujuan">
            <ChannelSelect value={channelId} onChange={setChannelId} channels={meta.channels} placeholder="Pilih channel…" />
          </Field>
          <Field label="Judul Panel">
            <TextInput value={title} onChange={setTitle} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Deskripsi">
              <TextArea value={description} onChange={setDescription} rows={2} />
            </Field>
          </div>
          <Field label="Bentuk Panel">
            <Select
              value={type}
              onChange={setType}
              options={[
                { value: "button", label: "Tombol (maks 25 role)" },
                { value: "select", label: "Dropdown select" },
              ]}
            />
          </Field>
          <div className="flex items-end">
            <div className="w-full">
              <Toggle
                checked={exclusive}
                onChange={setExclusive}
                label="Eksklusif"
                desc="Member hanya boleh pegang satu role dari panel ini."
              />
            </div>
          </div>
          <div className="md:col-span-2 space-y-2">
            <p className="text-[13px] font-medium text-zinc-300">Role di panel ({roles.length})</p>
            <div className="flex flex-wrap gap-2">
              {roles.map((r, i) => (
                <span key={`${r.roleId}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/60 bg-zinc-800/40 py-1 pl-3 pr-1.5 text-xs text-zinc-300">
                  {r.emoji ? <span>{r.emoji}</span> : null}
                  {r.label}
                  <button
                    type="button"
                    onClick={() => setRoles(roles.filter((_, idx) => idx !== i))}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-zinc-500 hover:bg-red-950/40 hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_90px_1fr_auto]">
              <RoleSelect value={roleId} onChange={setRoleId} roles={meta.roles} placeholder="Pilih role…" />
              <TextInput value={roleEmoji} onChange={setRoleEmoji} placeholder="🔔" />
              <TextInput value={roleLabel} onChange={setRoleLabel} placeholder="Label tombol" />
              <Button
                size="sm"
                variant="outline"
                className="h-10 shrink-0 border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-zinc-100"
                onClick={() => {
                  if (!roleId) {
                    toast("Pilih role dulu.", "err");
                    return;
                  }
                  if (roles.some((r) => r.roleId === roleId)) {
                    toast("Role sudah ada di panel.", "err");
                    return;
                  }
                  setRoles([...roles, { roleId, label: roleLabel.trim() || meta.roles.find((r) => r.id === roleId)?.name || "Role", emoji: roleEmoji.trim() || undefined, style: "Secondary" }]);
                  setRoleId(null);
                  setRoleLabel("");
                  setRoleEmoji("");
                }}
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> Role
              </Button>
            </div>
          </div>
          <div className="flex items-end gap-2 md:col-span-2">
            <Button onClick={createPanel} disabled={busy} className="bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Kirim Panel
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-100">
              Batal
            </Button>
          </div>
        </Section>
      )}

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <h3 className="text-sm font-semibold text-zinc-100">Panel Aktif ({draft.selfroles.length})</h3>
        <div className="mt-4 space-y-2">
          {draft.selfroles.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
              Belum ada panel self-role di server ini.
            </p>
          ) : null}
          {draft.selfroles.map((p) => (
            <div key={p.id} className="flex items-start gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-zinc-200">{p.title}</p>
                  <Pill>{p.type === "select" ? "dropdown" : "tombol"}</Pill>
                  {p.exclusive ? <Pill tone="amber">eksklusif</Pill> : null}
                  <span className="text-[11px] text-zinc-500">{channelLabel(meta.channels, p.channelId)}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{p.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.roles.map((r) => (
                    <span key={r.roleId} className="rounded-full bg-zinc-800/50 px-2 py-0.5 text-[10px] text-zinc-400">
                      {r.emoji ? `${r.emoji} ` : ""}{r.label}
                    </span>
                  ))}
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => deletePanel(p.id)}
                className="h-8 w-8 shrink-0 text-zinc-500 hover:text-red-400 hover:bg-red-950/30"
                title="Hapus panel + message"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ============================================================
 * MODUL: Announce Terjadwal
 * ============================================================ */

export function AnnounceModule({ draft, meta, call, refresh, toast }: ModuleActionProps) {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [when, setWhen] = useState("");
  const [recurring, setRecurring] = useState("");
  const [mention, setMention] = useState("");
  const [busy, setBusy] = useState(false);

  const pending = draft.announces.filter((a) => !a.sent);

  async function schedule() {
    if (!channelId || !title.trim() || !description.trim() || !when) {
      toast("Lengkapi channel, judul, isi, dan waktu kirim.", "err");
      return;
    }
    const ts = new Date(when).getTime();
    if (Number.isNaN(ts) || ts < Date.now() - 60000) {
      toast("Waktu kirim harus di masa depan.", "err");
      return;
    }
    setBusy(true);
    try {
      await call("announce", "POST", {
        channelId,
        sendAt: ts,
        title: title.trim(),
        description: description.trim(),
        recurring: recurring || null,
        mention: mention.trim() || null,
      });
      setTitle("");
      setDescription("");
      setWhen("");
      setRecurring("");
      setMention("");
      await refresh();
      toast("Pengumuman dijadwalkan.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menjadwalkan.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    try {
      await call(`announce/${id}`, "DELETE");
      await refresh();
      toast("Pengumuman dibatalkan.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal membatalkan.", "err");
    }
  }

  return (
    <div className="space-y-5">
      <Section title="Jadwalkan Pengumuman" desc="Embed terkirim otomatis pada waktu yang ditentukan — sekali atau berulang.">
        <Field label="Channel Tujuan">
          <ChannelSelect value={channelId} onChange={setChannelId} channels={meta.channels} placeholder="Pilih channel…" />
        </Field>
        <Field label="Waktu Kirim" hint="Zona waktu sesuai perangkatmu.">
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full h-10 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 text-sm text-zinc-100 focus:outline-none focus:border-amber-400/50 [color-scheme:dark]"
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Judul">
            <TextInput value={title} onChange={setTitle} placeholder="mis. 🎉 Event Akhir Pekan" />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Isi Pengumuman">
            <TextArea value={description} onChange={setDescription} rows={3} placeholder="Detail acara, link, dll." />
          </Field>
        </div>
        <Field label="Pengulangan">
          <Select
            value={recurring}
            onChange={setRecurring}
            options={[
              { value: "", label: "Sekali kirim" },
              { value: "daily", label: "Setiap hari" },
              { value: "weekly", label: "Setiap minggu" },
              { value: "monthly", label: "Setiap bulan" },
            ]}
          />
        </Field>
        <Field label="Mention (opsional)" hint="mis. @everyone atau <@&roleId>">
          <TextInput value={mention} onChange={setMention} placeholder="@everyone" />
        </Field>
        <div className="md:col-span-2">
          <Button onClick={schedule} disabled={busy} className="bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Clock className="h-4 w-4" aria-hidden="true" />}
            Jadwalkan
          </Button>
        </div>
      </Section>

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <h3 className="text-sm font-semibold text-zinc-100">Menunggu Terkirim ({pending.length})</h3>
        <div className="mt-4 space-y-2">
          {pending.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
              Tidak ada pengumuman terjadwal.
            </p>
          ) : null}
          {pending.map((a) => (
            <div key={a.id} className="flex items-start gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-zinc-200">{a.data.title}</p>
                  {a.recurring ? <Pill tone="amber">{a.recurring}</Pill> : null}
                </div>
                <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{a.data.description}</p>
                <p className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {new Date(a.sendAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
                  <span className="text-zinc-600">·</span>
                  {channelLabel(meta.channels, a.channelId)}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => cancel(a.id)}
                className="h-8 w-8 shrink-0 text-zinc-500 hover:text-red-400 hover:bg-red-950/30"
                title="Batalkan pengumuman"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ============================================================
 * MODUL: Temp Voice & Server Stats (status + aksi)
 * ============================================================ */

export function TempVoiceModule({ draft, meta, call, refresh, toast }: ModuleActionProps) {
  const tv = draft.tempvoice;
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-5">
      <Section title="Temporary Voice" desc="Channel suara privat per member — dibuat otomatis saat member join channel pemicu.">
        {tv ? (
          <>
            <Field label="Channel Pemicu" hint="Member join channel ini → bot membuat channel privat miliknya.">
              <div className="flex h-10 items-center rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 text-sm text-zinc-300">
                🔊 {channelLabel(meta.channels, tv.creatorChannelId)}
              </div>
            </Field>
            <Field label="Kategori">
              <div className="flex h-10 items-center rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 text-sm text-zinc-300">
                {tv.categoryId ? `Kategori ${tv.categoryId.slice(0, 10)}…` : "—"}
              </div>
            </Field>
            <div className="flex items-end">
              <div className="w-full rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-4 text-xs leading-relaxed text-zinc-500">
                <p><b className="text-zinc-300">{tv.activeChannels}</b> channel voice aktif saat ini.</p>
                <p className="mt-1.5">Ubah channel/kategori lewat <code className="text-amber-300/80">/setup-tempvoice</code> di Discord — setup membuat kategori + panel kontrol sekaligus.</p>
              </div>
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await call("tempvoice", "DELETE");
                    await refresh();
                    toast("Setup temp voice dilepas (channel fisik tidak dihapus).");
                  } catch (e) {
                    toast(e instanceof Error ? e.message : "Gagal melepas setup.", "err");
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full border-red-900/60 bg-transparent text-red-300 hover:bg-red-950/30 hover:text-red-200"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                Lepas Setup
              </Button>
            </div>
          </>
        ) : (
          <div className="md:col-span-2 rounded-xl border border-dashed border-zinc-800 p-6 text-center">
            <p className="text-xs text-zinc-400">Temp voice belum di-setup di server ini.</p>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
              Jalankan <code className="text-amber-300/80">/setup-tempvoice</code> di Discord — bot membuat kategori,
              channel pemicu, dan panel kontrol otomatis (anti-orphan: gagal di tengah = rollback).
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}

export function ServerStatsModule({ draft, call, refresh, toast }: ModuleActionProps) {
  const enabled = draft.serverstats?.enabled;
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-5">
      <Section title="Server Stats Live" desc="Counter di nama channel: member, bot, boost, role, channel — ter-update otomatis (aman rate-limit Discord).">
        <div className="md:col-span-2 flex items-center gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-4">
          <span className={`relative flex h-2 w-2 ${enabled ? "" : "grayscale"}`}>
            {enabled ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" /> : null}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${enabled ? "bg-emerald-400" : "bg-zinc-600"}`} />
          </span>
          <p className="text-sm text-zinc-300">{enabled ? "Counter aktif dan berjalan." : "Counter belum di-setup."}</p>
        </div>
        {enabled ? (
          <div className="md:col-span-2 flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await call("serverstats/refresh", "POST");
                  await refresh();
                  toast("Counter di-refresh.");
                } catch (e) {
                  toast(e instanceof Error ? e.message : "Gagal refresh.", "err");
                } finally {
                  setBusy(false);
                }
              }}
              className="border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-zinc-100"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              Refresh Sekarang
            </Button>
            <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              Setup/ubah pilihan counter: <code className="text-amber-300/80">/serverstats setup</code> di Discord.
            </p>
          </div>
        ) : (
          <div className="md:col-span-2 rounded-xl border border-dashed border-zinc-800 p-6 text-center">
            <p className="text-xs leading-relaxed text-zinc-500">
              Jalankan <code className="text-amber-300/80">/serverstats setup</code> di Discord untuk membuat kategori
              + 5 channel counter. Setelah aktif, kamu bisa memaksa refresh dari sini.
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ============================================================
 * MODUL: Overview ringkas (dipakai guild-dashboard)
 * ============================================================ */

export function ModuleOverview({ draft, meta }: { draft: DashboardPayload; meta: GuildMeta }) {
  const c = draft.config;
  const mods = [
    { name: "AutoMod", on: draft.automod.enabled, note: draft.automod.blockLinks ? "spam + link + kata" : "spam + kata" },
    { name: "Leveling", on: c.leveling.enabled, note: `${c.levelRoles.length} role reward` },
    { name: "Auto-Role", on: (c.autorole?.roleIds?.length ?? 0) > 0, note: c.autorole?.removeOnNewRole ? `${c.autorole?.roleIds?.length ?? 0} role join · hilang saat role baru` : `${c.autorole?.roleIds?.length ?? 0} role join` },
    { name: "Tiket", on: c.ticketCategories.length > 0, note: `${c.ticketCategories.length} kategori · ${c.products.length} produk` },
    { name: "Rekber", on: true, note: `${c.midman.feeMode === "percent" ? `${c.midman.feeValue}%` : `flat ${c.midman.feeValue}`} fee` },
    { name: "Responder", on: draft.responders.length > 0, note: `${draft.responders.length} pemicu` },
    { name: "Self Roles", on: draft.selfroles.length > 0, note: `${draft.selfroles.length} panel` },
    { name: "Temp Voice", on: Boolean(draft.tempvoice), note: draft.tempvoice ? `${draft.tempvoice.activeChannels} channel aktif` : "belum setup" },
    { name: "Server Stats", on: Boolean(draft.serverstats?.enabled), note: draft.serverstats?.enabled ? "counter live" : "belum setup" },
    { name: "Announce", on: draft.announces.filter((a) => !a.sent).length > 0, note: `${draft.announces.filter((a) => !a.sent).length} terjadwal` },
  ];
  const textChannels = meta.channels.filter((ch) => ch.type === 0).length;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { l: "Member", v: meta.memberCount?.toLocaleString("id-ID") ?? "—" },
          { l: "Channel", v: `${meta.channels.length} (${textChannels} teks)` },
          { l: "Role", v: String(meta.roles.length) },
        ].map((s) => (
          <div key={s.l} className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5">
            <p className="text-xs text-zinc-500">{s.l}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums text-zinc-100">{s.v}</p>
          </div>
        ))}
      </div>
      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <h3 className="text-sm font-semibold text-zinc-100">Status Modul</h3>
        <p className="mt-1 text-xs text-zinc-500">Ringkasan modul aktif — klik modul di sidebar untuk mengatur.</p>
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          {mods.map((m) => (
            <div key={m.name} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/40 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-zinc-200">{m.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">{m.note}</p>
              </div>
              {m.on ? <Pill tone="green">aktif</Pill> : <Pill tone="red">mati</Pill>}
            </div>
          ))}
        </div>
      </section>
      <p className="px-1 text-[11px] text-zinc-600">
        Perubahan konfigurasi dikumpulkan sebagai draft dan baru diterapkan setelah kamu menekan Simpan.
      </p>
    </div>
  );
}
