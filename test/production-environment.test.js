import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const loader = new URL("../ops/deploy/productionEnvironment.js", import.meta.url).href;
const defaults = {
  APP_ENV: "production",
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: "4000",
  DATABASE_URL: "postgresql://jokeuser:test-password@127.0.0.1/jokedb",
  FRONTEND_BASE_URL: "https://pundad.app",
  CORS_ORIGINS: "https://pundad.app,https://www.pundad.app",
  UPLOADS_DIR: "/var/www/pundad-uploads",
  EMAIL_DELIVERY: "provider",
  RESEND_API_KEY: "private-provider-fixture",
  JWT_ACCESS_SECRET: "a".repeat(64),
  JWT_REFRESH_SECRET: "b".repeat(64),
  TURNSTILE_SECRET_KEY: "0x4AAAAAA-private-production-fixture",
  TURNSTILE_ALLOWED_HOSTNAMES: "pundad.app,www.pundad.app",
};

function run(overrides = {}) {
  return spawnSync(process.execPath, ["--import", loader, "--eval", "process.stdout.write('ok')"], {
    env: { ...process.env, ...defaults, ...overrides },
    encoding: "utf8",
  });
}

test("production accepts its approved runtime configuration", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
});

for (const [name, config] of [
  ["missing Turnstile secret", { TURNSTILE_SECRET_KEY: "" }],
  ["Cloudflare test secret", { TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" }],
  ["staging Turnstile hostname", { TURNSTILE_ALLOWED_HOSTNAMES: "staging.pundad.app" }],
]) {
  test(`production rejects ${name} without exposing credentials`, () => {
    const result = run(config);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /private-production-fixture|private-provider-fixture/);
  });
}
