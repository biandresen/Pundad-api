import { Router } from "express";
import jokeController from "../controllers/jokeController.js";
import commentController from "../controllers/commentController.js";
import asyncErrorHandler from "../utils/asyncErrorHandler.js";
import isAuthenticated from "../middleware/isAuthenticated.js";
import isJokeAuthorOrAdmin from "../middleware/isJokeAuthorOrAdmin.js";
import isAdmin from "../middleware/isAdmin.js";
import updateJokeValidator from "../validation/updateJokeValidator.js";
import newJokeValidator from "../validation/newJokeValidator.js";
import newCommentValidator from "../validation/newCommentValidator.js";
import searchParametersValidator from "../validation/searchParametersValidator.js";
import queryParametersValidator from "../validation/queryParametersValidator.js";
import checkValidation from "../middleware/checkValidation.js";
import { readHeavyLimiter } from "../middleware/rateLimiters.js";
import optionalAuth from "../middleware/optinalAuth.js";
import searchFiltersValidator from "../validation/searchFiltersValidator.js";

const router = Router();

router.get(
  "/search",
  readHeavyLimiter,
  searchParametersValidator,
  searchFiltersValidator,
  queryParametersValidator,
  checkValidation,
  asyncErrorHandler(jokeController.searchJokes)
);

router.get("/popular", asyncErrorHandler(jokeController.getPopularJokes));

router.get("/random", asyncErrorHandler(jokeController.getRandomJoke));

router.get("/daily", asyncErrorHandler(jokeController.getDailyJoke));

router.post(
  "/daily/view",
  readHeavyLimiter,
  isAuthenticated,
  asyncErrorHandler(jokeController.recordDailyJokeView)
);


router.get(
  "/drafts",
  readHeavyLimiter,
  isAuthenticated,
  queryParametersValidator,
  checkValidation,
  asyncErrorHandler(jokeController.getAllDraftsFromCurrentUser)
);

router.get(
  "/drafts/all",
  readHeavyLimiter,
  isAuthenticated,
  isAdmin,
  queryParametersValidator,
  checkValidation,
  asyncErrorHandler(jokeController.getAllDrafts)
);

router.get("/:id",readHeavyLimiter, optionalAuth, asyncErrorHandler(jokeController.getJoke));

router.get("/",readHeavyLimiter, queryParametersValidator, checkValidation, asyncErrorHandler(jokeController.getAllJokes));

router.patch(
  "/:id/publish",
  readHeavyLimiter,
  isAuthenticated,
  isJokeAuthorOrAdmin,
  asyncErrorHandler(jokeController.publishDraft)
);

router.patch(
  "/:id",
  readHeavyLimiter,
  isAuthenticated,
  isJokeAuthorOrAdmin,
  updateJokeValidator,
  checkValidation,
  asyncErrorHandler(jokeController.updateJoke)
);

router.post("/:id/like", readHeavyLimiter, isAuthenticated, asyncErrorHandler(jokeController.toggleLike));

router.post(
  "/:id/comments",
  readHeavyLimiter,
  isAuthenticated,
  newCommentValidator,
  checkValidation,
  asyncErrorHandler(commentController.createComment)
);

router.get(
  "/:id/comments",
  readHeavyLimiter,
  queryParametersValidator,
  checkValidation,
  asyncErrorHandler(commentController.getAllCommentsFromJoke)
);

router.post(
  "/",
  readHeavyLimiter,
  isAuthenticated,
  newJokeValidator,
  checkValidation,
  asyncErrorHandler(jokeController.createJoke)
);

router.delete("/:id", readHeavyLimiter, isAuthenticated, isJokeAuthorOrAdmin, asyncErrorHandler(jokeController.deleteJoke));

export default router;
