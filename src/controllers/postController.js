import { matchedData } from "express-validator";
import postService from "../services/postService.js";
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

async function getAllPosts(req, res, next) {
  const language = req.language;

  const queryParams = matchedData(req);
  queryParams.tag = queryParams.tag ? normalizeTags(queryParams.tag) : undefined;

  const { items, total, page, limit } = await postService.getAllPosts({
    ...queryParams,
    language,
  });

  const meta = buildPageMeta({ page, limit, total });

  const message = items.length > 0 ? "Post(s) retrieved successfully" : "No posts found";
  return successResponse(res, 200, message, items, items.length, meta);
}

async function getPopularPosts(req, res, next) {
  const language = req.language;

  const queryParams = matchedData(req, { locations: ["query"] }) || {};
  queryParams.tag = queryParams.tag ? normalizeTags(queryParams.tag) : undefined;

  const posts = await postService.getPopularPosts({ ...queryParams, language });

  const message = posts.length > 0 ? "Post(s) retrieved successfully" : "No posts found";
  const data = posts.length > 0 ? posts : [];
  const count = posts.length;

  return successResponse(res, 200, message, data, count);
}

async function getRandomPost(req, res, next) {
  const language = req.language;

  const post = await postService.getRandomPost({ language });
  const message = post ? "Post retrieved successfully" : "No post found";
  const count = post ? 1 : 0;

  return successResponse(res, 200, message, post, count);
}

async function getDailyPost(req, res, next) {
  const language = req.language;

  const post = await postService.getDailyPost({ language });
  const message = post ? "Post retrieved successfully" : "No post found";
  const count = post ? 1 : 0;

  return successResponse(res, 200, message, post, count);
}

async function getAllPostsFromUser(req, res, next) {
  const language = req.language;

  const userId = Number(req.params?.id);
  if (isNaN(userId)) return next(new CustomError(400, "Invalid id given"));

  const queryParams = matchedData(req);
  queryParams.tag = queryParams.tag ? normalizeTags(queryParams.tag) : undefined;

  const { items, total, page, limit } = await postService.getAllPostsByAuthor(userId, {
    ...queryParams,
    language,
  });

  const meta = buildPageMeta({ page, limit, total });

  const message = items.length > 0 ? "Post(s) retrieved successfully" : "No posts found for this user";
  return successResponse(res, 200, message, items, items.length, meta);
}

async function getPost(req, res, next) {
  const language = req.language;

  const postId = Number(req.params?.id);
  if (isNaN(postId)) {
    return next(new CustomError(400, "Invalid id given"));
  }

  const requesterId = Number(req.user?.id);
  const requesterRole = req.user?.role ?? null;

  const post = await postService.getPostById(postId, {
    language,
    requesterId: Number.isNaN(requesterId) ? null : requesterId,
    requesterRole,
  });

  if (!post) {
    return successResponse(res, 404, "No post found", null, 0);
  }

  return successResponse(res, 200, "Post retrieved successfully", post, 1);
}

async function createPost(req, res, next) {
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
      action: "create_post",
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

  const createdPost = await postService.createPost(authorId, title, body, published, normalizedTags, {
    language,
  });

  const message = published === true ? "Post was successfully published" : "Post was successfully drafted";

  if (createdPost?.published) {
    await logService.createProductEvent({
      userId: authorId,
      type: "POST_PUBLISHED",
      path: req.originalUrl,
      language: createdPost.language,
      metadata: {
        postId: createdPost.id,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
    });
  }

  return successResponse(res, 200, message, createdPost, 1);
}

async function updatePost(req, res, next) {
  const language = req.language;

  const postId = Number(req.params?.id);
  if (isNaN(postId)) return next(new CustomError(400, "Invalid id given"));

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
      action: "create_post",
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

  const updatedPost = await postService.updatePost(
    postId,
    { title, body, published, tags: normalizedTags },
    {
      language,
      requesterId: req.user?.id ?? null,
      requesterRole: req.user?.role ?? null,
    },
  );

  if (!updatedPost) return next(new CustomError(404, "Post not found for this language"));

  return successResponse(res, 200, "Post was successfully updated", updatedPost, 1);
}

async function deletePost(req, res, next) {
  const language = req.language;

  const postId = Number(req.params?.id);
  if (isNaN(postId)) return next(new CustomError(400, "Invalid id given"));

  const deleted = await postService.deletePost(postId, { language });
  if (!deleted) return next(new CustomError(404, "Post not found for this language"));

  return successResponse(res, 200, "Post successfully deleted");
}

async function getAllDraftsFromCurrentUser(req, res, next) {
  const language = req.language;

  const userId = Number(req.user?.id);
  if (isNaN(userId)) return next(new CustomError(401, "Unauthorized"));

  const queryParams = matchedData(req);
  queryParams.tag = queryParams.tag ? normalizeTags(queryParams.tag) : undefined;
  queryParams.published = false;

  const { items, total, page, limit } = await postService.getAllPostsByAuthor(userId, {
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

  const drafts = await postService.getAllDrafts({ ...queryParams, language });

  const message = drafts.length > 0 ? "Drafts retrieved successfully" : "No drafts found";
  const data = drafts.length > 0 ? drafts : [];
  const count = drafts.length;

  return successResponse(res, 200, message, data, count);
}

async function publishDraft(req, res, next) {
  const language = req.language;

  const postId = Number(req.params?.id);
  if (isNaN(postId)) return next(new CustomError(400, "Invalid id given"));

  const published = await postService.publishDraft(postId, { language });
  if (!published) return next(new CustomError(404, "Draft not found for this language"));

  await logService.createProductEvent({
    userId: Number(req.user?.id) || null,
    type: "POST_PUBLISHED",
    path: req.originalUrl,
    language,
    metadata: {
      postId,
      source: "publish_draft",
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null,
  });

  return successResponse(res, 200, "Draft successfully published");
}

async function searchPosts(req, res, next) {
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
  } = await postService.searchPosts(terms, {
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

  const message = items.length > 0 ? "Posts retrieved successfully" : "No posts were found";

  return successResponse(res, 200, message, items, items.length, meta);
}

async function toggleLike(req, res, next) {
  const language = req.language;

  const userId = Number(req.user?.id);
  if (isNaN(userId)) return next(new CustomError(401, "Unauthorized"));

  const postId = Number(req.params?.id);
  if (isNaN(postId)) return next(new CustomError(400, "Invalid id given"));

  const post = await postService.getPostById(postId, { language, published: true });
  if (!post) {
    return next(new CustomError(404, `No post with id ${postId} found for this language`));
  }

  const existing = await postService.hasLiked(postId, userId);

  if (existing) {
    await postService.removeLike(postId, userId);
    return successResponse(res, 200, "Unliked post");
  }

  await postService.addLike(postId, userId);
  return successResponse(res, 201, "Liked post");
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
  getAllPostsFromUser,
  getAllPosts,
  getPopularPosts,
  getRandomPost,
  getDailyPost,
  recordDailyJokeView,
  getPost,
  createPost,
  updatePost,
  deletePost,
  getAllDraftsFromCurrentUser,
  getAllDrafts,
  publishDraft,
  searchPosts,
  toggleLike,
};
