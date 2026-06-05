import { Prisma } from "@prisma/client";
import prisma from "../config/prismaClient.js";
import { FEATURED_JOKE } from "../constants.js";
import badgeService from "./badgeService.js";
import logger from "../config/logger.js";
import {
  startOfUtcMonth,
  addUtcMonths,
  startOfUtcWeek,
  addUtcDays,
  startOfUtcHour,
  addUtcHours,
  startOfUtcDay
} from "../utils/date.js";
import jokeService from "./jokeService.js";
import { normalizeLanguage } from "../utils/language.js";

function deterministicIndex(dayUtc, total) {
  const dayNumber = Math.floor(dayUtc.getTime() / (24 * 60 * 60 * 1000));
  return dayNumber % total;
}

export async function computeDailyJoke({ language } = {}) {
  const lang = normalizeLanguage(language);

  const dayUtc = startOfUtcDay(new Date());
  const yesterdayUtc = startOfUtcDay(
    new Date(dayUtc.getTime() - 24 * 60 * 60 * 1000)
  );

  const existing = await prisma.featuredJoke.findUnique({
    where: {
      type_date_language: {
        type: FEATURED_JOKE.DAILY,
        date: dayUtc,
        language: lang,
      },
    },
    select: { jokeId: true },
  });

  if (existing?.jokeId) {
    logger.info(
      {
        event: "featured_compute_skipped_existing",
        featureType: FEATURED_JOKE.DAILY,
        language: lang,
        date: dayUtc,
        jokeId: existing.jokeId,
      },
      "Daily joke already computed"
    );

    return {
      status: "already_exists",
      jokeId: existing.jokeId,
      language: lang,
    };
  }

  const yesterday = await prisma.featuredJoke.findUnique({
    where: {
      type_date_language: {
        type: FEATURED_JOKE.DAILY,
        date: yesterdayUtc,
        language: lang,
      },
    },
    select: { jokeId: true },
  });

  const yesterdayJokeId = yesterday?.jokeId ?? null;

  const whereBase = {
    language: lang,
    published: true,
  };

  const whereExcludingYesterday =
    yesterdayJokeId != null
      ? { ...whereBase, id: { not: yesterdayJokeId } }
      : whereBase;

  const totalExcl = await prisma.joke.count({
    where: whereExcludingYesterday,
  });

  const canExcludeYesterday = yesterdayJokeId != null && totalExcl > 0;
  const finalWhere = canExcludeYesterday ? whereExcludingYesterday : whereBase;
  const total = canExcludeYesterday
    ? totalExcl
    : await prisma.joke.count({ where: whereBase });

  if (total === 0) {
    logger.info(
      {
        event: "featured_compute_no_winner",
        featureType: FEATURED_JOKE.DAILY,
        language: lang,
        date: dayUtc,
      },
      "No daily joke candidate found"
    );

    return {
      status: "no_winner",
      jokeId: null,
      language: lang,
    };
  }

  const index = deterministicIndex(dayUtc, total);

  const picked = await prisma.joke.findMany({
    where: finalWhere,
    orderBy: { id: "asc" },
    skip: index,
    take: 1,
    select: { id: true, authorId: true },
  });

  const joke = picked[0];
  if (!joke) {
    logger.warn(
      {
        event: "featured_compute_missing_pick",
        featureType: FEATURED_JOKE.DAILY,
        language: lang,
        date: dayUtc,
        index,
        total,
      },
      "Daily joke selection produced no joke"
    );

    return {
      status: "missing_pick",
      jokeId: null,
      language: lang,
    };
  }

  try {
    await prisma.featuredJoke.create({
      data: {
        type: FEATURED_JOKE.DAILY,
        date: dayUtc,
        jokeId: joke.id,
        language: lang,
      },
    });

    await badgeService.awardJokeOfTheDayToAuthor({
      authorId: joke.authorId,
      jokeId: joke.id,
      dayUtc,
      language: lang,
    });

    logger.info(
      {
        event: "featured_compute_created",
        featureType: FEATURED_JOKE.DAILY,
        language: lang,
        date: dayUtc,
        jokeId: joke.id,
        authorId: joke.authorId,
      },
      "Daily joke computed and badge awarded"
    );

    return {
      status: "created",
      jokeId: joke.id,
      authorId: joke.authorId,
      language: lang,
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      logger.warn(
        {
          event: "featured_compute_race_condition",
          featureType: FEATURED_JOKE.DAILY,
          language: lang,
          date: dayUtc,
          jokeId: joke.id,
        },
        "Daily joke already created by another concurrent process"
      );

      return {
        status: "duplicate_race",
        jokeId: joke.id,
        language: lang,
      };
    }

    throw e;
  }
}

export async function computeTopCreatorThisMonth({ language } = {}) {
  const lang = normalizeLanguage(language);

  const monthStartUtc = startOfUtcMonth(new Date());
  const monthEndUtc = addUtcMonths(monthStartUtc, 1);

  const existing = await prisma.featuredJoke.findUnique({
    where: {
      type_date_language: {
        type: FEATURED_JOKE.TOP_CREATOR_MONTH,
        date: monthStartUtc,
        language: lang,
      },
    },
    select: { jokeId: true },
  });

  if (existing?.jokeId) {
    logger.info(
      {
        event: "featured_compute_skipped_existing",
        featureType: FEATURED_JOKE.TOP_CREATOR_MONTH,
        language: lang,
        date: monthStartUtc,
        jokeId: existing.jokeId,
      },
      "Top creator month already computed"
    );

    return {
      status: "already_exists",
      jokeId: existing.jokeId,
      language: lang,
    };
  }

  const rows = await prisma.joke.groupBy({
    by: ["authorId"],
    where: {
      language: lang,
      published: true,
      createdAt: { gte: monthStartUtc, lt: monthEndUtc },
    },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });

  const winnerAuthorId = rows[0]?.authorId ?? null;
  const jokeCount = rows[0]?._count?.id ?? 0;

  if (!winnerAuthorId || jokeCount === 0) {
    logger.info(
      {
        event: "featured_compute_no_winner",
        featureType: FEATURED_JOKE.TOP_CREATOR_MONTH,
        language: lang,
        date: monthStartUtc,
      },
      "No top creator month winner found"
    );

    return {
      status: "no_winner",
      jokeId: null,
      language: lang,
    };
  }

  const latest = await prisma.joke.findFirst({
    where: {
      language: lang,
      authorId: winnerAuthorId,
      published: true,
      createdAt: { gte: monthStartUtc, lt: monthEndUtc },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (!latest?.id) {
    logger.warn(
      {
        event: "featured_compute_missing_representative_joke",
        featureType: FEATURED_JOKE.TOP_CREATOR_MONTH,
        language: lang,
        winnerAuthorId,
      },
      "Winner author had no representative joke"
    );

    return {
      status: "missing_representative_joke",
      jokeId: null,
      language: lang,
    };
  }

  try {
    await prisma.featuredJoke.create({
      data: {
        type: FEATURED_JOKE.TOP_CREATOR_MONTH,
        date: monthStartUtc,
        jokeId: latest.id,
        language: lang,
      },
    });

    await badgeService.awardTopCreatorMonthToUser({
      userId: winnerAuthorId,
      monthStartUtc,
      monthEndUtc,
      jokeCount,
      context: { jokeId: latest.id, language: lang },
      language: lang,
    });

    logger.info(
      {
        event: "featured_compute_created",
        featureType: FEATURED_JOKE.TOP_CREATOR_MONTH,
        language: lang,
        date: monthStartUtc,
        jokeId: latest.id,
        winnerAuthorId,
        jokeCount,
      },
      "Top creator month computed and badge awarded"
    );

    return {
      status: "created",
      jokeId: latest.id,
      winnerAuthorId,
      jokeCount,
      language: lang,
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      logger.warn(
        {
          event: "featured_compute_race_condition",
          featureType: FEATURED_JOKE.TOP_CREATOR_MONTH,
          language: lang,
          date: monthStartUtc,
          jokeId: latest.id,
        },
        "Top creator month already created by another concurrent process"
      );

      return {
        status: "duplicate_race",
        jokeId: latest.id,
        language: lang,
      };
    }

    throw e;
  }
}

export async function computeMostCommentedThisWeek({ language } = {}) {
  const lang = normalizeLanguage(language);

  const weekStartUtc = startOfUtcWeek(new Date());
  const weekEndUtc = addUtcDays(weekStartUtc, 7);

  const existing = await prisma.featuredJoke.findUnique({
    where: {
      type_date_language: {
        type: FEATURED_JOKE.MOST_COMMENTED_WEEK,
        date: weekStartUtc,
        language: lang,
      },
    },
    select: { jokeId: true },
  });

  if (existing?.jokeId) {
    logger.info(
      {
        event: "featured_compute_skipped_existing",
        featureType: FEATURED_JOKE.MOST_COMMENTED_WEEK,
        language: lang,
        date: weekStartUtc,
        jokeId: existing.jokeId,
      },
      "Most commented week already computed"
    );

    return {
      status: "already_exists",
      jokeId: existing.jokeId,
      language: lang,
    };
  }

  const commentWhere = {
    createdAt: { gte: weekStartUtc, lt: weekEndUtc },
    joke: { published: true, language: lang },
  };

  const rows = await prisma.comment.groupBy({
    by: ["jokeId"],
    where: commentWhere,
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });

  const winnerJokeId = rows[0]?.jokeId ?? null;
  const commentCount = rows[0]?._count?.id ?? 0;

  if (!winnerJokeId || commentCount === 0) {
    logger.info(
      {
        event: "featured_compute_no_winner",
        featureType: FEATURED_JOKE.MOST_COMMENTED_WEEK,
        language: lang,
        date: weekStartUtc,
      },
      "No most commented week winner found"
    );

    return {
      status: "no_winner",
      jokeId: null,
      language: lang,
    };
  }

  const winnerJoke = await prisma.joke.findFirst({
    where: { id: winnerJokeId, language: lang },
    select: { id: true, authorId: true },
  });

  if (!winnerJoke) {
    logger.warn(
      {
        event: "featured_compute_missing_joke",
        featureType: FEATURED_JOKE.MOST_COMMENTED_WEEK,
        language: lang,
        date: weekStartUtc,
        winnerJokeId,
      },
      "Most commented week winner joke not found"
    );

    return {
      status: "missing_joke",
      jokeId: null,
      language: lang,
    };
  }

  try {
    await prisma.featuredJoke.create({
      data: {
        type: FEATURED_JOKE.MOST_COMMENTED_WEEK,
        date: weekStartUtc,
        jokeId: winnerJoke.id,
        language: lang,
      },
    });

    await badgeService.awardMostCommentedWeekToAuthor({
      authorId: winnerJoke.authorId,
      jokeId: winnerJoke.id,
      weekStartUtc,
      weekEndUtc,
      commentCount,
      language: lang,
    });

    logger.info(
      {
        event: "featured_compute_created",
        featureType: FEATURED_JOKE.MOST_COMMENTED_WEEK,
        language: lang,
        date: weekStartUtc,
        jokeId: winnerJoke.id,
        authorId: winnerJoke.authorId,
        commentCount,
      },
      "Most commented week computed and badge awarded"
    );

    return {
      status: "created",
      jokeId: winnerJoke.id,
      authorId: winnerJoke.authorId,
      commentCount,
      language: lang,
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      logger.warn(
        {
          event: "featured_compute_race_condition",
          featureType: FEATURED_JOKE.MOST_COMMENTED_WEEK,
          language: lang,
          date: weekStartUtc,
          jokeId: winnerJoke.id,
        },
        "Most commented week already created by another concurrent process"
      );

      return {
        status: "duplicate_race",
        jokeId: winnerJoke.id,
        language: lang,
      };
    }

    throw e;
  }
}

export async function computeTrendingThisWeek({ language } = {}) {
  const lang = normalizeLanguage(language);

  const weekStartUtc = startOfUtcWeek(new Date());
  const weekEndUtc = addUtcDays(weekStartUtc, 7);

  const existing = await prisma.featuredJoke.findUnique({
    where: {
      type_date_language: {
        type: FEATURED_JOKE.TRENDING_WEEK,
        date: weekStartUtc,
        language: lang,
      },
    },
    select: { jokeId: true },
  });

  if (existing?.jokeId) {
    logger.info(
      {
        event: "featured_compute_skipped_existing",
        featureType: FEATURED_JOKE.TRENDING_WEEK,
        language: lang,
        date: weekStartUtc,
        jokeId: existing.jokeId,
      },
      "Trending week already computed"
    );

    return {
      status: "already_exists",
      jokeId: existing.jokeId,
      language: lang,
    };
  }

  const likeWhere = {
    createdAt: { gte: weekStartUtc, lt: weekEndUtc },
    joke: { published: true, language: lang },
  };

  const rows = await prisma.jokeLike.groupBy({
    by: ["jokeId"],
    where: likeWhere,
    _count: { jokeId: true },
    orderBy: { _count: { jokeId: "desc" } },
    take: 1,
  });

  const winnerJokeId = rows[0]?.jokeId ?? null;
  const likeCount = rows[0]?._count?.jokeId ?? 0;

  if (!winnerJokeId || likeCount === 0) {
    logger.info(
      {
        event: "featured_compute_no_winner",
        featureType: FEATURED_JOKE.TRENDING_WEEK,
        language: lang,
        date: weekStartUtc,
      },
      "No trending week winner found"
    );

    return {
      status: "no_winner",
      jokeId: null,
      language: lang,
    };
  }

  const winnerJoke = await prisma.joke.findFirst({
    where: { id: winnerJokeId, language: lang },
    select: { id: true, authorId: true },
  });

  if (!winnerJoke) {
    logger.warn(
      {
        event: "featured_compute_missing_joke",
        featureType: FEATURED_JOKE.TRENDING_WEEK,
        language: lang,
        date: weekStartUtc,
        winnerJokeId,
      },
      "Trending week winner joke not found"
    );

    return {
      status: "missing_joke",
      jokeId: null,
      language: lang,
    };
  }

  try {
    await prisma.featuredJoke.create({
      data: {
        type: FEATURED_JOKE.TRENDING_WEEK,
        date: weekStartUtc,
        jokeId: winnerJoke.id,
        language: lang,
      },
    });

    await badgeService.awardTrendingWeekToAuthor({
      authorId: winnerJoke.authorId,
      jokeId: winnerJoke.id,
      weekStartUtc,
      weekEndUtc,
      likeCount,
      language: lang,
    });

    logger.info(
      {
        event: "featured_compute_created",
        featureType: FEATURED_JOKE.TRENDING_WEEK,
        language: lang,
        date: weekStartUtc,
        jokeId: winnerJoke.id,
        authorId: winnerJoke.authorId,
        likeCount,
      },
      "Trending week computed and badge awarded"
    );

    return {
      status: "created",
      jokeId: winnerJoke.id,
      authorId: winnerJoke.authorId,
      likeCount,
      language: lang,
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      logger.warn(
        {
          event: "featured_compute_race_condition",
          featureType: FEATURED_JOKE.TRENDING_WEEK,
          language: lang,
          date: weekStartUtc,
          jokeId: winnerJoke.id,
        },
        "Trending week already created by another concurrent process"
      );

      return {
        status: "duplicate_race",
        jokeId: winnerJoke.id,
        language: lang,
      };
    }

    throw e;
  }
}

export async function computeFastestGrowing24h({ language } = {}) {
  const lang = normalizeLanguage(language);

  const now = new Date();
  const hourKeyUtc = startOfUtcHour(now);
  const windowStart = addUtcHours(now, -24);
  const validFromUtc = hourKeyUtc;
  const validToUtc = addUtcHours(hourKeyUtc, 24);

  const existing = await prisma.featuredJoke.findUnique({
    where: {
      type_date_language: {
        type: FEATURED_JOKE.FASTEST_GROWING,
        date: hourKeyUtc,
        language: lang,
      },
    },
    select: { jokeId: true },
  });

  if (existing?.jokeId) {
    logger.info(
      {
        event: "featured_compute_skipped_existing",
        featureType: FEATURED_JOKE.FASTEST_GROWING,
        language: lang,
        date: hourKeyUtc,
        jokeId: existing.jokeId,
      },
      "Fastest growing 24h already computed"
    );

    return {
      status: "already_exists",
      jokeId: existing.jokeId,
      language: lang,
    };
  }

  const likeWhere = {
    createdAt: { gte: windowStart, lt: now },
    joke: { published: true, language: lang },
  };

  const rows = await prisma.jokeLike.groupBy({
    by: ["jokeId"],
    where: likeWhere,
    _count: { jokeId: true },
    orderBy: { _count: { jokeId: "desc" } },
    take: 1,
  });

  const winnerJokeId = rows[0]?.jokeId ?? null;
  const likeCount24h = rows[0]?._count?.jokeId ?? 0;

  if (!winnerJokeId || likeCount24h === 0) {
    logger.info(
      {
        event: "featured_compute_no_winner",
        featureType: FEATURED_JOKE.FASTEST_GROWING,
        language: lang,
        date: hourKeyUtc,
      },
      "No fastest growing 24h winner found"
    );

    return {
      status: "no_winner",
      jokeId: null,
      language: lang,
    };
  }

  const winnerJoke = await prisma.joke.findFirst({
    where: { id: winnerJokeId, language: lang },
    select: { id: true, authorId: true },
  });

  if (!winnerJoke) {
    logger.warn(
      {
        event: "featured_compute_missing_joke",
        featureType: FEATURED_JOKE.FASTEST_GROWING,
        language: lang,
        date: hourKeyUtc,
        winnerJokeId,
      },
      "Fastest growing 24h winner joke not found"
    );

    return {
      status: "missing_joke",
      jokeId: null,
      language: lang,
    };
  }

  try {
    await prisma.featuredJoke.create({
      data: {
        type: FEATURED_JOKE.FASTEST_GROWING,
        date: hourKeyUtc,
        jokeId: winnerJoke.id,
        language: lang,
      },
    });

    await badgeService.awardFastestGrowingToAuthor({
      authorId: winnerJoke.authorId,
      jokeId: winnerJoke.id,
      validFromUtc,
      validToUtc,
      likeCount24h,
      language: lang,
    });

    logger.info(
      {
        event: "featured_compute_created",
        featureType: FEATURED_JOKE.FASTEST_GROWING,
        language: lang,
        date: hourKeyUtc,
        jokeId: winnerJoke.id,
        authorId: winnerJoke.authorId,
        likeCount24h,
      },
      "Fastest growing 24h computed and badge awarded"
    );

    return {
      status: "created",
      jokeId: winnerJoke.id,
      authorId: winnerJoke.authorId,
      likeCount24h,
      language: lang,
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      logger.warn(
        {
          event: "featured_compute_race_condition",
          featureType: FEATURED_JOKE.FASTEST_GROWING,
          language: lang,
          date: hourKeyUtc,
          jokeId: winnerJoke.id,
        },
        "Fastest growing 24h already created by another concurrent process"
      );

      return {
        status: "duplicate_race",
        jokeId: winnerJoke.id,
        language: lang,
      };
    }

    throw e;
  }
}

export async function getCurrentFeatured(type, { language } = {}) {
  const lang = normalizeLanguage(language);

  const row = await prisma.featuredJoke.findFirst({
    where: { type, language: lang },
    orderBy: { date: "desc" },
    select: { jokeId: true, date: true },
  });

  if (!row) return null;

  const joke = await jokeService.getJokeById(row.jokeId, { language: lang, published: true });
  return { joke, date: row.date, language: lang };
}

export default {
  computeDailyJoke,
  computeTopCreatorThisMonth,
  computeMostCommentedThisWeek,
  computeTrendingThisWeek,
  computeFastestGrowing24h,
  getCurrentFeatured,
};
