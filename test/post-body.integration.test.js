import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import jwt from "jsonwebtoken";
import { createIntegrationDatabase, integrationEnabled } from "./helpers/integrationDatabase.js";

describe("post body HTTP validation and persistence", { skip: !integrationEnabled }, () => {
  let database, prisma, servicePrisma, server, base, moderation;
  let author;
  let client = 0;
  const instant = new Date("2026-10-25T12:00:00.000Z");

  before(async () => {
    database = await createIntegrationDatabase("body_limits");
    prisma = database.prisma;
    process.env.LOG_LEVEL = "silent";
    process.env.NODE_ENV = "test";
    process.env.JWT_ACCESS_SECRET = "post-regression-test-fixture";
    ({ default: servicePrisma } = await import("../src/config/prismaClient.js"));
    ({ default: moderation } = await import("../src/services/moderationService.js"));
    const { default: app } = await import("../src/app.js");
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
    mock.timers.enable({ apis: ["Date"], now: instant });
  });

  after(async () => {
    mock.timers.reset();
    if (server) {
      server.close();
      await once(server, "close");
    }
    await servicePrisma?.$disconnect();
    await database?.close();
  });

  beforeEach(async () => {
    mock.timers.setTime(instant.getTime());
    delete process.env.FASTEST_GROWING_DAILY_START_UTC;
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User", "Tag", "ModerationTerm" RESTART IDENTITY CASCADE');
    await prisma.featuredAwardWindow.deleteMany();
    author = await prisma.user.create({ data: { username: "author", email: "author@example.test", password: "fixture" } });
    await moderation.loadModerationTerms();
  });

  async function request(path, { user, language = "NO", method = "GET", body } = {}) {
    const token = user ? jwt.sign({ id: user.id, role: user.role }, process.env.JWT_ACCESS_SECRET) : null;
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json", ...(language ? { "X-App-Language": language } : {}),
        "X-Forwarded-For": `198.51.${Math.floor(++client / 250)}.${client % 250 + 1}`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { ...(await response.json()), status: response.status };
  }

  test("invalid publishing, drafts and updates return body errors without storing changes", async () => {
    for (const language of ["NO", "EN"]) {
      const valid = { title: "Body fixture", body: "Setup\n\nPunchline", published: false, tags: [] };
      const created = await request("/jokes", { method: "POST", user: author, language, body: valid });
      assert.equal(created.status, 200);
      const path = `/jokes/${created.data.id}`;
      const original = (await request(path, { user: author, language })).data;
      for (const invalid of [Array(51).fill("x").join("\n"), "Setup\n\n\nPunchline", "Setup\r\n\r\r\n", "x".repeat(10001), " ", null, []]) {
        for (const published of [false, true]) {
          const payload = { ...valid, body: invalid, published };
          const before = await request("/jokes/drafts", { user: author, language });
          const publishedBefore = await request("/jokes", { language });
          for (const [url, method] of [["/jokes", "POST"], [path, "PATCH"]]) {
            const rejected = await request(url, { method, user: author, language, body: payload });
            assert.equal(rejected.status, 400, `${method} ${url}: ${JSON.stringify(invalid)}`);
            assert.equal(rejected.errors[0].field, "body");
          }
          assert.deepEqual((await request(path, { user: author, language })).data, original);
          assert.deepEqual((await request("/jokes/drafts", { user: author, language })).data, before.data);
          assert.deepEqual((await request("/jokes", { language })).data, publishedBefore.data);
        }
      }
    }
  });
  test("publishing a legacy invalid draft rejects its stored body and preserves the draft", async () => {
    const legacy = await prisma.joke.create({ data: { authorId: author.id, title: "Legacy draft", body: "Setup\n\n\nPunchline", language: "NO", published: false } });
    const path = `/jokes/${legacy.id}`;
    const original = (await request(path, { user: author })).data;
    const rejected = await request(`${path}/publish`, { method: "PATCH", user: author });
    assert.equal(rejected.status, 400);
    assert.deepEqual(rejected.errors, [{ field: "body", message: "Body must not contain three consecutive newlines" }]);
    assert.deepEqual((await request(path, { user: author })).data, original);
    const repaired = await request(path, { method: "PATCH", user: author, body: { title: legacy.title, body: "Setup\n\nPunchline", published: false } });
    assert.equal(repaired.status, 200);
    assert.equal((await request(`${path}/publish`, { method: "PATCH", user: author })).status, 200);
    assert.equal((await request(path)).data.published, true);
  });

  test("create and edit preserve valid normalized formatting and accept exact limits", async () => {
    for (const language of ["NO", "EN"]) {
      for (const [input, expected] of [
        ["\r\nSetup\r\n\rPunchline\r", "\nSetup\n\nPunchline\n"],
        [Array(50).fill("x").join("\r\n"), Array(50).fill("x").join("\n")],
        ["x".repeat(9998) + "\r\n\r\n", "x".repeat(9998) + "\n\n"],
      ]) {
        const created = await request("/jokes", { method: "POST", user: author, language, body: { title: "Boundary fixture", body: input, published: false } });
        assert.equal(created.status, 200);
        assert.equal(created.data.body, expected);
        const path = `/jokes/${created.data.id}`;
        const edited = await request(path, { method: "PATCH", user: author, language, body: { title: "Edited boundary", body: input, published: true } });
        assert.equal(edited.status, 200);
        assert.equal((await request(path, { language })).data.body, expected);
      }
    }
  });

});
