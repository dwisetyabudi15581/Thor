/**
 * Poll Manager — store polls with vote tracking.
 *
 * File: polls.json
 * [
 *   {
 *     id: "poll_<timestamp>_<rand>",
 *     guildId, channelId, messageId,
 *     question: "Event weekend ini?",
 *     options: [
 *       { label: "Rank Push", emoji: "🎮", votes: ["userId1", "userId2"] },
 *       { label: "Custom Room", emoji: "🏠", votes: ["userId3"] }
 *     ],
 *     multiple: false,      // true = boleh pilih banyak
 *     closed: false,
 *     createdAt, closedAt: null,
 *     creatorId, creatorTag
 *   }
 * ]
 */

const fs = require('fs');
const path = require('path');
const { safeWriteJSON } = require('./safeWrite');

const filePath = path.join(__dirname, '..', 'polls.json');

function load() {
    try {
        if (!fs.existsSync(filePath)) return [];
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn('⚠️ polls.json rusak:', err.message);
        return [];
    }
}

// v3.9.0 FIX: atomic write via safeWriteJSON (tmp+rename) to prevent corruption on crash
function save(list) {
    safeWriteJSON(filePath, list);
}

function genId() {
    return `poll_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function create(data) {
    const list = load();
    const poll = {
        id: genId(),
        guildId: data.guildId,
        channelId: data.channelId,
        messageId: null,
        question: data.question,
        options: data.options.map((opt, i) => ({
            label: opt.label,
            emoji: opt.emoji || `${i + 1}️⃣`,
            votes: []
        })),
        multiple: data.multiple || false,
        closed: false,
        createdAt: Date.now(),
        closedAt: null,
        creatorId: data.creatorId,
        creatorTag: data.creatorTag
    };
    list.push(poll);
    save(list);
    return poll;
}

function setMessageId(id, messageId) {
    const list = load();
    const poll = list.find(p => p.id === id);
    if (poll) {
        poll.messageId = messageId;
        save(list);
    }
    return poll;
}

function get(id) {
    return load().find(p => p.id === id);
}

function getByMessage(messageId) {
    return load().find(p => p.messageId === messageId);
}

function getByGuild(guildId) {
    return load().filter(p => p.guildId === guildId);
}

/**
 * Vote option. Kalau multiple=false, otomatis unvote option lain dulu.
 * Kalau user sudah vote option yang sama, unvote (toggle).
 * @returns {Object|null} updated poll, atau null kalau poll tidak ada
 */
function vote(id, userId, optionIndex) {
    const list = load();
    const poll = list.find(p => p.id === id);
    if (!poll) return null;
    if (poll.closed) return { closed: true };
    // P2-8 FIX: Number.isInteger check — sebelumnya NaN lolos check
    // karena (NaN < 0) = false dan (NaN >= length) = false.
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) return null;

    const option = poll.options[optionIndex];
    const alreadyVoted = option.votes.includes(userId);

    if (!poll.multiple) {
        // Hapus vote user dari semua option dulu
        for (const opt of poll.options) {
            opt.votes = opt.votes.filter(u => u !== userId);
        }
    }

    // Toggle vote
    if (!alreadyVoted) {
        option.votes.push(userId);
    }

    save(list);
    return poll;
}

function close(id) {
    const list = load();
    const poll = list.find(p => p.id === id);
    if (!poll) return null;
    poll.closed = true;
    poll.closedAt = Date.now();
    save(list);
    return poll;
}

function remove(id) {
    const list = load();
    const filtered = list.filter(p => p.id !== id);
    if (filtered.length !== list.length) {
        save(filtered);
        return true;
    }
    return false;
}

function getTotalVotes(poll) {
    if (!poll) return 0;
    if (poll.multiple) {
        return poll.options.reduce((sum, opt) => sum + opt.votes.length, 0);
    }
    // Untuk non-multiple, total voter = unique voters
    const unique = new Set();
    for (const opt of poll.options) {
        for (const u of opt.votes) unique.add(u);
    }
    return unique.size;
}

module.exports = {
    create, setMessageId, get, getByMessage, getByGuild,
    vote, close, remove, getTotalVotes
};
