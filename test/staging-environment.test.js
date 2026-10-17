import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const loader = new URL("../src/config/stagingEnvironment.js", import.meta.url).href;
const defaults = {
  APP_ENV: "staging", NODE_ENV: "production", HOST: "127.0.0.1", PORT: "4002",
  DATABASE_URL: "postgresql://pundad_staging:test-password@127.0.0.1/pundad_staging",
  FRONTEND_BASE_URL: "https://staging.pundad.app",
  CORS_ORIGINS: "https://staging.pundad.app",
  UPLOADS_DIR: "/srv/pundad/staging/uploads",
  EMAIL_DELIVERY: "capture", EMAIL_CAPTURE_DIR: "/var/lib/pundad-staging/mail",
  JWT_ACCESS_SECRET: "a".repeat(64), JWT_REFRESH_SECRET: "b".repeat(64),
  RESEND_API_KEY: "",
};

function run(overrides = {}) {
  return spawnSync(process.execPath, ["--import", loader, "--eval", "process.stdout.write('ok')"], {
    env: { ...process.env, ...defaults, ...overrides }, encoding: "utf8",
  });
}

test("staging accepts its own isolated runtime configuration", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
});

for (const [name, config] of [
  ["production database", { DATABASE_URL: "postgresql://pundad_staging:private-password@127.0.0.1/jokedb" }],
  ["production login", { DATABASE_URL: "postgresql://jokeuser:private-password@127.0.0.1/pundad_staging" }],
  ["production uploads", { UPLOADS_DIR: "/var/www/pundad-uploads" }],
  ["production frontend", { FRONTEND_BASE_URL: "https://pundad.app" }],
  ["real email credentials", { RESEND_API_KEY: "private-provider-key" }],
  ["production port", { PORT: "4000" }],
  ["non-production cookie configuration", { NODE_ENV: "development" }],
]) {
  test(`staging rejects ${name} without exposing credentials`, () => {
    const result = run(config);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /private-password|private-provider-key/);
  });
}
