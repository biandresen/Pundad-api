import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { createIntegrationDatabase, integrationEnabled } from "./helpers/integrationDatabase.js";

const NOW = new Date("2026-10-21T12:00:00.000Z");
const WEEK = new Date("2026-10-19T00:00:00.000Z");
let fixtureId = 0;

describe("featured winners against isolated PostgreSQL", { skip: !integrationEnabled }, () => {
  let database, db, featured, badges, users, servicePrisma;
  before(async () => {
    database = await createIntegrationDatabase("featured");
    db = database.prisma;
    featured = await import("../src/services/featuredService.js");
    badges = (await import("../src/services/badgeService.js")).default;
    users = (await import("../src/services/userService.js")).default;
    servicePrisma = (await import("../src/config/prismaClient.js")).default;
  });
  after(async () => {
    await servicePrisma?.$disconnect();
    await database?.close();
  });
  beforeEach(async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: NOW });
    delete process.env.FASTEST_GROWING_DAILY_START_UTC;
    await db.featuredAwardWindow?.deleteMany();
    await db.joke.deleteMany();
    await db.user.deleteMany();
  });
  const user = () => {
    const id = ++fixtureId;
    return db.user.create({ data: { username: `fixture${id}`, email: `fixture${id}@example.test`, password: "fixture" } });
  };
  const joke = (author, language = "NO", createdAt = NOW) => db.joke.create({
    data: { authorId: author.id, title: "Fixture", body: "Test joke", published: true, language, createdAt },
  });
  const like = (j, actor, createdAt = NOW) => db.jokeLike.create({ data: { jokeId: j.id, userId: actor.id, createdAt } });
  const comment = (j, actor, createdAt = NOW) => db.comment.create({ data: { jokeId: j.id, authorId: actor.id, body: "Fixture comment", createdAt } });
  const history = async (author, language = "NO") => (await badges.getBadgeHistoryForUser(author.id, { language, limit: 100 })).items;

  test("daily selection handles empty, singleton, two and larger pools fairly over many UTC days", async (t) => {
    assert.equal((await featured.computeDailyJoke({ now: NOW })).status, "no_winner");
    for (const size of [1, 2, 3, 5]) {
      await db.joke.deleteMany();
      await db.badgeAward.deleteMany();
      await db.currentUserBadge.deleteMany();
      const author = await user();
      const pool = [];
      for (let i = 0; i < size; i++) pool.push(await joke(author));
      const wins = new Map(pool.map((j) => [j.id, 0]));
      let previous;
      for (let day = 0; day < size * 6; day++) {
        const now = new Date(Date.UTC(2026, 8, 1 + day, 12));
        t.mock.timers.setTime(now.getTime());
        const result = await featured.computeDailyJoke({ now });
        assert.ok(wins.has(result.jokeId));
        if (size > 1) assert.notEqual(result.jokeId, previous);
        wins.set(result.jokeId, wins.get(result.jokeId) + 1);
        previous = result.jokeId;
        assert.equal((await featured.computeDailyJoke({ now })).jokeId, result.jokeId);
      }
      assert.deepEqual([...wins.values()], Array(size).fill(6));
      assert.equal((await history(author)).length, size * 6);
    }
  });

  test("daily choice persists through pool changes and remains isolated by language", async (t) => {
    const no = await user(), en = await user();
    const first = await joke(no), second = await joke(no), english = await joke(en, "EN");
    const selected = await featured.computeDailyJoke({ language: "NO", now: NOW });
    const extra = await joke(no);
    assert.equal((await featured.computeDailyJoke({ language: "NO", now: NOW })).jokeId, selected.jokeId);
    assert.equal((await featured.computeDailyJoke({ language: "EN", now: NOW })).jokeId, english.id);
    await db.joke.delete({ where: { id: selected.jokeId === first.id ? second.id : first.id } });
    const tomorrow = new Date("2026-10-22T12:00:00Z");
    t.mock.timers.setTime(tomorrow.getTime());
    const next = await featured.computeDailyJoke({ language: "NO", now: tomorrow });
    assert.notEqual(next.jokeId, selected.jokeId);
    assert.ok([first.id, second.id, extra.id].includes(next.jokeId));
    assert.equal((await history(en, "NO")).length, 0);
    assert.equal((await history(en, "EN")).length, 1);
  });

  test("daily retries repair legacy feature-only and missing-current records, with UTC expiry and permanent history", async () => {
    const author = await user(), j = await joke(author);
    const day = new Date("2026-10-21T00:00:00Z");
    await db.featuredJoke.create({ data: { type: "DAILY_JOKE", language: "NO", date: day, jokeId: j.id } });
    assert.equal((await featured.computeDailyJoke({ now: NOW })).status, "already_exists");
    assert.equal((await history(author))[0].validTo.toISOString(), "2026-10-22T00:00:00.000Z");
    assert.equal((await users.getUserById(author.id, { language: "NO" })).currentBadges.length, 1);
    await db.currentUserBadge.deleteMany();
    await featured.computeDailyJoke({ now: NOW });
    assert.equal((await users.getUserById(author.id, { language: "NO" })).currentBadges.length, 1);
    assert.equal((await history(author)).length, 1);
    assert.equal(await featured.getCurrentFeatured("DAILY_JOKE", { now: new Date("2026-10-22T00:00:00Z") }), null);
  });

  for (const [name, computeName, type, metric, add] of [
    ["trending", "computeTrendingThisWeek", "TRENDING_WEEK", "likeCount", like],
    ["most commented", "computeMostCommentedThisWeek", "MOST_COMMENTED_WEEK", "commentCount", comment],
  ]) {
    test(`${name} recalculates initial, unchanged, tied, changed and rolled-over winners`, async () => {
      const a = await user(), b = await user(), actor1 = await user(), actor2 = await user();
      const ja = await joke(a), jb = await joke(b), en = await joke(b, "EN");
      await add(ja, actor1, WEEK);
      await add(en, actor1, WEEK);
      const compute = featured[computeName];
      const initial = await compute({ language: "NO", now: NOW });
      assert.equal(initial.jokeId, ja.id);
      assert.equal(initial[metric], 1);
      const firstAward = (await history(a))[0];
      assert.equal((await compute({ now: NOW })).status, "already_exists");
      assert.equal((await history(a))[0].id, firstAward.id);
      await add(jb, actor1, WEEK);
      assert.equal((await compute({ now: NOW })).jokeId, ja.id, "exact ties use immutable joke ID");
      await add(jb, actor2, NOW);
      assert.equal((await compute({ now: NOW })).jokeId, jb.id);
      assert.equal((await history(a)).length, 0, "displaced provisional awards do not score");
      assert.equal((await history(b)).length, 1);
      assert.equal((await users.getUserById(a.id, { language: "NO" })).currentBadges.length, 0);
      assert.equal((await users.getUserById(b.id, { language: "NO" })).currentBadges[0].badge, type);
      assert.equal((await compute({ language: "EN", now: NOW })).jokeId, en.id);
      assert.equal((await history(b, "EN")).length, 1);
      const nextWeek = new Date("2026-10-26T12:00:00Z");
      await add(ja, actor2, nextWeek);
      assert.equal((await compute({ now: nextWeek })).jokeId, ja.id);
      assert.equal((await history(b)).length, 1, "completed-period winner history remains");
      assert.equal((await history(a)).length, 1);
      assert.equal((await compute({ now: new Date("2026-11-02T12:00:00Z") })).status, "no_winner");
      assert.equal((await history(a)).length, 1);
    });
  }

  test("monthly creator counts only jokes with two same-month likes from other users", async () => {
    const prolific = await user(), appreciated = await user(), actor1 = await user(), actor2 = await user();
    const selfLiked = await joke(prolific), commented = await joke(prolific);
    await joke(prolific);
    await like(selfLiked, prolific);
    await like(selfLiked, actor1);
    await comment(commented, actor1);
    await comment(commented, actor2);
    const qualified = await joke(appreciated);
    await like(qualified, actor1);
    await like(qualified, actor2);
    await joke(appreciated, "NO", new Date(NOW.getTime() + 1000));

    const result = await featured.computeTopCreatorThisMonth({ now: NOW });
    assert.equal(result.winnerAuthorId, appreciated.id);
    assert.equal(result.jokeCount, 1);
    assert.equal(result.jokeId, qualified.id);
    assert.equal((await history(prolific)).length, 0);
    assert.equal((await history(appreciated))[0].context.jokeCount, 1);
  });

  test("monthly creator updates metrics and winner, resolves exact ties and preserves previous months", async () => {
    const a = await user(), b = await user(), actor1 = await user(), actor2 = await user();
    const qualifyingJoke = async (author, language = "NO", date = NOW) => {
      const j = await joke(author, language, date);
      await like(j, actor1, date);
      await like(j, actor2, date);
      return j;
    };
    await qualifyingJoke(a, "NO", new Date("2026-10-01T00:00:00Z"));
    await qualifyingJoke(b, "NO", new Date("2026-10-01T00:00:00Z"));
    assert.equal((await featured.computeTopCreatorThisMonth({ now: NOW })).winnerAuthorId, a.id);
    const original = (await history(a))[0];
    await featured.computeTopCreatorThisMonth({ now: NOW });
    assert.equal((await history(a))[0].id, original.id);
    await qualifyingJoke(b);
    const changed = await featured.computeTopCreatorThisMonth({ now: NOW });
    assert.equal(changed.winnerAuthorId, b.id);
    assert.equal(changed.jokeCount, 2);
    assert.equal((await history(a)).length, 0);
    const bAward = (await history(b))[0];
    await qualifyingJoke(b);
    assert.equal((await featured.computeTopCreatorThisMonth({ now: NOW })).jokeCount, 3);
    assert.equal((await history(b))[0].id, bAward.id);
    assert.equal((await history(b))[0].context.jokeCount, 3);
    await qualifyingJoke(a, "EN");
    assert.equal((await featured.computeTopCreatorThisMonth({ language: "EN", now: NOW })).winnerAuthorId, a.id);
    const november = new Date("2026-11-01T00:00:00Z");
    await qualifyingJoke(a, "NO", november);
    assert.equal((await featured.computeTopCreatorThisMonth({ now: november })).winnerAuthorId, a.id);
    assert.equal((await history(b)).length, 1);
    assert.equal((await history(a)).length, 1);
    assert.equal(await featured.getCurrentFeatured("TOP_CREATOR_MONTH", { now: new Date("2026-12-01T00:00:00Z") }), null);
  });

  test("monthly creator tie uses likes on qualifying jokes, then immutable user ID", async () => {
    const a = await user(), b = await user(), actor1 = await user(), actor2 = await user(), actor3 = await user();
    const ja = await joke(a), jb = await joke(b);
    for (const j of [ja, jb]) {
      await like(j, actor1);
      await like(j, actor2);
    }
    assert.equal((await featured.computeTopCreatorThisMonth({ now: NOW })).winnerAuthorId, a.id);
    const unqualified = await joke(a);
    await like(unqualified, actor1);
    await like(ja, a);
    await like(jb, actor3);
    const result = await featured.computeTopCreatorThisMonth({ now: NOW });
    assert.equal(result.winnerAuthorId, b.id, "unqualified jokes and self-likes cannot decide a tie");
    assert.equal(result.jokeCount, 1);
    assert.equal((await history(a)).length, 0);
    assert.equal((await history(b)).length, 1);
  });

  test("monthly creator requires qualifying published jokes and other-user likes inside exact UTC month boundaries", async () => {
    const eligible = await user(), excluded = await user(), actor1 = await user(), actor2 = await user();
    const start = new Date("2026-10-01T00:00:00Z"), end = new Date("2026-11-01T00:00:00Z");
    const last = new Date("2026-10-31T23:59:59.999Z");
    const before = new Date("2026-09-30T23:59:59.999Z");
    const atStart = await joke(eligible, "NO", start);
    await like(atStart, actor1, start);
    await like(atStart, actor2, last);
    const oldDraft = await joke(excluded, "NO", before);
    const futurePost = await joke(excluded, "NO", end);
    const draft = await joke(excluded);
    await db.joke.update({ where: { id: draft.id }, data: { published: false } });
    for (const j of [oldDraft, futurePost, draft]) {
      await like(j, actor1);
      await like(j, actor2);
    }
    const oldLike = await joke(excluded), futureLike = await joke(excluded);
    await like(oldLike, actor1, before);
    await like(oldLike, actor2, start);
    await like(futureLike, actor1, last);
    await like(futureLike, actor2, end);
    const result = await featured.computeTopCreatorThisMonth({ now: last });
    assert.equal(result.winnerAuthorId, eligible.id);
    assert.equal(result.jokeCount, 1);
    assert.equal(result.jokeId, atStart.id);
    assert.equal((await history(excluded)).length, 0);
    assert.equal((await featured.computeTopCreatorThisMonth({ language: "EN", now: last })).status, "no_winner");
  });

  test("monthly creator loses qualification after unlike or unpublish, without a free first joke or lost historical awards", async () => {
    const a = await user(), actor1 = await user(), actor2 = await user();
    const j = await joke(a);
    assert.equal((await featured.computeTopCreatorThisMonth({ now: NOW })).status, "no_winner");
    await like(j, actor1);
    assert.equal((await featured.computeTopCreatorThisMonth({ now: NOW })).status, "no_winner");
    await like(j, actor2);
    await featured.computeTopCreatorThisMonth({ now: NOW });
    await db.jokeLike.delete({ where: { jokeId_userId: { jokeId: j.id, userId: actor2.id } } });
    assert.equal((await featured.computeTopCreatorThisMonth({ now: NOW })).status, "no_winner");
    assert.equal((await history(a)).length, 0);
    assert.equal(await featured.getCurrentFeatured("TOP_CREATOR_MONTH", { now: NOW }), null);
    assert.equal((await users.getUserById(a.id, { language: "NO" })).currentBadges.length, 0);
    await like(j, actor2);
    await featured.computeTopCreatorThisMonth({ now: NOW });
    await db.joke.update({ where: { id: j.id }, data: { published: false } });
    assert.equal((await featured.computeTopCreatorThisMonth({ now: NOW })).status, "no_winner");
    assert.equal((await history(a)).length, 0);
    await db.joke.update({ where: { id: j.id }, data: { published: true } });
    await featured.computeTopCreatorThisMonth({ now: NOW });
    assert.equal((await featured.computeTopCreatorThisMonth({ now: new Date("2026-11-01T00:00:00Z") })).status, "no_winner");
    assert.equal((await history(a)).length, 1, "completed month retains its award");
  });

  test("monthly creator transfer rolls back feature, history and current badge together, then recovers on retry", async () => {
    const a = await user(), b = await user(), actor1 = await user(), actor2 = await user();
    const ja = await joke(a);
    await like(ja, actor1);
    await like(ja, actor2);
    await featured.computeTopCreatorThisMonth({ now: NOW });
    const original = (await history(a))[0];
    for (let index = 0; index < 2; index++) {
      const jb = await joke(b);
      await like(jb, actor1);
      await like(jb, actor2);
    }
    await db.$executeRawUnsafe(`CREATE FUNCTION reject_creator_badge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'creator fixture failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER reject_creator_badge BEFORE INSERT OR UPDATE ON "CurrentUserBadge" FOR EACH ROW EXECUTE FUNCTION reject_creator_badge()`);
    try {
      await assert.rejects(featured.computeTopCreatorThisMonth({ now: NOW }), /creator fixture failure/);
      assert.equal((await featured.getCurrentFeatured("TOP_CREATOR_MONTH", { now: NOW })).joke.id, ja.id);
      assert.equal((await history(a))[0].id, original.id);
      assert.equal((await history(b)).length, 0);
      assert.equal((await users.getUserById(a.id, { language: "NO" })).currentBadges.length, 1);
      assert.equal((await users.getUserById(b.id, { language: "NO" })).currentBadges.length, 0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER reject_creator_badge ON "CurrentUserBadge"`);
      await db.$executeRawUnsafe(`DROP FUNCTION reject_creator_badge()`);
    }
    assert.equal((await featured.computeTopCreatorThisMonth({ now: NOW })).winnerAuthorId, b.id);
    assert.equal((await history(a)).length, 0);
    assert.equal((await history(b)).length, 1);
  });

  test("removed engagement clears only the provisional current-period winner", async () => {
    const a = await user(), actor = await user(), j = await joke(a);
    await like(j, actor, WEEK);
    await featured.computeTrendingThisWeek({ now: NOW });
    await db.jokeLike.deleteMany();
    assert.equal((await featured.computeTrendingThisWeek({ now: NOW })).status, "no_winner");
    assert.equal((await history(a)).length, 0);
    assert.equal((await users.getUserById(a.id, { language: "NO" })).currentBadges.length, 0);
    assert.equal(await featured.getCurrentFeatured("TRENDING_WEEK", { now: NOW }), null);
  });

  test("failure of a badge write rolls back feature and history, then a retry recovers", async () => {
    const author = await user();
    await joke(author);
    await db.$executeRawUnsafe(`CREATE FUNCTION reject_current_badge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER reject_current_badge BEFORE INSERT OR UPDATE ON "CurrentUserBadge" FOR EACH ROW EXECUTE FUNCTION reject_current_badge()`);
    try {
      await assert.rejects(featured.computeDailyJoke({ now: NOW }), /fixture failure/);
      assert.equal(await featured.getCurrentFeatured("DAILY_JOKE", { now: NOW }), null);
      assert.equal((await history(author)).length, 0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER reject_current_badge ON "CurrentUserBadge"`);
      await db.$executeRawUnsafe(`DROP FUNCTION reject_current_badge()`);
    }
    assert.equal((await featured.computeDailyJoke({ now: NOW })).status, "created");
    assert.equal((await history(author)).length, 1);
  });

  test("concurrent runs converge to one feature and award under actual unique constraints", async () => {
    const author = await user(), actor = await user(), actor2 = await user(), j = await joke(author);
    await like(j, actor, WEEK);
    await like(j, actor2, WEEK);
    for (const compute of [featured.computeDailyJoke, featured.computeTrendingThisWeek, featured.computeTopCreatorThisMonth]) {
      const results = await Promise.all(Array.from({ length: 4 }, () => compute({ now: NOW })));
      assert.deepEqual(new Set(results.map((r) => r.jokeId)), new Set([j.id]));
    }
    assert.equal((await history(author)).length, 3);
    assert.equal(await db.featuredJoke.count(), 3);
    const existing = (await history(author))[0];
    await assert.rejects(db.badgeAward.create({ data: {
      userId: existing.userId, badge: existing.badge, language: existing.language, validFrom: existing.validFrom,
    } }), { code: "P2002" });
  });

  test("fastest-growing legacy repair is idempotent and preserves the existing hourly scoring cadence", async () => {
    const author = await user(), actor = await user(), j = await joke(author);
    await like(j, actor, new Date("2026-10-21T11:59:00Z"));
    const hour = new Date("2026-10-21T12:00:00Z");
    await db.featuredJoke.create({ data: { type: "FASTEST_GROWING", date: hour, language: "NO", jokeId: j.id } });
    await featured.computeFastestGrowing24h({ now: NOW });
    await featured.computeFastestGrowing24h({ now: NOW });
    assert.equal((await history(author)).length, 1);
    assert.equal((await history(author))[0].context.likeCount24h, 1);
    await featured.computeFastestGrowing24h({ now: new Date("2026-10-21T13:00:00Z") });
    assert.equal((await history(author)).length, 2, "pending #13 approval, hourly history remains unchanged");
  });
  test("approved fastest-growing policy scores one completed UTC day while hourly discovery remains unscored", async (t) => {
    process.env.FASTEST_GROWING_DAILY_START_UTC = "2026-10-20";
    const author = await user(), actor = await user(), j = await joke(author);
    await like(j, actor, new Date("2026-10-20T23:59:59.999Z"));
    await featured.computeFastestGrowing24h({ now: new Date("2026-10-20T23:59:59.999Z") });
    assert.equal((await history(author)).length, 0, "hourly discovery grants no daily score");
    const result = await featured.finalizeFastestGrowingDays({ now: NOW });
    assert.equal(result.finalizedDays, 1);
    const awards = await history(author);
    assert.equal(awards.length, 1);
    assert.equal(awards[0].scoringWindowStart.toISOString(), "2026-10-20T00:00:00.000Z");
    assert.equal(awards[0].validFrom.toISOString(), "2026-10-21T00:00:00.000Z");
    assert.equal(awards[0].validTo.toISOString(), "2026-10-22T00:00:00.000Z");
    assert.equal((await users.getUserById(author.id, { language: "NO" })).currentBadges.length, 1);
    assert.equal((await featured.finalizeFastestGrowingDays({ now: NOW })).finalizedDays, 0);
    t.mock.timers.setTime(new Date("2026-10-22T00:00:00Z").getTime());
    assert.equal((await users.getUserById(author.id, { language: "NO" })).currentBadges.length, 0);
    assert.equal((await history(author)).length, 1);
  });

  test("daily fastest-growing windows separate exact UTC boundaries, ties, languages and empty days", async (t) => {
    process.env.FASTEST_GROWING_DAILY_START_UTC = "2026-10-20";
    const a = await user(), b = await user(), actor1 = await user(), actor2 = await user();
    const ja = await joke(a), jb = await joke(b), en = await joke(b, "EN");
    await like(ja, actor1, new Date("2026-10-20T00:00:00Z"));
    await like(ja, actor2, new Date("2026-10-19T23:59:59.999Z"));
    await like(jb, actor1, new Date("2026-10-20T23:59:59.999Z"));
    await like(jb, actor2, new Date("2026-10-21T00:00:00Z"));
    await like(en, actor1, new Date("2026-10-20T12:00:00Z"));
    const no = await featured.finalizeFastestGrowingDays({ language: "NO", now: NOW });
    const english = await featured.finalizeFastestGrowingDays({ language: "EN", now: NOW });
    assert.equal(no.results[0].jokeId, ja.id, "lower joke ID wins an exact day tie");
    assert.equal(english.results[0].jokeId, en.id);
    assert.equal((await history(a))[0].context.likeCount24h, 1, "previous-day event is excluded");
    assert.equal((await history(b)).length, 0, "next-day midnight event is excluded");
    const next = new Date("2026-10-22T12:00:00Z");
    t.mock.timers.setTime(next.getTime());
    assert.equal((await featured.finalizeFastestGrowingDays({ now: next })).results[0].jokeId, jb.id);
    assert.equal((await history(a)).length, 1);
    assert.equal((await history(b)).length, 1);
    assert.equal((await users.getUserById(a.id, { language: "NO" })).currentBadges.length, 0);
    assert.equal((await users.getUserById(b.id, { language: "NO" })).currentBadges.length, 1);
    const emptyDay = new Date("2026-10-23T00:00:00Z");
    t.mock.timers.setTime(emptyDay.getTime());
    assert.equal((await featured.finalizeFastestGrowingDays({ now: emptyDay })).results[0].status, "no_winner");
    assert.equal((await featured.finalizeFastestGrowingDays({ now: emptyDay })).finalizedDays, 0);
    assert.equal((await users.getUserById(b.id, { language: "NO" })).currentBadges.length, 0);
    assert.equal((await history(b)).length, 1, "old rolling likes grant no repeated daily points");
  });

  test("bounded daily catch-up checkpoints empty days and never presents historical winners as active", async () => {
    process.env.FASTEST_GROWING_DAILY_START_UTC = "2026-10-18";
    const a = await user(), b = await user(), actor = await user();
    const ja = await joke(a), jb = await joke(b);
    await like(ja, actor, new Date("2026-10-18T12:00:00Z"));
    await like(jb, actor, new Date("2026-10-20T12:00:00Z"));
    const first = await featured.finalizeFastestGrowingDays({ now: NOW, maxDays: 1 });
    assert.equal(first.finalizedDays, 1);
    assert.equal(first.hasMore, true);
    assert.equal((await users.getUserById(a.id, { language: "NO" })).currentBadges.length, 0);
    const second = await featured.finalizeFastestGrowingDays({ now: NOW, maxDays: 1 });
    assert.equal(second.results[0].status, "no_winner");
    assert.equal(second.hasMore, true);
    const third = await featured.finalizeFastestGrowingDays({ now: NOW, maxDays: 1 });
    assert.equal(third.hasMore, false);
    assert.equal((await users.getUserById(b.id, { language: "NO" })).currentBadges.length, 1);
    assert.equal((await history(a)).length, 1);
    assert.equal((await history(b)).length, 1);
    assert.equal((await featured.finalizeFastestGrowingDays({ now: NOW })).finalizedDays, 0);
  });

  test("daily award failure rolls back its checkpoint/history and concurrent retries create one award", async () => {
    process.env.FASTEST_GROWING_DAILY_START_UTC = "2026-10-20";
    const author = await user(), actor = await user(), j = await joke(author);
    await like(j, actor, new Date("2026-10-20T12:00:00Z"));
    await db.$executeRawUnsafe(`CREATE FUNCTION reject_daily_badge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'daily fixture failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER reject_daily_badge BEFORE INSERT OR UPDATE ON "CurrentUserBadge" FOR EACH ROW EXECUTE FUNCTION reject_daily_badge()`);
    try {
      await assert.rejects(featured.finalizeFastestGrowingDays({ now: NOW }), /daily fixture failure/);
      assert.equal((await history(author)).length, 0);
      assert.equal(await db.featuredAwardWindow.count(), 0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER reject_daily_badge ON "CurrentUserBadge"`);
      await db.$executeRawUnsafe(`DROP FUNCTION reject_daily_badge()`);
    }
    await Promise.all(Array.from({ length: 4 }, () => featured.finalizeFastestGrowingDays({ now: NOW })));
    assert.equal((await history(author)).length, 1);
    assert.equal(await db.featuredAwardWindow.count(), 1);
    const award = (await history(author))[0];
    const other = await user();
    await assert.rejects(db.badgeAward.create({ data: {
      userId: other.id, badge: "FASTEST_GROWING", language: "NO",
      validFrom: award.validFrom, scoringWindowStart: award.scoringWindowStart,
    } }), { code: "P2002" });
  });

  test("explicit cutover preserves legacy history, clears legacy active badges and rejects overlapping policy dates", async () => {
    const author = await user(), actor = await user(), j = await joke(author);
    await like(j, actor, new Date("2026-10-20T22:00:00Z"));
    assert.equal((await featured.finalizeFastestGrowingDays({ now: NOW })).status, "legacy_mode");
    process.env.FASTEST_GROWING_DAILY_START_UTC = "2026-10-21";
    const beforeCutover = new Date("2026-10-20T23:00:00Z");
    await featured.computeFastestGrowing24h({ now: beforeCutover });
    const legacy = (await history(author))[0];
    assert.equal(legacy.scoringWindowStart, null);
    assert.equal((await featured.finalizeFastestGrowingDays({ now: beforeCutover })).status, "before_cutover");
    assert.equal((await users.getUserById(author.id, { language: "NO" })).currentBadges.length, 1);
    await featured.computeFastestGrowing24h({ now: NOW });
    assert.equal((await users.getUserById(author.id, { language: "NO" })).currentBadges.length, 0);
    assert.equal((await history(author)).length, 1);
    assert.equal((await history(author))[0].id, legacy.id);
    process.env.FASTEST_GROWING_DAILY_START_UTC = "2026-10-20";
    await assert.rejects(featured.computeFastestGrowing24h({ now: NOW }), /after every legacy hourly award/);
    await assert.rejects(featured.finalizeFastestGrowingDays({ now: NOW }), /after every legacy hourly award/);
    assert.equal((await history(author))[0].id, legacy.id);
    for (const invalid of ["2026-02-30", "2026-1-01", "2026-10-21T00:00:00Z", "invalid"]) {
      process.env.FASTEST_GROWING_DAILY_START_UTC = invalid;
      await assert.rejects(featured.finalizeFastestGrowingDays({ now: NOW }), /FASTEST_GROWING_DAILY_START_UTC/);
    }
  });

  test("activated daily policy fails closed if cutover is removed or changed in either direction", async () => {
    process.env.FASTEST_GROWING_DAILY_START_UTC = "2026-10-20";
    await featured.finalizeFastestGrowingDays({ now: NOW });
    for (const changed of [undefined, "", "2026-10-19", "2026-10-21", "2026-12-01"]) {
      if (changed === undefined) delete process.env.FASTEST_GROWING_DAILY_START_UTC;
      else process.env.FASTEST_GROWING_DAILY_START_UTC = changed;
      await assert.rejects(featured.computeFastestGrowing24h({ now: NOW }), /cutover.*finalized daily/);
      await assert.rejects(featured.finalizeFastestGrowingDays({ now: NOW }), /cutover.*finalized daily/);
    }
    assert.equal(await db.badgeAward.count(), 0);
    assert.equal(await db.featuredAwardWindow.count(), 1, "even an empty finalized day fixes the cutover");
  });

});
