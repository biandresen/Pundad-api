import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, mock, test } from "node:test";
import { FeatureType, Prisma } from "@prisma/client";

let databaseAvailable = true;
mock.module("@prisma/client", { namedExports: {
  FeatureType, Prisma,
  PrismaClient: class {
    async $queryRaw() {
      if (!databaseAvailable) throw new Error("private database diagnostic");
      return [{ result: 1 }];
    }
  },
} });
process.env.LOG_LEVEL = "silent";
process.env.NODE_ENV = "production";
const { default: app } = await import("../src/app.js");
let server;
let base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}/api/v1/auth`;
});
after(async () => { server.close(); await once(server, "close"); });

test("readiness succeeds when the database responds", async () => {
  assert.equal((await fetch(`${base}/ready`)).status, 200);
});

test("readiness fails without exposing database diagnostics while liveness still succeeds", async () => {
  databaseAvailable = false;
  const response = await fetch(`${base}/ready`);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private database diagnostic/);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});
