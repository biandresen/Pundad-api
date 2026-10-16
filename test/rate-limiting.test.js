import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { after, before, beforeEach, mock, test } from "node:test";
import { FeatureType, Prisma } from "@prisma/client";

// Replace external systems only; the app, routes, controllers and limiters are real.
const user = {
  id: 1,
  username: "newuser",
  email: "newuser@example.com",
  active: true,
  emailVerified: false,
};
let verificationTokens = [];
let resetTokens = [];
const outbox = [];

mock.module("@prisma/client", {
  namedExports: {
    FeatureType,
    Prisma,
    PrismaClient: class {
      user = {
        findFirst: async ({ where }) => {
          const email = where.email?.equals;
          const username = where.username?.equals;
          return where.id === user.id || email === user.email || username === user.username ? { ...user } : null;
        },
        update: async ({ data }) => Object.assign(user, data),
      };
      emailVerificationToken = {
        deleteMany: async () => { verificationTokens = []; },
        findMany: async () => [...verificationTokens],
        create: async ({ data }) => {
          const record = { id: verificationTokens.length + 1, ...data };
          verificationTokens.push(record);
          return record;
        },
        findFirst: async ({ where }) => verificationTokens.find((record) => record.token === where.token),
        delete: async ({ where }) => {
          verificationTokens = verificationTokens.filter((record) => record.id !== where.id);
        },
      };
      resetPasswordToken = {
        deleteMany: async () => { resetTokens = []; },
        findMany: async () => [...resetTokens],
        create: async ({ data }) => {
          const record = { id: resetTokens.length + 1, ...data };
          resetTokens.push(record);
          return record;
        },
        findFirst: async ({ where }) => resetTokens.find((record) => record.token === where.token),
        delete: async ({ where }) => {
          resetTokens = resetTokens.filter((record) => record.id !== where.id);
        },
      };
      productEvent = { create: async ({ data }) => data };
    },
  },
});
mock.module("resend", {
  namedExports: {
    Resend: class {
      emails = {
        send: async (message) => {
          outbox.push(message);
          return { data: { id: "test-email" } };
        },
      };
    },
  },
});

process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";
const { default: app } = await import("../src/app.js");

let server;
let clientIp;
let clientNumber = 0;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
});
after(async () => {
  if (server?.listening) {
    server.close();
    await once(server, "close");
  }
});
beforeEach(() => {
  clientIp = `192.0.2.${++clientNumber}`;
  user.emailVerified = false;
  verificationTokens = [];
  resetTokens = [];
  outbox.length = 0;
});

async function request(path, { method = "GET", body, ip = clientIp } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: server.address().port,
      path: `/api/v1${path}`,
      method,
      headers: {
        "X-Forwarded-For": ip,
        ...(payload === undefined ? {} : {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        }),
      },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: JSON.parse(text),
      }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(payload);
  });
}

const login = (options = {}) => request("/auth/login", {
  method: "POST",
  body: { userInput: user.email, password: "Password123!" },
  ...options,
});

test("an unverified user gets 30 login attempts before being throttled", async () => {
  for (let attempt = 1; attempt <= 30; attempt++) {
    const response = await login();
    assert.equal(response.status, 403, `login attempt ${attempt}`);
    assert.equal(response.body.code, "EMAIL_NOT_VERIFIED");
  }
  assert.equal((await login()).status, 429);
});

test("login retries count down and resume after five minutes without extending the wait", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T12:00:00Z") });
  for (let attempt = 0; attempt < 30; attempt++) await login();

  const blocked = await login();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.status, "fail");
  assert.equal(blocked.body.statusCode, 429);
  assert.equal(blocked.headers["retry-after"], "300");
  assert.equal(blocked.body.retryAfter, 300);

  t.mock.timers.tick(60_000);
  const retry = await login();
  assert.equal(retry.status, 429);
  assert.equal(retry.headers["retry-after"], "240");
  assert.equal(retry.body.retryAfter, 240);

  t.mock.timers.tick(239_999);
  assert.equal((await login()).status, 429);
  t.mock.timers.tick(1);
  const resumed = await login();
  assert.equal(resumed.status, 403);
  assert.equal(resumed.body.code, "EMAIL_NOT_VERIFIED");
});

test("a user can resend and verify their email after exhausting login attempts", async () => {
  for (let attempt = 0; attempt < 30; attempt++) await login();
  assert.equal((await login()).status, 429);

  const resent = await request("/auth/resend-verification", {
    method: "POST", body: { email: user.email },
  });
  assert.equal(resent.status, 200);
  const verificationUrl = outbox.at(-1).text.match(/https?:\/\/\S+/)[0];
  const token = new URL(verificationUrl).pathname.split("/").at(-1);
  const verified = await request(`/auth/verify-email?token=${token}`);
  assert.equal(verified.status, 200);
  assert.equal(verified.body.message, "Email verified successfully");
});

test("refresh and logout share 120 requests per five minutes independently of login", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T12:00:00Z") });
  for (let attempt = 0; attempt < 120; attempt++) {
    const path = attempt % 2 === 0 ? "/auth/refresh" : "/auth/logout";
    const response = await request(path, { method: "POST" });
    assert.equal(response.status, attempt % 2 === 0 ? 400 : 200, `session request ${attempt + 1}`);
  }
  assert.equal((await request("/auth/refresh", { method: "POST" })).status, 429);
  assert.equal((await request("/auth/logout", { method: "POST" })).status, 429);
  assert.equal((await login()).status, 403);

  t.mock.timers.tick(300_000);
  assert.equal((await request("/auth/logout", { method: "POST" })).status, 200);
});

test("registration allows ten attempts and recovers after fifteen minutes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T12:00:00Z") });
  const register = () => request("/auth/register", { method: "POST", body: {} });
  for (let attempt = 1; attempt <= 10; attempt++) {
    const response = await register();
    assert.equal(response.status, 400, `registration attempt ${attempt}`);
    assert.equal(response.body.message, "Validation failed");
  }
  const blocked = await register();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.retryAfter, 900);
  t.mock.timers.tick(900_000);
  assert.equal((await register()).status, 400);
});

test("reset emails and password submissions each allow five attempts without blocking each other", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T12:00:00Z") });
  const reset = () => request("/auth/reset-password", {
    method: "POST", body: { email: user.email },
  });
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await reset()).status, 200);
  assert.equal((await reset()).status, 429);

  const resetUrl = outbox.at(-1).text.match(/https?:\/\/\S+/)[0];
  const token = new URL(resetUrl).pathname.split("/").at(-1);
  const submit = (value) => request("/auth/new-password", {
    method: "POST", body: { token: value, password: "NewPassword123!" },
  });
  assert.equal((await submit(token)).status, 200);
  for (let attempt = 0; attempt < 4; attempt++) assert.equal((await submit("invalid")).status, 400);
  const blocked = await submit("invalid");
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.retryAfter, 900);
  assert.equal((await login()).status, 403);

  t.mock.timers.tick(900_000);
  assert.equal((await reset()).status, 200);
  assert.equal((await submit("invalid")).status, 400);
});

test("all API routes share 600 requests and recover after five minutes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T12:00:00Z") });
  for (let attempt = 0; attempt < 600; attempt++) {
    const path = attempt % 2 === 0 ? "/auth/health" : "/missing-route";
    assert.equal((await request(path)).status, attempt % 2 === 0 ? 200 : 404, `API request ${attempt + 1}`);
  }
  const blocked = await login();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.message, "Too many requests. Please wait a moment and try again.");
  assert.equal(blocked.headers["retry-after"], "300");
  assert.equal(blocked.body.retryAfter, 300);
  t.mock.timers.tick(300_000);
  assert.equal((await request("/auth/health")).status, 200);
});

test("verification allows 30 attempts per five minutes independently of login and resend", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T12:00:00Z") });
  const verify = () => request("/auth/verify-email?token=invalid");
  for (let attempt = 0; attempt < 30; attempt++) assert.equal((await verify()).status, 400);
  const blocked = await verify();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.retryAfter, 300);
  assert.equal((await login()).status, 403);
  assert.equal((await request("/auth/resend-verification", {
    method: "POST", body: { email: user.email },
  })).status, 200);
  t.mock.timers.tick(300_000);
  assert.equal((await verify()).status, 400);
});

test("resending is limited to five per fifteen minutes while an issued link remains usable", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T12:00:00Z") });
  const resend = () => request("/auth/resend-verification", {
    method: "POST", body: { email: user.email },
  });
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await resend()).status, 200);
  const blocked = await resend();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers["retry-after"], "900");
  assert.equal(blocked.body.retryAfter, 900);

  const verificationUrl = outbox.at(-1).text.match(/https?:\/\/\S+/)[0];
  const token = new URL(verificationUrl).pathname.split("/").at(-1);
  assert.equal((await request(`/auth/verify-email?token=${token}`)).status, 200);

  t.mock.timers.tick(899_999);
  assert.equal((await resend()).status, 429);
  t.mock.timers.tick(1);
  const resumed = await resend();
  assert.equal(resumed.status, 400);
  assert.equal(resumed.body.code, "EMAIL_ALREADY_VERIFIED");
});

test("client IPs have independent login and general allowances behind the trusted proxy", async () => {
  for (let attempt = 0; attempt < 30; attempt++) await login();
  // With one trusted proxy, earlier forwarded entries cannot change the client key.
  assert.equal((await login({ ip: `203.0.113.10, ${clientIp}` })).status, 429);
  assert.equal((await login({ ip: "198.51.100.42" })).status, 403);

  for (let attempt = 0; attempt < 569; attempt++) {
    assert.equal((await request("/auth/health")).status, 200);
  }
  assert.equal((await request("/auth/health")).status, 429);
  assert.equal((await request("/auth/health", { ip: "198.51.100.42" })).status, 200);
});
