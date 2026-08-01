// SHIM — file ini re-export dari lokasi baru setelah refactor v3.9.9.
// Original file sudah dipindahkan ke src/infra/safeReply.js.
// Shim ini tetap dipertahankan untuk backward compatibility dengan code
// yang masih require('../utils/safeReply'). Akan dihapus setelah semua
// caller di-update ke path baru.
module.exports = require('../src/infra/safeReply');
