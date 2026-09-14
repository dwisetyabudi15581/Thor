"use client";

// /app/servers/[guildId] — halaman dashboard per-server (ala Dyno).
// Verifikasi akses (login + ManageGuild) dilakukan di API route;
// halaman ini hanya shell tipis untuk komponen GuildDashboard.

import { useParams } from "next/navigation";
import { GuildDashboard } from "@/components/dashboard/guild-dashboard";

export default function ServerDashboardPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = typeof params?.guildId === "string" ? params.guildId : "";

  if (!guildId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-100 gap-2">
        <p className="text-sm text-zinc-400">ID server tidak valid.</p>
      </div>
    );
  }

  return <GuildDashboard guildId={guildId} />;
}
