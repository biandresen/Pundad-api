module.exports = {
  apps: [
    {
      name: "pundad-api",
      cwd: "/home/pi/projects/backend/Blog-API",
      script: "src/server.js",
      interpreter: "node",
      env: {
        NODE_ENV: "development",
        LOG_LEVEL: "debug",
        PORT: 4001,
        FRONTEND_BASE_URL: "http://127.0.0.1:5173",
      },
      env_production: {
        NODE_ENV: "production",
        LOG_LEVEL: "info",
        PORT: 4000,
        UPLOADS_DIR: "/var/www/pundad-uploads",
        FRONTEND_BASE_URL: "https://pundad.app",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: "pundad-worker",
      cwd: "/home/pi/projects/backend/Blog-API",
      script: "src/jobs/worker.js",
      interpreter: "node",
      env: {
        NODE_ENV: "development",
        LOG_LEVEL: "debug",
      },
      env_production: {
        NODE_ENV: "production",
        LOG_LEVEL: "info",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};

// PM2 commands you should know

// These are the main ones worth memorizing.

// START FROM ECOSYSTEM
// pm2 start ecosystem.config.cjs --env production
// Start one app only
// pm2 start ecosystem.config.cjs --only pundad-api --env production
// pm2 start ecosystem.config.cjs --only pundad-worker --env production
// See all processes
// pm2 list

// DETAILED INFO
// pm2 show pundad-api
// pm2 show pundad-worker
// pm2 describe pundad-api
// pm2 describe pundad-worker
// View logs
// pm2 logs
// pm2 logs pundad-api
// pm2 logs pundad-worker
// pm2 logs pundad-api --lines 100
// pm2 logs pundad-worker --lines 100
// Restart
// pm2 restart pundad-api
// pm2 restart pundad-worker
// pm2 restart ecosystem.config.cjs --env production
// Reload

// Best for ecosystem-based updates:

// pm2 reload ecosystem.config.cjs --env production
// Stop
// pm2 stop pundad-api
// pm2 stop pundad-worker
// pm2 stop all
// Delete from PM2
// pm2 delete pundad-api
// pm2 delete pundad-worker
// pm2 delete all
// Reset restart counters
// pm2 reset pundad-api
// pm2 reset pundad-worker
// pm2 reset all
// Flush logs
// pm2 flush
// Save current PM2 state
// pm2 save
// Startup on reboot
// pm2 startup

// Then run the command PM2 prints for your system, then:

// pm2 save
// Monitor live
// pm2 monit
// Check current config
// pm2 conf
// View log files directly

// PM2 usually writes logs in:

// ~/.pm2/logs

// Useful commands:

// ls -lah ~/.pm2/logs
// tail -f ~/.pm2/logs/pundad-api-out.log
// tail -f ~/.pm2/logs/pundad-worker-out.log

// Install log rotation
// pm2 install pm2-logrotate
// pm2 set pm2-logrotate:max_size 10M
// pm2 set pm2-logrotate:retain 14
// pm2 set pm2-logrotate:compress true
// pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
