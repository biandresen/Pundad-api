import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createIntegrationDatabase, integrationEnabled } from "./helpers/integrationDatabase.js";

test("leaderboard contracts, UTC periods, scoring and eligibility", { skip: !integrationEnabled }, async (t) => {
  const db = await createIntegrationDatabase("leaderboard");
  process.env.LOG_LEVEL = "silent";
  const { default: prisma } = await import("../src/config/prismaClient.js");
  const { getLeaderboardUsers } = await import("../src/services/leaderboardService.js");
  const { default: app } = await import("../src/app.js");
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api/v1/leaderboard/users`;
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
    await db.close();
  });
  const now = new Date("2026-03-01T12:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now });
  let serial = 0;
  const user = (username, extra = {}) => db.prisma.user.create({ data: {
    username, email: `leaderboard-${++serial}@example.test`, password: "unused-test-hash", ...extra,
  } });
  const award = (userId, badge, awardedAt = now, language = "NO") => db.prisma.badgeAward.create({ data: {
    userId, badge, awardedAt, language,
    validFrom: new Date(now.getTime() - ++serial * 1000),
  } });
  const joke = (authorId, language = "NO") => db.prisma.joke.create({ data: {
    authorId, language, title: "Fixture", body: "Deterministic fixture", published: true,
  } });
  const clear = async () => {
    await db.prisma.joke.deleteMany();
    await db.prisma.user.deleteMany();
  };
  const names = (rows) => rows.map((row) => row.user.username);
  t.beforeEach(clear);

  await t.test("HTTP honors week, month, all, defaults and safe limits with UTC end exclusivity", async () => {
    const fixtures = [
      ["A_month", "2026-03-01T00:00:00.000Z"],
      ["B_week", "2026-02-23T00:00:00.000Z"],
      ["C_old", "2026-02-22T23:59:59.999Z"],
      ["D_weekEnd", "2026-03-02T00:00:00.000Z"],
      ["E_monthEnd", "2026-04-01T00:00:00.000Z"],
    ];
    for (const [name, at] of fixtures) await award((await user(name)).id, "JOKE_OF_DAY", new Date(at));
    for (const [query, expected] of [
      ["", ["A_month", "D_weekEnd"]],
      ["?period=month", ["A_month", "D_weekEnd"]],
      ["?period=week", ["A_month", "B_week"]],
      ["?period=all", fixtures.map(([name]) => name)],
      ["?period=all&limit=1", ["A_month"]],
      ["?period=all&limit=100", fixtures.map(([name]) => name)],
    ]) {
      const response = await fetch(base + query);
      assert.equal(response.status, 200, query);
      assert.deepEqual(names((await response.json()).data), expected, query);
    }
    const english = await fetch(base + "?period=all&lang=EN");
    assert.deepEqual((await english.json()).data, []);
    for (const query of [
      "period=year", "period=", "limit=0", "limit=101", "limit=-1", "limit=1.5",
      "limit=no", "limit=", "period=week&period=month", "limit=1&limit=2",
    ]) {
      const response = await fetch(`${base}?${query}`);
      assert.equal(response.status, 400, query);
      assert.equal((await response.json()).message, "Validation failed");
    }
    await clear();
  });

  await t.test("daily Fastest Growing scores use the earned UTC day while legacy awards retain awardedAt", async () => {
    for (const [name, earned, at] of [
      ["dailyPrevious", "2026-02-28T00:00:00Z", "2026-03-02T00:00:00Z"],
      ["dailyCurrent", "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z"],
      ["legacy", null, "2026-03-01T00:00:00Z"],
    ]) {
      await db.prisma.badgeAward.create({ data: {
        userId: (await user(name)).id, badge: "FASTEST_GROWING", language: "NO",
        awardedAt: new Date(at), scoringWindowStart: earned ? new Date(earned) : null,
      } });
    }
    assert.deepEqual(names(await getLeaderboardUsers({ period: "month" })), ["dailyCurrent", "legacy"]);
    assert.deepEqual(names(await getLeaderboardUsers({ period: "week" })), ["dailyCurrent", "dailyPrevious", "legacy"]);
    const all = await getLeaderboardUsers({ period: "all" });
    assert.deepEqual(names(all), ["dailyCurrent", "dailyPrevious", "legacy"]);
    assert.deepEqual(all.map((row) => row.featuredScore), [3, 3, 3]);
    await clear();
  });

  await t.test("all five badge weights contribute their specified points", async () => {
    const author = await user("weighted");
    for (const badge of ["TOP_CREATOR_MONTH", "JOKE_OF_DAY", "FASTEST_GROWING", "TRENDING_WEEK", "MOST_COMMENTED_WEEK"])
      await award(author.id, badge);
    const [row] = await getLeaderboardUsers({ period: "month", language: "NO" });
    assert.equal(row.featuredScore, 17);
    assert.equal(row.winsTotal, 5);
    assert.deepEqual(row.winsByBadge, {
      TOP_CREATOR_MONTH: 1, JOKE_OF_DAY: 1, FASTEST_GROWING: 1, TRENDING_WEEK: 1, MOST_COMMENTED_WEEK: 1,
    });
    await clear();
  });

  await t.test("earned streak bonuses qualify viewers without counting as featured wins or rewarding legacy streak badges", async () => {
    const viewer = await user("bonusOnly", { dailyJokeStreak: 365 });
    const legacy = await user("legacyOnly", { dailyJokeStreak: 999 });
    await award(viewer.id, "STREAK_BONUS");
    await award(legacy.id, "STREAK");
    const response = await fetch(`${base}?period=month&lang=NO`);
    assert.equal(response.status, 200);
    const rows = (await response.json()).data;
    assert.deepEqual(names(rows), ["bonusOnly"]);
    assert.equal(rows[0].featuredScore, 1);
    assert.equal(rows[0].streakBonusPoints, 1);
    assert.equal(rows[0].winsTotal, 0);
    assert.deepEqual(rows[0].winsByBadge, {});
    assert.equal(rows[0].dailyStreak, 365);
    assert.deepEqual(names(await getLeaderboardUsers({ language: "EN" })), []);
    await clear();
  });

  await t.test("bonus points follow awardedAt UTC periods and requested language while historical points remain", async () => {
    const fixtures = [
      ["A_month", "2026-03-01T00:00:00.000Z"],
      ["B_week", "2026-02-23T00:00:00.000Z"],
      ["C_old", "2026-02-22T23:59:59.999Z"],
      ["D_weekEnd", "2026-03-02T00:00:00.000Z"],
      ["E_monthEnd", "2026-04-01T00:00:00.000Z"],
    ];
    let bilingual;
    for (const [name, at] of fixtures) {
      const viewer = await user(name);
      if (name === "A_month") bilingual = viewer;
      await db.prisma.badgeAward.create({ data: {
        userId: viewer.id, badge: "STREAK_BONUS", language: "NO", awardedAt: new Date(at),
        // Period attribution uses the milestone instant, independent of its validity start.
        validFrom: new Date("2026-02-01T00:00:00.000Z"),
      } });
    }
    await award(bilingual.id, "STREAK_BONUS", now, "EN");
    for (const [period, expected] of [
      ["week", ["A_month", "B_week"]],
      ["month", ["A_month", "D_weekEnd"]],
      ["all", fixtures.map(([name]) => name)],
    ]) {
      const rows = await getLeaderboardUsers({ language: "NO", period });
      assert.deepEqual(names(rows), expected, period);
      assert.deepEqual(rows.map((row) => row.streakBonusPoints), Array(expected.length).fill(1));
      assert.ok(rows.every((row) => row.featuredScore === 1 && row.winsTotal === 0));
      assert.ok(rows.every((row) => row.user.currentBadges.length === 0), "historical bonus points need no active badge");
    }
    const english = await getLeaderboardUsers({ language: "EN", period: "all" });
    assert.deepEqual(names(english), ["A_month"]);
    assert.equal(english[0].streakBonusPoints, 1, "NO milestone must not add EN points");
    assert.equal((await getLeaderboardUsers({ language: "NO", period: "all" })).length, 5,
      "period changes preserve previously earned bonus history");
    await clear();
  });

  await t.test("combined points rank first and featured wins resolve ties without treating bonuses as wins", async () => {
    const featureWinner = await user("z_feature");
    const bonusOnly = await user("a_bonus");
    const mixed = await user("middle_mixed");
    const morePoints = await user("top_bonus");
    await award(featureWinner.id, "JOKE_OF_DAY");
    await award(mixed.id, "MOST_COMMENTED_WEEK");
    for (const [viewer, count] of [[bonusOnly, 4], [mixed, 2], [morePoints, 5]]) {
      for (let index = 0; index < count; index++) {
        await award(viewer.id, "STREAK_BONUS", new Date(now.getTime() - index * 7 * 86_400_000));
      }
    }
    const rows = await getLeaderboardUsers({ language: "NO", period: "all" });
    assert.deepEqual(names(rows), ["top_bonus", "middle_mixed", "z_feature", "a_bonus"]);
    assert.deepEqual(rows.map((row) => [row.featuredScore, row.streakBonusPoints, row.winsTotal]), [
      [5, 5, 0], [4, 2, 1], [4, 0, 1], [4, 4, 0],
    ]);
    assert.deepEqual(rows[1].winsByBadge, { MOST_COMMENTED_WEEK: 1 });
    assert.deepEqual(rows[3].winsByBadge, {});
    await clear();
  });

  await t.test("scoring fields and final username/ID ties order consistently while global streak is display only", async () => {
    const fixtures = [
      ["score", ["TOP_CREATOR_MONTH"], 0, 0, 0],
      ["wins", ["MOST_COMMENTED_WEEK", "MOST_COMMENTED_WEEK"], 0, 0, 0],
      ["likes", ["JOKE_OF_DAY"], 2, 0, 0],
      ["comments", ["JOKE_OF_DAY"], 1, 2, 0],
      ["Alpha", ["JOKE_OF_DAY"], 1, 1, 0],
      ["alpha", ["JOKE_OF_DAY"], 1, 1, 100],
      ["zeta", ["JOKE_OF_DAY"], 1, 1, 999],
    ];
    const viewer = await user("viewer");
    for (const [name, badges, likes, comments, streak] of fixtures) {
      const author = await user(name, { dailyJokeStreak: streak });
      for (const badge of badges) await award(author.id, badge);
      for (let i = 0; i < likes; i++) await db.prisma.jokeLike.create({ data: {
        jokeId: (await joke(author.id)).id, userId: viewer.id, createdAt: now,
      } });
      for (let i = 0; i < comments; i++) await db.prisma.comment.create({ data: {
        jokeId: (await joke(author.id)).id, authorId: viewer.id, body: "Fixture comment", createdAt: now,
      } });
    }
    const expected = fixtures.map(([name]) => name);
    for (let i = 0; i < 3; i++) {
      const rows = await getLeaderboardUsers({ period: "all", language: "NO" });
      assert.deepEqual(names(rows), expected);
      assert.equal(rows.at(-1).dailyStreak, 999);
      assert.deepEqual(names(await getLeaderboardUsers({ period: "all", limit: 5 })), expected.slice(0, 5));
    }
    await clear();
  });

  await t.test("inactive/deleted users are absent, administrators follow ordinary rules and global-streak-only users stay excluded", async () => {
    for (const [name, extra] of [
      ["active", {}], ["admin", { role: "ADMIN" }], ["inactive", { active: false }],
      ["deleted", { deletedAt: now }], ["streakOnly", { dailyJokeStreak: 365 }],
    ]) {
      const candidate = await user(name, extra);
      if (name !== "streakOnly") await award(candidate.id, "JOKE_OF_DAY");
    }
    assert.deepEqual(names(await getLeaderboardUsers({ language: "NO" })), ["active", "admin"]);
    assert.equal(await db.prisma.badgeAward.count(), 4);
    for (const [name, extra] of [["inactiveBonus", { active: false }], ["deletedBonus", { deletedAt: now }]]) {
      await award((await user(name, extra)).id, "STREAK_BONUS");
    }
    assert.deepEqual(names(await getLeaderboardUsers({ language: "NO" })), ["active", "admin"]);
    await clear();
  });

  await t.test("NO/EN ranking and badge validity isolate languages and exact validity boundaries", async () => {
    const author = await user("bilingual", { dailyJokeStreak: 50 });
    const english = await user("englishOnly");
    await award(author.id, "JOKE_OF_DAY");
    await award(author.id, "MOST_COMMENTED_WEEK", now, "EN");
    await award(english.id, "TOP_CREATOR_MONTH", now, "EN");
    const before = new Date(now.getTime() - 1000);
    const after = new Date(now.getTime() + 1000);
    await db.prisma.currentUserBadge.createMany({ data: [
      { userId: author.id, badge: "TRENDING_WEEK", language: "NO", since: now, validTo: after },
      { userId: author.id, badge: "FASTEST_GROWING", language: "NO", since: before, validTo: now },
      { userId: author.id, badge: "TOP_CREATOR_MONTH", language: "NO", since: after },
      { userId: author.id, badge: "MOST_COMMENTED_WEEK", language: "EN", since: before },
      { userId: author.id, badge: "ADMIN", language: "NO", since: before },
      { userId: author.id, badge: "JOKE_OF_DAY", language: "NO", since: new Date("2026-02-28T00:00:00Z") },
    ] });
    const [no] = await getLeaderboardUsers({ language: "NO" });
    assert.equal(no.featuredScore, 4);
    assert.deepEqual(no.user.currentBadges.map((badge) => badge.badge).sort(), ["ADMIN", "TRENDING_WEEK"]);
    const en = await getLeaderboardUsers({ language: "EN" });
    assert.deepEqual(names(en), ["englishOnly", "bilingual"]);
    assert.deepEqual(en[1].user.currentBadges.map((badge) => badge.badge), ["MOST_COMMENTED_WEEK"]);
    await clear();
  });

  await t.test("likes/comments obey selected UTC periods and language even without awards", async () => {
    const receiver = await user("receiver");
    const viewer = await user("engager");
    for (const [language, timestamp] of [
      ["NO", "2026-02-23T00:00:00Z"], ["NO", "2026-03-01T00:00:00Z"],
      ["NO", "2026-03-02T00:00:00Z"], ["EN", "2026-03-01T00:00:00Z"],
    ]) {
      const post = await joke(receiver.id, language);
      const createdAt = new Date(timestamp);
      await db.prisma.jokeLike.create({ data: { jokeId: post.id, userId: viewer.id, createdAt } });
      await db.prisma.comment.create({ data: { jokeId: post.id, authorId: viewer.id, body: "Fixture", createdAt } });
    }
    for (const [period, expected] of [["week", 2], ["month", 2], ["all", 3]]) {
      const [row] = await getLeaderboardUsers({ period, language: "NO" });
      assert.equal(row.featuredScore, 0);
      assert.equal(row.likesReceived, expected);
      assert.equal(row.commentsReceived, expected);
    }
    const [row] = await getLeaderboardUsers({ period: "all", language: "EN" });
    assert.equal(row.likesReceived, 1);
    assert.equal(row.commentsReceived, 1);
    await clear();
  });
});
