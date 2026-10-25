import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import jwt from "jsonwebtoken";
import { createIntegrationDatabase, integrationEnabled } from "./helpers/integrationDatabase.js";

describe("badge projections and existing post/streak HTTP behavior", { skip: !integrationEnabled }, () => {
  let database, prisma, servicePrisma, server, base, moderation;
  let author, other;
  let client = 0;
  const instant = new Date("2026-10-25T12:00:00.000Z");

  before(async () => {
    database = await createIntegrationDatabase("post_regression");
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
    other = await prisma.user.create({ data: { username: "other", email: "other@example.test", password: "fixture" } });
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

  test("current badge, profile and joke reads agree on validity and language; history survives", async () => {
    const now = instant.getTime();
    const past = new Date(now - 86_400_000);
    await prisma.currentUserBadge.createMany({ data: [
      { userId: author.id, badge: "ADMIN", language: "NO", since: past },
      { userId: author.id, badge: "ADMIN", language: "EN", since: past },
      { userId: author.id, badge: "TOP_CREATOR_MONTH", language: "NO", since: past, validTo: instant },
      { userId: author.id, badge: "TRENDING_WEEK", language: "NO", since: new Date(now + 1) },
      { userId: author.id, badge: "MOST_COMMENTED_WEEK", language: "NO", since: instant, validTo: new Date(now + 1) },
      { userId: author.id, badge: "JOKE_OF_DAY", language: "NO", since: past },
      { userId: author.id, badge: "FASTEST_GROWING", language: "NO", since: past },
    ] });
    await prisma.badgeAward.create({ data: { userId: author.id, badge: "JOKE_OF_DAY", language: "NO", validFrom: past } });
    const joke = await prisma.joke.create({ data: { authorId: author.id, language: "NO", title: "A title", body: "A clean joke", published: true } });
    const keys = (badges) => badges.map((badge) => badge.badge).sort();
    const expected = ["ADMIN", "FASTEST_GROWING", "MOST_COMMENTED_WEEK"];
    assert.deepEqual(keys((await request("/badges/me/current", { user: author })).data), expected);
    assert.deepEqual(keys((await request("/user/me", { user: author })).data.currentBadges), expected);
    assert.deepEqual(keys((await request(`/jokes/${joke.id}`)).data.user.currentBadges), expected);
    assert.deepEqual(keys((await request("/badges/me/current", { user: author, language: "EN" })).data), ["ADMIN"]);
    assert.equal((await request("/badges/me/history", { user: author })).data[0].badge, "JOKE_OF_DAY");
    mock.timers.setTime(now + 1);
    assert.deepEqual(keys((await request("/badges/me/current", { user: author })).data), ["ADMIN", "FASTEST_GROWING", "TRENDING_WEEK"]);
  });

  test("legacy and explicit daily badges expire exactly at the next UTC midnight", async () => {
    const midnight = new Date("2026-10-26T00:00:00.000Z");
    for (const language of ["NO", "EN"]) {
      await prisma.currentUserBadge.create({ data: {
        userId: author.id, language, badge: "JOKE_OF_DAY", since: new Date("2026-10-25T00:00:00.000Z"),
        validTo: language === "EN" ? midnight : null,
      } });
    }
    mock.timers.setTime(midnight.getTime() - 1);
    for (const language of ["NO", "EN"]) {
      assert.equal((await request("/badges/me/current", { user: author, language })).data.length, 1);
    }
    mock.timers.setTime(midnight.getTime());
    for (const language of ["NO", "EN"]) {
      assert.deepEqual((await request("/badges/me/current", { user: author, language })).data, []);
    }
  });

  test("published and draft posts retain creation, editing, language and author permissions", async () => {
    const body = { title: "A clean title", body: "A clean body", published: true, tags: ["dad"] };
    assert.equal((await request("/jokes", { method: "POST", body })).status, 401);
    for (const language of ["NO", "EN"]) {
      const created = await request("/jokes", { method: "POST", user: author, language, body });
      assert.equal(created.status, 200);
      assert.equal(created.data.language, language);
      assert.equal(created.data.published, true);
      assert.equal(created.data.tags[0].language, language);
      const path = `/jokes/${created.data.id}`;
      assert.equal((await request(path, { method: "PATCH", user: other, language, body })).status, 403);
      assert.equal((await request(path, { method: "PATCH", user: author, language: language === "NO" ? "EN" : "NO", body })).status, 404);
      const edited = await request(path, { method: "PATCH", user: author, language, body: { ...body, title: "Edited title", tags: ["new"] } });
      assert.equal(edited.status, 200);
      assert.equal(edited.data.title, "Edited title");
      assert.deepEqual(edited.data.tags.map((tag) => tag.name), ["new"]);
      const draft = await request("/jokes", { method: "POST", user: author, language, body: { ...body, published: false } });
      assert.equal(draft.data.published, false);
      assert.equal((await request(`/jokes/${draft.data.id}`, { language })).status, 404);
      assert.equal((await request(`/jokes/${draft.data.id}`, { user: author, language })).status, 200);
      const editedDraft = await request(`/jokes/${draft.data.id}`, { method: "PATCH", user: author, language, body: { ...body, published: false } });
      assert.equal(editedDraft.status, 200);
      assert.equal(editedDraft.data.published, false);
    }
  });

  test("moderation continues blocking post creation and editing in both languages", async () => {
    await prisma.moderationTerm.create({ data: { term: "blockedfixture" } });
    await moderation.loadModerationTerms();
    for (const language of ["NO", "EN"]) {
      const body = { title: "Clean title", body: "A clean body", published: true };
      const created = await request("/jokes", { method: "POST", user: author, language, body });
      assert.equal(created.status, 200);
      const blocked = { ...body, body: "A blockedfixture word" };
      assert.equal((await request("/jokes", { method: "POST", user: author, language, body: blocked })).status, 400);
      assert.equal((await request(`/jokes/${created.data.id}`, { method: "PATCH", user: author, language, body: blocked })).status, 400);
      const fetched = await request(`/jokes/${created.data.id}`, { language });
      assert.equal(fetched.data.body, "A clean body");
      assert.equal((await request(`/jokes?lang=${language}`)).data.length, 1);
    }
  });

  test("all admin recompute endpoints authorize, validate language and return flat empty/winner results", async () => {
    const slugs = ["joke-of-the-day", "top-creator-month", "most-commented-week", "trending-week", "fastest-growing"];
    const admin = { ...author, role: "ADMIN" };
    for (const slug of slugs) {
      const path = `/featured/admin/recompute/${slug}`;
      assert.equal((await request(path, { method: "POST" })).status, 401);
      assert.equal((await request(path, { method: "POST", user: author })).status, 403);
      assert.equal((await request(`${path}?lang=DE`, { method: "POST", user: admin })).status, 400);
      assert.equal((await request(path, { method: "POST", user: admin, language: "DE" })).status, 400);
      const defaultLanguage = await request(path, { method: "POST", user: admin, language: null });
      assert.equal(defaultLanguage.status, 200);
      assert.equal(defaultLanguage.data.language, "NO");
      for (const language of ["NO", "EN"]) {
        const response = await request(`${path}?lang=${language.toLowerCase()}`, { method: "POST", user: admin });
        assert.equal(response.status, 200);
        assert.equal(response.data.status, "no_winner");
        assert.equal(response.data.jokeId, null);
        assert.equal(response.data.language, language);
      }
    }
    const secondLiker = await prisma.user.create({ data: { username: "secondliker", email: "secondliker@example.test", password: "fixture" } });
    for (const language of ["NO", "EN"]) {
      const joke = await prisma.joke.create({ data: {
        authorId: author.id, language, title: "Eligible title", body: "Eligible joke", published: true,
        createdAt: new Date("2026-10-25T10:00:00.000Z"),
      } });
      await prisma.jokeLike.create({ data: { jokeId: joke.id, userId: other.id, createdAt: new Date("2026-10-25T11:00:00.000Z") } });
      const unqualified = await request("/featured/admin/recompute/top-creator-month", { method: "POST", user: admin, language });
      assert.equal(unqualified.status, 200);
      assert.equal(unqualified.data.status, "no_winner", "one like does not qualify the first joke");
      await prisma.jokeLike.create({ data: { jokeId: joke.id, userId: secondLiker.id, createdAt: new Date("2026-10-25T11:00:00.000Z") } });
      await prisma.comment.create({ data: { jokeId: joke.id, authorId: other.id, body: "A comment", createdAt: new Date("2026-10-25T11:00:00.000Z") } });
      for (const slug of slugs) {
        const response = await request(`/featured/admin/recompute/${slug}`, { method: "POST", user: admin, language: language.toLowerCase() });
        assert.equal(response.status, 200);
        assert.equal(typeof response.data.status, "string");
        assert.equal(response.data.jokeId, joke.id);
        assert.equal(response.data.language, language);
      }
    }
  });

  test("public featured endpoints hide prior periods, future rows, drafts and other languages", async () => {
    const features = [
      ["joke-of-the-day", "DAILY_JOKE", "2026-10-24T00:00:00.000Z", "2026-10-25T00:00:00.000Z", "2026-10-26T00:00:00.000Z"],
      ["top-creator-month", "TOP_CREATOR_MONTH", "2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"],
      ["trending-week", "TRENDING_WEEK", "2026-10-12T00:00:00.000Z", "2026-10-19T00:00:00.000Z", "2026-10-26T00:00:00.000Z"],
      ["most-commented-week", "MOST_COMMENTED_WEEK", "2026-10-12T00:00:00.000Z", "2026-10-19T00:00:00.000Z", "2026-10-26T00:00:00.000Z"],
      ["fastest-growing", "FASTEST_GROWING", "2026-10-24T11:00:00.000Z", "2026-10-25T12:00:00.000Z", "2026-10-25T13:00:00.000Z"],
    ];
    for (const language of ["NO", "EN"]) {
      const published = await prisma.joke.create({ data: { authorId: author.id, language, title: "Old winner", body: "Old joke", published: true } });
      const draft = await prisma.joke.create({ data: { authorId: author.id, language, title: "Draft winner", body: "Private joke", published: false } });
      for (const [slug, type, old, current, future] of features) {
        await prisma.featuredJoke.createMany({ data: [
          { type, language, jokeId: published.id, date: new Date(old) },
          { type, language, jokeId: published.id, date: new Date(future) },
        ] });
        assert.equal((await request(`/featured/${slug}`, { language })).data, null);
        await prisma.featuredJoke.create({ data: { type, language, jokeId: draft.id, date: new Date(current) } });
        assert.equal((await request(`/featured/${slug}`, { language })).data, null);
        await prisma.featuredJoke.update({ where: { type_date_language: { type, language, date: new Date(current) } }, data: { jokeId: published.id } });
        const visible = await request(`/featured/${slug}`, { language });
        assert.equal(visible.status, 200);
        assert.equal(visible.data.joke.language, language);
        assert.equal(visible.data.joke.id, published.id);
        if (language === "NO") assert.equal((await request(`/featured/${slug}`, { language: "EN" })).data, null);
      }
    }
  });

  test("daily fastest-growing admin action validates access and finalizes one earned day independently per language", async () => {
    const path = "/featured/admin/recompute/fastest-growing-daily";
    const admin = { ...author, role: "ADMIN" };
    assert.equal((await request(path, { method: "POST" })).status, 401);
    assert.equal((await request(path, { method: "POST", user: author })).status, 403);
    assert.equal((await request(`${path}?lang=DE`, { method: "POST", user: admin })).status, 400);
    assert.equal((await request(path, { method: "POST", user: admin, language: "DE" })).status, 400);
    const legacy = await request(path, { method: "POST", user: admin, language: null });
    assert.equal(legacy.status, 200);
    assert.equal(legacy.data.status, "legacy_mode");
    assert.equal(legacy.data.language, "NO");
    process.env.FASTEST_GROWING_DAILY_START_UTC = "2026-10-24";
    for (const language of ["NO", "EN"]) {
      const joke = await prisma.joke.create({ data: {
        authorId: author.id, language, title: "Daily award title", body: "Daily award body", published: true,
        createdAt: new Date("2026-10-23T12:00:00.000Z"),
      } });
      await prisma.jokeLike.createMany({ data: [
        { jokeId: joke.id, userId: other.id, createdAt: new Date("2026-10-24T23:59:59.999Z") },
        { jokeId: joke.id, userId: author.id, createdAt: new Date("2026-10-25T00:00:00.000Z") },
      ] });
      const display = await request("/featured/admin/recompute/fastest-growing", { method: "POST", user: admin, language });
      assert.equal(display.status, 200);
      assert.equal(display.data.jokeId, joke.id);
      assert.deepEqual((await request("/badges/me/history", { user: author, language })).data, []);
      const result = await request(`${path}?lang=${language.toLowerCase()}`, { method: "POST", user: admin, language: null });
      assert.equal(result.status, 200);
      assert.equal(result.data.status, "completed");
      assert.equal(result.data.language, language);
      assert.equal(result.data.finalizedDays, 1);
      assert.equal(result.data.hasMore, false);
      assert.equal(result.data.results[0].jokeId, joke.id);
      const history = (await request("/badges/me/history", { user: author, language })).data;
      assert.equal(history.length, 1);
      assert.equal(history[0].scoringWindowStart, "2026-10-24T00:00:00.000Z");
      assert.equal(history[0].context.likeCount24h, 1, "current-day midnight like belongs to the next scoring window");
      assert.equal(history[0].validFrom, "2026-10-25T00:00:00.000Z");
      assert.equal(history[0].validTo, "2026-10-26T00:00:00.000Z");
      assert.equal((await request("/badges/me/current", { user: author, language })).data.length, 1);
      assert.equal((await request(path, { method: "POST", user: admin, language: language.toLowerCase() })).data.finalizedDays, 0);
    }
  });

  test("daily views keep existing same-day, consecutive, missed-day and best-streak rules", async () => {
    for (const [last, streak, expected] of [
      [null, 0, 1],
      ["2026-10-25T00:00:00.000Z", 3, 3],
      ["2026-10-24T23:59:59.999Z", 3, 4],
      ["2026-10-23T23:59:59.999Z", 3, 1],
    ]) {
      await prisma.user.update({ where: { id: author.id }, data: { dailyJokeLastViewedAt: last ? new Date(last) : null, dailyJokeStreak: streak, dailyJokeBestStreak: 7 } });
      const response = await request("/jokes/daily/view", { method: "POST", user: author, body: {} });
      assert.equal(response.status, 200);
      assert.equal(response.data.dailyJokeStreak, expected);
      assert.equal(response.data.dailyJokeBestStreak, 7);
    }
  });

  test("NO and EN daily views share a global streak and increment at UTC midnight", async () => {
    assert.equal((await request("/jokes/daily/view", { method: "POST", body: {} })).status, 401);
    mock.timers.setTime(new Date("2026-10-25T23:59:59.999Z").getTime());
    assert.equal((await request("/jokes/daily/view", { method: "POST", user: author, language: "NO", body: {} })).data.dailyJokeStreak, 1);
    assert.equal((await request("/jokes/daily/view", { method: "POST", user: author, language: "EN", body: {} })).data.dailyJokeStreak, 1);
    mock.timers.setTime(new Date("2026-10-26T00:00:00.000Z").getTime());
    const response = await request("/jokes/daily/view", { method: "POST", user: author, language: "EN", body: {} });
    assert.equal(response.data.dailyJokeStreak, 2);
    assert.equal(response.data.dailyJokeBestStreak, 2);
  });
});
