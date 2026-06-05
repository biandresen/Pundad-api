import prisma from "../config/prismaClient.js";
import { Prisma } from "@prisma/client";

import { FEATURED_JOKE } from "../constants.js";
import { startOfUtcDay } from "../utils/date.js";
import { deterministicIndex } from "../utils/deterministicIndex.js";
import badgeService from "./badgeService.js";
import { normalizeLanguage } from "../utils/language.js";

/**
 * Base user fields always returned with jokes
 * (language-independent)
 */
const BASE_USER_SELECT = {
  id: true,
  username: true,
  avatar: true,
  role: true,
  dailyJokeStreak: true,
  dailyJokeBestStreak: true,
};

/**
 * Build language-filtered user selection
 * Ensures badges only appear for the active language
 */
function buildIncludedUser(language) {
  const lang = normalizeLanguage(language);

  return {
    ...BASE_USER_SELECT,
    currentBadges: {
      where: {
        language: lang,
      },
      select: {
        id: true,
        badge: true,
        since: true,
        validTo: true,
        context: true,
        language: true,
      },
    },
  };
}

/**
 * Build joke include with language-aware author badges
 */
function buildJokeInclude(language) {
  const lang = normalizeLanguage(language);

  return {
    tags: true,

    likes: {
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    },

    user: {
      select: buildIncludedUser(lang),
    },
  };
}

/**
 * Tag normalization (optional but recommended)
 * Prevent duplicate tags like "Dad" and "dad", or " dad "
 */
function normalizeTagName(name) {
  return name.toString().trim().replace(/\s+/g, " ");
}

function uniqueNormalizedTags(tags) {
  if (!Array.isArray(tags)) return [];
  const set = new Set();
  for (const t of tags) {
    if (t == null) continue;
    const nt = normalizeTagName(t);
    if (!nt) continue;
    set.add(nt);
  }
  return [...set];
}

async function getAllJokes({ language, page = 1, limit = 15, sort = "asc", tag = null } = {}) {
  const lang = normalizeLanguage(language);

  const parsedPage = Math.max(1, parseInt(page) || 1);
  const parsedLimit = Math.max(1, parseInt(limit) || 15);
  const skip = (parsedPage - 1) * parsedLimit;

  const where = {
    language: lang,
    published: true,
    ...(tag?.length && {
      tags: {
        some: {
          // tags are language-scoped in DB, but we still filter by name
          name: { in: tag.map(normalizeTagName) },
        },
      },
    }),
  };

  const orderBy = {
    createdAt: sort.toLowerCase() === "asc" ? "asc" : "desc",
  };

  const [items, total] = await Promise.all([
    prisma.joke.findMany({
      where,
      orderBy,
      skip,
      take: parsedLimit,
      include: buildJokeInclude(lang),
    }),
    prisma.joke.count({ where }),
  ]);

  return { items, total, page: parsedPage, limit: parsedLimit, language: lang };
}

async function getAllDrafts({ language, page = 1, limit = 100, sort = "desc", tag = null } = {}) {
  const lang = normalizeLanguage(language);

  const parsedPage = Math.max(1, parseInt(page) || 1);
  const parsedLimit = Math.max(1, parseInt(limit) || 100);
  const skip = (parsedPage - 1) * parsedLimit;

  return prisma.joke.findMany({
    where: {
      language: lang,
      published: false,
      ...(tag?.length && {
        tags: {
          some: {
            name: { in: tag.map(normalizeTagName) },
          },
        },
      }),
    },
    orderBy: {
      createdAt: sort.toLowerCase() === "asc" ? "asc" : "desc",
    },
    skip,
    take: parsedLimit,
    include: {
      tags: true,
      user: {
        select: buildIncludedUser(lang),
      },
    },
  });
}

async function getAllJokesByAuthor(
  authorId,
  { language, page = 1, limit = 15, sort = "desc", tag = null, published = true } = {},
) {
  const lang = normalizeLanguage(language);

  const parsedPage = Math.max(1, parseInt(page) || 1);
  const parsedLimit = Math.max(1, parseInt(limit) || 15);
  const skip = (parsedPage - 1) * parsedLimit;

  const where = {
    authorId,
    language: lang,
    ...(typeof published === "boolean" && { published }),
    ...(tag?.length && {
      tags: {
        some: { name: { in: tag.map(normalizeTagName) } },
      },
    }),
  };

  const orderBy = {
    createdAt: sort.toLowerCase() === "asc" ? "asc" : "desc",
  };

  const [items, total] = await Promise.all([
    prisma.joke.findMany({
      where,
      orderBy,
      skip,
      take: parsedLimit,
      include: buildJokeInclude(lang),
    }),
    prisma.joke.count({ where }),
  ]);

  return { items, total, page: parsedPage, limit: parsedLimit, language: lang };
}

async function getJokeById(jokeId, { language, requesterId = null, requesterRole = null } = {}) {
  const lang = normalizeLanguage(language);

  const joke = await prisma.joke.findFirst({
    where: {
      id: jokeId,
      language: lang,
    },
    include: buildJokeInclude(lang),
  });

  if (!joke) return null;

  // Public joke
  if (joke.published) {
    return joke;
  }

  // Draft visible to author
  if (requesterId != null && joke.authorId === requesterId) {
    return joke;
  }

  // Draft visible to admin
  if (requesterRole === "ADMIN") {
    return joke;
  }

  return null;
}

async function getRandomJoke({ language } = {}) {
  const lang = normalizeLanguage(language);

  const count = await prisma.joke.count({
    where: { language: lang, published: true },
  });

  if (count === 0) return null;

  const skip = Math.floor(Math.random() * count);

  const [joke] = await prisma.joke.findMany({
    where: { language: lang, published: true },
    orderBy: { id: "asc" },
    skip,
    take: 1,
    include: buildJokeInclude(lang),
  });

  return joke ?? null;
}

async function getDailyJoke({ language } = {}) {
  const lang = normalizeLanguage(language);
  const dayUtc = startOfUtcDay(new Date());

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

  if (!existing?.jokeId) return null;

  return getJokeById(existing.jokeId, { language: lang, published: true });
}

async function createJoke(
  authorId,
  title = "Title",
  body = "Body...",
  published = false,
  tags = [],
  { language } = {},
) {
  const lang = normalizeLanguage(language);
  const normalizedTags = uniqueNormalizedTags(tags);

  return prisma.joke.create({
    data: {
      authorId,
      language: lang,
      title,
      body,
      published,
      tags: {
        connectOrCreate: normalizedTags.map((tagName) => ({
          // NOTE: requires @@unique([language, name]) on Tag
          where: { language_name: { language: lang, name: tagName } },
          create: { language: lang, name: tagName },
        })),
      },
    },
    include: {
      tags: true,
    },
  });
}

async function updateJoke(
  jokeId,
  { title, body, published, tags },
  { language, requesterId = null, requesterRole = null } = {},
) {
  const lang = normalizeLanguage(language);

  const existing = await prisma.joke.findUnique({
    where: { id: Number(jokeId) },
    select: { id: true, language: true },
  });

  if (!existing || existing.language !== lang) return null;

  const updateData = {};
  if (title !== undefined) updateData.title = title;
  if (body !== undefined) updateData.body = body;
  if (published !== undefined) updateData.published = published;

  if (tags !== undefined) {
    const normalizedTags = uniqueNormalizedTags(tags);

    updateData.tags = {
      set: [],
      connectOrCreate: normalizedTags.map((tagName) => ({
        where: {
          language_name: {
            language: lang,
            name: tagName,
          },
        },
        create: {
          language: lang,
          name: tagName,
        },
      })),
    };
  }

  await prisma.joke.update({
    where: { id: Number(jokeId) },
    data: updateData,
  });

  return getJokeById(jokeId, {
    language: lang,
    requesterId,
    requesterRole,
  });
}

async function deleteJoke(jokeId, { language } = {}) {
  const lang = normalizeLanguage(language);

  // Use deleteMany for language-scoped delete
  const deleted = await prisma.joke.deleteMany({
    where: { id: jokeId, language: lang },
  });

  return deleted.count > 0;
}

async function publishDraft(jokeId, { language } = {}) {
  const lang = normalizeLanguage(language);

  const updated = await prisma.joke.updateMany({
    where: { id: jokeId, language: lang, published: false },
    data: { published: true },
  });

  return updated.count > 0;
}

async function addLike(jokeId, userId) {
  return prisma.jokeLike.create({
    data: {
      jokeId,
      userId,
    },
  });
}

async function removeLike(jokeId, userId) {
  return prisma.jokeLike.deleteMany({
    where: {
      jokeId,
      userId,
    },
  });
}
async function hasLiked(jokeId, userId) {
  return prisma.jokeLike.findUnique({
    where: {
      jokeId_userId: {
        jokeId,
        userId,
      },
    },
  });
}

async function searchJokes(
  searchParameters,
  {
    language,
    page = 1,
    limit = 15,
    sort = "desc",
    filters = { title: true, body: true, comments: true, tags: true },
  } = {},
) {
  const lang = normalizeLanguage(language);

  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.max(1, parseInt(limit, 10) || 15);
  const skip = (parsedPage - 1) * parsedLimit;

  const terms = (Array.isArray(searchParameters) ? searchParameters : [])
    .map((term) => term?.toString()?.trim())
    .filter(Boolean);

  if (terms.length === 0) {
    return {
      items: [],
      total: 0,
      page: parsedPage,
      limit: parsedLimit,
      language: lang,
    };
  }

  const activeFilters = {
    title: !!filters.title,
    body: !!filters.body,
    comments: !!filters.comments,
    tags: !!filters.tags,
  };

  if (!activeFilters.title && !activeFilters.body && !activeFilters.comments && !activeFilters.tags) {
    return {
      items: [],
      total: 0,
      page: parsedPage,
      limit: parsedLimit,
      language: lang,
    };
  }

  const orConditions = terms.flatMap((term) => {
    const conditions = [];

    if (activeFilters.title) {
      conditions.push({
        title: { contains: term, mode: "insensitive" },
      });
    }

    if (activeFilters.body) {
      conditions.push({
        body: { contains: term, mode: "insensitive" },
      });
    }

    if (activeFilters.comments) {
      conditions.push({
        comments: {
          some: {
            body: { contains: term, mode: "insensitive" },
          },
        },
      });
    }

    if (activeFilters.tags) {
      conditions.push({
        tags: {
          some: {
            name: { contains: term, mode: "insensitive" },
          },
        },
      });
    }

    return conditions;
  });

  const where = {
    language: lang,
    published: true,
    OR: orConditions,
  };

  const normalizedSort = sort?.toLowerCase() === "asc" ? "asc" : "desc";

  const [items, total] = await Promise.all([
    prisma.joke.findMany({
      where,
      orderBy: { createdAt: normalizedSort },
      skip,
      take: parsedLimit,
      include: buildJokeInclude(lang),
    }),
    prisma.joke.count({ where }),
  ]);

  return {
    items,
    total,
    page: parsedPage,
    limit: parsedLimit,
    language: lang,
  };
}

async function getPopularJokes({ language, limit = 10, tag = null } = {}) {
  const lang = normalizeLanguage(language);
  const parsedLimit = Math.max(1, parseInt(limit) || 10);

  return prisma.joke.findMany({
    where: {
      language: lang,
      published: true,
      ...(tag?.length && {
        tags: {
          some: {
            name: { in: tag.map(normalizeTagName) },
          },
        },
      }),
    },
    orderBy: [{ likes: { _count: "desc" } }, { createdAt: "desc" }],
    take: parsedLimit,
    include: buildJokeInclude(lang),
  });
}

export default {
  // Reads
  getAllJokes,
  getAllDrafts,
  getAllJokesByAuthor,
  getJokeById,
  getRandomJoke,
  getDailyJoke,
  searchJokes,
  getPopularJokes,

  // Writes
  createJoke,
  updateJoke,
  deleteJoke,
  publishDraft,
  addLike,
  removeLike,
  hasLiked,
};
