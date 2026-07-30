/**
 * Stats Manager — track aktivitas user untuk leaderboard & stats.
 *
 * File: stats.json
 * {
 *   "userId1": {
 *     "messages": 123,
 *     "lastMessageAt": 1735689600000,
 *     "vipPurchases": 2,
 *     "totalSpent": 80000,
 *     "joinedAt": 1735000000000,
 *     "giveawaysWon": 0
 *   }
 * }
 *
 * Tracking:
 *   - messages: count pesan user (updated by messageCreate event)
 *   - vipPurchases: count pembelian VIP (updated by set-key flow)
 *   - totalSpent: total uang dihabiskan (extracted dari price produk)
 *   - giveawaysWon: count menang giveaway
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'stats.json');

function load() {
    try {
        if (!fs.existsSync(filePath)) return {};
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn('⚠️ stats.json rusak:', err.message);
        return {};
    }
}

function save(data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getStats(userId) {
    const all = load();
    return all[userId] || {
        messages: 0,
        lastMessageAt: null,
        vipPurchases: 0,
        totalSpent: 0,
        joinedAt: null,
        giveawaysWon: 0
    };
}

function incrementMessages(userId) {
    const all = load();
    if (!all[userId]) all[userId] = { messages: 0, lastMessageAt: null, vipPurchases: 0, totalSpent: 0, joinedAt: null, giveawaysWon: 0 };
    all[userId].messages = (all[userId].messages || 0) + 1;
    all[userId].lastMessageAt = Date.now();
    save(all);
}

function recordPurchase(userId, priceNum) {
    const all = load();
    if (!all[userId]) all[userId] = { messages: 0, lastMessageAt: null, vipPurchases: 0, totalSpent: 0, joinedAt: null, giveawaysWon: 0 };
    all[userId].vipPurchases = (all[userId].vipPurchases || 0) + 1;
    all[userId].totalSpent = (all[userId].totalSpent || 0) + (priceNum || 0);
    save(all);
}

function recordGiveawayWin(userId) {
    const all = load();
    if (!all[userId]) all[userId] = { messages: 0, lastMessageAt: null, vipPurchases: 0, totalSpent: 0, joinedAt: null, giveawaysWon: 0 };
    all[userId].giveawaysWon = (all[userId].giveawaysWon || 0) + 1;
    save(all);
}

function recordJoin(userId) {
    const all = load();
    if (!all[userId]) all[userId] = { messages: 0, lastMessageAt: null, vipPurchases: 0, totalSpent: 0, joinedAt: null, giveawaysWon: 0 };
    if (!all[userId].joinedAt) all[userId].joinedAt = Date.now();
    save(all);
}

/**
 * Get top N users berdasarkan metric.
 * @param {string} metric - 'messages' | 'vipPurchases' | 'totalSpent' | 'giveawaysWon'
 * @param {number} limit
 * @returns {Array} [{ userId, value, ...otherStats }]
 */
function getTopUsers(metric, limit = 10) {
    const all = load();
    return Object.entries(all)
        .map(([userId, stats]) => ({ userId, ...stats, value: stats[metric] || 0 }))
        .filter(e => e.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
}

/**
 * Get agregat stats seluruh server.
 */
function getServerStats() {
    const all = load();
    const users = Object.keys(all);
    return {
        totalUsers: users.length,
        totalMessages: users.reduce((sum, id) => sum + (all[id].messages || 0), 0),
        totalPurchases: users.reduce((sum, id) => sum + (all[id].vipPurchases || 0), 0),
        totalRevenue: users.reduce((sum, id) => sum + (all[id].totalSpent || 0), 0),
        totalGiveawaysWon: users.reduce((sum, id) => sum + (all[id].giveawaysWon || 0), 0)
    };
}

/**
 * Parse price string ke number. Handle "Rp 25.000", "25000", "25.000", "25k", "2.5M"
 */
function parsePrice(priceStr) {
    if (typeof priceStr === 'number') return priceStr;
    if (!priceStr) return 0;
    let s = String(priceStr).toLowerCase().replace(/rp\.?/g, '').replace(/\s/g, '');
    let multiplier = 1;
    if (s.endsWith('k')) { multiplier = 1000; s = s.slice(0, -1); }
    else if (s.endsWith('m')) { multiplier = 1000000; s = s.slice(0, -1); }
    s = s.replace(/\./g, '').replace(/,/g, '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : Math.round(n * multiplier);
}

module.exports = {
    getStats, incrementMessages, recordPurchase, recordGiveawayWin, recordJoin,
    getTopUsers, getServerStats, parsePrice
};
