import prisma from "../config/prismaClient.js";
import { BADGE, FEATURED_JOKE } from "../constants.js";
import { addUtcDays } from "../utils/date.js";
import { normalizeLanguage } from "../utils/language.js";

async function getBadgeHistoryForUser(userId, { language, page = 1, limit = 15 } = {}) {
  const lang = normalizeLanguage(language);

  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Number(limit) || 15);
  const skip = (p - 1) * l;

  const where = { userId, language: lang };

  const [items, total] = await Promise.all([
    prisma.badgeAward.findMany({
      where,
      orderBy: { awardedAt: "desc" },
      skip,
      take: l,
    }),
    prisma.badgeAward.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / l));

  return {
    items,
    total,
    meta: {
      page: p,
      limit: l,
      total,
      totalPages,
      hasPrev: p > 1,
      hasNext: p < totalPages,
    },
  };
}

// The caller supplies its transaction client so feature and badge writes commit together.
async function award({ userId, badge, validFrom, validTo, context, language }, client) {
  if (client === prisma) {
    return prisma.$transaction((tx) => award({
      userId, badge, validFrom, validTo, context, language,
    }, tx));
  }
  const lang = normalizeLanguage(language);
  const data = { validTo, context: { ...context, language: lang } };
  await client.badgeAward.upsert({
    where: { userId_badge_validFrom_language: { userId, badge, validFrom, language: lang } },
    update: data,
    create: { userId, badge, validFrom, language: lang, ...data },
  });
  await client.currentUserBadge.upsert({
    where: { userId_badge_language: { userId, badge, language: lang } },
    update: { since: validFrom, ...data },
    create: { userId, badge, language: lang, since: validFrom, ...data },
  });
}

export async function awardJokeOfTheDayToAuthor({ authorId, jokeId, dayUtc, language }, client = prisma) {
  return award({
    userId: authorId, badge: BADGE.JOKE_OF_DAY,
    validFrom: dayUtc, validTo: addUtcDays(dayUtc, 1),
    context: { jokeId }, language,
  }, client);
}

export async function awardTopCreatorMonthToUser({
  userId, monthStartUtc, monthEndUtc, jokeCount, context, language,
}, client = prisma) {
  return award({
    userId, badge: BADGE.TOP_CREATOR_MONTH,
    validFrom: monthStartUtc, validTo: monthEndUtc,
    context: { ...context, jokeCount }, language,
  }, client);
}

export async function awardMostCommentedWeekToAuthor({
  authorId, jokeId, weekStartUtc, weekEndUtc, commentCount, language,
}, client = prisma) {
  return award({
    userId: authorId, badge: FEATURED_JOKE.MOST_COMMENTED_WEEK,
    validFrom: weekStartUtc, validTo: weekEndUtc,
    context: { jokeId, commentCount }, language,
  }, client);
}

export async function awardTrendingWeekToAuthor({
  authorId, jokeId, weekStartUtc, weekEndUtc, likeCount, language,
}, client = prisma) {
  return award({
    userId: authorId, badge: FEATURED_JOKE.TRENDING_WEEK,
    validFrom: weekStartUtc, validTo: weekEndUtc,
    context: { jokeId, likeCount }, language,
  }, client);
}

export async function awardFastestGrowingToAuthor({
  authorId, jokeId, validFromUtc, validToUtc, likeCount24h, language,
}, client = prisma) {
  return award({
    userId: authorId, badge: FEATURED_JOKE.FASTEST_GROWING,
    validFrom: validFromUtc, validTo: validToUtc,
    context: { jokeId, likeCount24h, windowHours: 24 }, language,
  }, client);
}

export async function awardFastestGrowingDay({
  authorId, jokeId, windowStart, windowEnd, likeCount, language, now,
}, client) {
  const lang = normalizeLanguage(language);
  const validTo = addUtcDays(windowEnd, 1);
  const context = {
    jokeId, likeCount24h: likeCount, windowHours: 24, language: lang,
    rule: "UTC_DAY_V1", windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(),
  };
  await client.badgeAward.upsert({
    where: { badge_language_scoringWindowStart: {
      badge: FEATURED_JOKE.FASTEST_GROWING, language: lang, scoringWindowStart: windowStart,
    } },
    update: {},
    create: {
      userId: authorId, badge: FEATURED_JOKE.FASTEST_GROWING, language: lang,
      scoringWindowStart: windowStart, validFrom: windowEnd, validTo, context,
    },
  });
  // Catch-up historical awards must never replace a newer/current daily winner.
  if (windowEnd <= now && now < validTo) {
    await client.currentUserBadge.deleteMany({
      where: { badge: FEATURED_JOKE.FASTEST_GROWING, language: lang, since: { lte: windowEnd } },
    });
    const newer = await client.currentUserBadge.findFirst({
      where: { badge: FEATURED_JOKE.FASTEST_GROWING, language: lang, since: { gt: windowEnd } },
    });
    if (!newer) {
      await client.currentUserBadge.upsert({
        where: { userId_badge_language: { userId: authorId, badge: FEATURED_JOKE.FASTEST_GROWING, language: lang } },
        update: { since: windowEnd, validTo, context },
        create: { userId: authorId, badge: FEATURED_JOKE.FASTEST_GROWING, language: lang, since: windowEnd, validTo, context },
      });
    }
  }
}

export default {
  getBadgeHistoryForUser,
  awardJokeOfTheDayToAuthor,
  awardTopCreatorMonthToUser,
  awardMostCommentedWeekToAuthor,
  awardTrendingWeekToAuthor,
  awardFastestGrowingToAuthor,
  awardFastestGrowingDay,
};
