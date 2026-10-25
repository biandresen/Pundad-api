import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { createIntegrationDatabase, integrationEnabled } from "./helpers/integrationDatabase.js";

describe("development badge and leaderboard demo fixtures", { skip: !integrationEnabled }, () => {
  let database, prisma, demo, leaderboard, users, servicePrisma, existing, post;
  const now = new Date("2026-10-25T12:00:00.000Z");

  before(async () => {
    database = await createIntegrationDatabase("badge_demo");
    prisma = database.prisma;
    demo = await import("../src/config/badgeLeaderboardDemo.js");
    leaderboard = await import("../src/services/leaderboardService.js");
    users = (await import("../src/services/userService.js")).default;
    servicePrisma = (await import("../src/config/prismaClient.js")).default;
  });
  after(async () => {
    await servicePrisma?.$disconnect();
    await database?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
    existing = await prisma.user.create({ data: {
      username: "existing-account", email: "existing@example.test", password: "untouched",
    } });
    post = await prisma.joke.create({ data: {
      authorId: existing.id, title: "Existing joke", body: "Keep this", published: true,
    } });
  });

  test("seeding produces distinct NO/EN rankings and active/history fixtures while preserving existing accounts and jokes", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now });
    await demo.seedBadgeLeaderboardDemo(prisma, { now });
    const rows = async (language) => (await leaderboard.getLeaderboardUsers({ language, period: "month" }))
      .map((row) => [row.user.username, row.featuredScore]);
    assert.deepEqual(await rows("NO"), [
      ["demo_badge_alex", 9], ["demo_badge_blair", 5], ["demo_badge_drew", 4], ["demo_badge_casey", 3],
    ]);
    assert.deepEqual(await rows("EN"), [
      ["demo_badge_casey", 9], ["demo_badge_drew", 5], ["demo_badge_blair", 4], ["demo_badge_alex", 3],
    ]);
    const alex = await prisma.user.findUnique({ where: { username: "demo_badge_alex" } });
    assert.equal(alex.emailVerified, true);
    const noBadges = (await users.getUserById(alex.id, { language: "NO" })).currentBadges;
    assert.deepEqual(noBadges.map((badge) => badge.badge).sort(), ["JOKE_OF_DAY", "STREAK", "TOP_CREATOR_MONTH"]);
    const enBadges = (await users.getUserById(alex.id, { language: "EN" })).currentBadges;
    assert.deepEqual(enBadges.map((badge) => badge.badge), ["FASTEST_GROWING"]);
    assert.ok(await prisma.badgeAward.count({ where: { userId: alex.id, language: "NO" } }) > 15);
    assert.deepEqual(await prisma.user.findUnique({ where: { id: existing.id } }), existing);
    assert.deepEqual(await prisma.joke.findUnique({ where: { id: post.id } }), post);
    assert.equal(await prisma.featuredAwardWindow.count(), 0);
    assert.equal(await prisma.featuredJoke.count(), 0);
  });

  test("rerunning the seed does not accumulate fixtures and cleanup preserves unrelated data", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now });
    await demo.seedBadgeLeaderboardDemo(prisma, { now });
    const counts = async () => ({
      users: await prisma.user.count(), jokes: await prisma.joke.count(),
      awards: await prisma.badgeAward.count(), badges: await prisma.currentUserBadge.count(),
      likes: await prisma.jokeLike.count(), comments: await prisma.comment.count(),
    });
    const original = await prisma.user.findUnique({ where: { username: "existing-account" } });
    const tokenDates = { issuedAt: now, expiresAt: new Date("2026-10-26T12:00:00Z") };
    const originalToken = await prisma.refreshToken.create({ data: {
      userId: original.id, token: "unrelated-session-fixture", ...tokenDates,
    } });
    const addDemoTokens = async () => {
      const account = await prisma.user.findUnique({ where: { username: "demo_badge_alex" } });
      await prisma.refreshToken.create({ data: { userId: account.id, token: "demo-session-fixture", ...tokenDates } });
      await prisma.resetPasswordToken.create({ data: { userId: account.id, token: "demo-reset-fixture", ...tokenDates } });
    };
    await addDemoTokens();
    const before = await counts();
    await demo.seedBadgeLeaderboardDemo(prisma, { now });
    assert.deepEqual(await counts(), before);
    assert.equal(await prisma.refreshToken.count(), 1);
    assert.equal(await prisma.resetPasswordToken.count(), 0);
    await addDemoTokens();
    assert.deepEqual(await demo.clearBadgeLeaderboardDemo(prisma), { removedAccounts: 4 });
    assert.deepEqual(await prisma.refreshToken.findUnique({ where: { id: originalToken.id } }), originalToken);
    assert.equal(await prisma.refreshToken.count(), 1);
    assert.equal(await prisma.resetPasswordToken.count(), 0);
    assert.deepEqual(await counts(), { users: 1, jokes: 1, awards: 0, badges: 0, likes: 0, comments: 0 });
    assert.deepEqual(await demo.clearBadgeLeaderboardDemo(prisma), { removedAccounts: 0 });
    assert.equal((await prisma.joke.findFirst()).body, "Keep this");
  });

  test("a colliding account causes an atomic abort rather than overwriting that account", async () => {
    const collision = await prisma.user.create({ data: {
      username: "demo_badge_alex", email: "not-a-demo@example.test", password: "preserve-me",
    } });
    await assert.rejects(demo.seedBadgeLeaderboardDemo(prisma, { now }), /outside this fixture/);
    await assert.rejects(demo.clearBadgeLeaderboardDemo(prisma), /outside this fixture/);
    assert.deepEqual(await prisma.user.findUnique({ where: { id: collision.id } }), collision);
    assert.equal(await prisma.user.count(), 2);
    assert.equal(await prisma.joke.count(), 1);
    await prisma.user.delete({ where: { id: collision.id } });
  });

  test("demo commands reject non-development environments and database targets without exposing their URL", () => {
    const valid = { APP_ENV: "development", NODE_ENV: "development",
      DATABASE_URL: "postgresql://pundad_dev:fixture@127.0.0.1:5432/pundad_dev?schema=public" };
    assert.doesNotThrow(() => demo.assertBadgeDemoDevelopmentEnvironment(valid));
    for (const override of [
      { NODE_ENV: "production" }, { APP_ENV: "staging" },
      { DATABASE_URL: "postgresql://prod:private-fixture@127.0.0.1/jokedb" },
      { DATABASE_URL: "postgresql://pundad_dev:private-fixture@remote.example/pundad_dev" },
      { DATABASE_URL: valid.DATABASE_URL.replace("public", "other_schema") },
      { DATABASE_URL: "invalid" },
    ]) {
      assert.throws(() => demo.assertBadgeDemoDevelopmentEnvironment({ ...valid, ...override }), (error) => {
        assert.match(error.message, /require the local development/);
        assert.doesNotMatch(error.message, /private-fixture|remote\.example|jokedb/);
        return true;
      });
    }
  });
});
