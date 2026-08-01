const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

/**
 * Helper untuk render panel self-role:
 * - Embed (title, description, footer = panel ID + mode)
 * - Komponen: tombol (≤25) atau select menu (1, ≤25 option)
 *
 * Custom ID format:
 * - Button: sr_btn:<panelId>:<roleId>
 * - Select : sr_sel:<panelId>
 */

const MAX_BUTTONS_PER_ROW = 5;
const MAX_ROWS = 5; // batas Discord: 5 ActionRow per message
const MAX_BUTTONS = MAX_BUTTONS_PER_ROW * MAX_ROWS; // 25

function buildPanelEmbed(panel, client) {
    const modeText = panel.exclusive
        ? '🔒 **Mode eksklusif** — hanya boleh 1 role pada satu waktu.'
        : '✅ **Mode multi** — boleh ambil lebih dari 1 role.';

    const rolesText = panel.roles.length === 0
        ? '_Belum ada role. Admin bisa tambah via `/selfrole-add`._'
        : panel.roles.map(r => {
            const emojiStr = r.emoji ? `${r.emoji} ` : '';
            const descStr = r.description ? ` — ${r.description}` : '';
            return `• ${emojiStr}**${r.label}** <@&${r.roleId}>${descStr}`;
        }).join('\n');

    const embed = new EmbedBuilder()
        .setTitle(panel.title)
        .setDescription(`${panel.description}\n\n${modeText}\n\n**Role tersedia:**\n${rolesText}`)
        .setColor(0x9B59B6)
        .setFooter({
            text: `${client?.user?.username || 'Bot'} • Panel ID: ${panel.id} • ${panel.exclusive ? 'Eksklusif' : 'Multi'}`,
            iconURL: client?.user?.displayAvatarURL?.({ dynamic: true })
        })
        .setTimestamp();

    return embed;
}

/**
 * Bangun ActionRow[] untuk panel.
 * - Type "button": maksimal 25 button (5 row × 5 button). Kalau 0 role → return [] (panel embed aja).
 * - Type "select": 1 StringSelectMenu dengan maksimal 25 option.
 *
 * Untuk mode exclusive + select, set minValues=1, maxValues=1.
 * Untuk mode multi + select, set minValues=0, maxValues=roles.length.
 */
function buildPanelComponents(panel) {
    if (panel.roles.length === 0) return [];

    if (panel.type === 'select') {
        const select = new StringSelectMenuBuilder()
            .setCustomId(`sr_sel:${panel.id}`)
            .setPlaceholder('Pilih role...')
            .setMinValues(0)
            .setMaxValues(panel.exclusive ? 1 : Math.min(panel.roles.length, 25))
            .addOptions(panel.roles.map(r => ({
                label: r.label,
                value: r.roleId,
                ...(r.emoji ? { emoji: r.emoji } : {}),
                ...(r.description ? { description: r.description } : {})
            })));
        return [new ActionRowBuilder().addComponents(select)];
    }

    // Type button
    const rows = [];
    const total = Math.min(panel.roles.length, MAX_BUTTONS);
    for (let i = 0; i < total; i += MAX_BUTTONS_PER_ROW) {
        const row = new ActionRowBuilder();
        for (let j = i; j < Math.min(i + MAX_BUTTONS_PER_ROW, total); j++) {
            const r = panel.roles[j];
            const btn = new ButtonBuilder()
                .setCustomId(`sr_btn:${panel.id}:${r.roleId}`)
                .setLabel(r.label)
                .setStyle(ButtonStyle.Secondary);
            if (r.emoji) {
                try { btn.setEmoji(r.emoji); } catch (_) { /* emoji invalid, skip */ }
            }
            row.addComponents(btn);
        }
        rows.push(row);
    }
    return rows;
}

module.exports = { buildPanelEmbed, buildPanelComponents };
