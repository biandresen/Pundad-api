import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const loader = new URL("../src/config/developmentEnvironment.js", import.meta.url).href;
const defaults = {
  NODE_ENV: "development",
  APP_ENV: "development",
  HOST: "127.0.0.1",
  PORT: "4001",
  DATABASE_URL: "postgresql://pundad_dev:test-only-password@127.0.0.1:5432/pundad_dev",
  UPLOADS_DIR: "./uploads",
  EMAIL_DELIVERY: "console",
  JWT_ACCESS_SECRET: "a".repeat(64),
  JWT_REFRESH_SECRET: "b".repeat(64),
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
};

function run(overrides = {}, writeConfig = true) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "pundad-env-test-"));
  try {
    if (writeConfig) {
      writeFileSync(path.join(cwd, ".env.development"), Object.entries({ ...defaults, ...overrides })
        .map(([key, value]) => `${key}=${value}`).join("\n"));
    }
    // Prove that an inherited production URL cannot win over the development file.
    return spawnSync(process.execPath, ["--import", loader, "--input-type=module", "--eval",
      "process.stdout.write(JSON.stringify({database: new URL(process.env.DATABASE_URL).pathname, port: process.env.PORT}))"], {
      cwd,
      env: { ...process.env, DATABASE_URL: "postgresql://prod:inherited-secret@localhost/jokedb" },
      encoding: "utf8",
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("development commands override inherited credentials with their isolated configuration", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { database: "/pundad_dev", port: "4001" });
});

test("development commands refuse the production database without exposing credentials", () => {
  const result = run({ DATABASE_URL: "postgresql://pundad_dev:private-password@localhost/jokedb" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /require the local pundad_dev database/);
  assert.doesNotMatch(result.stderr, /private-password|inherited-secret/);
});

test("development commands refuse missing configuration rather than falling back to .env", () => {
  const result = run({}, false);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Create .env.development/);
});

for (const [label, config, message] of [
  ["real email delivery", { EMAIL_DELIVERY: "resend" }, /EMAIL_DELIVERY=console/],
  ["production uploads", { UPLOADS_DIR: "/var/www/pundad-uploads" }, /checkout's uploads directory/],
  ["production port", { PORT: "4000" }, /PORT=4001/],
  ["remote database", { DATABASE_URL: "postgresql://pundad_dev:hidden@example.org/pundad_dev" }, /local pundad_dev/],
  ["missing Turnstile test secret", { TURNSTILE_SECRET_KEY: "" }, /Turnstile test secret/],
  ["real Turnstile secret", { TURNSTILE_SECRET_KEY: "0x4AAAAAA-private-fixture" }, /Turnstile test secret/],
]) {
  test(`development commands refuse ${label}`, () => {
    const result = run(config);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  });
}
