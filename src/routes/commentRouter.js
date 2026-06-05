import { Router } from "express";
import isAuthenticated from "../middleware/isAuthenticated.js";
import isCommentAuthorOrAdmin from "../middleware/isCommentAuthorOrAdmin.js";
import asyncErrorHandler from "../utils/asyncErrorHandler.js";
import commentController from "../controllers/commentController.js";
import newCommentValidator from "../validation/newCommentValidator.js";
import checkValidation from "../middleware/checkValidation.js";
import isCommentAuthor from "../middleware/isCommentAuthor.js";
import queryParametersValidator from "../validation/queryParametersValidator.js";

const router = Router();

router.get(
  "/:id",
  queryParametersValidator,
  checkValidation,
  asyncErrorHandler(commentController.getAllCommentsFromJoke)
);

router.patch(
  "/:id",
  isAuthenticated,
  isCommentAuthor,
  newCommentValidator,
  checkValidation,
  asyncErrorHandler(commentController.editComment)
);

router.delete(
  "/:id",
  isAuthenticated,
  isCommentAuthorOrAdmin,
  asyncErrorHandler(commentController.deleteComment)
);

export default router;
