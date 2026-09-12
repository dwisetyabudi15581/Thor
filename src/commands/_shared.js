/**
 * Shared helpers untuk semua domain command handlers.
 *
 * Setiap domain file (src/commands/<domain>.js) menerima `interaction` dari router
 * lalu pakai helper di sini untuk dapat config, embeds, safeEditReply, dll.
 *
 * Tujuan: hilangkan duplikasi require statements di setiap domain file.
 */

const {
    EmbedBuilder,
    MessageFlags,
    // v3.9.45 hotfix: moderation.js destructure PermissionFlagsBits dari sini,
    // tapi sebelumnya TIDAK diekspor → undefined saat runtime → /purge /timeout
    // /kick /ban crash "Cannot read properties of undefined (reading
    // 'ManageMessages')". Kini diekspor resmi (pola satu pintu _shared).
    PermissionFlagsBits,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

// === Data layer ===
const { getConfig, saveConfig, setField, DEFAULTS } = require('../data/configManager');
const {
    addKey,
    getActiveKeysByUserAndRole,
    findAllByUser,
    formatKeysForUser,
    removeAllKeysByUser,
    getStats: getKeyStats,
    getStatsByGuild: getKeyStatsByGuild,
    // v3.13.0: stok key + penukaran mandiri (premium SaaS)
    createStockKey,
    redeemKey,
    findKeyByString,
    listStockKeys,
    revokeStockKey,
    isRedeemRateLimited,
    noteRedeemFailure,
    noteRedeemSuccess
} = require('../data/keyManager');
const {
    scheduleRoleRemoval,
    removeActiveByUserAndRole,
    findAllByUser: findAllSchedulesByUser,
    removeAllByUser: removeAllSchedulesByUser,
    getRemainingDays,
    getAllActive: getAllScheduledActive,
    getActiveByGuild: getScheduledActiveByGuild
} = require('../data/roleScheduler');
const {
    createPanel,
    addRoleToPanel,
    removeRoleFromPanel,
    getPanel,
    getPanelsByGuild,
    deletePanel,
    setMessageId,
    deletePanel: deleteSelfRolePanel
} = require('../data/selfRoleManager');
const {
    create: createGiveaway,
    setMessageId: setGiveawayMessageId,
    getByGuild: getGiveawaysByGuild,
    get: getGiveaway,
    end: endGiveaway,
    reroll: rerollGiveaway,
    pickWinners,
    remove: removeGiveaway
} = require('../data/giveawayManager');
const {
    create: createScheduledAnn,
    getByGuild: getScheduledAnnsByGuild,
    get: getScheduledAnn,
    markSent: markScheduledAnnSent,
    remove: removeScheduledAnn,
    parseTime: parseAnnTime
} = require('../data/scheduledAnnouncements');
const {
    addWarn,
    getWarns,
    getWarnCount,
    removeWarn,
    clearWarns,
    markActionTaken,
    DEFAULT_THRESHOLDS: WARN_THRESHOLDS
} = require('../data/warnManager');
const {
    getStats: getUserStats,
    getTopUsers: getTopUsersStats,
    getServerStats: getServerStatsAll,
    parsePrice: parsePriceNum,
    recordPurchase: trackPurchase
} = require('../data/statsManager');
const {
    create: createPoll,
    setMessageId: setPollMessageId,
    get: getPoll,
    getByGuild: getPollsByGuild,
    close: closePoll,
    getTotalVotes: getPollTotalVotes,
    createPollSession
} = require('../data/pollManager');
const { createBackup, listBackups, restoreBackup, formatSize: formatBackupSize } = require('../data/backupManager');
// v3.9.9 refactor: sendInvoice dipakai /set-key untuk kirim invoice ke channel invoice.
const { sendInvoice } = require('../data/ticketManager');
// v3.9.43: riwayat tindakan moderasi (timeout/kick/ban/...) — dipakai
// domain moderation.js + ditampilkan di /warn-list (warn.js).
const { addModLog, getModLogs, getModLogCount, modLogTypeLabel } = require('../data/modLogManager');

// === UI builders ===
const { Embeds } = require('../ui/embedBuilder');
const { buildPanelEmbed, buildPanelComponents } = require('../ui/selfRolePanelBuilder');
const {
    createSession,
    buildEmbed,
    getSessionsByUser,
    deleteSession,
    deleteSessionByOwner,
    parseColor
} = require('../ui/embedBuilderSessions');
// v3.9.9 refactor: temp voice UI + data layer dipakai /setup-tempvoice & /tempvoice-remove.
const { buildGlobalControlPanel } = require('../ui/tempVoiceControlPanel');
const tempVoiceManager = require('../data/tempVoiceManager');
// v3.9.51: channel counter server stats live — dipakai /serverstats.
const serverstatsManager = require('../data/serverstatsManager');

// === Infra ===
const { isAdmin: checkIsAdmin, invalidateAdminRoleCache } = require('../infra/permissions');
// v3.10.0 multi-guild: resolveGuildId dipakai semua domain command untuk
// mengambil ID guild dari interaction sebelum baca/tulis config per-guild.
const { resolveGuildId } = require('../infra/guild');
const { logAudit } = require('../infra/auditLog');
const { safeEditReply } = require('../infra/safeReply');
const { DISCORD_LIMITS, EMBED_LIMITS } = require('../infra/constants');
// v3.9.9 refactor: withLock dipakai /giveaway reroll supaya double-click tidak double-announce.
const { withLock: withUserLock } = require('../infra/userLock');

module.exports = {
    // discord.js classes
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    // data layer
    getConfig,
    saveConfig,
    setField,
    DEFAULTS,
    addKey,
    getActiveKeysByUserAndRole,
    findAllByUser,
    formatKeysForUser,
    removeAllKeysByUser,
    getKeyStats,
    getKeyStatsByGuild,
    // v3.13.0: stok key + penukaran mandiri (premium SaaS)
    createStockKey,
    redeemKey,
    findKeyByString,
    listStockKeys,
    revokeStockKey,
    isRedeemRateLimited,
    noteRedeemFailure,
    noteRedeemSuccess,
    scheduleRoleRemoval,
    removeActiveByUserAndRole,
    findAllSchedulesByUser,
    removeAllSchedulesByUser,
    getRemainingDays,
    getAllScheduledActive,
    getScheduledActiveByGuild,
    createPanel,
    addRoleToPanel,
    removeRoleFromPanel,
    getPanel,
    getPanelsByGuild,
    deletePanel,
    deleteSelfRolePanel,
    setMessageId,
    createGiveaway,
    setGiveawayMessageId,
    getGiveawaysByGuild,
    getGiveaway,
    endGiveaway,
    rerollGiveaway,
    pickWinners,
    removeGiveaway,
    createScheduledAnn,
    getScheduledAnnsByGuild,
    getScheduledAnn,
    markScheduledAnnSent,
    removeScheduledAnn,
    parseAnnTime,
    addWarn,
    getWarns,
    getWarnCount,
    removeWarn,
    clearWarns,
    markActionTaken,
    WARN_THRESHOLDS,
    getUserStats,
    getTopUsersStats,
    getServerStatsAll,
    parsePriceNum,
    trackPurchase,
    createPoll,
    setPollMessageId,
    getPoll,
    getPollsByGuild,
    closePoll,
    getPollTotalVotes,
    createPollSession,
    createBackup,
    listBackups,
    restoreBackup,
    formatBackupSize,
    sendInvoice,
    addModLog,
    getModLogs,
    getModLogCount,
    modLogTypeLabel,
    tempVoiceManager,
    serverstatsManager,
    // UI
    Embeds,
    buildPanelEmbed,
    buildPanelComponents,
    createSession,
    buildEmbed,
    getSessionsByUser,
    deleteSession,
    deleteSessionByOwner,
    parseColor,
    buildGlobalControlPanel,
    // infra
    checkIsAdmin,
    invalidateAdminRoleCache,
    resolveGuildId,
    logAudit,
    safeEditReply,
    DISCORD_LIMITS,
    EMBED_LIMITS,
    withUserLock
};
