/**
 * Thor — MLBB Community Bot
 * Entry point (v3.9.9 refactor: slim, event-driven via src/bot/events/).
 *
 * Flow:
 *   1. Init Discord client dengan intents + partials.
 *   2. Attach error handlers (unhandledRejection log-only, uncaughtException → shutdown).
 *   3. Attach scheduler functions ke client (supaya commandHandler bisa panggil).
 *   4. Load event handlers dari src/bot/events/*.js.
 *   5. Expose refreshGlobalControlPanel ke client (dipakai interactionHandler).
 *   6. Graceful shutdown (async, 3s timeout, flush stats cache).
 *   7. Login.
 *
 * Semua business logic ada di:
 *   - src/commands/        (slash command handlers, per-domain)
 *   - src/interactions/    (button/select/modal handlers, per-domain)
 *   - src/data/            (JSON persistence layer)
 *   - src/services/        (scheduler tasks, business logic)
 *   - src/ui/              (embed/panel builders)
 *   - src/infra/           (safeWrite, safeReply, userLock, permissions, constants, auditLog)
 *   - src/bot/events/      (Discord event handlers)
 *
 * Legacy handlers/ tetap dipertahankan sebagai fallback selama migrasi
 * per-domain command/interaction ke src/commands/ dan src/interactions/.
 */

const { Client, GatewayIntentBits, Partials } = require('discord.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User]
});

// === Attach scheduler functions ke client (supaya commandHandler bisa panggil) ===
const { attachToClient } = require('./src/services/schedulerTasks');
attachToClient(client);

// === ERROR HANDLER GLOBAL ===
// v3.9.8: uncaughtException → graceful shutdown (bot lanjut jalan di state rusak berisiko korup data).
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception (will shutdown after log):', err);
    gracefulShutdown('uncaughtException');
});

// === LOAD EVENT HANDLERS ===
const eventHandlers = [
    require('./src/bot/events/ready'),
    require('./src/bot/events/interactionCreate'),
    require('./src/bot/events/guildMemberAdd'),
    require('./src/bot/events/guildMemberRemove'),
    require('./src/bot/events/messageCreate'),
    require('./src/bot/events/voiceStateUpdate'),
];

for (const handler of eventHandlers) {
    if (handler.once) {
        client.once(handler.name, (...args) => handler.execute(...args));
    } else {
        client.on(handler.name, (...args) => handler.execute(...args));
    }
}

// Expose refreshGlobalControlPanel ke client (dipakai interactionHandler setelah rename/kick/limit/lock/transfer/delete).
const voiceStateHandler = require('./src/bot/events/voiceStateUpdate');
client.refreshGlobalControlPanel = voiceStateHandler.refreshGlobalControlPanel;

// === GRACEFUL SHUTDOWN ===
// v3.9.8: async supaya shutdownStats() (yang butuh write file ke disk) benar-benar selesai sebelum exit.
const { shutdown: shutdownStats } = require('./src/data/statsManager');

async function gracefulShutdown(signal) {
    console.log(`\n⚠️ Received ${signal}, flushing stats & shutting down...`);
    try {
        await Promise.race([
            Promise.resolve(shutdownStats()),
            new Promise(resolve => setTimeout(resolve, 3000))
        ]);
    } catch (_) {}
    try { client.destroy(); } catch (_) {}
    process.exit(0);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// === LOGIN ===
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ Gagal login ke Discord:', err.message);
    process.exit(1);
});
