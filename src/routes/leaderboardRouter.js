import { Router } from "express";
import asyncErrorHandler from "../utils/asyncErrorHandler.js";
import leaderboardController from "../controllers/leaderboardController.js";
import { readHeavyLimiter } from "../middleware/rateLimiters.js";
import leaderboardQueryValidator from "../validation/leaderboardQueryValidator.js";
import checkValidation from "../middleware/checkValidation.js";

const router = Router();

// public
router.get(
  "/users",
  readHeavyLimiter,
  leaderboardQueryValidator,
  checkValidation,
  asyncErrorHandler(leaderboardController.getLeaderboardUsers),
);

export default router;
