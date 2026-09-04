/**
 * Unit tests v3.9.42 — notifikasi owner baru temp voice via CHAT voice channel (bukan DM).
 *
 * Perubahan yang dijaga (user request: "dm owner voice jangan lewat dm,
 * cukup beritahu lewat chat voice saja"):
 *   Sebelum: saat ownership voice channel berpindah (auto-transfer saat owner
 *   keluar, atau transfer manual via panel), bot DM ke owner baru — sering
 *   gagal (DM user ditutup, `catch (_) {}` senyap) / tidak terbaca.
 *   Sesudah: bot mengirim pesan di TEXT CHAT voice channel itu sendiri +
 *   mention owner baru (ping notifikasi tetap jalan).
 *
 * Titik yang diuji (kontrak statis sumber, gaya componentLimits.test.js):
 *   (1) voiceStateUpdate.js (auto-transfer): tidak ada `newOwner.send` (DM),
 *       ada `voiceChannel.send` (chat channel), dan mention `<@${newOwner.id}>`.
 *   (2) tempvoice.js (transfer manual): tidak ada `newOwner.send`, ada
 *       `found.channel.send`, mention `<@${newOwnerId}>`, dan `oldOwnerId`
 *       di-capture SEBELUM `transferOwnership` (anti ambigu pesan).
 *   (3) Regression: tidak ada DM owner baru yang tersisa di domain temp voice.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

function readSrc(rel) {
    return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

test('v3.9.42 #1 auto-transfer (voiceStateUpdate.js): notifikasi lewat chat voice channel, bukan DM, dengan mention owner baru', () => {
    const src = readSrc('src/bot/events/voiceStateUpdate.js');

    assert.ok(/function handleAutoTransferOwnership/.test(src), 'fungsi auto-transfer harus ada');
    assert.ok(!src.includes('newOwner.send('), 'DM ke owner baru (newOwner.send) sudah tidak boleh dipakai di auto-transfer');
    assert.ok(src.includes('voiceChannel.send('), 'notifikasi harus via voiceChannel.send (text chat voice channel)');
    assert.ok(src.includes('<@${newOwner.id}>'), 'pesan harus mention owner baru <@newOwner.id> supaya tetap dapat ping');
    assert.ok(src.includes('<@${oldOwnerId}>'), 'pesan auto-transfer harus menyebut owner lama');
});

test('v3.9.42 #2 transfer manual (tempvoice.js): notifikasi lewat chat voice channel, bukan DM; oldOwnerId di-capture sebelum transfer', () => {
    const src = readSrc('src/interactions/tempvoice.js');

    assert.ok(/function handleTempVoiceTransferExecute/.test(src), 'handler transfer manual harus ada');
    assert.ok(!src.includes('newOwner.send('), 'DM ke owner baru (newOwner.send) sudah tidak boleh dipakai di transfer manual');
    assert.ok(src.includes('found.channel.send('), 'notifikasi harus via found.channel.send (text chat voice channel)');
    assert.ok(src.includes('<@${newOwnerId}>'), 'pesan harus mention owner baru <@newOwnerId> supaya tetap dapat ping');

    // oldOwnerId HARUS di-capture sebelum registry ditimpa transferOwnership —
    // kalau tidak, pesan "oleh <@owner>" bisa ke-swap ke owner baru.
    const captureIdx = src.indexOf('const oldOwnerId = found.channelInfo.ownerId');
    const transferIdx = src.indexOf('tempVoiceManager.transferOwnership(found.guild.id');
    assert.ok(captureIdx !== -1, 'oldOwnerId harus di-capture eksplisit sebelum transfer');
    assert.ok(transferIdx !== -1, 'panggilan transferOwnership harus ada');
    assert.ok(captureIdx < transferIdx, 'capture oldOwnerId harus SEBELUM transferOwnership menimpa registry');
});

test('v3.9.42 #3 regression: domain temp voice bebas DM ke owner baru di kedua file handler', () => {
    for (const rel of ['src/bot/events/voiceStateUpdate.js', 'src/interactions/tempvoice.js']) {
        const src = readSrc(rel);
        assert.ok(!src.includes('newOwner.send('), `${rel} tidak boleh kembali memakai DM owner baru`);
    }
});
