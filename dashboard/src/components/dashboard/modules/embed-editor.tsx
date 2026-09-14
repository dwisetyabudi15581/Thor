"use client";

// Embed Editor + Pratinjau Live (v3.20.0) — dipakai bersama oleh modul
// Kirim Embed dan modul Custom Command.
//
// Paritas penuh dengan /embed-builder di Discord: teks di luar embed
// (content), author (nama + icon), title, description, warna, fields
// (sejajar/full + urutan bisa digeser), thumbnail, image, footer (teks +
// icon), dan timestamp. Pratinjau meniru tampilan chat Discord (dark)
// supaya admin tahu persis hasil akhirnya sebelum dikirim.

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Section, TextInput, TextArea, ColorInput, Toggle } from "../fields";
import type { EmbedDef } from "@/lib/bot-api";

/* ============================================================
 * Bentuk draft (state form) + konversi
 * ============================================================ */

export type EmbedFieldDraft = { name: string; value: string; inline: boolean };

export type EmbedDraft = {
  content: string; // teks di luar embed (plain message)
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
  fields: EmbedFieldDraft[];
};

export const EMPTY_EMBED: EmbedDraft = {
  content: "",
  title: "",
  description: "",
  color: 0x5865f2,
  authorName: "",
  authorIconURL: "",
  thumbnail: "",
  image: "",
  footerText: "",
  footerIconURL: "",
  timestamp: false,
  fields: [],
};

/** Dari def bot (payload / custom command tersimpan) → draft form. */
export function embedDraftFromDef(def?: Partial<EmbedDef> | null): EmbedDraft {
  if (!def) return { ...EMPTY_EMBED, fields: [] };
  return {
    content: "",
    title: def.title ?? "",
    description: def.description ?? "",
    color: typeof def.color === "number" ? def.color : 0x5865f2,
    authorName: def.authorName ?? "",
    authorIconURL: def.authorIconURL ?? "",
    thumbnail: def.thumbnail ?? "",
    image: def.image ?? "",
    footerText: def.footerText ?? "",
    footerIconURL: def.footerIconURL ?? "",
    timestamp: def.timestamp === true,
    fields: (def.fields ?? []).map((f) => ({ name: f.name, value: f.value, inline: f.inline === true })),
  };
}

/** Draft form → body API (embed kosong dibuang supaya validasi bot lolos). */
export function embedDraftToApi(d: EmbedDraft): { content: string; embed: Partial<EmbedDef> } {
  return {
    content: d.content.trim(),
    embed: {
      title: d.title.trim(),
      description: d.description.trim(),
      color: d.color,
      authorName: d.authorName.trim(),
      authorIconURL: d.authorIconURL.trim(),
      thumbnail: d.thumbnail.trim(),
      image: d.image.trim(),
      footerText: d.footerText.trim(),
      footerIconURL: d.footerIconURL.trim(),
      timestamp: d.timestamp,
      fields: d.fields
        .filter((f) => f.name.trim() || f.value.trim())
        .map((f) => ({ name: f.name.trim(), value: f.value.trim(), inline: f.inline })),
    },
  };
}

/** Apakah bagian EMBED-nya kosong total (content tidak dihitung)? */
export function isEmbedDraftEmpty(d: EmbedDraft): boolean {
  return (
    !d.title.trim() &&
    !d.description.trim() &&
    !d.authorName.trim() &&
    !d.footerText.trim() &&
    !d.thumbnail.trim() &&
    !d.image.trim() &&
    !d.fields.some((f) => f.name.trim() || f.value.trim())
  );
}

/* ============================================================
 * Editor
 * ============================================================ */

export function EmbedEditor({ value, onChange }: { value: EmbedDraft; onChange: (d: EmbedDraft) => void }) {
  const patch = (p: Partial<EmbedDraft>) => onChange({ ...value, ...p });

  function setField(i: number, p: Partial<EmbedFieldDraft>) {
    const fields = value.fields.map((f, idx) => (idx === i ? { ...f, ...p } : f));
    patch({ fields });
  }
  function moveField(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= value.fields.length) return;
    const fields = [...value.fields];
    [fields[i], fields[j]] = [fields[j], fields[i]];
    patch({ fields });
  }

  return (
    <div className="space-y-5">
      <Section
        title="Pesan"
        desc="Teks biasa di luar embed — cocok untuk ping (@everyone) atau teks pengantar. Salah satu (teks atau embed) harus terisi."
      >
        <div className="md:col-span-2">
          <Field label="Teks di luar embed (opsional)" hint="Maks 2000 karakter. Mendukung **bold**, *italic*, dan baris baru.">
            <TextArea value={value.content} onChange={(v) => patch({ content: v })} rows={3} placeholder="mis. @everyone baca pengumuman di bawah!" />
          </Field>
        </div>
      </Section>

      <Section title="Embed — Atas" desc="Author tampil di atas judul; thumbnail di pojok kanan atas embed.">
        <Field label="Nama Author (opsional)" hint="Maks 256.">
          <TextInput value={value.authorName} onChange={(v) => patch({ authorName: v })} placeholder="mis. Tim Thor" />
        </Field>
        <Field label="Icon Author (URL, opsional)" hint="https://… (gambar kecil di samping nama).">
          <TextInput value={value.authorIconURL} onChange={(v) => patch({ authorIconURL: v })} placeholder="https://cdn…/icon.png" />
        </Field>
        <Field label="Judul" hint="Maks 256. Opsional kalau description diisi.">
          <TextInput value={value.title} onChange={(v) => patch({ title: v })} placeholder="Judul embed" />
        </Field>
        <Field label="Warna" hint="Garis kiri embed di Discord.">
          <ColorInput value={value.color} onChange={(v) => patch({ color: v })} />
        </Field>
        <Field label="Thumbnail (URL, opsional)" hint="Gambar kecil pojok kanan atas embed.">
          <TextInput value={value.thumbnail} onChange={(v) => patch({ thumbnail: v })} placeholder="https://…/kecil.png" />
        </Field>
        <Field label="Gambar Besar (URL, opsional)" hint="Tampil di bawah isi embed.">
          <TextInput value={value.image} onChange={(v) => patch({ image: v })} placeholder="https://…/banner.png" />
        </Field>
        <div className="md:col-span-2">
          <Field label="Isi (description)" hint="Maks 4096. Mendukung **bold**, *italic*, dan baris baru.">
            <TextArea value={value.description} onChange={(v) => patch({ description: v })} rows={5} placeholder="Tulis isi pesan di sini…" />
          </Field>
        </div>
      </Section>

      <Section
        title="Embed — Fields"
        desc="Field = kotak kecil berisi nama + nilai di dalam embed. 'Sejajar' menampilkan 3 field dalam satu baris (ala Dyno). Maks 25 field."
      >
        <div className="space-y-3 md:col-span-2">
          {value.fields.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-3 text-xs text-zinc-500">
              Belum ada field — teksnya bisa langsung di Isi di atas, atau tambah field untuk data terstruktur (mis. Harga │ Kontak).
            </p>
          ) : null}
          {value.fields.map((f, i) => (
            <div key={i} className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Field #{i + 1}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveField(i, -1)}
                    disabled={i === 0}
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                    title="Naikkan"
                    aria-label={`Naikkan field ${i + 1}`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveField(i, 1)}
                    disabled={i === value.fields.length - 1}
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                    title="Turunkan"
                    aria-label={`Turunkan field ${i + 1}`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setField(i, { inline: !f.inline })}
                    className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
                      f.inline ? "bg-amber-400/15 text-amber-300" : "bg-zinc-800 text-zinc-400"
                    }`}
                    title="Tampilkan sejajar (3 per baris)"
                  >
                    {f.inline ? "SEJAJAR" : "FULL"}
                  </button>
                  <button
                    type="button"
                    onClick={() => patch({ fields: value.fields.filter((_, idx) => idx !== i) })}
                    className="rounded-md p-1.5 text-red-400/80 hover:bg-red-950/40 hover:text-red-300"
                    title="Hapus field"
                    aria-label={`Hapus field ${i + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <TextInput value={f.name} onChange={(v) => setField(i, { name: v })} placeholder="Nama field (maks 256)" />
                <div className="md:col-span-2">
                  <TextInput value={f.value} onChange={(v) => setField(i, { value: v })} placeholder="Isi field (maks 1024)" />
                </div>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() => value.fields.length < 25 && patch({ fields: [...value.fields, { name: "", value: "", inline: false }] })}
            disabled={value.fields.length >= 25}
            className="w-full border-dashed border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Tambah Field ({value.fields.length}/25)
          </Button>
        </div>
      </Section>

      <Section title="Embed — Bawah" desc="Footer tampil di dasar embed, di samping timestamp.">
        <Field label="Teks Footer (opsional)" hint="Maks 2048.">
          <TextInput value={value.footerText} onChange={(v) => patch({ footerText: v })} placeholder="mis. Dari Admin • thor.bot" />
        </Field>
        <Field label="Icon Footer (URL, opsional)">
          <TextInput value={value.footerIconURL} onChange={(v) => patch({ footerIconURL: v })} placeholder="https://…/icon.png" />
        </Field>
        <div className="md:col-span-2">
          <Toggle
            checked={value.timestamp}
            onChange={(v) => patch({ timestamp: v })}
            label="Tampilkan timestamp"
            desc="Waktu kirim muncul di footer embed (waktu bot, WIB)."
          />
        </div>
      </Section>
    </div>
  );
}

/* ============================================================
 * Pratinjau live (meniru chat Discord)
 * ============================================================ */

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** "Hari ini pukul 14.05" ala Discord (label statis — cukup untuk pratinjau). */
function previewClock(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Hari ini pukul ${pad(now.getHours())}.${pad(now.getMinutes())}`;
}

export function EmbedLivePreview({ draft, botName = "Thor" }: { draft: EmbedDraft; botName?: string }) {
  const hasEmbed = !isEmbedDraftEmpty(draft);
  return (
    <div className="rounded-xl bg-[#313338] p-4">
      <div className="flex gap-3">
        {/* Avatar bot */}
        <div className="flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full bg-amber-400 text-sm font-black text-zinc-950">
          T
        </div>
        <div className="min-w-0 flex-1">
          {/* Nama + badge BOT + waktu */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[15px] font-semibold leading-none text-white">{botName}</span>
            <span className="rounded bg-[#5865f2] px-1 py-px text-[9px] font-semibold uppercase leading-tight text-white">Bot</span>
            <span className="text-[11px] text-[#949ba4]">{previewClock()}</span>
          </div>

          {/* Teks di luar embed */}
          {draft.content.trim() ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-[1.375rem] text-[#dbdee1]">{draft.content}</p>
          ) : null}

          {/* Embed */}
          {hasEmbed ? (
            <div
              className="mt-1 max-w-[520px] overflow-hidden rounded-[4px] bg-[#2b2d31] pl-4 pr-4 pt-3 pb-3"
              style={{ borderLeft: `4px solid ${hex(draft.color)}` }}
            >
              <div className="relative">
                {draft.thumbnail.trim() ? (
                  <img
                    src={draft.thumbnail}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="absolute right-0 top-0 h-20 w-20 rounded object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}

                {draft.authorName.trim() || draft.authorIconURL.trim() ? (
                  <div className="mb-2 flex items-center gap-2">
                    {draft.authorIconURL.trim() ? (
                      <img
                        src={draft.authorIconURL}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-6 w-6 rounded-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                    {draft.authorName.trim() ? <span className="text-[14px] font-semibold text-white">{draft.authorName}</span> : null}
                  </div>
                ) : null}

                {draft.title.trim() ? <p className="text-[15px] font-semibold leading-snug text-[#00a8fc]">{draft.title}</p> : null}

                {draft.description.trim() ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[#dbdee1]">{draft.description}</p>
                ) : null}

                {draft.fields.filter((f) => f.name.trim() || f.value.trim()).length > 0 ? (
                  <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2">
                    {draft.fields
                      .filter((f) => f.name.trim() || f.value.trim())
                      .map((f, i) => (
                        <div key={i} className={f.inline ? "" : "col-span-3"}>
                          {f.name.trim() ? <p className="text-[13px] font-semibold text-white">{f.name}</p> : null}
                          {f.value.trim() ? <p className="text-[13px] leading-snug text-[#dbdee1]">{f.value}</p> : null}
                        </div>
                      ))}
                  </div>
                ) : null}

                {draft.image.trim() ? (
                  <img
                    src={draft.image}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="mt-3 max-h-72 w-auto max-w-full rounded object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}

                {draft.footerText.trim() || draft.timestamp ? (
                  <div className="mt-2 flex items-center gap-2">
                    {draft.footerIconURL.trim() ? (
                      <img
                        src={draft.footerIconURL}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-5 w-5 rounded-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                    {draft.footerText.trim() ? <span className="text-[12px] font-medium text-[#949ba4]">{draft.footerText}</span> : null}
                    {draft.footerText.trim() && draft.timestamp ? <span className="text-[12px] text-[#949ba4]">•</span> : null}
                    {draft.timestamp ? <span className="text-[12px] text-[#949ba4]">{previewClock()}</span> : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {!draft.content.trim() && !hasEmbed ? (
            <p className="mt-1 text-[13px] italic text-[#949ba4]">(pesan kosong — isi teks atau embed di kiri)</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
