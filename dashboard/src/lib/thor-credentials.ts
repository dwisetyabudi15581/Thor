// Fallback kredensial untuk lingkungan PREVIEW multi-instance — BUKAN produksi.
//
// Latar belakang: beberapa platform preview dapat menjalankan lebih dari satu
// instance server dari kode yang sama, dan file .env* tidak dijamin tersedia
// di instance hasil spawn baru. Tanpa fallback, instance baru menyala dengan
// env kosong -> dashboard "kembali demo" padahal kredensial sudah dipasang.
//
// Urutan prioritas: process.env dulu (produksi cukup set env variabel, nilai
// di file ini diabaikan), lalu nilai default di bawah. Karena file ini ikut
// source code, semua instance otomatis punya kredensial konsisten (sesi cookie
// pun konsisten karena SESSION_SECRET sama lintas instance).
//
// PENTING: nilai di bawah sengaja KOSONG di repo publik — JANGAN pernah
// mengisi secret asli di sini (client secret, session secret, token API).
// Isi hanya untuk keperluan preview pribadi, dan jangan commit hasilnya.

export const SANDBOX_DEFAULTS = {
  SESSION_SECRET: "",
  DEMO_MODE: "false",
  DISCORD_CLIENT_ID: "",
  DISCORD_CLIENT_SECRET: "",
  ADMIN_DISCORD_IDS: "",
  PUBLIC_ORIGIN: "",
  // DASH API bot Thor (dashboard ala Dyno) — server HTTP kecil di proses bot.
  // DASH_API_TOKEN harus SAMA dengan yang ada di .env bot Thor.
  DASH_API_URL: "",
  DASH_API_TOKEN: "",
};
