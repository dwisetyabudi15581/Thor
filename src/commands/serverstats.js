/**
 * Domain: serverstats
 * Slash command: /serverstats setup, /serverstats remove, /serverstats refresh
 *
 * v3.9.51 (permintaan user: "fitur stats server secara live yang mirip
 * seperti bot server stats"): membuat kategori "📊 STATISTIK SERVER" berisi
 * channel counter auto-update. NAMA channel-nya adalah angka live —
 * ter-update otomatis saat ada perubahan member/boost/role/channel (lihat
 * src/data/serverstatsManager.js untuk strategi rate-limit: change
 * detection + cooldown 5 menit per channel + refresh dirty-driven).
 *
 * v3.9.53 (permintaan user: "fitur /serverstats kasih opsi apa saja yang
 * mau di munculin"): setup kini punya 5 opsi boolean —
 * members/bots/boosts/roles/channels. Semuanya default TRUE; set ke False
 * untuk melewati counter itu. Minimal satu counter harus tetap aktif
 * (semua-False ditolak dengan pesan ramah). Hanya counter terpilih yang
 * dibuat, disimpan, dan di-refresh — /serverstats refresh menampilkan
 * persis counter yang ter-config.
 *
 * setup   — membuat kategori + counter terpilih (rollback saat gagal di
 *           tengah, anti-orphan, pola yang sama dengan /setup-tempvoice)
 * remove  — menghapus semua channel counter + kategori + config
 * refresh — memaksa update langsung (admin, melewati cooldown SEKALI —
 *           aman karena jarang)
 *
 * Catatan permission:
 *   - Level router: khusus admin (defaultMemberPermissions: ManageGuild).
 *   - Sisi bot: butuh Manage Channels + Manage Roles — membuat channel
 *     DENGAN permission overwrite (deny Connect @everyone) butuh keduanya.
 *     Dicek di depan dengan hint solusi spesifik, bukan gagal di tengah jalan.
 *   - @everyone di-deny Connect di setiap channel counter supaya
 *     display-only — member lihat angkanya, tidak bisa join channelnya.
 */

const {
    MessageFlags,
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder,
    serverstatsManager,
    logAudit,
    safeEditReply
} = require('./_shared');

const { COUNTER_DEFS, buildCounterName, computeCounterValue } = serverstatsManager;

const CATEGORY_NAME = '📊 STATISTIK SERVER';

module.exports = async function (interaction) {
    const sub = interaction.options.getSubcommand();

    // ====================================================
    // === /serverstats setup ===
    // ====================================================
    if (sub === 'setup') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const guild = interaction.guild;

        // v3.9.53: counter mana yang mau dibuat? Setiap opsi default true —
        // False melewati counter itu. Semua-False ditolak (kategori counter
        // tanpa counter tidak masuk akal).
        const selectedDefs = COUNTER_DEFS.filter(def => interaction.options.getBoolean(def.type) !== false);
        if (selectedDefs.length === 0) {
            return safeEditReply(interaction, {
                content:
                    '⚠️ Kamu mematikan SEMUA counter (member, bot, boost, role DAN channel).\n\n' +
                    'Pilih minimal satu — biarkan opsi yang kamu mau **aktif** (default True), set yang TIDAK kamu mau ke **False** saja.'
            });
        }

        // Cek permission bot — SEBELUM membuat apa pun (anti-orphan).
        const me = guild.members?.me;
        const myPerms = me?.permissions || interaction.appPermissions;
        if (!myPerms?.has(PermissionFlagsBits.ManageChannels) || !myPerms?.has(PermissionFlagsBits.ManageRoles)) {
            return safeEditReply(interaction, {
                content:
                    '❌ Aku butuh permission **Manage Channels** + **Manage Roles** untuk membuat channel counter (Manage Roles wajib untuk overwrite @everyone).\n\n' +
                    'Solusi: Server Settings → Roles → **role bot** → aktifkan keduanya, lalu jalankan `/serverstats setup` lagi.'
            });
        }

        // Sudah di-setup? Tidak otomatis dipakai ulang — admin harus
        // remove dulu secara eksplisit (kalau tidak, kita bikin set kedua).
        if (serverstatsManager.isEnabled()) {
            const cfg = serverstatsManager.getConfig();
            const existing = Object.values(cfg.counters || {})
                .map(id => guild.channels.cache.get(id))
                .filter(Boolean);
            if (existing.length > 0) {
                return safeEditReply(interaction, {
                    content:
                        '⚠️ Counter server stats sudah di-setup.\n\n' +
                        `• Untuk update angkanya sekarang: \`/serverstats refresh\`\n` +
                        `• Untuk hapus dan mulai ulang: \`/serverstats remove\` dulu`
                });
            }
            // Enabled tapi SEMUA channel hilang (dihapus admin) → config
            // mati: hapus dan lanjut ke setup baru.
            serverstatsManager.clearConfig();
        }

        // === Buat kategori + channel counter TERPILIH ===
        // Pola anti-orphan v3.9.8 (sama dengan /setup-tempvoice): kalau ada
        // langkah yang gagal, semua yang sudah dibuat di-rollback — tanpa
        // channel zombie.
        //
        // Semua nilai live dihitung DI DEPAN (sebelum membuat apa pun):
        // membuat counter itu sendiri menambah ukuran guild.channels.cache,
        // jadi menghitung "Channel" di tengah loop akan menghitung counter
        // yang setengah dibuat (angka self-referential yang loncat lagi
        // di refresh berikutnya).
        const liveValues = {};
        for (const def of selectedDefs) {
            liveValues[def.type] = computeCounterValue(guild, def.type);
        }

        const everyoneId = guild.roles.everyone.id;
        const created = [];
        let category = null;
        try {
            category = await guild.channels.create({
                name: CATEGORY_NAME,
                type: ChannelType.GuildCategory,
                // Paling atas daftar channel — counter adalah hal pertama
                // yang dilihat member (penempatan yang sama dengan bot
                // ServerStats populer).
                position: 0,
                permissionOverwrites: [
                    { id: everyoneId, deny: [PermissionFlagsBits.Connect] }
                ],
                reason: 'Counter server stats (counter live di nama channel)'
            });
            created.push(category);

            const counters = {};
            for (const def of selectedDefs) {
                const ch = await guild.channels.create({
                    name: buildCounterName(def.type, liveValues[def.type]),
                    type: ChannelType.GuildVoice,
                    parent: category.id,
                    permissionOverwrites: [
                        { id: everyoneId, deny: [PermissionFlagsBits.Connect] }
                    ],
                    reason: `Counter server stats: ${def.label}`
                });
                counters[def.type] = ch.id;
                created.push(ch);
            }

            serverstatsManager.saveConfig({
                guildId: guild.id,
                categoryId: category.id,
                counters,
                enabled: true,
                updatedAt: Date.now()
            });

            await logAudit(interaction.client, {
                action: 'SETUP_SERVER_STATS',
                actorId: interaction.user.id,
                actorTag: interaction.user.tag,
                details: `Setup counter server stats — kategori: ${CATEGORY_NAME}, ${selectedDefs.length} channel counter: ${selectedDefs.map(d => d.type).join('/')}`,
                guildId: guild.id
            });

            const skipped = COUNTER_DEFS.filter(d => !selectedDefs.includes(d));
            const embed = new EmbedBuilder()
                .setTitle('📊 Server Stats — counter live berhasil dibuat!')
                .setDescription(
                    'Nama channel di bawah ini adalah **counter live** — ter-update otomatis saat member join/leave, boost, atau role/channel berubah.'
                )
                .setColor(0x5865f2)
                .addFields(
                    ...selectedDefs.map(def => ({
                        name: `${def.emoji} ${def.label}`,
                        value: `\`${buildCounterName(def.type, liveValues[def.type])}\``,
                        inline: true
                    })),
                    {
                        name: '🧩 Tidak dibuat',
                        value: skipped.length > 0 ? skipped.map(d => `${d.emoji} ${d.label}`).join(' · ') : '— semua counter aktif —',
                        inline: false
                    }
                )
                .setFooter({
                    text: 'Counter ter-refresh otomatis (aman rate-limit) • /serverstats refresh memaksa update sekarang • /serverstats remove + setup untuk mengubah pilihan'
                })
                .setTimestamp();
            return safeEditReply(interaction, { embeds: [embed] });
        } catch (err) {
            // Rollback — best effort, tidak boleh melempar error keluar handler.
            for (const ch of created.reverse()) {
                try {
                    await ch.delete('Setup server stats gagal — rollback');
                } catch (_) {}
            }
            console.error('Setup server stats gagal:', err);
            return safeEditReply(interaction, {
                content:
                    `❌ Setup gagal: ${err.message}\n\n` +
                    'Channel yang setengah dibuat sudah di-rollback. Cek permission **Manage Channels** + **Manage Roles** bot lalu coba lagi.'
            });
        }
    }

    // ====================================================
    // === /serverstats remove ===
    // ====================================================
    if (sub === 'remove') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const guild = interaction.guild;

        if (!serverstatsManager.isEnabled()) {
            return safeEditReply(interaction, {
                content: '⚠️ Counter server stats belum di-setup. Jalankan `/serverstats setup` dulu.'
            });
        }

        const cfg = serverstatsManager.getConfig();
        let deleted = 0;
        let failed = 0;

        // Penghapusan best-effort setiap channel counter + kategorinya.
        for (const id of Object.values(cfg.counters || {})) {
            const ch = guild.channels.cache.get(id);
            if (!ch) continue; // sudah hilang — clearConfig tetap jalan di bawah
            try {
                await ch.delete('Penghapusan server stats');
                deleted++;
            } catch (err) {
                failed++;
                console.warn(`⚠️ Server stats remove: gagal menghapus channel ${id}: ${err.message}`);
            }
        }
        const category = cfg.categoryId ? guild.channels.cache.get(cfg.categoryId) : null;
        if (category) {
            try {
                await category.delete('Penghapusan server stats');
                deleted++;
            } catch (err) {
                failed++;
                console.warn(`⚠️ Server stats remove: gagal menghapus kategori: ${err.message}`);
            }
        }

        serverstatsManager.clearConfig();

        await logAudit(interaction.client, {
            action: 'REMOVE_SERVER_STATS',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Counter server stats dihapus — ${deleted} channel dihapus${failed > 0 ? `, ${failed} gagal (hapus manual)` : ''}`,
            guildId: guild.id
        });

        const content =
            failed > 0
                ? `✅ Counter server stats dihapus (${deleted} dihapus, ${failed} tidak bisa dihapus — tolong hapus channel tersebut manual).\n\nConfig sudah dibersihkan — jalankan \`/serverstats setup\` kapan saja untuk membuatnya lagi.`
                : '✅ Counter server stats dihapus.\n\nConfig sudah dibersihkan — jalankan `/serverstats setup` kapan saja untuk membuatnya lagi.';
        return safeEditReply(interaction, { content });
    }

    // ====================================================
    // === /serverstats refresh ===
    // ====================================================
    if (sub === 'refresh') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const guild = interaction.guild;

        if (!serverstatsManager.isEnabled()) {
            return safeEditReply(interaction, {
                content: '⚠️ Counter server stats belum di-setup. Jalankan `/serverstats setup` dulu.'
            });
        }

        // force: lewati cooldown SEKALI (panggilan admin, jarang — aman dalam
        // limit Discord 2-rename-per-10-menit).
        const result = await serverstatsManager.refreshServerStats(guild, { force: true });

        // v3.9.53: tampilkan persis counter yang TER-CONFIG (setup mungkin
        // melewatkan beberapa) — bentuk yang sama dengan konfirmasi setup.
        const cfg = serverstatsManager.getConfig() || {};
        const activeDefs = COUNTER_DEFS.filter(def => (cfg.counters || {})[def.type]);
        const lines = activeDefs.map(def => {
            const value = computeCounterValue(guild, def.type);
            return `${def.emoji} ${def.label}: **${value}**`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setTitle('📊 Server Stats — counter di-refresh')
            .setDescription(
                `${lines}\n\n` +
                `📤 Di-update: **${result.updated}** • ⏳ Tertunda cooldown: **${result.deferred}** • ⚠️ Channel hilang: **${result.missing}** • ❌ Error: **${result.errors}**`
            )
            .setColor(0x57f287)
            .setFooter({
                text: 'Counter yang tidak berubah = nol panggilan API • counter juga ter-update otomatis saat ada perubahan member/boost/role/channel'
            })
            .setTimestamp();
        return safeEditReply(interaction, { embeds: [embed] });
    }
};
