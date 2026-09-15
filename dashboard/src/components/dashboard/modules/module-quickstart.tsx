"use client";

// MODUL: Panduan Cepat (v3.21.0) — mirror kategori 🚀 "Panduan Cepat" dari
// /help ke dashboard web. Konsep persis permintaan user: "di web ada kategori
// slash command quick start, ngaturnya langsung di web — misal add role ada
// kolom text untuk memasukkan ID role yang akan didaftarkan".
//
// Bentuk: CHECKLIST setup server 6 langkah. Tiap langkah punya form langsung
// (dropdown pilih cepat + kolom teks ID manual) → tombol Terapkan/Pasang →
// aksi LANGSUNG via call() (tanpa SaveBar) → bot menerapkannya ke server
// Discord. Paritas penuh dengan slash command:
//
//   Langkah 1  Role Admin Bot       ≙ /set-role admin
//   Langkah 2  Auto-Role Saat Join   ≙ /set-autorole            (v3.23.0)
//   Langkah 3  Kategori & Produk    ≙ /add-category + /add-product
//   Langkah 4  Pasang Panel Tiket   ≙ /setup-ticket-panel
//   Langkah 5  Panel Self-Role      ≙ /setup-selfrole          (v3.22.0)
//   Langkah 6  Channel Log Server   ≙ /set-channel server-log
//
// v3.23.0: konsep role penanda Unverified DIHAPUS — Langkah 2 kini murni
// auto-role saat join + toggle "role join hilang saat member dapat role
// lain" (pengganti role Unverified); Langkah 5 mengarahkan admin ke modul
// Self Roles untuk memasang panel (mis. Verifikasi).
//
// Di bawahnya: "Langkah lanjutan" — pintasan ke modul kategori lain
// (serverstats / leveling / tempvoice / responder / selfrole) supaya web
// benar-benar menghubungkan SEMUA kategori slash command.
//
// Kontrak: ModuleActionProps (draft/meta/call/refresh/toast) + goTo(module)
// untuk navigasi antar modul (diberikan guild-dashboard).

import { useState, type ReactNode } from "react";
import { CheckCircle2, Circle, Loader2, Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field, TextInput, Select, ChannelSelect, RoleSelect, Pill, Toggle, channelLabel, roleLabel,
} from "../fields";
import type { ModuleActionProps } from "./module-actions";

const SNOWFLAKE_RE = /^\d{5,25}$/;

const ID_HINT = (
  <span>
    Tempel ID role (klik kanan role di Discord → <b>Copy ID</b>, butuh Developer Mode) —{" "}
    <b>atau</b> pilih dari daftar di samping.
  </span>
);

const CHANNEL_ID_HINT = (
  <span>
    Tempel ID channel (klik kanan channel → <b>Copy ID</b>) — <b>atau</b> pilih dari daftar.
  </span>
);

/* ---------------- Kartu langkah checklist ---------------- */

function StepCard({
  n, title, desc, done, children,
}: {
  n: number;
  title: string;
  desc: ReactNode;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border p-5 transition-colors md:p-6 ${
        done ? "border-emerald-500/30 bg-emerald-950/10" : "border-zinc-800/80 bg-zinc-900/30"
      }`}
    >
      <div className="flex items-start gap-3">
        {done ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden="true" />
        ) : (
          <Circle className="mt-0.5 h-5 w-5 shrink-0 text-zinc-600" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-100">
            <span className="text-zinc-500">{n}.</span>
            {title}
            {done ? <Pill tone="green">selesai</Pill> : <Pill>belum</Pill>}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">{desc}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

/* ============================================================
 * MODUL: Panduan Cepat
 * ============================================================ */

export function QuickStartModule({
  draft, meta, call, refresh, toast, goTo,
}: ModuleActionProps & { goTo: (module: string) => void }) {
  const c = draft.config;
  const [busy, setBusy] = useState<string | null>(null);

  // Langkah 1-2: role (dropdown + kolom ID manual — nilai awal = yang tersimpan)
  const [adminPick, setAdminPick] = useState<string | null>(c.roles.admin ?? null);
  const [adminId, setAdminId] = useState("");
  const [joinPick, setJoinPick] = useState<string | null>(null);
  const [joinId, setJoinId] = useState("");

  // Langkah 3: produk cepat
  const [prdLabel, setPrdLabel] = useState("");
  const [prdValue, setPrdValue] = useState("");
  const [prdPrice, setPrdPrice] = useState("");
  const [prdCat, setPrdCat] = useState(c.ticketCategories[0]?.id ?? "transaction");
  const [prdKey, setPrdKey] = useState(true);

  // Langkah 4-5: panel
  const [panelChannel, setPanelChannel] = useState<string | null>(null);
  const [panelDropdown, setPanelDropdown] = useState(false);

  // Langkah 6: channel log
  const [logPick, setLogPick] = useState<string | null>(c.channels["server-log"] ?? null);
  const [logId, setLogId] = useState("");

  const cats = c.ticketCategories;
  const products = c.products;
  const panels = draft.panels ?? [];
  const selfrolePanels = draft.selfroles ?? [];

  const done = {
    admin: !!c.roles.admin,
    autorole: (c.autorole?.roleIds?.length ?? 0) > 0,
    catalog: products.length > 0,
    panel: panels.length > 0,
    selfrole: selfrolePanels.length > 0,
    log: !!c.channels["server-log"],
  };
  const doneCount = Object.values(done).filter(Boolean).length;

  /* ---------------- Aksi ---------------- */

  async function applyUpdates(step: string, updates: Record<string, unknown>, okMsg: string) {
    setBusy(step);
    try {
      await call("config", "PUT", { updates });
      await refresh();
      toast(okMsg);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menyimpan.", "err");
    } finally {
      setBusy(null);
    }
  }

  /** Terapkan role: kolom ID manual menang atas dropdown. */
  function applyRole(step: string, dotPath: string, pick: string | null, manualId: string, okMsg: string) {
    const v = manualId.trim() || pick || "";
    if (!v) {
      toast("Pilih role dari daftar atau tempel ID role-nya dulu.", "err");
      return;
    }
    if (!SNOWFLAKE_RE.test(v)) {
      toast("ID role tidak valid — angka 5-25 digit. Aktifkan Developer Mode di Discord, klik kanan role → Copy ID.", "err");
      return;
    }
    void applyUpdates(step, { [dotPath]: v }, okMsg);
  }

  /** Terapkan channel: kolom ID manual menang atas dropdown. */
  function applyChannel(step: string, dotPath: string, pick: string | null, manualId: string, okMsg: string) {
    const v = manualId.trim() || pick || "";
    if (!v) {
      toast("Pilih channel dari daftar atau tempel ID channel-nya dulu.", "err");
      return;
    }
    if (!SNOWFLAKE_RE.test(v)) {
      toast("ID channel tidak valid — angka 5-25 digit. Klik kanan channel di Discord → Copy ID.", "err");
      return;
    }
    void applyUpdates(step, { [dotPath]: v }, okMsg);
  }

  /** Langkah 2: tambah role ke daftar auto-role join (array utuh, anti-duplikat). */
  function applyJoinRole(pick: string | null, manualId: string) {
    const v = manualId.trim() || pick || "";
    if (!v) {
      toast("Pilih role dari daftar atau tempel ID role-nya dulu.", "err");
      return;
    }
    if (!SNOWFLAKE_RE.test(v)) {
      toast("ID role tidak valid — angka 5-25 digit. Aktifkan Developer Mode di Discord, klik kanan role → Copy ID.", "err");
      return;
    }
    const current = c.autorole?.roleIds ?? [];
    if (current.includes(v)) {
      toast("Role itu sudah ada di daftar auto-role.", "err");
      return;
    }
    void applyUpdates("autorole", { autorole: [...current, v] }, "Role join didaftarkan — setiap member baru menerimanya otomatis.");
  }

  /** Langkah 2: balik toggle "hapus role join saat member dapat role lain". */
  function toggleRemoveOnNewRole() {
    const next = !(c.autorole?.removeOnNewRole ?? false);
    void applyUpdates(
      "autoroleToggle",
      { "autorole.removeOnNewRole": next },
      next
        ? "Toggle AKTIF — role join otomatis hilang saat member dapat role lain."
        : "Toggle MATI — role join bersifat permanen."
    );
  }

  async function installTicketPanel() {
    if (!panelChannel) {
      toast("Pilih channel tujuan panel tiket dulu.", "err");
      return;
    }
    setBusy("panel");
    try {
      await call("panels", "POST", { channelId: panelChannel, useDropdown: panelDropdown });
      await refresh();
      toast(`Panel tiket dipasang di ${channelLabel(meta.channels, panelChannel)} — cek Discord.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal memasang panel.", "err");
    } finally {
      setBusy(null);
    }
  }

  /** Tambah produk cepat (paritas /add-product — array utuh + validasi bot). */
  async function quickAddProduct() {
    if (!prdLabel.trim() || !prdValue.trim() || !prdPrice.trim()) {
      toast("Label, value, dan harga produk wajib diisi.", "err");
      return;
    }
    setBusy("product");
    try {
      const next = [
        ...products,
        {
          label: prdLabel.trim(),
          value: prdValue.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ""),
          price: prdPrice.trim(),
          category: prdCat,
          requiresKey: prdKey,
        },
      ];
      await call("config", "PUT", { updates: { products: next } });
      setPrdLabel("");
      setPrdValue("");
      setPrdPrice("");
      await refresh();
      toast("Produk ditambahkan ke price list.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menambah produk.", "err");
    } finally {
      setBusy(null);
    }
  }

  /* ---------------- Render ---------------- */

  return (
    <div className="space-y-5">
      {/* Progress */}
      <div className="rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-400/10 to-transparent p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Setup server dari nol — semua dari web</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              Ikuti urutan langkah di bawah; tiap form langsung diterapkan bot ke server Discord
              (tanpa perlu mengetik slash command). Sama persis dengan kategori 🚀 Panduan Cepat di /help.
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-amber-300">
              {doneCount}<span className="text-sm text-zinc-500">/6</span>
            </p>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">langkah inti</p>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={6} aria-label="Progres setup">
          <div
            className="h-full rounded-full bg-amber-400 transition-all duration-500"
            style={{ width: `${(doneCount / 6) * 100}%` }}
          />
        </div>
      </div>

      {/* Langkah 1 — Role Admin */}
      <StepCard
        n={1}
        title="Role Admin Bot"
        desc={<>Pemegang role ini bisa memakai seluruh command admin bot. Wajib sebelum memasang panel tiket. ≙ <code className="text-amber-300/80">/set-role admin</code></>}
        done={done.admin}
      >
        <Field label="Pilih dari daftar role" hint={done.admin ? `Tersimpan: ${roleLabel(meta.roles, c.roles.admin)}` : undefined}>
          <RoleSelect value={adminPick} onChange={setAdminPick} roles={meta.roles} />
        </Field>
        <Field label="…atau masukkan ID role manual" hint={ID_HINT}>
          <div className="flex gap-2">
            <TextInput value={adminId} onChange={setAdminId} placeholder="mis. 888000111222333555" />
            <Button
              onClick={() => applyRole("admin", "roles.admin", adminPick, adminId, "Role Admin didaftarkan — langsung efektif di bot.")}
              disabled={busy === "admin"}
              className="shrink-0 bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300"
            >
              {busy === "admin" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Daftarkan
            </Button>
          </div>
        </Field>
      </StepCard>

      {/* Langkah 2 — Auto-Role saat join + toggle (v3.23.0) */}
      <StepCard
        n={2}
        title="Auto-Role Saat Join"
        desc={<>Role yang diberikan otomatis ke setiap member baru. Nyalakan toggle di bawah kalau mau role-nya hilang begitu member mendapat role lain apa pun (self-role, role level, pemberian admin) — pengganti role Unverified, tanpa setup terpisah. ≙ <code className="text-amber-300/80">/set-autorole</code></>}
        done={done.autorole}
      >
        <Field label="Pilih dari daftar role" hint={done.autorole ? `Tersimpan: ${(c.autorole?.roleIds ?? []).map((id) => roleLabel(meta.roles, id)).join(", ")}` : undefined}>
          <RoleSelect value={joinPick} onChange={setJoinPick} roles={meta.roles} />
        </Field>
        <Field label="…atau masukkan ID role manual" hint={ID_HINT}>
          <div className="flex gap-2">
            <TextInput value={joinId} onChange={setJoinId} placeholder="mis. 888000111222333444" />
            <Button
              onClick={() => applyJoinRole(joinPick, joinId)}
              disabled={busy === "autorole"}
              className="shrink-0 bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300"
            >
              {busy === "autorole" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Daftarkan
            </Button>
          </div>
        </Field>
        <div className="md:col-span-2">
          <Toggle
            checked={c.autorole?.removeOnNewRole ?? false}
            onChange={() => toggleRemoveOnNewRole()}
            label="Hapus role join saat member dapat role lain"
            desc="AKTIF: semua role di daftar otomatis dilepas begitu member menerima role lain apa pun — cocok untuk penanda member baru. MATI: role join permanen ala Dyno."
          />
        </div>
      </StepCard>

      {/* Langkah 3 — Kategori & Produk */}
      <StepCard
        n={3}
        title="Kategori Tiket & Produk"
        desc={<>Siapkan katalog jualan: tiap produk muncul di price list panel tiket. ≙ <code className="text-amber-300/80">/add-product</code> — kelola lengkap di modul Tiket &amp; Produk.</>}
        done={done.catalog}
      >
        <div className="md:col-span-2">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800/70 bg-zinc-950/40 px-4 py-3">
            <Pill tone={cats.length > 0 ? "green" : "red"}>{cats.length} kategori</Pill>
            <Pill tone={products.length > 0 ? "green" : "red"}>{products.length} produk</Pill>
            <span className="text-[11px] text-zinc-500">
              {done.catalog
                ? "Katalog siap — panel tiket akan menampilkan price list ini."
                : "Tambahkan minimal 1 produk supaya panel tiket menampilkan price list."}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => goTo("tickets")}
              className="ml-auto border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-zinc-100"
            >
              Kelola katalog <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {/* Tambah produk cepat */}
        <div className="md:col-span-2 grid gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-4 md:grid-cols-6">
          <div className="md:col-span-2">
            <Field label="Label produk">
              <TextInput value={prdLabel} onChange={setPrdLabel} placeholder="mis. VIP 30 Hari" />
            </Field>
          </div>
          <div>
            <Field label="Value (ID unik)">
              <TextInput value={prdValue} onChange={setPrdValue} placeholder="vip30" />
            </Field>
          </div>
          <div>
            <Field label="Harga">
              <TextInput value={prdPrice} onChange={setPrdPrice} placeholder="Rp 30.000" />
            </Field>
          </div>
          <div>
            <Field label="Kategori">
              <Select
                value={prdCat}
                onChange={setPrdCat}
                options={cats.map((cat) => ({ value: cat.id, label: cat.label }))}
              />
            </Field>
          </div>
          <div className="flex items-end">
            <Button
              onClick={quickAddProduct}
              disabled={busy === "product"}
              className="w-full bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300"
            >
              {busy === "product" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Tambah
            </Button>
          </div>
          <div className="md:col-span-6">
            <button
              type="button"
              onClick={() => setPrdKey(!prdKey)}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                prdKey
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                  : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {prdKey ? "pakai key (role VIP — dikasih via /set-key)" : "tanpa key (jasa/akun — detail via DM)"}
            </button>
          </div>
        </div>
      </StepCard>

      {/* Langkah 4 — Panel Tiket */}
      <StepCard
        n={4}
        title="Pasang Panel Tiket"
        desc={<>Bot mengirim panel order (embed + tombol kategori + price list) ke channel pilihanmu — member klik untuk beli. ≙ <code className="text-amber-300/80">/setup-ticket-panel</code></>}
        done={done.panel}
      >
        <Field label="Channel tujuan" hint={done.panel ? `Terpasang di: ${panels.map((p) => channelLabel(meta.channels, p.channelId)).join(", ")}` : "Pilih channel tempat panel mau dipasang."}>
          <ChannelSelect value={panelChannel} onChange={setPanelChannel} channels={meta.channels} placeholder="— pilih channel —" />
        </Field>
        <Field label="Layout panel" hint="Dropdown hemat tempat untuk banyak kategori; tombol lebih mencolok.">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPanelDropdown(false)}
              className={`h-10 flex-1 rounded-lg border text-xs font-medium transition-colors ${
                !panelDropdown ? "border-amber-400/40 bg-amber-400/10 text-amber-300" : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              🔘 Tombol
            </button>
            <button
              type="button"
              onClick={() => setPanelDropdown(true)}
              className={`h-10 flex-1 rounded-lg border text-xs font-medium transition-colors ${
                panelDropdown ? "border-amber-400/40 bg-amber-400/10 text-amber-300" : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              📋 Dropdown
            </button>
            <Button
              onClick={installTicketPanel}
              disabled={busy === "panel"}
              className="shrink-0 bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300"
            >
              {busy === "panel" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Pasang
            </Button>
          </div>
        </Field>
      </StepCard>

      {/* Langkah 5 — Panel self-role (v3.22.0: menggantikan panel verifikasi lama) */}
      <StepCard
        n={5}
        title="Panel Self-Role (mis. Verifikasi)"
        desc={<>Panel tempat member mengambil role sendiri lewat tombol — tambahkan role Verified-mu di sini dan itu jadi gerbang verifikasi, dengan style/label/emoji sesukamu. ≙ <code className="text-amber-300/80">/setup-selfrole</code> + <code className="text-amber-300/80">/selfrole-add</code></>}
        done={done.selfrole}
      >
        <Field
          label="Panel self-role"
          hint={done.selfrole ? `${selfrolePanels.length} panel terpasang — kelola di modul Self Roles.` : "Belum ada — buat satu di modul Self Roles."}
        >
          <div className="flex items-center">
            <span className="mr-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
              🎭 {selfrolePanels.length} panel
            </span>
            <Button
              onClick={() => goTo("selfroles")}
              className="ml-auto bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300"
            >
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
              Buat / Kelola
            </Button>
          </div>
        </Field>
      </StepCard>

      {/* Langkah 6 — Channel Log */}
      <StepCard
        n={6}
        title="Channel Log Server"
        desc={<>Catat join/left, pesan dihapus, ban, dan semua tindakan moderasi. ≙ <code className="text-amber-300/80">/set-channel server-log</code></>}
        done={done.log}
      >
        <Field label="Pilih dari daftar channel" hint={done.log ? `Tersimpan: ${channelLabel(meta.channels, c.channels["server-log"])}` : undefined}>
          <ChannelSelect value={logPick} onChange={setLogPick} channels={meta.channels} />
        </Field>
        <Field label="…atau masukkan ID channel manual" hint={CHANNEL_ID_HINT}>
          <div className="flex gap-2">
            <TextInput value={logId} onChange={setLogId} placeholder="mis. 777000111222333444" />
            <Button
              onClick={() => applyChannel("log", "channels.server-log", logPick, logId, "Channel log terdaftar — aktivitas server mulai tercatat.")}
              disabled={busy === "log"}
              className="shrink-0 bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300"
            >
              {busy === "log" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Daftarkan
            </Button>
          </div>
        </Field>
      </StepCard>

      {/* Langkah lanjutan — menghubungkan kategori lain */}
      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 md:p-6">
        <h3 className="text-sm font-semibold text-zinc-100">Langkah lanjutan (opsional)</h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          Dasar sudah jalan? Semua kategori slash command bot punya modulnya sendiri di dashboard ini —
          atur semuanya dari web tanpa membuka Discord:
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            { id: "serverstats", label: "Server Stats", desc: "Counter member/boost live di atas daftar channel" },
            { id: "leveling", label: "Leveling", desc: "XP per pesan + role reward per level" },
            { id: "tempvoice", label: "Temp Voice", desc: "Channel suara privat yang dibuat sendiri member" },
            { id: "responders", label: "Auto-Responder", desc: "Auto-reply untuk pertanyaan yang sering ditanya" },
            { id: "selfroles", label: "Self Roles", desc: "Panel member mengambil role sendiri" },
            { id: "automod", label: "AutoMod", desc: "Anti-spam, blokir link & kata terlarang" },
            { id: "giveaway", label: "Giveaway & Poll", desc: "Kontes interaktif dengan tombol join/vote" },
            { id: "embed", label: "Embed Builder", desc: "Bikin embed di web, bot kirim ke channel" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => goTo(item.id)}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/40 px-4 py-3 text-left transition-colors hover:border-amber-400/30 hover:bg-zinc-900/60"
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-zinc-200">{item.label}</span>
                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{item.desc}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
