import { matchedData } from "express-validator";
import jokeService from "../services/jokeService.js";
import userService from "../services/userService.js";
import CustomError from "../utils/CustomError.js";
import normalizeTags from "../utils/normalizeTags.js";
import successResponse from "../utils/successResponse.js";
import { toClientUser } from "../utils/toClientUser.js";
import { isSameUtcDay, isYesterdayUtc } from "../utils/date.js";
import { buildPageMeta } from "../utils/paginationMeta.js";
import { moderateFields } from "../utils/moderation.js";
import logService from "../services/logService.js";
import { getModerationLogData } from "../utils/moderationLogData.js";

async function getAllJokes(req, res, next) {
  const language = req.language;

  const queryParams = matchedData(req);
  queryParams.tag = queryParams.tag ? normalizeTags(queryParams.tag) : undefined;

  const { items, total, page, limit } = await jokeService.getAllJokes({
    ...queryParams,
    language,
  });

  const meta = buildPageMeta({ page, limit, total });

  const message = items.length > 0 ? "Joke(s) retrieved successfully" : "No jokes found";
  return successResponse(res, 200, message, items, items.length, meta);
}

async function getPopularJokes(req, res, next) {
  const language = req.language;

  const queryParams = matchedData(req, { locations: ["query"] }) || {};
  queryParams.tag = queryParams.tag ? normalizeTags(queryParams.tag) : undefined;

  const jokes = await jokeService.getPopularJokes({ ...queryParams, language });

  const message = jokes.length > 0 ? "Joke(s) retrieved successfully" : "No jokes found";
  const data = jokes.length > 0 ? jokes : [];
  const count = jokes.length;

  return successResponse(res, 200, message, data, count);
}

async function getRandomJoke(req, res, next) {
  const language = req.language;

  const joke = await jokeService.getRandomJoke({ language });
  const message = joke ? "Joke retrieved successfully" : "No joke found";
  const count = joke ? 1 : 0;

  return successResponse(res, 200, message, joke, count);
}

async function getDailyJoke(req, res, next) {
  const language = req.language;

  const joke = await jokeService.getDailyJoke({ language });
  const message = joke ? "Joke retrieved successfully" : "No joke found";
  const count = joke ? 1 : 0;

  return successResponse(res, 200, message, joke, count);
}

async function getAllJokesFromUser(req, res, next) {
  const language = req.language;

  const userId = Number(req.params?.id);
  if (isNaN(userId)) return next(new CustomError(400, "Invalid id given"));

  const queryParams = matchedData(req);
  queryParams.tag = queryParams.tag ? normalizeTags(queryParams.tag) : undefined;

  const { items, total, page, limit } = await jokeService.getAllJokesByAuthor(userId, {
    ...queryParams,
    language,
  });

  const meta = buildPageMeta({ page, limit, total });

  const message = items.length > 0 ? "Joke(s) retrieved successfully" : "No jokes found for this user";
  return successResponse(res, 200, message, items, items.length, meta);
}

async function getJoke(req, res, next) {
  const language = req.language;

  const jokeId = Number(req.params?.id);
  if (isNaN(jokeId)) {
    return next(new CustomError(400, "Invalid id given"));
  }

  const requesterId = Number(req.user?.id);
  const requesterRole = req.user?.role ?? null;

  const joke = await jokeService.getJokeById(jokeId, {
    language,
    requesterId: Number.isNaN(requesterId) ? null : requesterId,
    requesterRole,
  });

  if (!joke) {
    return successResponse(res, 404, "No joke found", null, 0);
  }

  return successResponse(res, 200, "Joke retrieved successfully", joke, 1);
}

async function createJoke(req, res, next) {
  const language = req.language;

  const { title, body, published, tags } = matchedData(req);

  const moderation = moderateFields({
    title,
    body,
    tags: Array.isArray(tags) ? tags.join(" ") : tags,
  });

  if (moderation.blocked) {
    const { matchedTerms, matchedVariants } = getModerationLogData(moderation);

    await logService.createModerationEvent({
      userId: Number(req.user?.id) || null,
      action: "create_joke",
      blocked: true,
      fieldNames: ["title", "body", "tags"],
      matchedTerms,
      matchedVariants,
      contentPreview: [title, body].filter(Boolean).join(" | ").slice(0, 160),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
    });

    return next(
      new CustomError(400, "Content contains blocked language", [
        { field: "content", message: "Contains inappropriate language" },
      ]),
    );
  }

  const authorId = Number(req.user?.id);
  if (isNaN(authorId)) return next(new CustomError(401, "Unauthorized"));

  const normalizedTags = tags ? normalizeTags(tags) : [];

  const createdJoke = await jokeService.createJoke(authorId, title, body, published, normalizedTags, {
    language,
  });

  const message = published === true ? "Joke was successfully published" : "Joke was successfully drafted";

  if (createdJoke?.published) {
    await logService.createProductEvent({
      userId: authorId,
      type: "JOKE_PUBLISHED",
      path: req.originalUrl,
      language: createdJoke.language,
      metadata: {
        jokeId: createdJoke.id,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
    });
  }

  return successResponse(res, 200, message, createdJoke, 1);
}

async function updateJoke(req, res, next) {
  const language = req.language;

  const jokeId = Number(req.params?.id);
  if (isNaN(jokeId)) return next(new CustomError(400, "Invalid id given"));

  const { title, body, published, tags } = matchedData(req);
  const normalizedTags = tags ? normalizeTags(tags) : undefined;

  const moderation = moderateFields({
    title,
    body,
    tags: Array.isArray(normalizedTags) ? normalizedTags.join(" ") : "",
  });

  if (moderation.blocked) {
    const { matchedTerms, matchedVariants } = getModerationLogData(moderation);

    await logService.createModerationEvent({
      userId: Number(req.user?.id) || null,
      action: "create_joke",
      blocked: true,
      fieldNames: ["title", "body", "tags"],
      matchedTerms,
      matchedVariants,
      contentPreview: [title, body].filter(Boolean).join(" | ").slice(0, 160),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
    });

    return next(
      new CustomError(400, "Content contains blocked language", [
        { field: "content", message: "Contains inappropriate language" },
      ]),
    );
  }

  const updatedJoke = await jokeService.updateJoke(
    jokeId,
    { title, body, published, tags: normalizedTags },
    {
      language,
      requesterId: req.user?.id ?? null,
      requesterRole: req.user?.role ?? null,
    },
  );

  if (!updatedJoke) return next(new CustomError(404, "Joke not found for this language"));

  return successResponse(res, 200, "Joke was successfully updated", updatedJoke, 1);
}

async function deleteJoke(req, res, next) {
  const language = req.language;

  const jokeId = Number(req.params?.id);
  if (isNaN(jokeId)) return next(new CustomError(400, "Invalid id given"));

  const deleted = await jokeService.deleteJoke(jokeId, { language });
  if (!deleted) return next(new CustomError(404, "Joke not found for this language"));

  return successResponse(res, 200, "Joke successfully deleted");
}

async function getAllDraftsFromCurrentUser(req, res, next) {
  const language = req.language;

  const userId = Number(req.user?.id);
  if (isNaN(userId)) return next(new CustomError(401, "Unauthorized"));

  const queryParams = matchedData(req);
  queryParams.tag = queryParams.tag ? normalizeTags(queryParams.tag) : undefined;
  queryParams.published = false;

  const { items, total, page, limit } = await jokeService.getAllJokesByAuthor(userId, {
    ...queryParams,
    language,
  });

  const meta = buildPageMeta({ page, limit, total });

  const message = items.length > 0 ? "Drafts retrieved successfully" : "No drafts found for this user";
  return successResponse(res, 200, message, items, items.length, meta);
}

async function getAllDrafts(req, res, next) {
  const language = req.language;

  const queryParams = matchedData(req);
  queryParams.tag = queryParams.tag ? normalizeTags(queryParams.tag) : undefined;

  const drafts = await jokeService.getAllDrafts({ ...queryParams, language });

  const message = drafts.length > 0 ? "Drafts retrieved successfully" : "No drafts found";
  const data = drafts.length > 0 ? drafts : [];
  const count = drafts.length;

  return successResponse(res, 200, message, data, count);
}

async function publishDraft(req, res, next) {
  const language = req.language;

  const jokeId = Number(req.params?.id);
  if (isNaN(jokeId)) return next(new CustomError(400, "Invalid id given"));

  const published = await jokeService.publishDraft(jokeId, { language });
  if (!published) return next(new CustomError(404, "Draft not found for this language"));

  await logService.createProductEvent({
    userId: Number(req.user?.id) || null,
    type: "JOKE_PUBLISHED",
    path: req.originalUrl,
    language,
    metadata: {
      jokeId,
      source: "publish_draft",
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null,
  });

  return successResponse(res, 200, "Draft successfully published");
}

async function searchJokes(req, res, next) {
  const language = req.language;

  const data = matchedData(req);
  const { searchParameters, page, limit, sort } = data;

  const filters = {
    title: data.title ?? true,
    body: data.body ?? true,
    comments: data.comments ?? true,
    tags: data.tags ?? true,
  };

  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.max(1, parseInt(limit, 10) || 15);

  if (!searchParameters || typeof searchParameters !== "string" || !searchParameters.trim()) {
    const meta = buildPageMeta({
      page: parsedPage,
      limit: parsedLimit,
      total: 0,
    });

    return successResponse(res, 200, "No search parameters were given", [], 0, meta);
  }

  const terms = searchParameters
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (terms.length === 0) {
    const meta = buildPageMeta({
      page: parsedPage,
      limit: parsedLimit,
      total: 0,
    });

    await logService.createProductEvent({
      userId: Number(req.user?.id) || null,
      type: "SEARCH_EXECUTED",
      path: req.originalUrl,
      language,
      metadata: {
        queryLength: searchParameters.trim().length,
        filters,
        resultCount: items.length,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
    });

    return successResponse(res, 200, "No search parameters were given", [], 0, meta);
  }

  const {
    items,
    total,
    page: currentPage,
    limit: currentLimit,
  } = await jokeService.searchJokes(terms, {
    language,
    page: parsedPage,
    limit: parsedLimit,
    sort,
    filters,
  });

  const meta = buildPageMeta({
    page: currentPage,
    limit: currentLimit,
    total,
  });

  const message = items.length > 0 ? "Jokes retrieved successfully" : "No jokes were found";

  return successResponse(res, 200, message, items, items.length, meta);
}

async function toggleLike(req, res, next) {
  const language = req.language;

  const userId = Number(req.user?.id);
  if (isNaN(userId)) return next(new CustomError(401, "Unauthorized"));

  const jokeId = Number(req.params?.id);
  if (isNaN(jokeId)) return next(new CustomError(400, "Invalid id given"));

  const joke = await jokeService.getJokeById(jokeId, { language, published: true });
  if (!joke) {
    return next(new CustomError(404, `No joke with id ${jokeId} found for this language`));
  }

  const existing = await jokeService.hasLiked(jokeId, userId);

  if (existing) {
    await jokeService.removeLike(jokeId, userId);
    return successResponse(res, 200, "Unliked joke");
  }

  await jokeService.addLike(jokeId, userId);
  return successResponse(res, 201, "Liked joke");
}

async function recordDailyJokeView(req, res, next) {
  const currentUser = req.user;
  if (!currentUser?.id) {
    return next(new CustomError(401, "Unauthorized. Please log in."));
  }

  const userId = Number(currentUser.id);
  const user = await userService.getUserById(userId);
  if (!user) return next(new CustomError(404, "User not found"));
  if (!user.active) return next(new CustomError(403, "User is inactive"));

  const now = new Date();
  const last = user.dailyJokeLastViewedAt;

  let newStreak = user.dailyJokeStreak ?? 0;

  if (!last) {
    newStreak = 1;
  } else if (isSameUtcDay(last, now)) {
    newStreak = user.dailyJokeStreak ?? 0;
  } else if (isYesterdayUtc(last, now)) {
    newStreak = (user.dailyJokeStreak ?? 0) + 1;
  } else {
    newStreak = 1;
  }

  const best = Math.max(user.dailyJokeBestStreak ?? 0, newStreak);

  const updated = await userService.updateUser(userId, {
    dailyJokeStreak: newStreak,
    dailyJokeBestStreak: best,
    dailyJokeLastViewedAt: now,
  });

  await logService.createProductEvent({
    userId,
    type: "DAILY_JOKE_VIEW",
    path: req.originalUrl,
    language: req.language || null,
    metadata: {
      streak: updated.dailyJokeStreak,
      bestStreak: updated.dailyJokeBestStreak,
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null,
  });

  return successResponse(res, 200, "Daily joke view recorded", {
    dailyJokeStreak: updated.dailyJokeStreak,
    dailyJokeBestStreak: updated.dailyJokeBestStreak,
    dailyJokeLastViewedAt: updated.dailyJokeLastViewedAt,
  });
}

export default {
  getAllJokesFromUser,
  getAllJokes,
  getPopularJokes,
  getRandomJoke,
  getDailyJoke,
  recordDailyJokeView,
  getJoke,
  createJoke,
  updateJoke,
  deleteJoke,
  getAllDraftsFromCurrentUser,
  getAllDrafts,
  publishDraft,
  searchJokes,
  toggleLike,
};
