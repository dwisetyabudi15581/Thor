#!/usr/bin/env node
/**
 * Mock DASH API — server tiruan DASH API bot Thor untuk SANDBOX/DEMO.
 *
 * Kenapa ada: dashboard web butuh bot nyala untuk menampilkan data. Di
 * sandbox bot tidak jalan (tanpa DISCORD_TOKEN) — mock ini menyuplai
 * endpoint yang SAMA (health/guilds/meta/dashboard/config/automod/
 * responders/announce/selfroles) dengan data demo realistis, sehingga:
 *   1. UI dashboard bisa dikembangkan + diuji + di-screenshot penuh.
 *   2. USER bisa mempratinjau tampilan dashboard dengan server Discord
 *      aslinya sendiri sebelum bot di-deploy (lihat /__demo/adopt).
 *
 * Produksi: TIDAK dipakai. Web otomatis mengabaikan mock (endpoint
 * /__demo/adopt tidak ada di bot asli → 404 → diabaikan). Jalankan bot
 * asli + set DASH_API_URL/TOKEN di .env web.
 *
 * Jalankan: node scripts/mock-dash-api.mjs   (default 127.0.0.1:8788)
 * Env: MOCK_DASH_PORT, MOCK_DASH_TOKEN, MOCK_DASH_HOST
 */

import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.MOCK_DASH_PORT || process.env.DASH_API_PORT || 8788);
const HOST = process.env.MOCK_DASH_HOST || "127.0.0.1";
const TOKEN = process.env.MOCK_DASH_TOKEN || "dash-dev-token-thor-local-8788";

// ============================================================
// === Store in-memory per guild ===
// ============================================================

const guilds = new Map(); // guildId -> { meta, data }

function defaultConfig() {
  return {
    roles: { admin: "333333333333333333" },
    // v3.23.0: konsep role verify/unverified dihapus — autorole + toggle.
    autorole: { roleIds: ["555555555555555555"], removeOnNewRole: true },
    channels: { welcome: "444444444444444444", goodbye: null, invoice: "555555555555555555" },
    messages: {
      welcomeTitle: "👋 SELAMAT DATANG!",
      welcomeBody: "Halo {user}!\n\nSelamat datang di **{server}** 🎉\n\n🔐 Silakan verifikasi dirimu untuk mendapatkan akses penuh ke server.\n\n📊 Kamu adalah member ke-**{count}**!",
      goodbyeTitle: "👋 SELAMAT JALAN",
      goodbyeBody: "**{username}** telah {action} dari server.\n\nSampai jumpa lagi! 👋",
      verifyTitle: "✅ VERIFIKASI SERVER",
      verifyBody: "Selamat datang di **{server}**!\nKlik tombol di bawah untuk diverifikasi dan mendapatkan akses penuh ke seluruh channel.",
      ticketTitle: "🎫 SISTEM TIKET & PRICE LIST",
      ticketBody: "Butuh bantuan atau ingin membeli?\n\nKlik tombol kategori di bawah untuk memulai.\n\n**{price_header}**\n{price_list}",
      ticketPriceHeader: "💰 PRICE LIST 💰",
    },
    colors: { success: 3066993, danger: 15158332, primary: 3447003, warning: 15105570, info: 5793266 },
    verifyButton: { label: "Verifikasi Saya", emoji: "✅", style: "Success" },
    ticketCategories: [
      { id: "transaction", label: "Beli Key / Transaksi", emoji: "🔑", style: "Primary", requiresKey: true, isDefault: true },
      { id: "help", label: "Help", emoji: "📞", style: "Secondary", requiresKey: false, isDefault: true },
      { id: "report", label: "Report", emoji: "⚠️", style: "Danger", requiresKey: false, isDefault: true },
    ],
    leveling: { enabled: true, xpPerMessage: 15, cooldownMs: 60000, announceLevelUp: true, levelUpChannel: null },
    levelRoles: [
      { level: 5, roleId: "333333333333333333" },
      { level: 10, roleId: "111111111111111111" },
    ],
    midman: { feeMode: "percent", feeValue: 5, category: "🤝 REKBER" },
    products: [
      { label: "VIP 30 Hari", value: "vip30", price: "Rp 15.000", duration: "30 hari", category: "transaction", requiresKey: true, roleId: "111111111111111111", days: 30 },
      { label: "VIP 90 Hari", value: "vip90", price: "Rp 35.000", duration: "90 hari", category: "transaction", requiresKey: true, roleId: "111111111111111111", days: 90 },
      { label: "Jasa Setup Bot", value: "setup", price: "Rp 50.000", category: "transaction", requiresKey: false },
    ],
  };
}

function defaultAutomod() {
  return {
    enabled: true,
    spamThreshold: 5,
    spamWindowMs: 10000,
    spamAction: "mute_10m",
    blockLinks: false,
    linkAllowedChannels: [],
    linkAllowedRoles: [],
    wordRules: [
      { word: "scam", action: "delete_only", addedBy: "mock", addedAt: Date.now() },
      { word: "jual akun", action: "mute_10m", addedBy: "mock", addedAt: Date.now() },
    ],
    exemptWords: ["scammer-alert"],
    wordMatchMode: "whole_word",
    wordAction: "delete_only",
    maxMentions: 5,
    mentionAction: "warn",
  };
}

function makeMeta({ id, name, icon, memberCount }) {
  const ch = (n, t, p) => ({ id: crypto.randomBytes(8).toString("hex").padEnd(18, "4").replace(/[^0-9]/g, "7").slice(0, 18), name: n, type: t, position: p });
  return {
    id,
    name,
    icon: icon ?? null,
    memberCount: memberCount ?? 128,
    channels: [
      ch("📢 pengumuman", 0, 0),
      ch("💬 umum", 0, 1),
      ch("🎫 buat-tiket", 0, 2),
      ch("🏆 leaderboard", 0, 3),
      ch("🎧 Lounge", 2, 4),
    ],
    roles: [
      { id: "333333333333333333", name: "Admin", color: 15548997, position: 5 },
      { id: "444444444444444444", name: "Moderator", color: 3447003, position: 4 },
      { id: "111111111111111111", name: "VIP", color: 15844367, position: 3 },
      { id: "222222222222222222", name: "Newbie", color: 10070709, position: 2 },
      { id: "555555555555555555", name: "Member", color: 0, position: 1 },
    ],
  };
}

// v3.19.0: katalog command demo untuk modul Command Manager (subset
// representatif — bot asli mengirim semua 93 command dari registry).
const COMMAND_CATALOG = [
  ["help", "Pusat bantuan: pilih kategori atau cari command", "help"],
  ["setup-verify", "Setup panel verifikasi member baru", "config"],
  ["setup-ticket", "Setup panel tiket 1 kategori (legacy)", "config"],
  ["set-role", "Set role sistem (verified/admin/midman/booster)", "config"],
  ["set-channel", "Set channel sistem (welcome/invoice/log/dll)", "config"],
  ["set-message", "Set teks pesan sistem", "config"],
  ["config-show", "Lihat semua konfigurasi", "config"],
  ["reset-config", "Reset semua konfigurasi (2-step)", "config"],
  ["test-welcome", "Diagnosis + preview welcome/goodbye", "config"],
  ["add-product", "Tambah produk ke price list", "products"],
  ["list-products", "Lihat daftar produk", "products"],
  ["set-product-role", "Set auto-role produk + durasi", "products"],
  ["set-key", "Beri key produk ke member", "keys"],
  ["list-keys", "Lihat key member", "keys"],
  ["clear-schedule", "Hapus schedule/key user", "keys"],
  ["add-category", "Tambah kategori tiket", "categories"],
  ["setup-ticket-panel", "Pasang panel tiket multi-kategori", "panels"],
  ["list-panels", "Lihat semua panel", "panels-mgmt"],
  ["setup-selfrole", "Buat panel self-role", "selfrole"],
  ["selfrole-list", "Lihat panel self-role", "selfrole"],
  ["announce", "Kirim pengumuman embed", "announce"],
  ["announce-schedule", "Jadwalkan pengumuman", "announce"],
  ["embed-builder", "Bangun embed interaktif", "embed"],
  ["send-message", "Kirim embed via form", "send-message"],
  ["backup-now", "Backup data sekarang", "backup"],
  ["restore-backup", "Pulihkan dari backup", "backup"],
  ["giveaway", "Kelola giveaway (create/list/end/reroll)", "giveaway"],
  ["poll", "Buat poll dengan tombol vote", "poll"],
  ["warn", "Beri peringatan member", "warn"],
  ["warn-list", "Riwayat warn member", "warn"],
  ["timeout", "Mute member sementara", "moderation"],
  ["kick", "Keluarkan member", "moderation"],
  ["ban", "Blokir member", "moderation"],
  ["purge", "Hapus massal pesan", "moderation"],
  ["stats", "Statistik server live", "stats"],
  ["leaderboard", "Top 10 member", "stats"],
  ["boosters", "Daftar booster + riwayat", "stats"],
  ["serverstats", "Channel counter live", "serverstats"],
  ["setup-tempvoice", "Setup temporary voice", "tempvoice"],
  ["add-responder", "Tambah auto-responder", "responder"],
  ["set-automod", "Konfigurasi auto-mod", "automod"],
  ["afk", "Set status AFK", "afk"],
  ["setup-leveling", "Aktifkan XP & level", "leveling"],
  ["rank", "Lihat level & XP", "leveling"],
  ["set-midman-fee", "Set fee rekber", "midman"],
  ["midman-deals", "Lihat deal rekber aktif", "midman"],
  ["commands", "Kelola aktif/nonaktif command (ala Dyno)", "commands"],
];

function seedGuild({ id, name, icon, memberCount }) {
  const meta = makeMeta({ id, name, icon, memberCount });
  const data = {
    config: defaultConfig(),
    automod: defaultAutomod(),
    responders: [
      {
        id: `resp_${id}_1`,
        trigger: "harga",
        matchMode: "contains",
        reply: "Cek daftar harga di 📢 pengumuman ya!",
        replyType: "text",
        cooldownMs: 3000,
        useCount: 12,
      },
      {
        id: `resp_${id}_2`,
        trigger: "!sosmed",
        matchMode: "exact",
        reply: "Instagram: @thorbot • TikTok: @thorbot",
        replyType: "text",
        cooldownMs: 5000,
        useCount: 3,
      },
    ],
    selfroles: [
      {
        id: `srp_${id}_1`,
        guildId: id,
        channelId: meta.channels[1].id,
        messageId: "998877665544332211",
        title: "🎭 Pilih Role Kamu",
        description: "Klik tombol untuk ambil / lepas role.",
        type: "button",
        exclusive: false,
        roles: [
          { roleId: "111111111111111111", label: "VIP", emoji: "⭐", description: "Role VIP", style: "Success" },
          { roleId: "555555555555555555", label: "Notif", emoji: "🔔", description: "Ping pengumuman", style: "Secondary" },
        ],
      },
    ],
    tempvoice: { creatorChannelId: meta.channels[4].id, categoryId: "777777777777777777", activeChannels: 2 },
    announces: [
      {
        id: `sa_${id}_1`,
        guildId: id,
        channelId: meta.channels[0].id,
        sendAt: Date.now() + 3600_000,
        sent: false,
        sentAt: null,
        recurring: null,
        data: { title: "Event Akhir Pekan 🎉", description: "Jangan lupa join event minggu ini!", color: 5793266, mention: "@everyone" },
      },
    ],
    serverstats: { enabled: true, config: { enabled: true } },
    // v3.19.0: Command Manager + modul baru (data demo).
    commands: {
      list: COMMAND_CATALOG.map(([name, description, domain]) => ({ name, description, domain })),
      disabled: ["giveaway", "afk-list"],
      protected: ["commands"],
    },
    giveaways: [
      {
        id: `gw_${id}_1`,
        guildId: id,
        channelId: meta.channels[0].id,
        messageId: "112233445566778899",
        prize: "VIP 30 Hari",
        winnersCount: 2,
        endsAt: Date.now() + 7200_000,
        ended: false,
        winnerIds: [],
        participantIds: ["111111111111111111", "222222222222222222", "333333333333333333"],
        hostId: "333333333333333333",
        hostTag: "Owner#0001",
        requiredRoleId: null,
        createdAt: Date.now() - 3600_000,
      },
      {
        id: `gw_${id}_2`,
        guildId: id,
        channelId: meta.channels[1].id,
        messageId: "112233445566778800",
        prize: "Nitro 1 Bulan",
        winnersCount: 1,
        endsAt: Date.now() - 86400_000,
        ended: true,
        winnerIds: ["222222222222222222"],
        participantIds: ["111111111111111111", "222222222222222222"],
        hostId: "333333333333333333",
        hostTag: "Owner#0001",
        requiredRoleId: null,
        createdAt: Date.now() - 172800_000,
      },
    ],
    polls: [
      {
        id: `poll_${id}_1`,
        guildId: id,
        channelId: meta.channels[1].id,
        messageId: "998877665544332200",
        question: "Event berikutnya main apa?",
        options: [
          { label: "Mobile Legends", emoji: "1\u20e3", votes: ["111111111111111111"] },
          { label: "Valorant", emoji: "2\u20e3", votes: ["222222222222222222", "333333333333333333"] },
        ],
        multiple: false,
        closed: false,
        createdAt: Date.now() - 1800_000,
        closedAt: null,
        creatorId: "333333333333333333",
        creatorTag: "Owner#0001",
      },
    ],
    backups: [
      { name: "2026-09-14_08-30-00", size: 24576, fileCount: 12, mtime: Date.now() - 86400_000 },
      { name: "2026-09-13_08-30-00", size: 23552, fileCount: 12, mtime: Date.now() - 172800_000 },
      { name: "pre-restore_2026-09-12_10-15-00", size: 23040, fileCount: 11, mtime: Date.now() - 259200_000 },
    ],
    warns: [
      {
        id: `warn_${id}_1`,
        reason: "Spam link di channel umum",
        warnedBy: "333333333333333333",
        warnedByTag: "Owner#0001",
        guildId: id,
        userId: "999222999222999222",
        createdAt: Date.now() - 5400_000,
        actionTaken: null,
      },
      {
        id: `warn_${id}_2`,
        reason: "Bahasa kasar",
        warnedBy: "444444444444444444",
        warnedByTag: "Moderator#0002",
        guildId: id,
        userId: "888777888777888777",
        createdAt: Date.now() - 172800_000,
        actionTaken: null,
      },
    ],
    modlogs: [
      {
        id: `mod_${id}_1`,
        type: "timeout",
        reason: "Spam setelah peringatan",
        durationMs: 3600000,
        moderatorId: "444444444444444444",
        moderatorTag: "Moderator#0002",
        guildId: id,
        userId: "999222999222999222",
        createdAt: Date.now() - 5300_000,
      },
      {
        id: `mod_${id}_2`,
        type: "kick",
        reason: "Iklan server lain",
        durationMs: null,
        moderatorId: "333333333333333333",
        moderatorTag: "Owner#0001",
        guildId: id,
        userId: "777666777666777666",
        createdAt: Date.now() - 259200_000,
      },
    ],
    keys: [
      {
        id: `key_${id}_1`,
        key: "ABCDE-FGHIJ-KLMNO",
        userId: "111111111111111111",
        username: "Budi#1234",
        roleId: "111111111111111111",
        productName: "VIP 30 Hari",
        days: 30,
        expireAt: Date.now() + 2592000_000,
        createdAt: Date.now() - 86400000,
        guildId: id,
      },
      {
        id: `key_${id}_2`,
        key: "PQRST-UVWXY-Z0123",
        userId: "222222222222222222",
        username: "Sari#5678",
        roleId: "111111111111111111",
        productName: "VIP 90 Hari",
        days: 90,
        expireAt: null,
        createdAt: Date.now() - 172800000,
        guildId: id,
      },
    ],
    // v3.21.0: panel tiket terpasang (status checklist Panduan Cepat).
    // Demo sengaja kosong — langkah "pasang panel tiket" kelihatan belum
    // selesai, jadi alur quickstart bisa dicoba penuh dari web.
    panels: [],
    // v3.20.0: custom command demo — contoh nyata hasil modul Custom Command.
    customCommands: [
      {
        name: "sosmed",
        description: "Link semua sosial media server",
        ephemeral: false,
        content: "Follow sosial media kita ya!",
        embed: {
          title: "📱 SOSIAL MEDIA SERVER",
          description: "Semua channel resmi kami ada di sini.",
          color: 5793266,
          authorName: "",
          authorIconURL: "",
          thumbnail: "",
          image: "",
          footerText: "Diupdate rutin oleh admin",
          footerIconURL: "",
          timestamp: true,
          fields: [
            { name: "Instagram", value: "@thorbot", inline: true },
            { name: "TikTok", value: "@thorbot", inline: true },
            { name: "YouTube", value: "Thor Community", inline: true },
          ],
        },
        createdBy: "333333333333333333",
        createdByTag: "Owner#0001",
        createdAt: Date.now() - 345600000,
        updatedAt: Date.now() - 86400000,
        useCount: 47,
      },
      {
        name: "aturan",
        description: "Aturan singkat server",
        ephemeral: true,
        content: "",
        embed: {
          title: "📜 ATURAN SERVER",
          description: "1. Sopan\n2. No spam\n3. No iklan tanpa izin\n4. Ikuti channel masing-masing",
          color: 15105570,
          authorName: "",
          authorIconURL: "",
          thumbnail: "",
          image: "",
          footerText: "Pelanggaran = warn / mute / ban",
          footerIconURL: "",
          timestamp: false,
          fields: [],
        },
        createdBy: "333333333333333333",
        createdByTag: "Owner#0001",
        createdAt: Date.now() - 691200000,
        updatedAt: Date.now() - 691200000,
        useCount: 128,
      },
    ],
  };
  guilds.set(id, { meta, data });
  return guilds.get(id);
}

function setPath(obj, dotPath, value) {
  const parts = dotPath.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// ============================================================
// === HTTP server ===
// ============================================================

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  const send = (code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
    res.end(body);
  };
  const readBody = () =>
    new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
        } catch {
          resolve({});
        }
      });
    });

  if (req.method === "GET" && url.pathname === "/health") {
    return send(200, { ok: true, ready: true, guildCount: guilds.size, uptimeSec: Math.floor(process.uptime()), version: "mock-3.16.0" });
  }

  // Token auth
  const got = req.headers["x-dash-token"];
  if (!got || got.length !== TOKEN.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(TOKEN))) {
    return send(401, { error: "Token tidak valid" });
  }

  // --- Endpoint khusus demo: adopt guild user supaya bisa dipratinjau ---
  if (req.method === "POST" && url.pathname === "/__demo/adopt") {
    const body = await readBody();
    const list = Array.isArray(body?.guilds) ? body.guilds : [];
    for (const g of list) {
      if (!g?.id || !/^\d{5,25}$/.test(String(g.id))) continue;
      if (!guilds.has(g.id)) seedGuild({ id: String(g.id), name: String(g.name || "Server"), icon: g.icon ?? null, memberCount: g.memberCount ?? null });
    }
    return send(200, { ok: true, adopted: list.length });
  }

  if (parts[0] !== "guilds") return send(404, { error: "Endpoint tidak ditemukan" });

  if (req.method === "GET" && parts.length === 1) {
    return send(200, { guilds: [...guilds.values()].map(({ meta }) => ({ id: meta.id, name: meta.name, icon: meta.icon, memberCount: meta.memberCount, ownerId: null })) });
  }

  const guildId = parts[1];
  const entry = guilds.get(guildId);
  const rest = parts.slice(2);

  if (req.method === "GET" && rest[0] === "meta") {
    return entry ? send(200, entry.meta) : send(404, { error: "Bot tidak ada di server ini" });
  }
  if (req.method === "GET" && rest[0] === "dashboard") {
    if (!entry) return send(404, { error: "Bot tidak ada di server ini" });
    // v3.20.0: custom command ikut masuk daftar Command Manager (domain
    // 'custom') — sama seperti payload bot asli (dashServer.js).
    const payload = {
      ...entry.data,
      commands: {
        ...entry.data.commands,
        list: [
          ...entry.data.commands.list,
          ...entry.data.customCommands.map((c) => ({ name: c.name, description: c.description, domain: "custom", custom: true })),
        ],
      },
    };
    return send(200, payload);
  }

  if (!entry) return send(404, { error: "Bot tidak ada di server ini" });

  if (req.method === "PUT" && rest[0] === "config") {
    const body = await readBody();
    const updates = body?.updates ?? {};
    for (const [p, v] of Object.entries(updates)) setPath(entry.data.config, p, v);
    console.log(`[m[mock-dash] config ${guildId} += ${Object.keys(updates).length} field (actor ${body?.actor?.tag ?? "?"})`);
    return send(200, { ok: true, applied: Object.keys(updates), config: entry.data.config });
  }

  if (req.method === "PUT" && rest[0] === "automod") {
    const body = await readBody();
    delete body.actor;
    entry.data.automod = { ...entry.data.automod, ...body };
    return send(200, { ok: true, automod: entry.data.automod });
  }

  // v3.19.0: Command Manager — simpan daftar disabled
  // v3.20.0: custom command guild ini juga sah dinonaktifkan.
  if (req.method === "PUT" && rest[0] === "commands" && rest.length === 1) {
    const body = await readBody();
    const disabled = Array.isArray(body?.disabled) ? body.disabled : null;
    if (!disabled) return send(422, { error: "Daftar command tidak valid (harus array)" });
    const known = new Set([...entry.data.commands.list.map((c) => c.name), ...entry.data.customCommands.map((c) => c.name)]);
    const bad = disabled.filter((n) => !known.has(String(n)));
    if (bad.length) return send(422, { error: `Command \`${bad[0]}\` tidak dikenal` });
    if (disabled.includes("commands")) return send(422, { error: "Command `/commands` tidak bisa dinonaktifkan — itu pintu manajemen command" });
    entry.data.commands.disabled = [...new Set(disabled.map(String))];
    return send(200, { ok: true, disabled: entry.data.commands.disabled, total: known.size });
  }

  // v3.20.0: Custom Commands — buat/update + hapus dari web
  if (rest[0] === "custom-commands") {
    if (req.method === "POST" && rest.length === 1) {
      const body = await readBody();
      const name = String(body?.name || "").trim().toLowerCase();
      const description = String(body?.description || "").trim();
      const content = String(body?.content || "").trim();
      const embed = body?.embed && typeof body.embed === "object" ? body.embed : {};
      if (!/^[a-z0-9_-]{1,32}$/.test(name)) return send(422, { error: "Nama command hanya boleh huruf kecil, angka, - dan _ (1-32 karakter)" });
      if (entry.data.commands.list.some((c) => c.name === name)) return send(422, { error: `Nama \`/${name}\` sudah dipakai command bawaan bot — pilih nama lain` });
      if (!description || description.length > 100) return send(422, { error: "Deskripsi wajib diisi (1-100 karakter)" });
      const embedHasContent = [embed.title, embed.description, embed.authorName, embed.footerText, embed.image, embed.thumbnail].some((v) => String(v || "").trim()) || (Array.isArray(embed.fields) && embed.fields.length > 0);
      if (!content && !embedHasContent) return send(422, { error: "Minimal isi teks balasan ATAU embed — keduanya kosong" });
      if (!entry.data.customCommands.some((c) => c.name === name) && entry.data.customCommands.length >= 20) {
        return send(422, { error: "Maksimal 20 custom command per server" });
      }
      const now = Date.now();
      const existing = entry.data.customCommands.find((c) => c.name === name);
      const normalizedEmbed = {
        title: String(embed.title || ""),
        description: String(embed.description || ""),
        color: Number.isInteger(embed.color) ? embed.color : 0x5865f2,
        authorName: String(embed.authorName || ""),
        authorIconURL: String(embed.authorIconURL || ""),
        thumbnail: String(embed.thumbnail || ""),
        image: String(embed.image || ""),
        footerText: String(embed.footerText || ""),
        footerIconURL: String(embed.footerIconURL || ""),
        timestamp: embed.timestamp === true,
        fields: (Array.isArray(embed.fields) ? embed.fields : []).filter((f) => String(f?.name || "").trim() || String(f?.value || "").trim()).map((f) => ({ name: String(f.name || ""), value: String(f.value || ""), inline: f.inline === true })),
      };
      let command;
      if (existing) {
        Object.assign(existing, { description, ephemeral: body?.ephemeral === true, content, embed: normalizedEmbed, updatedAt: now });
        command = existing;
      } else {
        command = {
          name,
          description,
          ephemeral: body?.ephemeral === true,
          content,
          embed: normalizedEmbed,
          createdBy: String(body?.actor?.id || "mock"),
          createdByTag: String(body?.actor?.tag || "Dashboard"),
          createdAt: now,
          updatedAt: now,
          useCount: 0,
        };
        entry.data.customCommands.push(command);
      }
      return send(existing ? 200 : 201, { ok: true, command, synced: true });
    }
    if (req.method === "DELETE" && rest.length === 2) {
      const name = decodeURIComponent(rest[1]);
      const before = entry.data.customCommands.length;
      entry.data.customCommands = entry.data.customCommands.filter((c) => c.name !== name);
      if (entry.data.customCommands.length === before) return send(404, { error: `Custom command \`/${name}\` tidak ditemukan` });
      // Nonaktif-tandai juga dibersihkan dari daftar disabled.
      entry.data.commands.disabled = entry.data.commands.disabled.filter((n) => n !== name);
      return send(200, { ok: true, synced: true });
    }
  }

  // v3.19.0: Giveaway dari web
  if (req.method === "POST" && rest[0] === "giveaway" && rest.length === 1) {
    const body = await readBody();
    const channelId = String(body?.channelId || "");
    const prize = String(body?.prize || "").trim();
    const winners = Number(body?.winners ?? 1);
    const durationMin = Number(body?.durationMin);
    if (!/^\d{5,25}$/.test(channelId)) return send(400, { error: "channelId tidak valid" });
    if (!prize || prize.length > 200) return send(400, { error: "Prize wajib diisi, maksimal 200 karakter" });
    if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 43200) return send(400, { error: "Durasi 1 menit sampai 30 hari (43200 menit)" });
    if (!Number.isInteger(winners) || winners < 1 || winners > 20) return send(400, { error: "Jumlah pemenang 1-20" });
    const gw = {
      id: `gw_${guildId}_${Date.now()}`,
      guildId,
      channelId,
      messageId: `mock_${Date.now()}`,
      prize,
      winnersCount: winners,
      endsAt: Date.now() + durationMin * 60000,
      ended: false,
      winnerIds: [],
      participantIds: [],
      hostId: String(body?.actor?.id || "dash"),
      hostTag: String(body?.actor?.tag || "Dashboard"),
      requiredRoleId: body?.requiredRoleId ? String(body.requiredRoleId) : null,
      createdAt: Date.now(),
    };
    entry.data.giveaways.unshift(gw);
    return send(201, { ok: true, giveaway: gw });
  }

  // v3.19.0: Poll dari web
  if (req.method === "POST" && rest[0] === "poll" && rest.length === 1) {
    const body = await readBody();
    const channelId = String(body?.channelId || "");
    const question = String(body?.question || "").trim();
    const rawOptions = Array.isArray(body?.options) ? body.options : [];
    if (!/^\d{5,25}$/.test(channelId)) return send(400, { error: "channelId tidak valid" });
    if (!question || question.length > 250) return send(400, { error: "Pertanyaan wajib diisi, maksimal 250 karakter" });
    if (rawOptions.length < 2 || rawOptions.length > 10) return send(400, { error: "Poll butuh 2-10 opsi" });
    const poll = {
      id: `poll_${guildId}_${Date.now()}`,
      guildId,
      channelId,
      messageId: `mock_${Date.now()}`,
      question,
      options: rawOptions.map((o, i) => ({ label: String(o.label || "").slice(0, 80), emoji: o.emoji ? String(o.emoji).slice(0, 64) : `${i + 1}\u20e3`, votes: [] })),
      multiple: !!body?.multiple,
      closed: false,
      createdAt: Date.now(),
      closedAt: null,
      creatorId: String(body?.actor?.id || "dash"),
      creatorTag: String(body?.actor?.tag || "Dashboard"),
    };
    entry.data.polls.unshift(poll);
    return send(201, { ok: true, poll });
  }

  // v3.19.0: Embed dari web — v3.20.0: bentuk lengkap (content + embed objek)
  if (req.method === "POST" && rest[0] === "embed" && rest.length === 1) {
    const body = await readBody();
    const channelId = String(body?.channelId || "");
    if (!/^\d{5,25}$/.test(channelId)) return send(400, { error: "channelId tidak valid" });
    const content = String(body?.content || "").trim();
    const embed = body?.embed && typeof body.embed === "object" ? body.embed : { title: body?.title, description: body?.description };
    const hasEmbed = [embed.title, embed.description, embed.authorName, embed.footerText, embed.image, embed.thumbnail].some((v) => String(v || "").trim()) || (Array.isArray(embed.fields) && embed.fields.some((f) => String(f?.name || "").trim() || String(f?.value || "").trim()));
    if (!content && !hasEmbed) return send(400, { error: "Minimal title, description, atau content harus diisi" });
    return send(201, { ok: true, messageId: `mock_${Date.now()}`, url: "https://discord.com/channels/mock/mock" });
  }

  // v3.19.0: Backup dari web
  if (rest[0] === "backups") {
    if (req.method === "POST" && rest.length === 1) {
      await readBody();
      const name = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace(/[T:]/g, (c) => (c === "T" ? "_" : "-"));
      entry.data.backups.unshift({ name, size: 24000 + Math.floor(Math.random() * 4000), fileCount: 12, mtime: Date.now() });
      return send(201, { ok: true, backupName: name, filesCopied: 12 });
    }
    if (req.method === "POST" && rest.length === 3 && rest[2] === "restore") {
      await readBody();
      const name = rest[1];
      if (!entry.data.backups.some((b) => b.name === name)) return send(422, { error: `Restore gagal: backup '${name}' tidak ditemukan` });
      return send(200, { ok: true, filesRestored: 12, note: "Data bot sudah di-restore dari backup (mock)." });
    }
  }

  // v3.19.0: Keys dari web
  if (rest[0] === "keys") {
    if (req.method === "POST" && rest.length === 1) {
      const body = await readBody();
      const userId = String(body?.userId || "");
      const value = String(body?.value || "");
      if (!/^\d{5,25}$/.test(userId)) return send(400, { error: "userId (ID Discord) tidak valid" });
      const product = entry.data.config.products.find((p) => p.value === value);
      if (!product) return send(404, { error: `Produk value "${value}" tidak ditemukan` });
      if (!product.roleId) return send(422, { error: `Produk ${product.label} belum punya role — atur dulu di modul Tiket & Produk` });
      const keyValue =
        (typeof body?.key === "string" ? body.key.trim() : "") ||
        Array.from({ length: 3 }, () => Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("")).join("-");
      const days = product.days || 0;
      const keyEntry = {
        id: `key_${guildId}_${Date.now()}`,
        key: keyValue,
        userId,
        username: `User#${userId.slice(-4)}`,
        roleId: product.roleId,
        productName: product.label,
        days,
        expireAt: days > 0 ? Date.now() + days * 86400000 : null,
        createdAt: Date.now(),
        guildId,
      };
      entry.data.keys.unshift(keyEntry);
      return send(201, { ok: true, key: keyEntry.key, expireAt: keyEntry.expireAt, warnings: [] });
    }
    if (req.method === "DELETE" && rest.length === 1) {
      const userId = url.searchParams.get("userId");
      if (!userId || !/^\d{5,25}$/.test(userId)) return send(400, { error: "Parameter userId (ID Discord) wajib" });
      const before = entry.data.keys.length;
      entry.data.keys = entry.data.keys.filter((k) => k.userId !== userId);
      const removedKeys = before - entry.data.keys.length;
      if (removedKeys === 0) return send(404, { error: "Tidak ada key / schedule untuk user ini di server itu" });
      return send(200, { ok: true, removedKeys, removedSchedules: removedKeys, warnings: [] });
    }
  }

  if (rest[0] === "responders") {
    if (req.method === "POST" && rest.length === 1) {
      const body = await readBody();
      if (entry.data.responders.some((r) => r.trigger.toLowerCase() === String(body.trigger).toLowerCase())) {
        return send(409, { error: `Trigger "${body.trigger}" sudah ada.` });
      }
      entry.data.responders.push({
        id: `resp_${Date.now()}`,
        trigger: String(body.trigger),
        matchMode: body.matchMode ?? "contains",
        reply: String(body.reply),
        replyType: body.replyType ?? "text",
        cooldownMs: body.cooldownMs ?? 3000,
        useCount: 0,
      });
      return send(201, { ok: true, responders: entry.data.responders });
    }
    if (req.method === "DELETE" && rest.length === 1) {
      const trigger = url.searchParams.get("trigger");
      const before = entry.data.responders.length;
      entry.data.responders = entry.data.responders.filter((r) => r.trigger.toLowerCase() !== trigger?.toLowerCase());
      if (entry.data.responders.length === before) return send(404, { error: "Trigger tidak ditemukan." });
      return send(200, { ok: true, responders: entry.data.responders });
    }
  }

  if (rest[0] === "announce") {
    if (req.method === "POST" && rest.length === 1) {
      const body = await readBody();
      const ann = {
        id: `sa_${Date.now()}`,
        guildId,
        channelId: body.channelId,
        sendAt: typeof body.sendAt === "string" ? Date.parse(body.sendAt) : Number(body.sendAt),
        sent: false,
        sentAt: null,
        recurring: body.recurring ?? null,
        data: { title: body.title, description: body.description, color: body.color ?? 5793266, mention: body.mention ?? null },
      };
      entry.data.announces.push(ann);
      return send(201, { ok: true, announcement: ann });
    }
    if (req.method === "DELETE" && rest.length === 2) {
      const before = entry.data.announces.length;
      entry.data.announces = entry.data.announces.filter((a) => a.id !== rest[1]);
      if (entry.data.announces.length === before) return send(404, { error: "Announcement tidak ditemukan" });
      return send(200, { ok: true });
    }
  }

  if (rest[0] === "selfroles") {
    if (req.method === "POST" && rest.length === 1) {
      const body = await readBody();
      const panel = {
        id: `srp_${Date.now()}`,
        guildId,
        channelId: body.channelId,
        messageId: `mock_${Date.now()}`,
        title: body.title ?? "🎭 Self Role",
        description: body.description ?? "Klik untuk ambil / lepas role.",
        type: body.type ?? "button",
        exclusive: !!body.exclusive,
        roles: (body.roles ?? []).map((r) => ({ roleId: r.roleId, label: r.label, emoji: r.emoji, description: r.description, style: r.style ?? "Secondary" })),
      };
      entry.data.selfroles.push(panel);
      return send(201, { ok: true, panel });
    }
    if (req.method === "DELETE" && rest.length === 2) {
      entry.data.selfroles = entry.data.selfroles.filter((p) => p.id !== rest[1]);
      return send(200, { ok: true });
    }
    if (req.method === "POST" && rest.length === 3 && rest[2] === "roles") {
      const body = await readBody();
      const panel = entry.data.selfroles.find((p) => p.id === rest[1]);
      if (!panel) return send(404, { error: "Panel tidak ditemukan" });
      panel.roles.push({ roleId: body.roleId, label: body.label, emoji: body.emoji, description: body.description, style: body.style ?? "Secondary" });
      return send(200, { ok: true, panel });
    }
    if (req.method === "DELETE" && rest.length === 3 && rest[2] === "roles") {
      const roleId = url.searchParams.get("roleId");
      const panel = entry.data.selfroles.find((p) => p.id === rest[1]);
      if (!panel) return send(404, { error: "Panel tidak ditemukan" });
      panel.roles = panel.roles.filter((r) => r.roleId !== roleId);
      return send(200, { ok: true, panel });
    }
  }

  if (req.method === "POST" && rest[0] === "serverstats" && rest[1] === "refresh") {
    return send(200, { ok: true, result: { updated: 5, deferred: 0, missing: 0, errors: 0 } });
  }
  if (req.method === "DELETE" && rest[0] === "tempvoice") {
    if (!entry.data.tempvoice) return send(404, { error: "Setup temp voice tidak ditemukan" });
    entry.data.tempvoice = null;
    return send(200, { ok: true, note: "(demo) config dilepas." });
  }

  // v3.21.0: Panduan Cepat — pasang panel tiket + verifikasi (demo in-memory).
  // Validasi prasyarat sama dengan bot asli supaya alur checklist terasa nyata.
  if (req.method === "POST" && rest[0] === "panels" && rest.length === 1) {
    const body = await readBody();
    if (!entry.data.config.roles?.admin) return send(422, { error: "Role Admin Bot belum di-set — isi dulu langkah 1 Panduan Cepat (Role Admin)." });
    const allCats = entry.data.config.ticketCategories ?? [];
    if (allCats.length === 0) return send(422, { error: "Belum ada kategori tiket — tambahkan dulu di langkah 3 Panduan Cepat / modul Tiket & Produk." });
    const channelId = String(body?.channelId || "");
    if (!/^\d{5,25}$/.test(channelId)) return send(400, { error: "channelId tidak valid" });
    const ch = entry.meta.channels.find((c) => c.id === channelId && (c.type === 0 || c.type === 5));
    if (!ch) return send(400, { error: "Channel harus berupa text channel" });
    // Filter kategori opsional — paritas bot asli (categoryIds tak cocok → 400).
    const requested = Array.isArray(body?.categoryIds) ? body.categoryIds.map(String) : null;
    const cats = requested ? allCats.filter((c) => requested.includes(c.id)) : allCats;
    if (cats.length === 0) return send(400, { error: "Tidak ada kategori yang cocok dengan categoryIds yang diminta" });
    const panel = {
      id: `tp_demo_${Date.now().toString(36)}`,
      channelId,
      messageId: `msg_${Date.now()}`,
      title: body?.title ? String(body.title).slice(0, 256) : null,
      categoryIds: cats.map((c) => c.id),
      useDropdown: body?.useDropdown === true,
      createdAt: Date.now(),
    };
    entry.data.panels.push(panel);
    return send(201, { ok: true, panel, url: `https://discord.com/channels/${guildId}/${channelId}/demo` });
  }
  if (req.method === "POST" && rest[0] === "verify-panel" && rest.length === 1) {
    const body = await readBody();
    if (!entry.data.config.roles?.verified) return send(422, { error: "Role Terverifikasi belum di-set — isi dulu langkah 2 Panduan Cepat (Role Verified)." });
    const channelId = String(body?.channelId || "");
    if (!/^\d{5,25}$/.test(channelId)) return send(400, { error: "channelId tidak valid" });
    const ch = entry.meta.channels.find((c) => c.id === channelId && (c.type === 0 || c.type === 5));
    if (!ch) return send(400, { error: "Channel harus berupa text channel" });
    return send(201, { ok: true, messageId: `msg_${Date.now()}`, url: `https://discord.com/channels/${guildId}/${channelId}/demo` });
  }

  return send(404, { error: "Endpoint tidak ditemukan" });
});

server.listen(PORT, HOST, () => {
  console.log(`🧪 Mock DASH API siap: http://${HOST}:${PORT} (token-secured, data demo in-memory)`);
  console.log("   Dipakai web dashboard saat bot asli belum dideploy. Produksi: matikan mock ini.");
});
