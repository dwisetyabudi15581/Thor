/**
 * Domain: commands
 * Slash command: /commands (subcommands: list, toggle, enable-all)
 *
 * v3.19.0 — Command Manager ala Dyno:
 *   Admin bisa menonaktifkan / mengaktifkan command bot per-server lewat
 *   Discord (command ini) ATAU lewat web dashboard (modul Command Manager).
 *   Kedua interface menulis ke field config yang sama: `disabledCommands`
 *   (array nama command), dan router (src/commands/index.js) menolak
 *   command yang dinonaktifkan dengan pesan ephemeral.
 *
 * Desain keamanan:
 *   - `/commands` sendiri TIDAK BISA dinonaktifkan (guard di sini + di
 *     validator DASH API) — mencegah admin mengunci dirinya dari sisi
 *     Discord. Web dashboard juga selalu bisa mengembalikan semuanya.
 *   - Hanya admin bot (permission check router) yang boleh memakai
 *     command ini; defaultMemberPermissions ManageGuild di registry.
 */

const { EmbedBuilder, MessageFlags } = require('discord.js');
const { getCommands } = require('./registry');
const { getConfig, saveConfig } = require('../data/configManager');
const { logAudit, safeEditReply } = require('./_shared');
// v3.20.0: custom command ikut dikelola Command Manager (toggle/list).
const customCommandManager = require('../data/customCommandManager');

// Command yang kebal disable — pintu manajemen tidak boleh dikunci.
const PROTECTED_COMMANDS = ['commands'];

/**
 * Normalisasi + validasi daftar disabled. Dipakai handler ini DAN
 * dashServer.js (via re-export di bawah) supaya aturannya identik di
 * Discord maupun web — single source of truth.
 *
 * v3.20.0: parameter kedua `extraNames` — daftar nama custom command guild
 * terkait (dari customCommandManager). Custom command ikut bisa
 * dinonaktifkan lewat /commands toggle DAN Command Manager web.
 *
 * @returns {{ ok: true, value: string[] } | { ok: false, error: string }}
 */
function normalizeDisabledList(list, extraNames = []) {
    if (!Array.isArray(list)) return { ok: false, error: 'Daftar command tidak valid (harus array)' };
    if (list.length > 100) return { ok: false, error: 'Maksimal 100 command dinonaktifkan' };
    const known = new Set([...getCommands().map((c) => c.name), ...extraNames]);
    const seen = new Set();
    for (const raw of list) {
        const name = String(raw);
        if (!known.has(name)) return { ok: false, error: `Command \`${name}\` tidak dikenal` };
        if (PROTECTED_COMMANDS.includes(name)) {
            return { ok: false, error: `Command \`/${name}\` tidak bisa dinonaktifkan — itu pintu manajemen command` };
        }
        seen.add(name);
    }
    return { ok: true, value: [...seen] };
}

/** Baca daftar disabled dari config guild (selalu array, tak pernah undefined). */
function getDisabledCommands(config) {
    return Array.isArray(config?.disabledCommands) ? config.disabledCommands : [];
}

module.exports = async function (interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const config = getConfig(guildId);

    // === /commands list ===
    if (sub === 'list') {
        const disabled = getDisabledCommands(config);
        const customCommands = customCommandManager.getGuildCommands(guildId);
        const total = getCommands().length + customCommands.length;
        const embed = new EmbedBuilder()
            .setTitle('🧩 Command Manager')
            .setColor(disabled.length > 0 ? 0xe67e22 : 0x2ecc71)
            .setDescription(
                (disabled.length === 0
                    ? `✅ Semua **${total} command aktif** di server ini.\n\nNonaktifkan lewat \`/commands toggle\` atau web dashboard.`
                    : `⚠️ **${disabled.length}/${total} command dinonaktifkan**:\n\n` +
                      disabled.map((c) => `• \`/${c}\``).join('\n') +
                      `\n\nAktifkan kembali lewat \`/commands toggle\` atau \`/commands enable-all\`.`) +
                (customCommands.length > 0
                    ? `\n\n🧪 **${customCommands.length} custom command** (dibuat lewat web): ${customCommands
                        .map((c) => `\`/${c.name}\``)
                        .join(' ')}`
                    : '')
            )
            .setFooter({ text: `Command dinonaktifkan ditolak otomatis oleh bot · /commands` })
            .setTimestamp();
        return safeEditReply(interaction, { embeds: [embed] });
    }

    // === /commands toggle ===
    if (sub === 'toggle') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const name = (interaction.options.getString('command') || '').trim().toLowerCase();
        const enabled = interaction.options.getBoolean('enabled');

        const known = new Set([
            ...getCommands().map((c) => c.name),
            ...customCommandManager.getGuildCommands(guildId).map((c) => c.name)
        ]);
        if (!known.has(name)) {
            return safeEditReply(interaction, {
                content: `❌ Command \`/${name || '(kosong)'}\` tidak dikenal. Cek ejaannya di \`/help\`.`
            });
        }
        if (PROTECTED_COMMANDS.includes(name)) {
            return safeEditReply(interaction, {
                content: `❌ \`/${name}\` tidak bisa dinonaktifkan — itu pintu manajemen command (ala tidak bisa ganti kunci dari dalam brankas).`
            });
        }

        const disabled = getDisabledCommands(config);
        const next = enabled ? disabled.filter((c) => c !== name) : [...new Set([...disabled, name])];
        const normalized = normalizeDisabledList(
            next,
            customCommandManager.getGuildCommands(guildId).map((c) => c.name)
        );
        if (!normalized.ok) {
            return safeEditReply(interaction, { content: `❌ ${normalized.error}` });
        }

        config.disabledCommands = normalized.value;
        saveConfig(guildId, config);

        await logAudit(interaction.client, {
            guildId,
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            action: 'command_toggle',
            details: `\`/${name}\` ${enabled ? 'di**aktifkan**' : 'di**nonaktifkan**'} via /commands`
        });

        return safeEditReply(interaction, {
            content: `${enabled ? '✅' : '⛔'} Command \`/${name}\` ${enabled ? 'diaktifkan' : 'dinonaktifkan'} di server ini.${enabled ? '' : ' Member yang mencobanya akan melihat pesan bahwa command dinonaktifkan admin.'}`
        });
    }

    // === /commands enable-all ===
    if (sub === 'enable-all') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const before = getDisabledCommands(config).length;
        if (before === 0) {
            return safeEditReply(interaction, { content: 'ℹ️ Semua command memang sudah aktif — tidak ada yang perlu diubah.' });
        }
        config.disabledCommands = [];
        saveConfig(guildId, config);

        await logAudit(interaction.client, {
            guildId,
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            action: 'command_enable_all',
            details: `Semua command (${before} yang tadinya nonaktif) diaktifkan via /commands`
        });

        return safeEditReply(interaction, {
            content: `✅ Semua command diaktifkan kembali (${before} command tadinya nonaktif).`
        });
    }

    return safeEditReply(interaction, { content: '❌ Subcommand tidak dikenal. Pakai `/commands list`, `toggle`, atau `enable-all`.' });
};

// Ekspor untuk dashServer + unit test — aturan yang SAMA di kedua interface.
module.exports.PROTECTED_COMMANDS = PROTECTED_COMMANDS;
module.exports.normalizeDisabledList = normalizeDisabledList;
module.exports.getDisabledCommands = getDisabledCommands;
