import { matchedData } from "express-validator";
import CustomError from "../utils/CustomError.js";
import commentService from "../services/commentService.js";
import successResponse from "../utils/successResponse.js";
import { buildPageMeta } from "../utils/paginationMeta.js";
import { moderateFields } from "../utils/moderation.js";
import logService from "../services/logService.js";
import { getModerationLogData } from "../utils/moderationLogData.js";

async function createComment(req, res, next) {
  const jokeId = Number(req.params?.id);
  if (isNaN(jokeId)) {
    return next(new CustomError(400, "Invalid joke id given"));
  }

  const authorId = Number(req.user?.id);
  if (isNaN(authorId)) {
    return next(new CustomError(401, "Unauthorized"));
  }

  const language = req.language;
  const { comment: commentBody } = matchedData(req);

  const moderation = moderateFields(
  { comment: req.body.comment },
  );

  if (moderation.blocked) {
    const { matchedTerms, matchedVariants } = getModerationLogData(moderation);

    await logService.createModerationEvent({
      userId: Number(req.user?.id) || null,
      action: "create_joke",
      blocked: true,
      fieldNames: ["comment"],
      matchedTerms,
      matchedVariants,
      contentPreview: commentBody.slice(0, 160),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
    });

    return next(
      new CustomError(400, "Content contains blocked language", [
        { field: "content", message: "Contains inappropriate language" },
      ])
    );
  }

  const comment = await commentService.createComment(
    jokeId,
    authorId,
    commentBody,
    { language }
  );

  if (!comment) {
    return next(new CustomError(404, "Joke not found for this language"));
  }

  await logService.createProductEvent({
    userId: authorId,
    type: "COMMENT_CREATED",
    path: req.originalUrl,
    language,
    metadata: {
      jokeId,
      commentId: comment.id,
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null,
  });

  return successResponse(res, 201, "Comment created successfully", comment);
}

async function getAllCommentsFromJoke(req, res, next) {
  const jokeId = Number(req.params?.id);
  if (isNaN(jokeId)) {
    return next(new CustomError(400, "Invalid joke id given"));
  }

  const language = req.language;
  const queryParams = matchedData(req);

  const { items, total, page, limit } =
    await commentService.getAllCommentsFromJoke(jokeId, {
      ...queryParams,
      language,
    });

  const meta = buildPageMeta({ page, limit, total });
  const message =
    items.length > 0
      ? "Comments successfully retrieved"
      : "No comments found";

  return successResponse(res, 200, message, items, items.length, meta);
}

async function deleteComment(req, res, next) {
  const commentId = Number(req.params?.id);
  if (isNaN(commentId)) {
    return next(new CustomError(400, "Invalid comment id given"));
  }

  const deleted = await commentService.deleteComment(commentId);

  if (!deleted) {
    return next(new CustomError(404, "Comment not found"));
  }

  return successResponse(res, 200, "Comment successfully deleted");
}

async function editComment(req, res, next) {
  const commentId = Number(req.params?.id);
  if (isNaN(commentId)) {
    return next(new CustomError(400, "Invalid comment id given"));
  }

  const { comment: commentBody } = matchedData(req);

  const moderation = moderateFields(
    { comment: commentBody },
  );

  if (moderation.blocked) {
    const { matchedTerms, matchedVariants } = getModerationLogData(moderation);

    await logService.createModerationEvent({
      userId: Number(req.user?.id) || null,
      action: "create_joke",
      blocked: true,
      fieldNames: ["comment"],
      matchedTerms,
      matchedVariants,
      contentPreview: commentBody.slice(0, 160),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
    });

    return next(
      new CustomError(400, "Content contains blocked language", [
        { field: "content", message: "Contains inappropriate language" },
      ])
    );
  }

  const editedComment = await commentService.updateComment(
    commentId,
    commentBody
  );

  if (!editedComment) {
    return next(new CustomError(404, "Comment not found"));
  }

  return successResponse(res, 200, "Comment successfully updated", editedComment);
}

export default {
  createComment,
  getAllCommentsFromJoke,
  deleteComment,
  editComment,
};
