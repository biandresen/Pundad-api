import prisma from "../config/prismaClient.js";
import { FEATURED_JOKE } from "../constants.js";
import badgeService from "./badgeService.js";
import {
  startOfUtcMonth, addUtcMonths, startOfUtcWeek, addUtcDays,
  startOfUtcHour, addUtcHours, startOfUtcDay,
} from "../utils/date.js";
import jokeService from "./jokeService.js";
import { normalizeLanguage } from "../utils/language.js";
import { fastestGrowingDailyStart } from "../config/fastestGrowingPolicy.js";

// Retry the entire snapshot, including candidate calculation, after a competing run.
async function transaction(operation) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      if (attempt >= 4 || !["P2034", "P2002"].includes(error.code)) throw error;
    }
  }
}

function featureKey(type, date, language) {
  return { type_date_language: { type, date, language } };
}

async function saveFeature(tx, { type, date, language, joke, award, details = {}, existing }) {
  await tx.featuredJoke.upsert({
    where: featureKey(type, date, language),
    update: { jokeId: joke.id },
    create: { type, date, language, jokeId: joke.id },
  });
  await award(tx);
  return {
    status: !existing ? "created" : existing.jokeId === joke.id ? "already_exists" : "updated",
    jokeId: joke.id, language, ...details,
  };
}

// These awards describe the provisional winner, not every user who briefly led.
// Only the open period is reconciled; completed periods remain historical awards.
async function reconcilePeriod(tx, { type, date, language, userId = null }) {
  await tx.badgeAward.deleteMany({
    where: {
      badge: type, language, validFrom: date,
      ...(userId === null ? {} : { userId: { not: userId } }),
    },
  });
  await tx.currentUserBadge.deleteMany({
    where: { badge: type, language, ...(userId === null ? {} : { userId: { not: userId } }) },
  });
  if (userId === null) {
    await tx.featuredJoke.deleteMany({ where: { type, date, language } });
  }
}

export async function computeDailyJoke({ language, now = new Date() } = {}) {
  const lang = normalizeLanguage(language);
  const dayUtc = startOfUtcDay(now);
  return transaction(async (tx) => {
    const existing = await tx.featuredJoke.findUnique({
      where: featureKey(FEATURED_JOKE.DAILY, dayUtc, lang),
      include: { joke: { select: { id: true, authorId: true } } },
    });
    let joke = existing?.joke;
    if (!joke) {
      const yesterday = await tx.featuredJoke.findUnique({
        where: featureKey(FEATURED_JOKE.DAILY, addUtcDays(dayUtc, -1), lang),
        select: { jokeId: true },
      });
      const where = { language: lang, published: true };
      const total = await tx.joke.count({ where });
      if (!total) return { status: "no_winner", jokeId: null, language: lang };
      // Rotate over the FULL pool first. Removing yesterday before modulo can starve jokes.
      let index = Math.floor(dayUtc.getTime() / 86400000) % total;
      const pick = async () => (await tx.joke.findMany({
        where, orderBy: { id: "asc" }, skip: index, take: 1,
        select: { id: true, authorId: true },
      }))[0];
      joke = await pick();
      if (total > 1 && joke.id === yesterday?.jokeId) {
        index = (index + 1) % total;
        joke = await pick();
      }
    }
    return saveFeature(tx, {
      type: FEATURED_JOKE.DAILY, date: dayUtc, language: lang, joke, existing,
      details: { authorId: joke.authorId },
      award: (client) => badgeService.awardJokeOfTheDayToAuthor({
        authorId: joke.authorId, jokeId: joke.id, dayUtc, language: lang,
      }, client),
    });
  });
}

export async function computeTopCreatorThisMonth({ language, now = new Date() } = {}) {
  const lang = normalizeLanguage(language);
  const monthStartUtc = startOfUtcMonth(now);
  const monthEndUtc = addUtcMonths(monthStartUtc, 1);
  const type = FEATURED_JOKE.TOP_CREATOR_MONTH;
  return transaction(async (tx) => {
    const existing = await tx.featuredJoke.findUnique({ where: featureKey(type, monthStartUtc, lang) });
    // Prisma stores these DateTime columns as UTC timestamps without a time zone.
    // Bind ISO strings as timestamp to avoid session-time-zone conversion at midnight.
    const monthStart = monthStartUtc.toISOString(), monthEnd = monthEndUtc.toISOString();
    // Aggregate without fetching every like. The unique (jokeId, userId) key ensures distinct voters.
    const rows = await tx.$queryRaw`
      WITH qualifying_jokes AS (
        SELECT j."id", j."authorId", j."createdAt", COUNT(*) AS "likeCount"
        FROM "Joke" j
        JOIN "JokeLike" l ON l."jokeId" = j."id"
        WHERE j."language" = ${lang}::"Language" AND j."published" = true
          AND j."createdAt" >= ${monthStart}::timestamp AND j."createdAt" < ${monthEnd}::timestamp
          AND l."createdAt" >= ${monthStart}::timestamp AND l."createdAt" < ${monthEnd}::timestamp
          AND l."userId" <> j."authorId"
        GROUP BY j."id", j."authorId", j."createdAt"
        HAVING COUNT(*) >= 2
      )
      SELECT "authorId", COUNT(*)::integer AS "jokeCount",
        (ARRAY_AGG("id" ORDER BY "createdAt" DESC, "id" ASC))[1] AS "jokeId"
      FROM qualifying_jokes
      GROUP BY "authorId"
      ORDER BY COUNT(*) DESC, SUM("likeCount") DESC, "authorId" ASC
      LIMIT 1
    `;
    const winnerAuthorId = rows[0]?.authorId;
    if (!winnerAuthorId) {
      await reconcilePeriod(tx, { type, date: monthStartUtc, language: lang });
      return { status: "no_winner", jokeId: null, language: lang };
    }
    const { jokeCount, jokeId } = rows[0];
    const joke = { id: jokeId };
    await reconcilePeriod(tx, { type, date: monthStartUtc, language: lang, userId: winnerAuthorId });
    return saveFeature(tx, {
      type, date: monthStartUtc, language: lang, joke, existing,
      details: { winnerAuthorId, jokeCount },
      award: (client) => badgeService.awardTopCreatorMonthToUser({
        userId: winnerAuthorId, monthStartUtc, monthEndUtc, jokeCount,
        context: { jokeId: joke.id }, language: lang,
      }, client),
    });
  });
}

async function computeWeekly(type, { language, now = new Date() } = {}) {
  const lang = normalizeLanguage(language);
  const weekStartUtc = startOfUtcWeek(now);
  const weekEndUtc = addUtcDays(weekStartUtc, 7);
  const commented = type === FEATURED_JOKE.MOST_COMMENTED_WEEK;
  return transaction(async (tx) => {
    const existing = await tx.featuredJoke.findUnique({ where: featureKey(type, weekStartUtc, lang) });
    const model = commented ? tx.comment : tx.jokeLike;
    const countField = commented ? "id" : "jokeId";
    const rows = await model.groupBy({
      by: ["jokeId"],
      where: {
        createdAt: { gte: weekStartUtc, lt: weekEndUtc },
        joke: { published: true, language: lang },
      },
      _count: { [countField]: true },
      orderBy: [{ _count: { [countField]: "desc" } }, { jokeId: "asc" }], take: 1,
    });
    const winnerJokeId = rows[0]?.jokeId;
    if (!winnerJokeId) {
      await reconcilePeriod(tx, { type, date: weekStartUtc, language: lang });
      return { status: "no_winner", jokeId: null, language: lang };
    }
    const count = rows[0]._count[countField];
    const joke = await tx.joke.findFirst({
      where: { id: winnerJokeId, language: lang, published: true },
      select: { id: true, authorId: true },
    });
    await reconcilePeriod(tx, { type, date: weekStartUtc, language: lang, userId: joke.authorId });
    const award = commented ? badgeService.awardMostCommentedWeekToAuthor : badgeService.awardTrendingWeekToAuthor;
    const metric = commented ? "commentCount" : "likeCount";
    return saveFeature(tx, {
      type, date: weekStartUtc, language: lang, joke, existing,
      details: { authorId: joke.authorId, [metric]: count },
      award: (client) => award({
        authorId: joke.authorId, jokeId: joke.id, weekStartUtc, weekEndUtc,
        [metric]: count, language: lang,
      }, client),
    });
  });
}

export function computeMostCommentedThisWeek(options) {
  return computeWeekly(FEATURED_JOKE.MOST_COMMENTED_WEEK, options);
}

export function computeTrendingThisWeek(options) {
  return computeWeekly(FEATURED_JOKE.TRENDING_WEEK, options);
}

export async function computeFastestGrowing24h({ language, now = new Date() } = {}) {
  const lang = normalizeLanguage(language);
  const hourKeyUtc = startOfUtcHour(now);
  const validToUtc = addUtcHours(hourKeyUtc, 24);
  const type = FEATURED_JOKE.FASTEST_GROWING;
  const cutover = fastestGrowingDailyStart();
  const dailyMode = cutover !== null && now >= cutover;
  return transaction(async (tx) => {
    if (dailyMode) await prepareDailyPolicy(tx, cutover, lang);
    else await assertPolicyConfiguration(tx, cutover, lang);
    const existing = await tx.featuredJoke.findUnique({
      where: featureKey(type, hourKeyUtc, lang),
      include: { joke: { select: { id: true, authorId: true } } },
    });
    const where = {
      createdAt: { gte: addUtcHours(now, -24), lt: now },
      joke: { published: true, language: lang },
    };
    let joke = existing?.joke;
    let likeCount24h;
    if (joke) {
      const award = await tx.badgeAward.findUnique({
        where: { userId_badge_validFrom_language: {
          userId: joke.authorId, badge: type, validFrom: hourKeyUtc, language: lang,
        } },
      });
      likeCount24h = award?.context?.likeCount24h ?? await tx.jokeLike.count({ where: { ...where, jokeId: joke.id } });
    } else {
      const rows = await tx.jokeLike.groupBy({
        by: ["jokeId"], where, _count: { jokeId: true },
        orderBy: [{ _count: { jokeId: "desc" } }, { jokeId: "asc" }], take: 1,
      });
      if (!rows[0]) return { status: "no_winner", jokeId: null, language: lang };
      likeCount24h = rows[0]._count.jokeId;
      joke = await tx.joke.findFirst({
        where: { id: rows[0].jokeId, language: lang, published: true },
        select: { id: true, authorId: true },
      });
    }
    return saveFeature(tx, {
      type, date: hourKeyUtc, language: lang, joke, existing,
      details: { authorId: joke.authorId, likeCount24h },
      award: dailyMode ? async () => {} : (client) => badgeService.awardFastestGrowingToAuthor({
        authorId: joke.authorId, jokeId: joke.id, validFromUtc: hourKeyUtc,
        validToUtc, likeCount24h, language: lang,
      }, client),
    });
  });
}

async function assertPolicyConfiguration(tx, cutover, language) {
  const firstWindow = await tx.featuredAwardWindow.findFirst({
    where: { badge: FEATURED_JOKE.FASTEST_GROWING, language },
    orderBy: { windowStart: "asc" }, select: { windowStart: true },
  });
  if (firstWindow && firstWindow.windowStart.getTime() !== cutover?.getTime()) {
    throw new Error("Fastest Growing cutover cannot be removed or changed after a finalized daily window");
  }
}

async function prepareDailyPolicy(tx, cutover, language) {
  await assertPolicyConfiguration(tx, cutover, language);
  const conflictingLegacy = await tx.badgeAward.findFirst({
    where: {
      badge: FEATURED_JOKE.FASTEST_GROWING, language, scoringWindowStart: null,
      OR: [{ validFrom: { gte: cutover } }, { validFrom: null, awardedAt: { gte: cutover } }],
    },
    select: { id: true },
  });
  if (conflictingLegacy) {
    throw new Error("Fastest Growing cutover must be after every legacy hourly award; choose a later UTC date");
  }
  await tx.currentUserBadge.deleteMany({
    where: { badge: FEATURED_JOKE.FASTEST_GROWING, language, since: { lt: cutover } },
  });
}

export async function finalizeFastestGrowingDays({ language, now = new Date(), maxDays = 31 } = {}) {
  const lang = normalizeLanguage(language);
  const cutover = fastestGrowingDailyStart();
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > 366) {
    throw new Error("Fastest Growing catch-up limit must be an integer from 1 to 366");
  }
  await transaction(async (tx) => {
    if (cutover && now >= cutover) await prepareDailyPolicy(tx, cutover, lang);
    else await assertPolicyConfiguration(tx, cutover, lang);
  });
  if (!cutover) return { status: "legacy_mode", language: lang, finalizedDays: 0, hasMore: false };
  if (now < cutover) return { status: "before_cutover", language: lang, finalizedDays: 0, hasMore: false };
  const today = startOfUtcDay(now);
  const windows = await prisma.featuredAwardWindow.findMany({
    where: { badge: FEATURED_JOKE.FASTEST_GROWING, language: lang, windowStart: { gte: cutover, lt: today } },
    orderBy: { windowStart: "asc" }, select: { windowStart: true },
  });
  let next = cutover;
  for (const row of windows) {
    if (row.windowStart.getTime() !== next.getTime()) break;
    next = addUtcDays(next, 1);
  }
  let finalizedDays = 0;
  const results = [];
  for (let attempt = 0; next < today && attempt < maxDays; attempt++, next = addUtcDays(next, 1)) {
    const windowStart = next;
    const windowEnd = addUtcDays(windowStart, 1);
    const result = await transaction(async (tx) => {
      const key = { badge_language_windowStart: { badge: FEATURED_JOKE.FASTEST_GROWING, language: lang, windowStart } };
      if (await tx.featuredAwardWindow.findUnique({ where: key })) return { status: "already_exists", windowStart };
      const rows = await tx.jokeLike.groupBy({
        by: ["jokeId"],
        where: {
          createdAt: { gte: windowStart, lt: windowEnd },
          joke: { language: lang, published: true },
        },
        _count: { jokeId: true },
        orderBy: [{ _count: { jokeId: "desc" } }, { jokeId: "asc" }], take: 1,
      });
      const winner = rows[0];
      if (winner) {
        const joke = await tx.joke.findUnique({ where: { id: winner.jokeId }, select: { authorId: true } });
        await badgeService.awardFastestGrowingDay({
          authorId: joke.authorId, jokeId: winner.jokeId, likeCount: winner._count.jokeId,
          windowStart, windowEnd, language: lang, now,
        }, tx);
      }
      await tx.featuredAwardWindow.create({ data: { badge: FEATURED_JOKE.FASTEST_GROWING, language: lang, windowStart } });
      return { status: winner ? "awarded" : "no_winner", windowStart, jokeId: winner?.jokeId ?? null };
    });
    if (result.status !== "already_exists") finalizedDays++;
    results.push(result);
  }
  return { status: "completed", language: lang, finalizedDays, hasMore: next < today, results };
}

export async function getCurrentFeatured(type, { language, now = new Date() } = {}) {
  const lang = normalizeLanguage(language);
  let date;
  if (type === FEATURED_JOKE.DAILY) date = startOfUtcDay(now);
  else if (type === FEATURED_JOKE.TOP_CREATOR_MONTH) date = startOfUtcMonth(now);
  else if ([FEATURED_JOKE.TRENDING_WEEK, FEATURED_JOKE.MOST_COMMENTED_WEEK].includes(type)) date = startOfUtcWeek(now);
  else date = { gt: addUtcHours(now, -24), lte: now };
  const row = await prisma.featuredJoke.findFirst({
    where: { type, language: lang, date, joke: { published: true, language: lang } },
    orderBy: { date: "desc" }, select: { jokeId: true, date: true },
  });
  if (!row) return null;
  const joke = await jokeService.getJokeById(row.jokeId, { language: lang, published: true });
  return { joke, date: row.date, language: lang };
}

export default {
  computeDailyJoke, computeTopCreatorThisMonth, computeMostCommentedThisWeek,
  computeTrendingThisWeek, computeFastestGrowing24h, getCurrentFeatured,
  finalizeFastestGrowingDays,
};
