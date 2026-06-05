import prisma from "../config/prismaClient.js";
import { startOfUtcMonth, addUtcMonths, startOfUtcWeek, addUtcDays } from "../utils/date.js";
import { normalizeLanguage } from "../utils/language.js";

const FEATURE_BADGES = [
  "TOP_CREATOR_MONTH",
  "JOKE_OF_DAY",
  "TRENDING_WEEK",
  "MOST_COMMENTED_WEEK",
  "FASTEST_GROWING",
];

const WEIGHTS = {
  TOP_CREATOR_MONTH: 5,
  JOKE_OF_DAY: 4,
  FASTEST_GROWING: 3,
  TRENDING_WEEK: 3,
  MOST_COMMENTED_WEEK: 2,
};

function getPeriodRange(period) {
  const now = new Date();

  if (period === "week") {
    const from = startOfUtcWeek(now);
    const to = addUtcDays(from, 7);
    return { from, to };
  }

  if (period === "month") {
    const from = startOfUtcMonth(now);
    const to = addUtcMonths(from, 1);
    return { from, to };
  }

  return { from: null, to: null };
}

function sumWeights(winsByBadge) {
  let score = 0;

  for (const [badge, count] of Object.entries(winsByBadge)) {
    score += (WEIGHTS[badge] ?? 0) * (count ?? 0);
  }

  return score;
}

export async function getLeaderboardUsers({ language, period = "month", limit = 25 } = {}) {
  const lang = normalizeLanguage(language);

  const safePeriod = period === "week" || period === "month" || period === "all" ? period : "month";

  const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 25));

  const { from, to } = getPeriodRange(safePeriod);
  const timeFilter = from && to ? { gte: from, lt: to } : null;

  /**
   * Badge wins are explicitly language-scoped.
   */
  const winsRows = await prisma.badgeAward.groupBy({
    by: ["userId", "badge"],
    where: {
      badge: { in: FEATURE_BADGES },
      ...(timeFilter ? { awardedAt: timeFilter } : {}),
      language: lang,
    },
    _count: { _all: true },
  });

  const winsByUser = new Map();

  for (const row of winsRows) {
    if (!winsByUser.has(row.userId)) {
      winsByUser.set(row.userId, {});
    }

    winsByUser.get(row.userId)[row.badge] = row._count._all;
  }

  /**
   * Likes received for jokes in the selected language.
   * Language is derived from the related Joke.
   */
  const likeRows = await prisma.jokeLike.groupBy({
    by: ["jokeId"],
    where: {
      ...(timeFilter ? { createdAt: timeFilter } : {}),
      joke: { language: lang },
    },
    _count: { _all: true },
  });

  const likeJokeIds = likeRows.map((row) => row.jokeId);

  const likeJokes =
    likeJokeIds.length ?
      await prisma.joke.findMany({
        where: {
          id: { in: likeJokeIds },
          language: lang,
        },
        select: {
          id: true,
          authorId: true,
        },
      })
    : [];

  const jokeIdToAuthor = new Map(likeJokes.map((joke) => [joke.id, joke.authorId]));
  const likesByUser = new Map();

  for (const row of likeRows) {
    const authorId = jokeIdToAuthor.get(row.jokeId);
    if (!authorId) continue;

    likesByUser.set(authorId, (likesByUser.get(authorId) ?? 0) + row._count._all);
  }

  /**
   * Comments received for jokes in the selected language.
   * Language is derived from the related Joke.
   */
  const commentRows = await prisma.comment.groupBy({
    by: ["jokeId"],
    where: {
      ...(timeFilter ? { createdAt: timeFilter } : {}),
      joke: { language: lang },
    },
    _count: { _all: true },
  });

  const commentJokeIds = commentRows.map((row) => row.jokeId);

  const commentJokes =
    commentJokeIds.length ?
      await prisma.joke.findMany({
        where: {
          id: { in: commentJokeIds },
          language: lang,
        },
        select: {
          id: true,
          authorId: true,
        },
      })
    : [];

  const commentJokeIdToAuthor = new Map(commentJokes.map((joke) => [joke.id, joke.authorId]));

  const commentsByUser = new Map();

  for (const row of commentRows) {
    const authorId = commentJokeIdToAuthor.get(row.jokeId);
    if (!authorId) continue;

    commentsByUser.set(authorId, (commentsByUser.get(authorId) ?? 0) + row._count._all);
  }

  /**
   * Union of users appearing in this language slice.
   */
  const userIds = new Set([...winsByUser.keys(), ...likesByUser.keys(), ...commentsByUser.keys()]);

  if (userIds.size === 0) return [];

  const users = await prisma.user.findMany({
    where: {
      id: { in: Array.from(userIds) },
    },
    select: {
      id: true,
      username: true,
      avatar: true,
      role: true,
      dailyJokeStreak: true,
      dailyJokeBestStreak: true,
      currentBadges: true,
    },
  });

  const rows = users.map((user) => {
    const winsByBadge = winsByUser.get(user.id) ?? {};
    const winsTotal = Object.values(winsByBadge).reduce((sum, count) => sum + (count ?? 0), 0);

    const featuredScore = sumWeights(winsByBadge);

    return {
      user,
      winsByBadge,
      winsTotal,
      featuredScore,
      likesReceived: likesByUser.get(user.id) ?? 0,
      commentsReceived: commentsByUser.get(user.id) ?? 0,
      dailyStreak: user.dailyJokeStreak ?? 0,
      bestStreak: user.dailyJokeBestStreak ?? 0,
    };
  });

  rows.sort((a, b) => {
    if (b.featuredScore !== a.featuredScore) {
      return b.featuredScore - a.featuredScore;
    }

    if (b.winsTotal !== a.winsTotal) {
      return b.winsTotal - a.winsTotal;
    }

    if (b.likesReceived !== a.likesReceived) {
      return b.likesReceived - a.likesReceived;
    }

    if (b.dailyStreak !== a.dailyStreak) {
      return b.dailyStreak - a.dailyStreak;
    }

    return b.commentsReceived - a.commentsReceived;
  });

  return rows.slice(0, parsedLimit);
}

export default { getLeaderboardUsers };
