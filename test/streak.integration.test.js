import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import jwt from "jsonwebtoken";
import { createIntegrationDatabase, integrationEnabled } from "./helpers/integrationDatabase.js";

describe("language-specific seven-day streak bonus HTTP contract", { skip: !integrationEnabled }, () => {
  let database, prisma, servicePrisma, server, base, viewer, dailyJokes;
  let client = 0;
  const firstDay = new Date("2026-10-26T12:00:00.000Z");

  before(async () => {
    database = await createIntegrationDatabase("streak");
    prisma = database.prisma;
    process.env.LOG_LEVEL = "silent";
    process.env.NODE_ENV = "test";
    process.env.JWT_ACCESS_SECRET = "streak-bonus-test-fixture";
    ({ default: servicePrisma } = await import("../src/config/prismaClient.js"));
    const { default: app } = await import("../src/app.js");
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
    mock.timers.enable({ apis: ["Date"], now: firstDay });
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
    mock.timers.setTime(firstDay.getTime());
    process.env.STREAK_BONUS_START_UTC = "2026-10-26";
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
    viewer = await prisma.user.create({ data: {
      username: "viewer", email: "viewer@example.test", password: "fixture",
      dailyJokeStreak: 365, dailyJokeBestStreak: 365,
      dailyJokeLastViewedAt: new Date("2026-10-25T12:00:00.000Z"),
    } });
    const provider = await prisma.user.create({ data: {
      username: "daily_provider", email: "daily-provider@example.test", password: "fixture",
    } });
    dailyJokes = {};
    for (const language of ["NO", "EN"]) {
      dailyJokes[language] = await prisma.joke.create({ data: {
        authorId: provider.id, language, title: "Daily title", body: "Daily fixture", published: true,
      } });
    }
  });

  async function request(path, { language = "NO", user = viewer, method = "GET" } = {}) {
    const token = user ? jwt.sign({ id: user.id, role: user.role }, process.env.JWT_ACCESS_SECRET) : null;
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json", "X-App-Language": language,
        "X-Forwarded-For": `203.0.${Math.floor(++client / 250)}.${client % 250 + 1}`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    return { ...(await response.json()), status: response.status };
  }
  const view = async (language = "NO", { dailyFeature = true } = {}) => {
    if (dailyFeature) {
      const date = new Date(Date.now());
      date.setUTCHours(0, 0, 0, 0);
      await prisma.featuredJoke.upsert({
        where: { type_date_language: { type: "DAILY_JOKE", date, language } },
        update: { jokeId: dailyJokes[language].id },
        create: { type: "DAILY_JOKE", date, language, jokeId: dailyJokes[language].id },
      });
    }
    return request("/jokes/daily/view", { language, method: "POST" });
  };
  const progress = (language = "NO") => request("/jokes/daily/streak", { language });
  const history = async (language = "NO") => (await request("/badges/me/history", { language })).data;
  const at = (iso) => mock.timers.setTime(new Date(iso).getTime());
  async function recordDays(count, languages = ["NO"], start = firstDay) {
    let response;
    for (let day = 0; day < count; day++) {
      mock.timers.setTime(start.getTime() + day * 86_400_000);
      for (const language of languages) {
        response = await view(language);
        assert.equal(response.status, 200);
      }
    }
    return response;
  }

  test("first eligible view starts bonus progress at one without backfilling the existing global streak", async () => {
    const response = await view();
    assert.equal(response.status, 200);
    assert.equal(response.data.dailyJokeStreak, 366);
    assert.ok(response.data.streakBonus, "daily view must expose its language-specific bonus progress");
    assert.equal(response.data.streakBonus.language, "NO");
    assert.equal(response.data.streakBonus.streak, 1);
    assert.equal(response.data.streakBonus.awarded, false);
    assert.equal(response.data.streakBonus.daysUntilBonus, 6);
    assert.deepEqual((await request("/badges/me/history")).data, []);
  });

  test("missing, prior-day, draft and wrong-language daily features cannot advance bonus progress", async () => {
    const provider = await prisma.user.create({ data: { username: "source", email: "source@example.test", password: "fixture" } });
    const published = await prisma.joke.create({ data: { authorId: provider.id, language: "NO", title: "Published", body: "Daily fixture", published: true } });
    const draft = await prisma.joke.create({ data: { authorId: provider.id, language: "NO", title: "Draft", body: "Daily fixture", published: false } });
    const english = await prisma.joke.create({ data: { authorId: provider.id, language: "EN", title: "English", body: "Daily fixture", published: true } });
    for (const feature of [
      null,
      { date: new Date("2026-10-25T00:00:00.000Z"), language: "NO", jokeId: published.id },
      { date: new Date("2026-10-26T00:00:00.000Z"), language: "NO", jokeId: draft.id },
      { date: new Date("2026-10-26T00:00:00.000Z"), language: "EN", jokeId: english.id },
      { date: new Date("2026-10-26T00:00:00.000Z"), language: "NO", jokeId: english.id },
    ]) {
      await prisma.featuredJoke.deleteMany();
      if (feature) await prisma.featuredJoke.create({ data: { type: "DAILY_JOKE", ...feature } });
      const response = await view("NO", { dailyFeature: false });
      assert.equal(response.status, 200);
      assert.equal(response.data.dailyJokeStreak, 366, "legacy global view behavior is preserved");
      assert.equal(response.data.streakBonus.streak, 0, "bonus needs today's published Joke of the Day in this language");
      assert.equal(response.data.streakBonus.awarded, false);
      assert.equal((await progress()).data.streak, 0);
      assert.deepEqual(await history(), []);
    }
  });

  test("an unavailable seventh day's joke grants no bonus and a later real view cannot bridge the gap", async () => {
    await recordDays(6);
    at("2026-11-01T12:00:00.000Z");
    const unavailable = await view("NO", { dailyFeature: false });
    assert.equal(unavailable.status, 200);
    assert.equal(unavailable.data.dailyJokeStreak, 372, "global view behavior stays unchanged");
    assert.equal(unavailable.data.streakBonus.streak, 6);
    assert.equal(unavailable.data.streakBonus.viewedToday, false);
    assert.equal(unavailable.data.streakBonus.awarded, false);
    assert.deepEqual(await history(), []);
    at("2026-11-02T12:00:00.000Z");
    const resumed = await view();
    assert.equal(resumed.data.dailyJokeStreak, 373);
    assert.equal(resumed.data.streakBonus.streak, 1);
    assert.equal(resumed.data.streakBonus.awarded, false);
    assert.deepEqual(await history(), []);
    const seventhReal = await recordDays(6, ["NO"], new Date("2026-11-03T12:00:00.000Z"));
    assert.equal(seventhReal.data.streakBonus.streak, 7);
    assert.equal(seventhReal.data.streakBonus.awarded, true);
    assert.equal((await history())[0].validFrom, "2026-11-08T00:00:00.000Z");
  });

  test("bonus starts prospectively, remains disabled or scheduled before activation, and requires authentication", async () => {
    for (const [path, method] of [["/jokes/daily/streak", "GET"], ["/jokes/daily/view", "POST"]]) {
      assert.equal((await request(path, { user: null, method })).status, 401);
    }
    delete process.env.STREAK_BONUS_START_UTC;
    const disabled = await progress();
    assert.equal(disabled.status, 200);
    assert.equal(disabled.data.status, "disabled");
    assert.equal(disabled.data.startsAt, null);
    assert.equal(disabled.data.streak, 0);
    assert.equal(disabled.data.daysUntilBonus, 7);
    assert.equal((await view()).data.streakBonus.awarded, false);
    assert.deepEqual(await history(), []);

    process.env.STREAK_BONUS_START_UTC = "2026-10-27";
    const scheduled = await progress();
    assert.equal(scheduled.data.status, "scheduled");
    assert.equal(scheduled.data.startsAt, "2026-10-27T00:00:00.000Z");
    assert.equal((await view()).data.streakBonus.streak, 0);
    at("2026-10-28T12:00:00.000Z");
    assert.equal((await progress()).data.streak, 0);
    const first = await view();
    assert.equal(first.data.streakBonus.streak, 1, "missing launch day does not create retroactive progress");
    assert.equal(first.data.streakBonus.awarded, false);
  });

  test("days seven and fourteen grant permanent one-point history without creating active badges", async () => {
    const sixth = await recordDays(6);
    assert.equal(sixth.data.streakBonus.streak, 6);
    assert.equal(sixth.data.streakBonus.daysUntilBonus, 1);
    assert.deepEqual(await history(), []);
    assert.equal((await progress("EN")).data.streak, 0);
    at("2026-11-01T12:00:00.000Z");
    const seventh = await view();
    assert.equal(seventh.data.streakBonus.streak, 7);
    assert.equal(seventh.data.streakBonus.awarded, true);
    assert.equal(seventh.data.streakBonus.daysUntilBonus, 7);
    const firstAward = (await history())[0];
    assert.equal(firstAward.badge, "STREAK_BONUS");
    assert.equal(firstAward.language, "NO");
    assert.equal(firstAward.validFrom, "2026-11-01T00:00:00.000Z");
    assert.equal(firstAward.validTo, null);
    assert.equal(firstAward.scoringWindowStart, null);
    assert.equal(firstAward.context.points, 1);
    assert.deepEqual((await request("/badges/me/current")).data, []);
    assert.equal((await view()).data.streakBonus.awarded, false);
    assert.deepEqual((await history()).map((award) => award.id), [firstAward.id]);
    const fourteenth = await recordDays(7, ["NO"], new Date("2026-11-02T12:00:00.000Z"));
    assert.equal(fourteenth.data.streakBonus.streak, 14);
    assert.equal(fourteenth.data.streakBonus.awarded, true);
    assert.equal(fourteenth.data.dailyJokeStreak, 379, "profile keeps the existing account-wide streak");
    assert.deepEqual((await history()).map((award) => award.validFrom).sort(), ["2026-11-01T00:00:00.000Z", "2026-11-08T00:00:00.000Z"]);
    assert.deepEqual(await history("EN"), []);
  });

  test("same-day retries and concurrent NO/EN views award once per language and increment the global streak once", async () => {
    await recordDays(6, ["NO", "EN"]);
    at("2026-11-01T00:00:00.000Z");
    const responses = await Promise.all([view("NO"), view("EN"), view("NO"), view("EN")]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.data.streakBonus.streak, 7);
      assert.equal(response.data.dailyJokeStreak, 372);
    }
    assert.equal(responses.filter((response) => response.data.streakBonus.awarded).length, 2);
    for (const language of ["NO", "EN"]) {
      const awards = await history(language);
      assert.equal(awards.length, 1);
      assert.equal(awards[0].language, language);
      const retry = await view(language);
      assert.equal(retry.data.streakBonus.awarded, false);
      assert.equal(retry.data.streakBonus.streak, 7);
      assert.equal((await history(language))[0].id, awards[0].id);
      assert.equal((await progress(language)).data.viewedToday, true);
    }
  });

  test("UTC midnight advances progress while repeated local hours at the DST boundary do not", async () => {
    process.env.STREAK_BONUS_START_UTC = "2026-10-24";
    await prisma.user.update({ where: { id: viewer.id }, data: {
      dailyJokeStreak: 0, dailyJokeLastViewedAt: null,
    } });
    at("2026-10-24T23:59:59.999Z");
    assert.equal((await view()).data.streakBonus.streak, 1);
    at("2026-10-25T00:00:00.000Z");
    assert.equal((await progress()).data.viewedToday, false);
    assert.equal((await view()).data.streakBonus.streak, 2);
    // These are both 02:30 in Oslo, on opposite sides of the autumn clock change.
    for (const instant of ["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]) {
      at(instant);
      const response = await view();
      assert.equal(response.data.streakBonus.streak, 2);
      assert.equal(response.data.dailyJokeStreak, 2);
      assert.equal(response.data.streakBonus.awarded, false);
    }
    at("2026-10-26T00:00:00.000Z");
    assert.equal((await view()).data.streakBonus.streak, 3);
    assert.deepEqual(await history(), []);
  });

  test("a missed UTC day resets bonus progress while earned history survives and the next reward still requires seven days", async () => {
    await recordDays(7);
    const original = (await history())[0];
    at("2026-11-03T12:00:00.000Z");
    const missed = await progress();
    assert.equal(missed.data.streak, 0);
    assert.equal(missed.data.bestStreak, 7);
    assert.equal(missed.data.daysUntilBonus, 7);
    const restarted = await view();
    assert.equal(restarted.data.streakBonus.streak, 1);
    assert.equal(restarted.data.streakBonus.awarded, false);
    assert.equal((await view()).data.streakBonus.streak, 1);
    assert.deepEqual((await history()).map((award) => award.id), [original.id]);
    const next = await recordDays(6, ["NO"], new Date("2026-11-04T12:00:00.000Z"));
    assert.equal(next.data.streakBonus.streak, 7);
    assert.equal(next.data.streakBonus.awarded, true);
    assert.equal(next.data.streakBonus.bestStreak, 7);
    assert.deepEqual((await history()).map((award) => award.validFrom).sort(), ["2026-11-01T00:00:00.000Z", "2026-11-09T00:00:00.000Z"]);
  });

  test("invalid, removed or changed policy configuration fails closed without changing progress or the global profile", async () => {
    await view();
    const initial = (await progress()).data;
    const profile = (await request("/user/me")).data;
    for (const changed of [undefined, "", "2026-10-25", "2026-10-27", "2026-02-30", "tomorrow"]) {
      if (changed === undefined) delete process.env.STREAK_BONUS_START_UTC;
      else process.env.STREAK_BONUS_START_UTC = changed;
      assert.equal((await progress()).status, 500);
      assert.equal((await view()).status, 500);
      process.env.STREAK_BONUS_START_UTC = "2026-10-26";
      assert.deepEqual((await progress()).data, initial);
      assert.deepEqual((await request("/user/me")).data, profile);
      assert.deepEqual(await history(), []);
    }
  });

  test("inactive and soft-deleted accounts cannot earn a milestone and can retry after restoration", async () => {
    await recordDays(6);
    at("2026-11-01T12:00:00.000Z");
    await prisma.user.update({ where: { id: viewer.id }, data: { active: false } });
    assert.equal((await progress()).status, 404);
    assert.equal((await view()).status, 404);
    assert.deepEqual(await history(), []);
    await prisma.user.update({ where: { id: viewer.id }, data: { active: true, deletedAt: firstDay } });
    assert.equal((await progress()).status, 404);
    assert.equal((await view()).status, 404);
    assert.deepEqual(await history(), []);
    await prisma.user.update({ where: { id: viewer.id }, data: { deletedAt: null } });
    assert.equal((await progress()).data.streak, 6);
    const resumed = await view();
    assert.equal(resumed.data.streakBonus.streak, 7);
    assert.equal(resumed.data.streakBonus.awarded, true);
    assert.equal((await history()).length, 1);
  });

  test("a failed milestone award rolls back language progress and global streak before a successful retry", async () => {
    await recordDays(6);
    at("2026-11-01T12:00:00.000Z");
    const initialProgress = (await progress()).data;
    const initialProfile = (await request("/user/me")).data;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_streak_bonus() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.badge = 'STREAK_BONUS' THEN RAISE EXCEPTION 'streak fixture failure'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_streak_bonus BEFORE INSERT ON "BadgeAward" FOR EACH ROW EXECUTE FUNCTION reject_streak_bonus()`);
    try {
      assert.equal((await view()).status, 500);
      assert.deepEqual((await progress()).data, initialProgress);
      assert.deepEqual((await request("/user/me")).data, initialProfile);
      assert.deepEqual(await history(), []);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER reject_streak_bonus ON "BadgeAward"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION reject_streak_bonus()`);
    }
    const retry = await view();
    assert.equal(retry.status, 200);
    assert.equal(retry.data.streakBonus.streak, 7);
    assert.equal(retry.data.streakBonus.awarded, true);
    assert.equal(retry.data.dailyJokeStreak, 372);
    assert.equal((await history()).length, 1);
    assert.equal((await view()).data.streakBonus.awarded, false);
  });

  test("viewer-only milestones qualify for one point each in the earned language and UTC period", async () => {
    const leaderboard = async (period, language = "NO") => (await request(`/leaderboard/users?period=${period}`, { language })).data;
    await recordDays(6);
    assert.deepEqual(await leaderboard("month"), [], "old global streak and six new views earn no points");
    at("2026-11-01T12:00:00.000Z");
    await view();
    const rows = await leaderboard("month");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user.id, viewer.id);
    assert.equal(rows[0].featuredScore, 1);
    assert.equal(rows[0].streakBonusPoints, 1);
    assert.equal(rows[0].winsTotal, 0, "streak bonuses are not featured wins");
    assert.equal(rows[0].likesReceived, 0);
    assert.equal(rows[0].commentsReceived, 0);
    assert.deepEqual(await leaderboard("all", "EN"), []);
    at("2026-11-02T00:00:00.000Z");
    assert.deepEqual(await leaderboard("week"), [], "last Sunday's milestone belongs to the previous UTC week");
    assert.equal((await leaderboard("month"))[0].featuredScore, 1);
    await recordDays(7, ["NO"], new Date("2026-11-02T12:00:00.000Z"));
    assert.equal((await leaderboard("week"))[0].featuredScore, 1);
    assert.equal((await leaderboard("month"))[0].featuredScore, 2);
    assert.equal((await leaderboard("all"))[0].featuredScore, 2);
    const twentyFirst = await recordDays(7, ["NO"], new Date("2026-11-09T12:00:00.000Z"));
    assert.equal(twentyFirst.data.streakBonus.streak, 21);
    assert.equal(twentyFirst.data.streakBonus.awarded, true);
    assert.equal((await leaderboard("month"))[0].featuredScore, 3);
    assert.equal((await leaderboard("week"))[0].featuredScore, 1);
  });
});
