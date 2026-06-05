import prisma from "../config/prismaClient.js";
import { INCLUDED_IN_USER } from "../constants.js";
import { normalizeLanguage } from "../utils/language.js";

/**
 * Ensures the target joke exists in the requested language.
 * This is useful for language-scoped read/create flows tied to a joke.
 */
async function assertJokeInLanguage(jokeId, language, { published } = {}) {
  const lang = normalizeLanguage(language);

  return prisma.joke.findFirst({
    where: {
      id: jokeId,
      language: lang,
      ...(typeof published === "boolean" ? { published } : {}),
    },
    select: {
      id: true,
      language: true,
      published: true,
    },
  });
}

/**
 * Create comment on a published joke in the currently selected language.
 * Language is validated through the joke, not stored on the comment itself.
 */
async function createComment(jokeId, authorId, body, { language } = {}) {
  const joke = await assertJokeInLanguage(jokeId, language, { published: true });

  if (!joke) return null;

  return prisma.comment.create({
    data: {
      body,
      authorId,
      jokeId,
    },
    include: {
      user: { select: INCLUDED_IN_USER },
    },
  });
}

/**
 * Get paginated comments for a published joke in the current language.
 * We validate the joke language once, then fetch comments by jokeId only.
 */
async function getAllCommentsFromJoke(
  jokeId,
  { language, page = 1, limit = 10, sort = "asc" } = {}
) {
  const lang = normalizeLanguage(language);

  const joke = await assertJokeInLanguage(jokeId, lang, { published: true });

  if (!joke) {
    return {
      items: [],
      total: 0,
      page: 1,
      limit: Number(limit) || 10,
    };
  }

  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.max(1, parseInt(limit, 10) || 10);
  const skip = (parsedPage - 1) * parsedLimit;
  const normalizedSort = sort?.toLowerCase() === "asc" ? "asc" : "desc";

  const where = {
    jokeId,
  };

  const [items, total] = await Promise.all([
    prisma.comment.findMany({
      where,
      orderBy: { createdAt: normalizedSort },
      skip,
      take: parsedLimit,
      include: {
        user: { select: INCLUDED_IN_USER },
      },
    }),
    prisma.comment.count({ where }),
  ]);

  return {
    items,
    total,
    page: parsedPage,
    limit: parsedLimit,
  };
}

/**
 * Get comment by id only.
 * Comment identity is global and should not depend on current UI language.
 */
async function getCommentById(commentId) {
  return prisma.comment.findUnique({
    where: {
      id: commentId,
    },
    include: {
      user: { select: INCLUDED_IN_USER },
    },
  });
}

/**
 * Delete comment by id only.
 * Authorization should be handled in the controller/service layer above this call.
 */
async function deleteComment(commentId) {
  const res = await prisma.comment.deleteMany({
    where: {
      id: commentId,
    },
  });

  return res.count > 0;
}

/**
 * Update comment by id only.
 * Language should not be part of comment mutation queries.
 */
async function updateComment(commentId, body) {
  const res = await prisma.comment.updateMany({
    where: {
      id: commentId,
    },
    data: {
      body,
    },
  });

  if (res.count === 0) return null;

  return prisma.comment.findUnique({
    where: {
      id: commentId,
    },
    include: {
      user: { select: INCLUDED_IN_USER },
    },
  });
}

export default {
  createComment,
  getAllCommentsFromJoke,
  getCommentById,
  deleteComment,
  updateComment,
};