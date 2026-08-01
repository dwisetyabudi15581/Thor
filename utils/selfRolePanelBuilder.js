// SHIM — file ini re-export dari lokasi baru setelah refactor v3.9.9.
// Original file sudah dipindahkan ke src/ui/selfRolePanelBuilder.js.
// Shim ini tetap dipertahankan untuk backward compatibility dengan code
// yang masih require('../utils/selfRolePanelBuilder'). Akan dihapus setelah semua
// caller di-update ke path baru.
module.exports = require('../src/ui/selfRolePanelBuilder');
