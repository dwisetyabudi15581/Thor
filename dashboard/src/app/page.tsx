"use client";

// Halaman utama Thor Dashboard — satu rute, dua wajah:
// - belum login  -> landing publik (etalase fitur gratis + dashboard web)
// - sudah login  -> langsung diarahkan ke /app (pilih server ala Dyno)

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Hammer } from "lucide-react";
import { Landing } from "@/components/dashboard/landing";
import type { MeResponse } from "@/components/dashboard/types";

export default function Page() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    // ?_= penuh timestamp memaksa cache proxy/tab lama meminta salinan
    // segar dari server; header no-store menutup celah cache di sisi Next.
    const res = await fetch(`/api/me?_=${Date.now()}`, { cache: "no-store" });
    setMe((await res.json()) as MeResponse);
  }, []);

  useEffect(() => {
    void refresh().finally(() => setBooting(false));
  }, [refresh]);

  // Sudah login → pindah ke dashboard server (pilih server ala Dyno).
  useEffect(() => {
    if (me?.user) router.replace("/app");
  }, [me, router]);

  async function loginDemo(role: "member" | "admin") {
    setBusy(true);
    try {
      await fetch("/api/auth/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (booting || !me) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-100 gap-4">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/10 border border-amber-400/25">
          <Hammer className="h-6 w-6 text-amber-400" aria-hidden="true" />
          <span className="absolute inset-0 rounded-2xl border border-amber-400/40 animate-ping opacity-30" aria-hidden="true" />
        </div>
        <p className="text-sm text-zinc-400">Menyiapkan dashboard…</p>
      </div>
    );
  }

  if (!me.user) {
    return (
      <Landing
        config={me.config}
        busy={busy}
        onLoginDiscord={() => {
          window.location.href = "/api/auth/discord";
        }}
        onLoginDemo={loginDemo}
      />
    );
  }

  // User sudah login — efek redirect di atas sedang berjalan.
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-100 gap-4">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/10 border border-amber-400/25">
        <Hammer className="h-6 w-6 text-amber-400" aria-hidden="true" />
        <span className="absolute inset-0 rounded-2xl border border-amber-400/40 animate-ping opacity-30" aria-hidden="true" />
      </div>
      <p className="text-sm text-zinc-400">Menuju dashboard…</p>
    </div>
  );
}
