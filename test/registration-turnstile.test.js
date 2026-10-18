import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, beforeEach, mock, test } from "node:test";
import { FeatureType, Prisma } from "@prisma/client";

let userLookups = 0;
const createdUsers = [];
const outbox = [];
mock.module("@prisma/client", { namedExports: {
  FeatureType, Prisma,
  PrismaClient: class {
    user = {
      findFirst: async () => { userLookups++; return null; },
      create: async ({ data }) => {
        createdUsers.push(data);
        return { id: 1, ...data };
      },
    };
    emailVerificationToken = {
      deleteMany: async () => ({}),
      findMany: async () => [],
      create: async ({ data }) => data,
    };
    productEvent = { create: async ({ data }) => data };
  },
} });
mock.module("resend", { namedExports: {
  Resend: class {
    emails = { send: async (message) => {
      outbox.push(message);
      return { data: { id: "test-email" } };
    } };
  },
} });

process.env.LOG_LEVEL = "silent";
process.env.NODE_ENV = "production";
const { default: app } = await import("../src/app.js");
const realFetch = globalThis.fetch;
const siteverifyRequests = [];
let upstream;
mock.method(globalThis, "fetch", async (url, options) => {
  if (url !== "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
    return realFetch(url, options);
  }
  siteverifyRequests.push(options);
  return upstream();
});

let server;
let base;
let client = 0;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}/api/v1/auth`;
});
after(async () => { server.close(); await once(server, "close"); });
beforeEach(() => {
  process.env.APP_ENV = "production";
  process.env.NODE_ENV = "production";
  process.env.TURNSTILE_SECRET_KEY = "private-test-fixture";
  process.env.TURNSTILE_ALLOWED_HOSTNAMES = "pundad.app, www.pundad.app";
  upstream = () => Response.json({ success: true, action: "register", hostname: "pundad.app" });
  userLookups = 0;
  createdUsers.length = 0;
  outbox.length = 0;
  siteverifyRequests.length = 0;
  client++;
});

async function register(overrides = {}) {
  return fetch(`${base}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": `192.0.2.${client}` },
    body: JSON.stringify({
      username: "newuser", email: "newuser@example.com", password: "StrongPassword123!",
      passwordConfirmation: "StrongPassword123!", acceptedTerms: true,
      turnstileToken: "browser-token", ...overrides,
    }),
  });
}

test("registration rejects missing and malformed tokens before accessing users or Cloudflare", async () => {
  for (const turnstileToken of [undefined, null, "", " ", 123, {}, "a".repeat(2049)]) {
    const response = await register({ turnstileToken });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "TURNSTILE_FAILED");
  }
  assert.equal(siteverifyRequests.length, 0);
  assert.equal(userLookups, 0);
  assert.equal(createdUsers.length, 0);
});

test("a valid registration verifies on the server before creating the account and verification email", async () => {
  const response = await register();
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.needsEmailVerification, true);
  assert.equal(createdUsers.length, 1);
  assert.equal(createdUsers[0].emailVerified, false);
  assert.equal(createdUsers[0].turnstileToken, undefined);
  assert.equal(outbox.length, 1);
  assert.deepEqual(JSON.parse(siteverifyRequests[0].body), {
    secret: "private-test-fixture", response: "browser-token",
  });
  assert.ok(siteverifyRequests[0].signal instanceof AbortSignal);
});

test("failed, expired, replayed, wrong-action and wrong-hostname tokens cannot create accounts", async () => {
  for (const validation of [
    { success: false, "error-codes": ["invalid-input-response"] },
    { success: false, "error-codes": ["timeout-or-duplicate"] },
    { success: true, action: "login", hostname: "pundad.app" },
    { success: true, action: "register", hostname: "attacker.example" },
    { success: true },
  ]) {
    upstream = () => Response.json(validation);
    assert.equal((await register()).status, 400);
  }
  assert.equal(userLookups, 0);
  assert.equal(createdUsers.length, 0);
  assert.equal(outbox.length, 0);
});

test("missing secret or hostname configuration fails closed", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  assert.equal((await register()).status, 503);
  process.env.TURNSTILE_SECRET_KEY = "private-test-fixture";
  delete process.env.TURNSTILE_ALLOWED_HOSTNAMES;
  assert.equal((await register()).status, 503);
  assert.equal(siteverifyRequests.length, 0);
  assert.equal(createdUsers.length, 0);
});

test("upstream network errors, timeouts, HTTP failures and invalid responses fail closed without leaking secrets", async () => {
  for (const failure of [
    () => { throw new Error("private-test-fixture browser-token"); },
    () => { throw new DOMException("timeout", "TimeoutError"); },
    () => new Response("private upstream error", { status: 500 }),
    () => new Response("invalid JSON"),
    () => Response.json(null),
    () => Response.json({ success: "true" }),
  ]) {
    upstream = failure;
    const response = await register();
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /TURNSTILE_UNAVAILABLE/);
    assert.doesNotMatch(body, /private-test-fixture|browser-token|private upstream/);
  }
  assert.equal(createdUsers.length, 0);
});

test("Cloudflare test secrets are refused in staging and production", async () => {
  for (const secret of [
    "1x0000000000000000000000000000000AA",
    "2x0000000000000000000000000000000AA",
    "3x0000000000000000000000000000000AA",
  ]) {
    for (const environment of ["production", "staging"]) {
      process.env.APP_ENV = environment;
      process.env.TURNSTILE_SECRET_KEY = secret;
      assert.equal((await register()).status, 503);
    }
  }
  assert.equal(siteverifyRequests.length, 0);
});

test("development test keys still call Siteverify and accept its dummy action and hostname", async () => {
  process.env.NODE_ENV = "development";
  process.env.APP_ENV = "development";
  process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
  delete process.env.TURNSTILE_ALLOWED_HOSTNAMES;
  upstream = () => Response.json({ success: true, action: "test", hostname: "localhost" });
  assert.equal((await register()).status, 201);
  assert.equal(siteverifyRequests.length, 1);
  assert.equal(createdUsers.length, 1);
});

test("login, refresh, and logout do not require Turnstile", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  for (const [path, status] of [["login", 400], ["refresh", 400], ["logout", 200]]) {
    const response = await fetch(`${base}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /TURNSTILE/);
  }
  assert.equal(siteverifyRequests.length, 0);
});
