// pm2 ecosystem — jalankan bot + dashboard web sebagai service 24/7.
//
// Pakai (dari root repo, setelah ./setup.sh dan kedua .env terisi):
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup     # auto-start saat VPS reboot
//
// Perintah harian:
//   pm2 status                  # thor-bot + thor-dash harus online
//   pm2 logs thor-bot           /  pm2 logs thor-dash
//   pm2 restart all             # restart keduanya
module.exports = {
  apps: [
    {
      name: "thor-bot",
      script: "index.js",
      cwd: __dirname,
      time: true,
      max_memory_restart: "400M",
    },
    {
      name: "thor-dash",
      script: "npm",
      args: "run start",
      cwd: __dirname + "/dashboard",
      time: true,
      max_memory_restart: "400M",
    },
  ],
};
