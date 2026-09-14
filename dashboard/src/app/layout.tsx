import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Thor Dashboard — Kendalikan Bot Discord-mu dari Web",
  description:
    "Bot Discord gratis untuk semua server: moderasi, tiket, toko, leveling, automod. Atur lewat slash command atau dashboard web ala Dyno — satu sumber data, dua cara kendali.",
  keywords: ["Discord bot", "dashboard", "Thor", "gratis", "moderasi", "ala Dyno"],
  authors: [{ name: "dwisetyabudi15581" }],
  openGraph: {
    title: "Thor Dashboard",
    description: "Bot Discord gratis — kendali penuh via slash command atau dashboard web.",
    siteName: "Thor Dashboard",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // className="dark": aplikasi ini SELALU gelap (bg-zinc-950 manual). Tanpa
    // class ini, variabel tema shadcn (:root) resolve ke tema TERANG — tombol
    // variant="outline" jadi berlatar PUTIH, menelan teks zinc terang
    // (bug "tulisan tidak kelihatan ketumpuk sama warna").
    <html lang="id" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950 text-zinc-100`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
