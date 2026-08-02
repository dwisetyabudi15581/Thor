/**
 * Domain: panels
 * Slash commands: /set-verify-button, /setup-ticket-panel, /set-transcript-channel
 *
 * v3.9.11 Phase 1: verify button customization
 * v3.9.11 Phase 3: multi-panel ticket + transcript channel
 */

const {
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ChannelType,
    MessageFlags,
    getConfig,
    saveConfig,
    setField,
    logAudit,
    safeEditReply
} = require('./_shared');

const VALID_STYLES = ['Primary', 'Secondary', 'Success', 'Danger'];
const STYLE_MAP = {
    Primary: ButtonStyle.Primary,
    Secondary: ButtonStyle.Secondary,
    Success: ButtonStyle.Success,
    Danger: ButtonStyle.Danger
};

module.exports = async function (interaction) {
    const config = getConfig();

    // === SET VERIFY BUTTON ===
    if (interaction.commandName === 'set-verify-button') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const label = interaction.options.getString('label');
        const emoji = interaction.options.getString('emoji');
        const style = interaction.options.getString('style');

        // Validate style
        if (style && !VALID_STYLES.includes(style)) {
            return safeEditReply(interaction, { content: '❌ `style` tidak valid. Pilih: Primary, Secondary, Success, Danger.' });
        }

        // Build new verifyButton config
        const newVerifyBtn = {
            ...(config.verifyButton || {}),
            label: label.slice(0, 80)
        };
        if (emoji) newVerifyBtn.emoji = emoji;
        if (style) newVerifyBtn.style = style;

        config.verifyButton = newVerifyBtn;
        saveConfig(config);

        await logAudit(interaction.client, {
            action: 'SET_VERIFY_BUTTON',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Update verify button — label: "${newVerifyBtn.label}", emoji: ${newVerifyBtn.emoji}, style: ${newVerifyBtn.style}`,
            guildId: interaction.guild.id
        });

        // Preview button
        const previewBtn = new ButtonBuilder()
            .setCustomId('btn_verify_preview')
            .setLabel(newVerifyBtn.label)
            .setEmoji(newVerifyBtn.emoji || '✅')
            .setStyle(STYLE_MAP[newVerifyBtn.style] || ButtonStyle.Success)
            .setDisabled(true);
        const previewRow = new ActionRowBuilder().addComponents(previewBtn);

        return safeEditReply(interaction, {
            content: '✅ Verify button di-update!\n\n**Preview:**',
            components: [previewRow]
        });
    }

    // === SETUP TICKET PANEL (multi-panel) ===
    if (interaction.commandName === 'setup-ticket-panel') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const customTitle = interaction.options.getString('title');
        const categoriesFilter = interaction.options.getString('categories'); // comma-separated IDs

        const allCategories = config.ticketCategories || [];
        if (allCategories.length === 0) {
            return safeEditReply(interaction, {
                content: '❌ Belum ada kategori. Tambah dulu pakai `/add-category`, atau pakai `/setup-ticket` untuk default.'
            });
        }

        // Filter categories by IDs (kalau di-specify), else pakai semua
        let categoriesToShow = allCategories;
        if (categoriesFilter) {
            const requestedIds = categoriesFilter.split(',').map(s => s.trim()).filter(Boolean);
            categoriesToShow = allCategories.filter(c => requestedIds.includes(c.id));
            if (categoriesToShow.length === 0) {
                return safeEditReply(interaction, {
                    content: `❌ Tidak ada kategori yang match dengan: \`${categoriesFilter}\`. Pakai /list-categories untuk lihat daftar.`
                });
            }
        }

        // Build price list (filtered by category kalau di-specify)
        const categoryIds = new Set(categoriesToShow.map(c => c.id));
        const productsInCategories = (config.products || []).filter(p => {
            const pCat = p.category || 'mlbb_key';
            return categoryIds.has(pCat);
        });

        // v3.9.12: pakai fillTemplate dengan variabel ticket-specific.
        const { fillTemplate } = require('../data/configManager');

        const priceListByCategory = {};
        for (const cat of categoriesToShow) {
            const prods = productsInCategories.filter(p => (p.category || 'mlbb_key') === cat.id);
            priceListByCategory[cat.id] = prods.length > 0
                ? prods.map(p => `• **${p.label}** — ${p.price}`).join('\n')
                : `_(belum ada produk di kategori ini)_`;
        }

        const priceList = productsInCategories.length > 0
            ? productsInCategories.map(p => `• **${p.label}** — ${p.price}`).join('\n')
            : '_(belum ada produk di kategori ini)_';

        const title = customTitle || config.messages.ticketTitle;
        const priceHeader = config.messages?.ticketPriceHeader || '💰 PRICE LIST 💰';
        const categoriesListStr = categoriesToShow.map(c => `${c.emoji} **${c.label}**`).join(' • ');

        const renderedBody = fillTemplate(config.messages.ticketBody, {
            server: interaction.guild.name,
            priceList,
            priceHeader,
            categoriesList: categoriesListStr,
            priceListByCategory
        });

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(renderedBody)
            .setColor(0xE67E22)
            .setFooter({ text: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        // Build rows from filtered categories
        const rows = [];
        let currentRow = new ActionRowBuilder();
        let btnCount = 0;

        for (const cat of categoriesToShow.slice(0, 25)) {
            if (btnCount === 5) {
                rows.push(currentRow);
                currentRow = new ActionRowBuilder();
                btnCount = 0;
            }
            const btnStyle = STYLE_MAP[cat.style] || ButtonStyle.Primary;
            const btn = new ButtonBuilder()
                .setCustomId(`ticket_cat:${cat.id}`)
                .setLabel((cat.label || cat.id).slice(0, 80))
                .setEmoji(cat.emoji || '🎫')
                .setStyle(btnStyle);
            currentRow.addComponents(btn);
            btnCount++;
        }
        if (btnCount > 0) rows.push(currentRow);

        // Kirim panel ke channel. Wrap try/catch biar error jelas.
        try {
            await interaction.channel.send({ embeds: [embed], components: rows });
        } catch (sendErr) {
            return safeEditReply(interaction, {
                content: `❌ Gagal kirim panel tiket multi-panel: ${sendErr.message}\n\nPastikan bot punya permission **Send Messages** dan **Embed Links** di channel ini.`
            });
        }
        return safeEditReply(interaction, {
            content: `✅ Panel tiket dipasang! (${categoriesToShow.length} kategori ditampilkan)\n\n` +
                `Kategori: ${categoriesToShow.map(c => `\`${c.id}\``).join(', ')}`
        });
    }

    // === SET TRANSCRIPT CHANNEL ===
    if (interaction.commandName === 'set-transcript-channel') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const channel = interaction.options.getChannel('channel');

        // Validate channel type
        if (!channel || channel.type !== ChannelType.GuildText) {
            return safeEditReply(interaction, { content: '❌ Channel harus berupa text channel.' });
        }

        // v3.9.11 Phase 3: simpan ke config.channels.transcript
        config.channels.transcript = channel.id;
        saveConfig(config);

        await logAudit(interaction.client, {
            action: 'SET_CHANNEL',
            actorId: interaction.user.id,
            actorTag: interaction.user.tag,
            details: `Channel transcript diatur ke ${channel} (\`${channel.id}\`)`,
            guildId: interaction.guild.id
        });

        return safeEditReply(interaction, {
            content: `✅ Channel transcript diatur ke ${channel}.\n\n` +
                `💡 Setiap tiket yang di-close akan auto-save chat history ke channel ini sebagai bukti transaksi.`
        });
    }
};
