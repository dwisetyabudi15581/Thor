"use client";

// Modul-form dashboard: panel yang mengedit CONFIG BOT (perubahan dikumpulkan
// sebagai draft lalu disimpan sekaligus lewat SaveBar — pola ala Dyno).
//
// Kontrak dengan guild-dashboard.tsx:
//   draft     — salinan editable payload (config/automod dimutasi via setter)
//   setConfig — tandai dirty + ubah draft.config lewat dotPath
//   setAutomod— tandai dirty + merge patch ke draft.automod
//   meta      — channels/roles guild (untuk picker)
//   toast     — notifikasi kecil

import { useState } from "react";
import { Plus, Trash2, GripVertical, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field, Section, TextInput, TextArea, Toggle, Select, ChannelSelect, RoleSelect, ColorInput, Pill,
} from "../fields";
import type { AutoModConfig, DashboardPayload, GuildMeta, Product, TicketCategory } from "@/lib/bot-api";

export type ModuleFormProps = {
  draft: DashboardPayload;
  meta: GuildMeta;
  setConfig: (dotPath: string, value: unknown) => void;
  setAutomod: (patch: Partial<AutoModConfig>) => void;
  toast: (msg: string, tone?: "ok" | "err") => void;
};

/* ============================================================
 * MODUL: Umum (roles, channels, pesan, tombol verifikasi, warna)
 * ============================================================ */

const TEMPLATE_VARS = (
  <span>
    Variabel tersedia: <code className="text-amber-300/80">{"{user}"}</code>{" "}
    <code className="text-amber-300/80">{"{username}"}</code>{" "}
    <code className="text-amber-300/80">{"{server}"}</code>{" "}
    <code className="text-amber-300/80">{"{count}"}</code>{" "}
    <code className="text-amber-300/80">{"{action}"}</code>
  </span>
);

export function GeneralModule({ draft, meta, setConfig }: ModuleFormProps) {
  const c = draft.config;
  // v3.22.0: state lokal picker untuk editor daftar auto-role.
  const [autorolePick, setAutorolePick] = useState<string | null>(null);
  const autoroleIds = c.autorole?.roleIds ?? [];
  // v3.23.0: toggle "role join hilang saat member dapat role lain" —
  // pengganti konsep role penanda Unverified yang dihapus.
  const removeOnNewRole = c.autorole?.removeOnNewRole ?? false;

  const addAutorole = () => {
    if (!autorolePick || autoroleIds.includes(autorolePick)) return;
    setConfig("autorole", [...autoroleIds, autorolePick]);
    setAutorolePick(null);
  };
  const removeAutorole = (id: string) => {
    setConfig("autorole", autoroleIds.filter((r) => r !== id));
  };

  return (
    <div className="space-y-5">
      <Section title="Role Penting" desc="Role admin bot. Pilih dari daftar role server.">
        <Field label="Role Admin Bot" hint="Pemegang role ini bisa memakai seluruh command admin di server.">
          <RoleSelect value={c.roles.admin ?? null} onChange={(v) => setConfig("roles.admin", v)} roles={meta.roles} />
        </Field>
      </Section>

      <Section title="Auto-Role Saat Join" desc="Role yang diberikan otomatis ke setiap member baru (≙ /set-autorole, maks 10). Nyalakan toggle di bawah kalau mau role-nya hilang begitu member mendapat role lain.">
        <div className="md:col-span-2">
          <div className="flex flex-wrap gap-2">
            {autoroleIds.length === 0 ? (
              <span className="text-xs text-zinc-500">Belum ada role join — tambahkan satu di bawah (mis. @Member, atau @Unverified sebagai penanda member baru).</span>
            ) : (
              autoroleIds.map((id) => (
                <span key={id} className="flex items-center gap-1 rounded-lg border border-zinc-700/70 bg-zinc-900/60 px-2.5 py-1 text-xs text-zinc-300">
                  <span className="text-zinc-500">@</span>
                  {meta.roles.find((r) => r.id === id)?.name ?? id}
                  <button type="button" onClick={() => removeAutorole(id)} className="ml-1 text-zinc-500 hover:text-red-400" aria-label="Hapus role">×</button>
                </span>
              ))
            )}
          </div>
        </div>
        <Field label="Tambah role ke daftar join" hint={`${autoroleIds.length}/10 role`}>
          <div className="flex gap-2">
            <RoleSelect value={autorolePick} onChange={setAutorolePick} roles={meta.roles} placeholder="— pilih role —" />
            <Button
              type="button"
              onClick={addAutorole}
              disabled={!autorolePick || autoroleIds.includes(autorolePick) || autoroleIds.length >= 10}
              className="shrink-0 bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Tambah
            </Button>
          </div>
        </Field>
        <div className="md:col-span-2">
          <Toggle
            checked={removeOnNewRole}
            onChange={(v) => setConfig("autorole.removeOnNewRole", v)}
            label="Hapus role join saat member dapat role lain"
            desc="Saat aktif: SEMUA role di daftar di atas otomatis dilepas begitu member menerima role lain apa pun (panel self-role, reward level, pemberian admin, bot lain…). Cocok untuk role penanda member baru. Saat mati: role join permanen ala Dyno."
          />
        </div>
      </Section>

      <Section title="Channel Sistem" desc="Tujuan pesan otomatis bot.">
        <Field label="Channel Welcome" hint="Pesan selamat datang dikirim ke sini.">
          <ChannelSelect value={c.channels.welcome ?? null} onChange={(v) => setConfig("channels.welcome", v)} channels={meta.channels} />
        </Field>
        <Field label="Channel Goodbye" hint="Pesan perpisahan dikirim ke sini.">
          <ChannelSelect value={c.channels.goodbye ?? null} onChange={(v) => setConfig("channels.goodbye", v)} channels={meta.channels} />
        </Field>
        <Field label="Channel Invoice" hint="Invoice transaksi (tiket + rekber) terkirim ke sini.">
          <ChannelSelect value={c.channels.invoice ?? null} onChange={(v) => setConfig("channels.invoice", v)} channels={meta.channels} />
        </Field>
        {/* v3.21.0: paritas penuh kategori "Log & Channel" (/set-channel semua tipe) —
            sebelumnya server-log / server-booster / transcript hanya bisa diatur
            lewat slash command. */}
        <Field label="Channel Log Server" hint="Join/left, pesan dihapus, ban, tindakan moderasi (≙ /set-channel server-log).">
          <ChannelSelect value={c.channels["server-log"] ?? null} onChange={(v) => setConfig("channels.server-log", v)} channels={meta.channels} />
        </Field>
        <Field label="Channel Booster" hint="Embed pink tiap ada yang boost server (≙ /set-channel server-booster).">
          <ChannelSelect value={c.channels["server-booster"] ?? null} onChange={(v) => setConfig("channels.server-booster", v)} channels={meta.channels} />
        </Field>
        <Field label="Channel Transcript Tiket" hint="Arsip chat tiket yang sudah ditutup (≙ /set-channel transcript).">
          <ChannelSelect value={c.channels.transcript ?? null} onChange={(v) => setConfig("channels.transcript", v)} channels={meta.channels} />
        </Field>
      </Section>

      <Section title="Pesan Welcome & Goodbye" desc={TEMPLATE_VARS}>
        <Field label="Judul Welcome">
          <TextInput value={c.messages.welcomeTitle} onChange={(v) => setConfig("messages.welcomeTitle", v)} placeholder="👋 SELAMAT DATANG!" />
        </Field>
        <Field label="Judul Goodbye">
          <TextInput value={c.messages.goodbyeTitle} onChange={(v) => setConfig("messages.goodbyeTitle", v)} placeholder="👋 SELAMAT JALAN" />
        </Field>
        <div className="md:col-span-2">
          <Field label="Isi Welcome" hint={TEMPLATE_VARS}>
            <TextArea value={c.messages.welcomeBody} onChange={(v) => setConfig("messages.welcomeBody", v)} rows={5} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Isi Goodbye" hint={TEMPLATE_VARS}>
            <TextArea value={c.messages.goodbyeBody} onChange={(v) => setConfig("messages.goodbyeBody", v)} rows={4} />
          </Field>
        </div>
      </Section>

      <Section title="Warna Embed Bot" desc="Warna tepi embed yang dipakai seluruh notifikasi bot di server ini.">
        {(["success", "danger", "primary", "warning", "info"] as const).map((k) => (
          <Field key={k} label={k.charAt(0).toUpperCase() + k.slice(1)}>
            <ColorInput value={c.colors[k] ?? 0} onChange={(v) => setConfig(`colors.${k}`, v)} />
          </Field>
        ))}
      </Section>
    </div>
  );
}

/* ============================================================
 * MODUL: Tiket & Produk
 * ============================================================ */

const STYLE_OPTS = [
  { value: "Primary", label: "Biru" },
  { value: "Secondary", label: "Abu" },
  { value: "Success", label: "Hijau" },
  { value: "Danger", label: "Merah" },
];

export function TicketsModule({ draft, meta, setConfig, toast }: ModuleFormProps) {
  const c = draft.config;
  const cats = c.ticketCategories;
  const products = c.products;

  function updateCat(idx: number, patch: Partial<TicketCategory>) {
    const next = cats.map((cat, i) => (i === idx ? { ...cat, ...patch } : cat));
    setConfig("ticketCategories", next);
  }
  function addCat() {
    if (cats.length >= 25) {
      toast("Maksimal 25 kategori (batas Discord).", "err");
      return;
    }
    const id = `cat${Date.now().toString(36).slice(-4)}`;
    setConfig("ticketCategories", [...cats, { id, label: "Kategori Baru", emoji: "🎫", style: "Primary", requiresKey: false }]);
  }
  function removeCat(idx: number) {
    if (cats.length <= 1) {
      toast("Minimal harus ada 1 kategori.", "err");
      return;
    }
    setConfig("ticketCategories", cats.filter((_, i) => i !== idx));
  }
  function updateProduct(idx: number, patch: Partial<Product>) {
    const next = products.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    setConfig("products", next);
  }
  function addProduct() {
    if (products.length >= 25) {
      toast("Maksimal 25 produk (batas dropdown Discord).", "err");
      return;
    }
    const cat = cats[0]?.id ?? "transaction";
    setConfig("products", [
      ...products,
      { label: "Produk Baru", value: `prd${Date.now().toString(36).slice(-4)}`, price: "Rp 10.000", category: cat, requiresKey: true },
    ]);
  }

  return (
    <div className="space-y-5">
      <Section title="Panel Tiket" desc="Tampilan embed panel tiket yang dikirim bot ke channel tiket.">
        <Field label="Judul Panel">
          <TextInput value={c.messages.ticketTitle} onChange={(v) => setConfig("messages.ticketTitle", v)} />
        </Field>
        <Field label="Header Price List">
          <TextInput value={c.messages.ticketPriceHeader} onChange={(v) => setConfig("messages.ticketPriceHeader", v)} />
        </Field>
        <div className="md:col-span-2">
          <Field
            label="Isi Panel Tiket"
            hint={
              <span>
                Variabel: <code className="text-amber-300/80">{"{price_list}"}</code>{" "}
                <code className="text-amber-300/80">{"{price_list:<kategori>}"}</code>{" "}
                <code className="text-amber-300/80">{"{price_header}"}</code>{" "}
                <code className="text-amber-300/80">{"{categories_list}"}</code>
              </span>
            }
          >
            <TextArea value={c.messages.ticketBody} onChange={(v) => setConfig("messages.ticketBody", v)} rows={5} />
          </Field>
        </div>
      </Section>

      {/* Kategori tiket */}
      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Kategori Tiket</h3>
            <p className="mt-1 text-xs text-zinc-500">Setiap kategori jadi tombol di panel — member klik untuk membuka tiket.</p>
          </div>
          <Button size="sm" variant="outline" onClick={addCat} className="border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-zinc-100">
            <Plus className="h-4 w-4" aria-hidden="true" /> Kategori
          </Button>
        </div>
        <div className="mt-5 space-y-3">
          {cats.map((cat, idx) => (
            <div key={`${cat.id}-${idx}`} className="grid gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-4 sm:grid-cols-[70px_1fr_1fr_140px_auto]">
              <div className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-zinc-700" aria-hidden="true" />
                <TextInput value={cat.emoji} onChange={(v) => updateCat(idx, { emoji: v })} placeholder="🎫" />
              </div>
              <TextInput value={cat.label} onChange={(v) => updateCat(idx, { label: v })} placeholder="Label kategori" />
              <div className="flex items-center gap-2">
                <TextInput value={cat.id} onChange={(v) => updateCat(idx, { id: v.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} placeholder="id-slug" />
                {cat.isDefault ? <Pill tone="amber">bawaan</Pill> : null}
              </div>
              <Select value={cat.style} onChange={(v) => updateCat(idx, { style: v })} options={STYLE_OPTS} />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateCat(idx, { requiresKey: !cat.requiresKey })}
                  title="Butuh key VIP untuk membuka tiket kategori ini"
                  className={`h-9 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${
                    cat.requiresKey
                      ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                      : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  butuh key
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removeCat(idx)}
                  className="h-9 w-9 text-zinc-500 hover:text-red-400 hover:bg-red-950/30"
                  title="Hapus kategori"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Produk */}
      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Produk / Price List</h3>
            <p className="mt-1 text-xs text-zinc-500">Muncul di dropdown tiket transaksi + price list otomatis.</p>
          </div>
          <Button size="sm" variant="outline" onClick={addProduct} className="border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-zinc-100">
            <Plus className="h-4 w-4" aria-hidden="true" /> Produk
          </Button>
        </div>
        <div className="mt-5 space-y-3">
          {products.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
              Belum ada produk — tambahkan untuk mulai jualan lewat tiket.
            </p>
          ) : null}
          {products.map((p, idx) => (
            <div key={`${p.value}-${idx}`} className="grid gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-4 sm:grid-cols-[1fr_110px_1fr_140px_auto]">
              <TextInput value={p.label} onChange={(v) => updateProduct(idx, { label: v })} placeholder="Nama produk" />
              <TextInput value={p.price} onChange={(v) => updateProduct(idx, { price: v })} placeholder="Rp 10.000" />
              <div className="flex items-center gap-2">
                <Select
                  value={p.category}
                  onChange={(v) => updateProduct(idx, { category: v })}
                  options={cats.map((cat) => ({ value: cat.id, label: cat.label }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateProduct(idx, { requiresKey: !p.requiresKey })}
                  className={`h-9 w-full rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${
                    p.requiresKey
                      ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                      : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {p.requiresKey ? "kirim key" : "kirim manual"}
                </button>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setConfig("products", products.filter((_, i) => i !== idx))}
                className="h-9 w-9 text-zinc-500 hover:text-red-400 hover:bg-red-950/30"
                title="Hapus produk"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ============================================================
 * MODUL: AutoMod
 * ============================================================ */

const ACTION_OPTS = [
  { value: "delete_only", label: "Hapus pesan saja" },
  { value: "warn", label: "Warn" },
  { value: "mute_10m", label: "Mute 10 menit" },
  { value: "mute_1h", label: "Mute 1 jam" },
  { value: "kick", label: "Kick" },
];

export function AutoModModule({ draft, setAutomod }: ModuleFormProps) {
  const a = draft.automod;
  const [wordInput, setWordInput] = useState("");
  const [wordAction, setWordAction] = useState("delete_only");
  const [exemptInput, setExemptInput] = useState("");

  function addWord() {
    const w = wordInput.trim().toLowerCase();
    if (!w) return;
    if (a.wordRules.some((r) => r.word === w)) return;
    setAutomod({ wordRules: [...a.wordRules, { word: w, action: wordAction === "none" ? null : wordAction }] });
    setWordInput("");
  }

  return (
    <div className="space-y-5">
      <Section title="Status & Anti-Spam" desc="Pengawas pesan otomatis — aktifkan untuk melindungi server tanpa moderasi manual.">
        <div className="md:col-span-2">
          <Toggle
            checked={a.enabled}
            onChange={(v) => setAutomod({ enabled: v })}
            label="AutoMod aktif"
            desc="Matikan untuk mematikan SEMUA pengawasan otomatis seketika."
          />
        </div>
        <Field label="Ambang Spam" hint="Jumlah pesan dalam window di bawah = dianggap spam.">
          <TextInput type="number" value={a.spamThreshold} onChange={(v) => setAutomod({ spamThreshold: Number(v) || 1 })} />
        </Field>
        <Field label="Window Spam (detik)">
          <TextInput type="number" value={Math.round(a.spamWindowMs / 1000)} onChange={(v) => setAutomod({ spamWindowMs: (Number(v) || 1) * 1000 })} />
        </Field>
        <Field label="Aksi Spam">
          <Select value={a.spamAction} onChange={(v) => setAutomod({ spamAction: v })} options={ACTION_OPTS} />
        </Field>
        <Field label="Batas Mention" hint="Lebih dari ini per pesan = tindakan.">
          <TextInput type="number" value={a.maxMentions} onChange={(v) => setAutomod({ maxMentions: Number(v) || 1 })} />
        </Field>
        <Field label="Aksi Mention Berlebih">
          <Select value={a.mentionAction} onChange={(v) => setAutomod({ mentionAction: v })} options={ACTION_OPTS.slice(0, 3)} />
        </Field>
      </Section>

      <Section title="Blokir Link" desc="Hapus pesan berisi link — kecuali di channel/role yang diizinkan.">
        <div className="md:col-span-2">
          <Toggle
            checked={a.blockLinks}
            onChange={(v) => setAutomod({ blockLinks: v })}
            label="Blokir semua link"
            desc="Kecuali channel & role whitelist di bawah."
          />
        </div>
        <Field label="Channel Bebas Link" hint="Channel di sini boleh mengandung link.">
          <TextArea
            value={a.linkAllowedChannels.join("\n")}
            onChange={(v) => setAutomod({ linkAllowedChannels: v.split("\n").map((s) => s.trim()).filter(Boolean) })}
            rows={3}
            placeholder="Satu ID channel per baris"
          />
        </Field>
        <Field label="Role Bebas Link">
          <TextArea
            value={a.linkAllowedRoles.join("\n")}
            onChange={(v) => setAutomod({ linkAllowedRoles: v.split("\n").map((s) => s.trim()).filter(Boolean) })}
            rows={3}
            placeholder="Satu ID role per baris"
          />
        </Field>
      </Section>

      <Section title="Blokir Kata" desc="Matching whole-word default — “scam” tidak match di “scammer”.">
        <Field label="Mode Pencocokan">
          <Select
            value={a.wordMatchMode}
            onChange={(v) => setAutomod({ wordMatchMode: v })}
            options={[
              { value: "whole_word", label: "Kata utuh (anti false-positive)" },
              { value: "substring", label: "Mengandung (lebih ketat)" },
            ]}
          />
        </Field>
        <Field label="Aksi Default Kata" hint="Dipakai untuk kata tanpa aksi khusus.">
          <Select value={a.wordAction} onChange={(v) => setAutomod({ wordAction: v })} options={ACTION_OPTS} />
        </Field>
        <div className="md:col-span-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            {a.wordRules.length === 0 ? <p className="text-xs text-zinc-500">Belum ada kata yang diblokir.</p> : null}
            {a.wordRules.map((r, i) => (
              <span key={`${r.word}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/60 bg-zinc-800/40 py-1 pl-3 pr-1.5 text-xs text-zinc-300">
                <span className="font-mono">{r.word}</span>
                <span className="text-[10px] text-zinc-500">{r.action ?? "default"}</span>
                <button
                  type="button"
                  onClick={() => setAutomod({ wordRules: a.wordRules.filter((_, idx) => idx !== i) })}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-zinc-500 hover:bg-red-950/40 hover:text-red-400"
                  title="Hapus kata"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <TextInput value={wordInput} onChange={setWordInput} placeholder="kata yang mau diblokir…" />
            <Select value={wordAction} onChange={setWordAction} options={ACTION_OPTS} />
            <Button size="sm" onClick={addWord} className="bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold shrink-0 h-10">
              <Plus className="h-4 w-4" aria-hidden="true" /> Blokir
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <p className="text-[11px] text-zinc-500">
                Kata pengecualian — membatalkan match (mis. blokir “asu”, bebas-kan “asus”).
              </p>
              <TextInput value={exemptInput} onChange={setExemptInput} placeholder="tambah kata pengecualian…" />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-10 shrink-0 border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() => {
                const w = exemptInput.trim().toLowerCase();
                if (!w || a.exemptWords.includes(w)) return;
                setAutomod({ exemptWords: [...a.exemptWords, w] });
                setExemptInput("");
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Bebaskan
            </Button>
          </div>
          {a.exemptWords.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {a.exemptWords.map((w, i) => (
                <span key={`${w}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/5 py-1 pl-3 pr-1.5 text-xs text-emerald-300">
                  <span className="font-mono">{w}</span>
                  <button
                    type="button"
                    onClick={() => setAutomod({ exemptWords: a.exemptWords.filter((_, idx) => idx !== i) })}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-emerald-500/70 hover:bg-red-950/40 hover:text-red-400"
                    title="Hapus pengecualian"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </Section>
    </div>
  );
}

/* ============================================================
 * MODUL: Leveling
 * ============================================================ */

export function LevelingModule({ draft, meta, setConfig, toast }: ModuleFormProps) {
  const c = draft.config;
  const lv = c.leveling;
  const [newLevel, setNewLevel] = useState("");
  const [newRole, setNewRole] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <Section title="Sistem Level" desc="XP diberikan per pesan chat; level naik otomatis + role reward.">
        <div className="md:col-span-2">
          <Toggle
            checked={lv.enabled}
            onChange={(v) => setConfig("leveling.enabled", v)}
            label="Leveling aktif"
            desc="Matikan untuk berhenti menghitung XP (data lama tetap tersimpan)."
          />
        </div>
        <Field label="XP per Pesan">
          <TextInput type="number" value={lv.xpPerMessage} onChange={(v) => setConfig("leveling.xpPerMessage", Number(v) || 1)} />
        </Field>
        <Field label="Cooldown XP (detik)" hint="Jeda antar pesan yang dihitung — anti spam XP.">
          <TextInput type="number" value={Math.round(lv.cooldownMs / 1000)} onChange={(v) => setConfig("leveling.cooldownMs", (Number(v) || 1) * 1000)} />
        </Field>
        <div className="md:col-span-2">
          <Toggle
            checked={lv.announceLevelUp}
            onChange={(v) => setConfig("leveling.announceLevelUp", v)}
            label="Umumkan kenaikan level"
            desc="Bot mengirim pesan ucapan setiap member naik level."
          />
        </div>
        <Field label="Channel Umum Level Up" hint="Kosongkan = di channel tempat member chat.">
          <ChannelSelect value={lv.levelUpChannel} onChange={(v) => setConfig("leveling.levelUpChannel", v)} channels={meta.channels} placeholder="— channel chat member —" />
        </Field>
      </Section>

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <h3 className="text-sm font-semibold text-zinc-100">Role Reward per Level</h3>
        <p className="mt-1 text-xs text-zinc-500">Role otomatis diberikan saat member mencapai level tertentu.</p>
        <div className="mt-5 space-y-2">
          {c.levelRoles.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 p-5 text-center text-xs text-zinc-500">
              Belum ada role reward — tambahkan untuk mengapresiasi member aktif.
            </p>
          ) : null}
          {c.levelRoles
            .slice()
            .sort((x, y) => x.level - y.level)
            .map((lr, i) => (
              <div key={`${lr.level}-${lr.roleId}-${i}`} className="flex items-center gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-3">
                <Pill tone="amber">Lv {lr.level}</Pill>
                <span className="flex-1 truncate text-sm text-zinc-300">
                  {meta.roles.find((r) => r.id === lr.roleId)?.name ?? `role ${lr.roleId.slice(0, 10)}…`}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setConfig("levelRoles", c.levelRoles.filter((x) => x !== lr))}
                  className="h-8 w-8 text-zinc-500 hover:text-red-400 hover:bg-red-950/30"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            ))}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <TextInput type="number" value={newLevel} onChange={setNewLevel} placeholder="Level (mis. 10)" />
          <RoleSelect value={newRole} onChange={setNewRole} roles={meta.roles} placeholder="Pilih role reward…" />
          <Button
            size="sm"
            className="h-10 shrink-0 bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold"
            onClick={() => {
              const level = Number(newLevel);
              if (!Number.isInteger(level) || level < 1 || level > 1000) {
                toast("Level harus angka 1-1000.", "err");
                return;
              }
              if (!newRole) {
                toast("Pilih role reward dulu.", "err");
                return;
              }
              if (c.levelRoles.some((x) => x.level === level)) {
                toast(`Level ${level} sudah punya reward.`, "err");
                return;
              }
              setConfig("levelRoles", [...c.levelRoles, { level, roleId: newRole }]);
              setNewLevel("");
              setNewRole(null);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Tambah Reward
          </Button>
        </div>
      </section>
    </div>
  );
}

/* ============================================================
 * MODUL: Rekber (Midman)
 * ============================================================ */

export function MidmanModule({ draft, setConfig }: ModuleFormProps) {
  const m = draft.config.midman;
  return (
    <div className="space-y-5">
      <Section
        title="Escrow / Rekber"
        desc="Deal 3-pihak: buyer — midman — seller. Fee dihitung otomatis saat deal dibuat."
      >
        <Field label="Mode Fee">
          <Select
            value={m.feeMode}
            onChange={(v) => setConfig("midman.feeMode", v)}
            options={[
              { value: "percent", label: "Persen dari harga deal" },
              { value: "flat", label: "Nominal tetap" },
            ]}
          />
        </Field>
        <Field
          label={m.feeMode === "percent" ? "Besar Fee (%)" : "Besar Fee (nominal)"}
          hint={m.feeMode === "percent" ? "Contoh: 5 → fee 5% dari harga. Buyer bayar harga + fee." : "Contoh: 5000 → fee Rp 5.000 per deal."}
        >
          <TextInput type="number" value={m.feeValue} onChange={(v) => setConfig("midman.feeValue", Number(v) || 0)} />
        </Field>
        <Field label="Nama Kategori Channel Deal" hint="Kategori tempat channel deal rekber dibuat.">
          <TextInput value={m.category} onChange={(v) => setConfig("midman.category", v)} />
        </Field>
        <div className="md:col-span-2 flex items-start gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400/80" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-zinc-500">
            Alur rekber: siapa pun bisa membuka deal lewat kategori <b className="text-zinc-300">Rekber</b> di panel
            tiket → pilih buyer &amp; seller → midman mengunci deal → barang diserahkan → midman melepas dana.
            Semua klik tercatat di riwayat deal.
          </p>
        </div>
      </Section>
    </div>
  );
}
