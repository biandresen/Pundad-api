import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mock, test } from "node:test";

mock.module("resend", {
  namedExports: { Resend: class { constructor() { throw new Error("Provider must not be contacted"); } } },
});
const { default: emailService } = await import("../src/services/emailService.js");

test("staging captures verification mail in a private file without contacting the provider", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pundad-staging-mail-"));
  const previous = { APP_ENV: process.env.APP_ENV, EMAIL_DELIVERY: process.env.EMAIL_DELIVERY, EMAIL_CAPTURE_DIR: process.env.EMAIL_CAPTURE_DIR };
  try {
    process.env.APP_ENV = "staging";
    process.env.EMAIL_DELIVERY = "capture";
    process.env.EMAIL_CAPTURE_DIR = directory;
    const url = "https://staging.pundad.app/verify-email/test-token";
    await emailService.sendVerificationEmail("tester@example.test", url, "EN");
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    const file = path.join(directory, files[0]);
    const message = JSON.parse(await readFile(file, "utf8"));
    assert.equal(message.to, "tester@example.test");
    assert.ok(message.text.includes(url));
    assert.equal((await stat(file)).mode & 0o777, 0o600);

    process.env.APP_ENV = "production";
    await assert.rejects(emailService.sendVerificationEmail("tester@example.test", url), /requires the staging environment/);
    assert.equal((await readdir(directory)).length, 1);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
