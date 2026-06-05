import prisma from "../config/prismaClient.js";
import { BADGE, FEATURED_JOKE } from "../constants.js";
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

export async function awardJokeOfTheDayToAuthor({ authorId, jokeId, dayUtc, language }) {
  const lang = normalizeLanguage(language);

  await prisma.badgeAward.upsert({
    where: {
      userId_badge_validFrom_language: {
        userId: authorId,
        badge: BADGE.JOKE_OF_DAY,
        validFrom: dayUtc,
        language: lang,
      },
    },
    update: {},
    create: {
      userId: authorId,
      badge: BADGE.JOKE_OF_DAY,
      validFrom: dayUtc,
      language: lang,
      context: { jokeId, language: lang },
    },
  });

  await prisma.currentUserBadge.upsert({
    where: {
      userId_badge_language: {
        userId: authorId,
        badge: BADGE.JOKE_OF_DAY,
        language: lang,
      },
    },
    update: {
      since: dayUtc,
      context: { jokeId, language: lang },
      validTo: null,
    },
    create: {
      userId: authorId,
      badge: BADGE.JOKE_OF_DAY,
      language: lang,
      since: dayUtc,
      context: { jokeId, language: lang },
      validTo: null,
    },
  });
}

export async function awardTopCreatorMonthToUser({
  userId,
  monthStartUtc,
  monthEndUtc,
  jokeCount,
  context,
  language,
}) {
  const lang = normalizeLanguage(language);

  await prisma.badgeAward.upsert({
    where: {
      userId_badge_validFrom_language: {
        userId,
        badge: BADGE.TOP_CREATOR_MONTH,
        validFrom: monthStartUtc,
        language: lang,
      },
    },
    update: {
      validTo: monthEndUtc,
      context: { jokeCount, ...(context || {}), language: lang },
    },
    create: {
      userId,
      badge: BADGE.TOP_CREATOR_MONTH,
      validFrom: monthStartUtc,
      validTo: monthEndUtc,
      language: lang,
      context: { jokeCount, ...(context || {}), language: lang },
    },
  });

  await prisma.currentUserBadge.upsert({
    where: {
      userId_badge_language: { userId, badge: BADGE.TOP_CREATOR_MONTH, language: lang },
    },
    update: {
      since: monthStartUtc,
      validTo: monthEndUtc,
      context: { jokeCount, ...(context || {}), language: lang },
    },
    create: {
      userId,
      badge: BADGE.TOP_CREATOR_MONTH,
      language: lang,
      since: monthStartUtc,
      validTo: monthEndUtc,
      context: { jokeCount, ...(context || {}), language: lang },
    },
  });
}

export async function awardMostCommentedWeekToAuthor({
  authorId,
  jokeId,
  weekStartUtc,
  weekEndUtc,
  commentCount,
  language,
}) {
  const lang = normalizeLanguage(language);

  await prisma.badgeAward.upsert({
    where: {
      userId_badge_validFrom_language: {
        userId: authorId,
        badge: FEATURED_JOKE.MOST_COMMENTED_WEEK,
        validFrom: weekStartUtc,
        language: lang,
      },
    },
    update: {
      validTo: weekEndUtc,
      context: { jokeId, commentCount, language: lang },
    },
    create: {
      userId: authorId,
      badge: FEATURED_JOKE.MOST_COMMENTED_WEEK,
      validFrom: weekStartUtc,
      validTo: weekEndUtc,
      language: lang,
      context: { jokeId, commentCount, language: lang },
    },
  });

  await prisma.currentUserBadge.upsert({
    where: {
      userId_badge_language: {
        userId: authorId,
        badge: FEATURED_JOKE.MOST_COMMENTED_WEEK,
        language: lang,
      },
    },
    update: {
      since: weekStartUtc,
      validTo: weekEndUtc,
      context: { jokeId, commentCount, language: lang },
    },
    create: {
      userId: authorId,
      badge: FEATURED_JOKE.MOST_COMMENTED_WEEK,
      language: lang,
      since: weekStartUtc,
      validTo: weekEndUtc,
      context: { jokeId, commentCount, language: lang },
    },
  });
}

export async function awardTrendingWeekToAuthor({
  authorId,
  jokeId,
  weekStartUtc,
  weekEndUtc,
  likeCount,
  language,
}) {
  const lang = normalizeLanguage(language);

  await prisma.badgeAward.upsert({
    where: {
      userId_badge_validFrom_language: {
        userId: authorId,
        badge: FEATURED_JOKE.TRENDING_WEEK,
        validFrom: weekStartUtc,
        language: lang,
      },
    },
    update: {
      validTo: weekEndUtc,
      context: { jokeId, likeCount, language: lang },
    },
    create: {
      userId: authorId,
      badge: FEATURED_JOKE.TRENDING_WEEK,
      validFrom: weekStartUtc,
      validTo: weekEndUtc,
      language: lang,
      context: { jokeId, likeCount, language: lang },
    },
  });

  await prisma.currentUserBadge.upsert({
    where: {
      userId_badge_language: {
        userId: authorId,
        badge: FEATURED_JOKE.TRENDING_WEEK,
        language: lang,
      },
    },
    update: {
      since: weekStartUtc,
      validTo: weekEndUtc,
      context: { jokeId, likeCount, language: lang },
    },
    create: {
      userId: authorId,
      badge: FEATURED_JOKE.TRENDING_WEEK,
      language: lang,
      since: weekStartUtc,
      validTo: weekEndUtc,
      context: { jokeId, likeCount, language: lang },
    },
  });
}

export async function awardFastestGrowingToAuthor({
  authorId,
  jokeId,
  validFromUtc,
  validToUtc,
  likeCount24h,
  language,
}) {
  const lang = normalizeLanguage(language);

  await prisma.badgeAward.upsert({
    where: {
      userId_badge_validFrom_language: {
        userId: authorId,
        badge: FEATURED_JOKE.FASTEST_GROWING,
        validFrom: validFromUtc,
        language: lang,
      },
    },
    update: {
      validTo: validToUtc,
      context: { jokeId, likeCount24h, windowHours: 24, language: lang },
    },
    create: {
      userId: authorId,
      badge: FEATURED_JOKE.FASTEST_GROWING,
      validFrom: validFromUtc,
      validTo: validToUtc,
      language: lang,
      context: { jokeId, likeCount24h, windowHours: 24, language: lang },
    },
  });

  await prisma.currentUserBadge.upsert({
    where: {
      userId_badge_language: {
        userId: authorId,
        badge: FEATURED_JOKE.FASTEST_GROWING,
        language: lang,
      },
    },
    update: {
      since: validFromUtc,
      validTo: validToUtc,
      context: { jokeId, likeCount24h, windowHours: 24, language: lang },
    },
    create: {
      userId: authorId,
      badge: FEATURED_JOKE.FASTEST_GROWING,
      language: lang,
      since: validFromUtc,
      validTo: validToUtc,
      context: { jokeId, likeCount24h, windowHours: 24, language: lang },
    },
  });
}

export default {
  getBadgeHistoryForUser,
  awardJokeOfTheDayToAuthor,
  awardTopCreatorMonthToUser,
  awardMostCommentedWeekToAuthor,
  awardTrendingWeekToAuthor,
  awardFastestGrowingToAuthor,
};