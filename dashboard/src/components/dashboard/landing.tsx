"use client";

// Landing publik Thor Dashboard — etalase bot GRATIS + kendali web ala Dyno.
// v2 (rombak): model langganan premium DIBEKUKAN — semua fitur bot gratis
// untuk siapa pun. Nilai jual baru: "dua cara kendali" (slash command di
// Discord ATAU dashboard web) + semua modul terbuka penuh.
// Desain tetap dark editorial (asimetris, whitespace lega, aksen emas tunggal).

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Hammer,
  ArrowRight,
  Loader2,
  Copy,
  Check,
  Lock,
  Terminal,
  LayoutDashboard,
  ShieldCheck,
  Ticket,
  Handshake,
  BarChart3,
  MessageSquareReply,
  Palette,
  Mic,
  Megaphone,
  Activity,
  Hash,
  Bot,
  Globe,
  Gift,
  KeyRound,
  Vote,
  SquarePen,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

type LandingProps = {
  config: {
    authReady: boolean;
    demoMode: boolean;
    inviteUrl: string;
    serverTime?: string;
    oauthRedirectUri?: string;
  };
  busy: boolean;
  onLoginDiscord: () => void;
  onLoginDemo: (role: "member" | "admin") => void;
};

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.5 },
};

/* ---------------- Elemen diagnosis (render di footer) ---------------- */

function OwnerSetupNote({ serverUri }: { serverUri?: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(serverUri ?? window.location.origin + "/api/auth/discord/callback");
  }, [serverUri]);

  if (!origin) return null;
  const bedaDenganBrowser =
    serverUri && !serverUri.startsWith(window.location.origin) ? true : false;

  async function copyUri() {
    try {
      await navigator.clipboard.writeText(origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard diblokir? teksnya tetap bisa diseleksi manual
    }
  }

  return (
    <details className="group rounded-xl border border-zinc-800/80 bg-zinc-900/30">
      <summary className="cursor-pointer list-none px-4 py-3 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-2 [&::-webkit-details-marker]:hidden">
        <Lock className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
        Setup pemilik bot — alamat redirect OAuth
        <ArrowRight className="ml-auto h-3.5 w-3.5 text-zinc-500 transition-transform group-open:rotate-90" aria-hidden="true" />
      </summary>
      <div className="px-4 pb-4 pt-1">
        <p className="text-xs text-zinc-400 leading-relaxed">
          Daftarkan alamat ini sekali di Discord Developer Portal (OAuth2 → Redirects)
          agar login Discord berfungsi:
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 text-[11px] leading-relaxed text-amber-200/90 break-all select-all">
            {origin}
          </code>
          <button
            type="button"
            onClick={copyUri}
            className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            {copied ? "Tersalin" : "Salin"}
          </button>
        </div>
        {bedaDenganBrowser ? (
          <p className="text-[10px] text-amber-500/80 mt-2 leading-relaxed">
            Catatan: alamat di atas (dipakai server saat login) berbeda dengan domain
            halaman ini — tetap daftarkan alamat di atas, bukan alamat address bar.
          </p>
        ) : null}
      </div>
    </details>
  );
}

// Indikator kesehatan koneksi: titik hijau berdenyut ketika data segar.
function ServerStatus({ serverTime }: { serverTime?: string }) {
  if (!serverTime) return null;
  const t = new Date(serverTime);
  const jam = t.toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const umurDetik = Math.max(0, Math.round((Date.now() - t.getTime()) / 1000));
  const segar = umurDetik < 120;
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-zinc-800/80 bg-zinc-900/40 px-3 py-1.5 text-[11px] text-zinc-400"
      title={segar ? `Data segar (${umurDetik}s lalu)` : `DATA BASI ${umurDetik}s — muat ulang halaman`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {segar ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
        ) : null}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${segar ? "bg-emerald-400" : "bg-red-400"}`}
        />
      </span>
      {segar ? "Sistem normal" : "Data basi — muat ulang"}
      <span className="text-zinc-500">· server {jam} WIB</span>
    </span>
  );
}

// Banner status login yang dibawa rute callback via ?error=<reason>.
const AUTH_ERRORS: Record<string, { title: string; hint?: string }> = {
  oauth_belum_disiapkan: { title: "Login Discord belum disiapkan di server." },
  login_dibatalkan: { title: "Login dibatalkan." },
  sesi_kedaluwarsa: {
    title: "Sesi login kedaluwarsa — coba login ulang.",
    hint: "Popup dibuka terlalu lama atau cookie state terhapus. Klik login lagi.",
  },
  login_gagal: {
    title: "Gagal menyelesaikan login Discord.",
    hint: "Kalau ini terus terjadi, pastikan alamat redirect di bagian “Setup pemilik bot” (footer) sudah terdaftar di Discord Developer Portal — persis sama, tanpa spasi.",
  },
  profil_tidak_terbaca: { title: "Profil Discord tidak bisa dibaca — coba lagi." },
};

function AuthErrorBanner() {
  const [info, setInfo] = useState<{ title: string; hint?: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get("error");
    if (!reason) return;
    setInfo(AUTH_ERRORS[reason] ?? { title: "Login gagal — coba lagi." });
    params.delete("error");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  if (!info) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 p-4 rounded-xl border border-red-900/60 bg-red-950/30"
      role="alert"
    >
      <p className="text-sm font-medium text-red-200">{info.title}</p>
      {info.hint ? <p className="text-xs text-red-200/70 mt-1.5 leading-relaxed">{info.hint}</p> : null}
    </motion.div>
  );
}

/* ---------------- Hero ---------------- */

function Hero({ config, busy, onLoginDiscord }: LandingProps) {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-6 pt-14 pb-16 md:pt-20 md:pb-24">
        <AuthErrorBanner />
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Copy kiri */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[11px] font-medium text-amber-300">
              <Bot className="h-3.5 w-3.5" aria-hidden="true" />
              Gratis · Tanpa langganan · Semua fitur terbuka
            </div>
            <h1 className="mt-5 text-4xl md:text-5xl font-semibold tracking-tight text-zinc-50 leading-[1.08]">
              Satu bot untuk seluruh servermu.
              <span className="block text-zinc-400 mt-2">Kendali lewat Discord atau web — pilih yang nyaman.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-zinc-400">
              Thor menggabungkan moderasi, tiket, toko, leveling, dan otomasi komunitas
              dalam satu bot. Atur semuanya langsung dengan slash command, atau buka
              dashboard web untuk konfigurasi menyeluruh — keduanya menulis ke sumber
              data yang sama, jadi tidak pernah bentrok.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={onLoginDiscord}
                disabled={busy}
                className="bg-amber-400 text-zinc-950 hover:bg-amber-300 h-11 px-6 font-semibold"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Buka Dashboard
              </Button>
              <a href={config.inviteUrl} target="_blank" rel="noreferrer">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-11 px-6 border-zinc-700 bg-transparent hover:bg-zinc-800/60 hover:text-zinc-100"
                >
                  Invite ke Server
                  <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                </Button>
              </a>
            </div>
            <p className="mt-4 text-xs text-zinc-500 leading-relaxed">
              Login aman lewat OAuth Discord — bot hanya membaca daftar server dan
              identitasmu, tanpa permission berbahaya.
            </p>
          </div>

          {/* Mockup kanan: dua panel kendali */}
          <div className="hidden lg:block">
            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-1.5 shadow-2xl shadow-black/40">
              <div className="rounded-xl bg-zinc-950/80 p-4">
                <div className="flex items-center gap-1.5 pb-3 border-b border-zinc-800/60">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
                  <span className="ml-3 text-[11px] text-zinc-500">thor dashboard — #umum</span>
                </div>
                <div className="pt-3 space-y-3 font-mono text-[11.5px] leading-relaxed">
                  <p className="text-zinc-500">
                    <span className="text-zinc-300">admin</span> hari ini jam 14.02
                  </p>
                  <p>
                    <span className="text-amber-300">/setup-ticket</span>{" "}
                    <span className="text-zinc-400">channel:#🎫buat-tiket</span>
                  </p>
                  <p className="text-zinc-600">✅ Panel tiket terpasang — 4 kategori aktif</p>
                  <p className="text-zinc-500 pt-1">
                    <span className="text-zinc-300">kamu</span> hari ini jam 14.05
                  </p>
                  <p>
                    <span className="text-amber-300">/add-product</span>{" "}
                    <span className="text-zinc-400">label:"VIP 30 Hari" price:Rp 15.000</span>
                  </p>
                  <p className="text-zinc-600">✅ Produk tersimpan di kategori transaction</p>
                </div>
                <div className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2.5">
                  <p className="text-[11px] text-amber-200/90 leading-snug">
                    ↻ Perubahan yang sama bisa dilakukan dari dashboard web —
                    data tersinkron otomatis, tanpa restart.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Strip statistik */}
        <div className="mt-14 grid grid-cols-2 divide-zinc-800/70 border-y border-zinc-800/70 md:grid-cols-4 md:divide-x">
          {[
            { v: "90+", l: "slash command siap pakai" },
            { v: "18", l: "modul yang bisa diatur dari web" },
            { v: "670+", l: "unit test — stabil & teruji" },
            { v: "Rp 0", l: "gratis selamanya, tanpa tier" },
          ].map((s) => (
            <div key={s.l} className="py-5 px-4 text-center md:text-left">
              <p className="text-2xl font-semibold text-zinc-100 tabular-nums">{s.v}</p>
              <p className="mt-1 text-xs text-zinc-500">{s.l}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Dua cara kendali ---------------- */

const CONTROL_WAYS = [
  {
    icon: Terminal,
    title: "Slash Command",
    desc: "Cepat, langsung di Discord. Ketik / dan semua command tersedia — lengkap dengan autocomplete, permission check, dan preview. Cocok untuk perubahan kecil seketika.",
    points: ["/setup-ticket, /add-product, /set-automod", "Permission Discord tetap berlaku", "Instant, tanpa buka browser"],
    accent: false,
  },
  {
    icon: LayoutDashboard,
    title: "Dashboard Web",
    desc: "Konfigurasi menyeluruh dengan formulir yang rapi — pilih channel dari dropdown, edit daftar kategori, jadwalkan pengumuman. Perubahan langsung efektif ke bot.",
    points: ["Login aman via Discord OAuth", "Form validasi + preview data live", "Kelola banyak server dari satu tempat"],
    accent: true,
  },
];

function ControlSection() {
  return (
    <section className="border-t border-zinc-900">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <motion.p {...fadeUp} className="text-xs font-medium uppercase tracking-widest text-amber-400/90">
          Dua Cara Kendali
        </motion.p>
        <motion.h2 {...fadeUp} className="mt-3 max-w-2xl text-2xl md:text-3xl font-semibold tracking-tight text-zinc-50">
          Satu sumber data, dua pintu masuk.
        </motion.h2>
        <motion.p {...fadeUp} className="mt-4 max-w-2xl text-[15px] leading-relaxed text-zinc-400">
          Apa pun yang kamu ubah dari web langsung terlihat oleh slash command —
          dan sebaliknya. Tidak ada mode sinkron manual, tidak ada restart.
        </motion.p>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {CONTROL_WAYS.map((w) => (
            <motion.div
              key={w.title}
              {...fadeUp}
              className={`relative rounded-2xl border p-6 ${
                w.accent
                  ? "border-amber-400/30 bg-gradient-to-b from-amber-400/[0.07] to-transparent"
                  : "border-zinc-800/80 bg-zinc-900/30"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
                  w.accent ? "border-amber-400/40 bg-amber-400/10" : "border-zinc-700/60 bg-zinc-800/60"
                }`}>
                  <w.icon className={`h-5 w-5 ${w.accent ? "text-amber-300" : "text-zinc-300"}`} aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-zinc-100">{w.title}</h3>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-zinc-400">{w.desc}</p>
              <ul className="mt-4 space-y-2">
                {w.points.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-[13px] text-zinc-400">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400/80" aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Grid modul ---------------- */

const MODULES = [
  { icon: ShieldCheck, name: "Moderasi & Warn", desc: "Timeout, purge, kick/ban, sistem warn dengan riwayat." },
  { icon: Hash, name: "AutoMod", desc: "Anti-spam, blokir link & kata, batas mention, whitelist." },
  { icon: Ticket, name: "Tiket & Toko", desc: "Panel tiket multi-kategori, produk, invoice otomatis." },
  { icon: Handshake, name: "Rekber (Escrow)", desc: "Deal 3-pihak buyer–seller–midman dengan papan deal." },
  { icon: BarChart3, name: "Leveling", desc: "XP per pesan, role reward per level, leaderboard." },
  { icon: MessageSquareReply, name: "Auto-Responder", desc: "Trigger kata → balasan otomatis, cooldown anti-spam." },
  { icon: Palette, name: "Self Roles", desc: "Panel tombol/select untuk member ambil-lepas role." },
  { icon: Mic, name: "Temporary Voice", desc: "Channel suara privat per member, kontrol via tombol." },
  { icon: Megaphone, name: "Announce Terjadwal", desc: "Pengumuman sekali atau berulang harian/mingguan." },
  { icon: Activity, name: "Server Stats", desc: "Counter member/boost/role live di nama channel." },
  { icon: Gift, name: "Auto-Role", desc: "Role otomatis saat member join + toggle role hilang saat dapat role lain." },
  { icon: Globe, name: "Backup", desc: "Snapshot struktur server, restore saat darurat." },
  { icon: Terminal, name: "Command Manager", desc: "Aktif/nonaktifkan tiap slash command per server — ala Dyno." },
  { icon: Gift, name: "Giveaway", desc: "Mulai giveaway dengan tombol Join/Leave dari web." },
  { icon: KeyRound, name: "Kunci VIP", desc: "Beri key produk — role + auto-expire otomatis." },
  { icon: SquarePen, name: "Embed Builder", desc: "Bikin embed lengkap dengan pratinjau live ala Discord, kirim ke channel mana pun." },
  { icon: Wand2, name: "Custom Command", desc: "Bikin slash command sendiri dari web — langsung terdaftar di Discord untuk member." },
  { icon: Vote, name: "Poll", desc: "Polling interaktif dengan tombol vote." },
];

function ModulesSection() {
  return (
    <section className="border-t border-zinc-900">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <motion.p {...fadeUp} className="text-xs font-medium uppercase tracking-widest text-amber-400/90">
          Semua Modul
        </motion.p>
        <motion.h2 {...fadeUp} className="mt-3 max-w-2xl text-2xl md:text-3xl font-semibold tracking-tight text-zinc-50">
          18 modul. Semuanya gratis. Semuanya bisa diatur dari web.
        </motion.h2>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <motion.div
              key={m.name}
              {...fadeUp}
              className="group rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4 hover:border-zinc-700 hover:bg-zinc-900/60 transition-colors"
            >
              <m.icon className="h-5 w-5 text-amber-300/90" aria-hidden="true" />
              <h3 className="mt-3 text-sm font-semibold text-zinc-100">{m.name}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{m.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Cara pakai ---------------- */

const STEPS = [
  { n: "01", title: "Invite bot", desc: "Klik “Invite ke Server”, pilih servermu, selesai — slash command langsung terpasang tanpa setup." },
  { n: "02", title: "Login dashboard", desc: "Buka dashboard dan login dengan Discord. Daftar server tempat kamu admin tampil otomatis." },
  { n: "03", title: "Kelola sesukamu", desc: "Aktifkan modul, atur channel dan role, isi pesan selamat datang — dari web atau slash command." },
];

function HowSection() {
  return (
    <section className="border-t border-zinc-900">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <motion.p {...fadeUp} className="text-xs font-medium uppercase tracking-widest text-amber-400/90">
          Mulai dalam 3 Langkah
        </motion.p>
        <motion.h2 {...fadeUp} className="mt-3 max-w-2xl text-2xl md:text-3xl font-semibold tracking-tight text-zinc-50">
          Dari invite sampai jalan — di bawah 5 menit.
        </motion.h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <motion.div key={s.n} {...fadeUp} className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-6">
              <p className="font-mono text-xs text-amber-400/80">{s.n}</p>
              <h3 className="mt-3 text-base font-semibold text-zinc-100">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- FAQ ---------------- */

const FAQ_ITEMS = [
  {
    q: "Benar-benar gratis? Fitur mana saja yang dibatasi?",
    a: "Tidak ada batasan. Seluruh modul — moderasi, tiket, toko, rekber, leveling, automod, sampai backup — terbuka penuh untuk semua server, tanpa tier berbayar dan tanpa key aktivasi.",
  },
  {
    q: "Apa bedanya mengatur dari web vs slash command?",
    a: "Hasil akhirnya sama persis — keduanya menulis ke data yang satu. Web lebih nyaman untuk konfigurasi panjang (edit daftar kategori, jadwal pengumuman, kalimat selamat datang), slash command lebih cepat untuk perubahan kecil langsung di Discord.",
  },
  {
    q: "Apakah bot saya bisa mengubah server tanpa izin?",
    a: "Tidak. Dashboard hanya menampilkan server di mana kamu punya izin Manage Server di Discord, dan setiap perubahan diverifikasi ulang oleh Discord sebelum diterapkan. Bot juga hanya menjalankan perintah sesuai permission channel yang sudah kamu berikan.",
  },
  {
    q: "Data konfigurasi disimpan di mana?",
    a: "Di server tempat bot kamu berjalan (file JSON per server) — bukan di cloud pihak ketiga. Kalau kamu self-host, data 100% milikmu dan bisa dibackup kapan saja.",
  },
  {
    q: "Bisa dipakai untuk banyak server sekaligus?",
    a: "Bisa. Konfigurasi tiap server terisolasi penuh — setelan server A tidak pernah bocor ke server B. Dashboard menampilkan semua server tempat kamu admin.",
  },
];

function FaqSection() {
  return (
    <section id="faq" className="border-t border-zinc-900">
      <div className="mx-auto max-w-3xl px-6 py-16 md:py-20">
        <motion.p {...fadeUp} className="text-xs font-medium uppercase tracking-widest text-amber-400/90">
          FAQ
        </motion.p>
        <motion.h2 {...fadeUp} className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight text-zinc-50">
          Pertanyaan yang sering muncul.
        </motion.h2>
        <motion.div {...fadeUp} className="mt-8">
          <Accordion type="single" collapsible className="w-full">
            {FAQ_ITEMS.map((f, i) => (
              <AccordionItem key={f.q} value={`item-${i}`} className="border-zinc-800/80">
                <AccordionTrigger className="text-left text-[15px] text-zinc-200 hover:text-zinc-50 hover:no-underline">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-zinc-400">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </section>
  );
}

/* ---------------- CTA + Footer ---------------- */

function CtaSection({ onLoginDiscord, inviteUrl }: { onLoginDiscord: () => void; inviteUrl: string }) {
  return (
    <section className="border-t border-zinc-900">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <motion.div
          {...fadeUp}
          className="relative overflow-hidden rounded-3xl border border-amber-400/25 bg-gradient-to-b from-amber-400/[0.08] to-transparent px-6 py-12 text-center md:px-12"
        >
          <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-amber-400/10 blur-3xl" aria-hidden="true" />
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-50">
            Servermu siap dikelola dengan cara baru.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-zinc-400">
            Invite bot, login, dan mulai atur modul favoritmu. Tidak ada syasan berlangganan —
            semuanya terbuka sejak menit pertama.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button
              onClick={onLoginDiscord}
              className="bg-amber-400 text-zinc-950 hover:bg-amber-300 h-11 px-6 font-semibold"
            >
              Login dengan Discord
            </Button>
            <a href={inviteUrl} target="_blank" rel="noreferrer">
              <Button variant="outline" className="h-11 px-6 border-zinc-700 bg-transparent hover:bg-zinc-800/60 hover:text-zinc-100">
                Invite Bot
              </Button>
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ---------------- Root ---------------- */

export function Landing(props: LandingProps) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-zinc-900/80 bg-zinc-950/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 border border-amber-400/25">
              <Hammer className="h-4 w-4 text-amber-400" aria-hidden="true" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-zinc-100">Thor</p>
              <p className="text-[10px] text-zinc-500">Community Bot Dashboard</p>
            </div>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
            <a href="#modul" className="hover:text-zinc-100 transition-colors">Modul</a>
            <a href="#cara" className="hover:text-zinc-100 transition-colors">Cara Pakai</a>
            <a href="#faq" className="hover:text-zinc-100 transition-colors">FAQ</a>
          </nav>
          <Button
            onClick={props.onLoginDiscord}
            disabled={props.busy}
            size="sm"
            className="bg-amber-400 text-zinc-950 hover:bg-amber-300 font-semibold"
          >
            {props.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Login
          </Button>
        </div>
      </header>

      <main>
        <Hero {...props} />
        <ControlSection />
        <div id="modul">
          <ModulesSection />
        </div>
        <div id="cara">
          <HowSection />
        </div>
        <FaqSection />
        <CtaSection onLoginDiscord={props.onLoginDiscord} inviteUrl={props.config.inviteUrl} />
      </main>

      <footer className="border-t border-zinc-900/80">
        <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-400/10 border border-amber-400/25">
                <Hammer className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              </div>
              <p className="text-xs text-zinc-500">
                Thor Community Bot — gratis untuk semua server, kendali penuh via Discord &amp; web.
              </p>
            </div>
            <ServerStatus serverTime={props.config.serverTime} />
          </div>
          <OwnerSetupNote serverUri={props.config.oauthRedirectUri} />
        </div>
      </footer>
    </div>
  );
}
