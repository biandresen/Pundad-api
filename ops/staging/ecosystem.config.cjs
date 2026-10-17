const runtime = {
    cwd: "/srv/pundad/staging/current/api",
    interpreter: "/opt/pundad/node-v24.12.0/bin/node",
    node_args: "--import ./src/config/stagingEnvironment.js",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    max_restarts: 10,
    min_uptime: "10s",
    restart_delay: 3000,
    kill_timeout: 5000,
    merge_logs: true,
};

module.exports = {
  apps: [
    { ...runtime, name: "pundad-staging-api", script: "src/server.js" },
    { ...runtime, name: "pundad-staging-worker", script: "src/jobs/worker.js" },
  ],
};
