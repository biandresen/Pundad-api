const runtime = {
  cwd: "/srv/pundad/production/current/api",
  interpreter: "/opt/pundad/node-v24.12.0/bin/node",
  node_args: "--import /usr/local/lib/pundad-deploy/productionEnvironment.js",
  instances: 1, exec_mode: "fork", autorestart: true, max_restarts: 10,
  min_uptime: "10s", restart_delay: 3000, kill_timeout: 5000,
  merge_logs: true,
};
module.exports = { apps: [
  { ...runtime, name: "pundad-production-api", script: "src/server.js" },
  { ...runtime, name: "pundad-production-worker", script: "src/jobs/worker.js" },
] };
