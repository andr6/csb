const path = require("path");

// PM2 Ecosystem Config — Chat Shit Bob
// Usage:
//   pm2 start ecosystem.config.js           ← start
//   pm2 restart ecosystem.config.js         ← restart
//   pm2 reload ecosystem.config.js          ← zero-downtime reload
//   pm2 stop ecosystem.config.js            ← stop

module.exports = {
  apps: [
    {
      name:         "chatshitbob",
      script:       "server.js",
      cwd:          path.resolve(__dirname),

      // ── Instances ──────────────────────────────────────────────────────────
      instances:    1,          // increase to "max" to use all CPU cores
      exec_mode:    "fork",     // use "cluster" if instances > 1

      // ── Auto-restart ───────────────────────────────────────────────────────
      watch:        false,      // don't watch files in production
      autorestart:  true,
      max_restarts: 10,
      restart_delay: 3000,      // wait 3s before restarting on crash

      // ── Memory limit ──────────────────────────────────────────────────────
      max_memory_restart: "512M",

      // ── Environment ───────────────────────────────────────────────────────
      // Reads from .env file via dotenv in server.js
      // You can also override specific vars here:
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },

      // ── Logging ───────────────────────────────────────────────────────────
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file:  "/var/log/pm2/chatshitbob-error.log",
      out_file:    "/var/log/pm2/chatshitbob-out.log",
      merge_logs:  true,
    },
  ],
};
