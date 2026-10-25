import { Router } from "express";
import { query, header } from "express-validator";
import checkValidation from "../middleware/checkValidation.js";
import { SUPPORTED_LANGUAGES } from "../constants.js";
import isAuthenticated from "../middleware/isAuthenticated.js";
import isAdmin from "../middleware/isAdmin.js";
import asyncErrorHandler from "../utils/asyncErrorHandler.js";
import successResponse from "../utils/successResponse.js";
import * as featuredService from "../services/featuredService.js";
import { FeatureType } from "@prisma/client";
import { readHeavyLimiter } from "../middleware/rateLimiters.js";

const router = Router();

// Missing language follows the API default (NO); explicit invalid selectors are rejected.
const recomputations = [
  ["joke-of-the-day", featuredService.computeDailyJoke],
  ["top-creator-month", featuredService.computeTopCreatorThisMonth],
  ["most-commented-week", featuredService.computeMostCommentedThisWeek],
  ["trending-week", featuredService.computeTrendingThisWeek],
  ["fastest-growing", featuredService.computeFastestGrowing24h],
  ["fastest-growing-daily", featuredService.finalizeFastestGrowingDays],
];

for (const [slug, compute] of recomputations) {
  router.post(
    `/admin/recompute/${slug}`,
    isAuthenticated,
    isAdmin,
    query("lang").optional().isString().bail().toUpperCase().isIn(SUPPORTED_LANGUAGES)
      .withMessage("Language must be NO or EN"),
    header("X-App-Language").optional().isString().bail().toUpperCase().isIn(SUPPORTED_LANGUAGES)
      .withMessage("Language must be NO or EN"),
    checkValidation,
    asyncErrorHandler(async (req, res) => {
      const result = await compute({ language: req.language });
      return successResponse(res, 200, "Feature recomputed", result);
    }),
  );
}

// helper: map slug -> enum
const FEATURE_SLUG_MAP = {
  "joke-of-the-day": FeatureType.DAILY_JOKE,
  "trending-week": FeatureType.TRENDING_WEEK,
  "most-commented-week": FeatureType.MOST_COMMENTED_WEEK,
  "fastest-growing": FeatureType.FASTEST_GROWING,
  "top-creator-month": FeatureType.TOP_CREATOR_MONTH,
};

router.get(
  "/:slug",
  readHeavyLimiter,
  asyncErrorHandler(async (req, res) => {
    const slug = req.params.slug;
    const language = req.language;
    const type = FEATURE_SLUG_MAP[slug];

    if (!type) {
      return successResponse(res, 200, "Unknown feature", null);
      // or throw CustomError(400, "Unknown feature")
    }

    const result = await featuredService.getCurrentFeatured(type, { language });

    if (!result?.joke) {
      return successResponse(res, 200, "No featured joke yet", null);
    }

    return successResponse(res, 200, "Featured joke retrieved", {
      type,
      date: result.date,
      joke: result.joke,
    });
  })
);

export default router;
