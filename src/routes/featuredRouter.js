import { Router } from "express";
import isAuthenticated from "../middleware/isAuthenticated.js";
import isAdmin from "../middleware/isAdmin.js";
import asyncErrorHandler from "../utils/asyncErrorHandler.js";
import successResponse from "../utils/successResponse.js";
import * as featuredService from "../services/featuredService.js";
import { FeatureType } from "@prisma/client";
import { readHeavyLimiter } from "../middleware/rateLimiters.js";

const router = Router();

router.post(
  "/admin/recompute/top-creator-month",
  isAuthenticated,
  isAdmin,
  asyncErrorHandler(async (req, res) => {
    const jokeId = await featuredService.computeTopCreatorThisMonth();
    return successResponse(res, 200, "Top creator computed", { jokeId });
  })
);

router.post(
  "/admin/recompute/most-commented-week",
  isAuthenticated,
  isAdmin,
  asyncErrorHandler(async (req, res) => {
    const jokeId = await featuredService.computeMostCommentedThisWeek();
    return successResponse(res, 200, "Most commented week computed", { jokeId });
  })
);

router.post(
  "/admin/recompute/trending-week",
  isAuthenticated,
  isAdmin,
  asyncErrorHandler(async (req, res) => {
    const jokeId = await featuredService.computeTrendingThisWeek();
    return successResponse(res, 200, "Trending week computed", { jokeId });
  })
);

router.post(
  "/admin/recompute/fastest-growing",
  isAuthenticated,
  isAdmin,
  asyncErrorHandler(async (req, res) => {
    const jokeId = await featuredService.computeFastestGrowing24h();
    return successResponse(res, 200, "Fastest growing computed", { jokeId });
  })
);

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
    const language = req.language
    const type = FEATURE_SLUG_MAP[slug];

    if (!type) {
      return successResponse(res, 200, "Unknown feature", null);
      // or throw CustomError(400, "Unknown feature")
    }

    const result = await featuredService.getCurrentFeatured(type, {language});

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
