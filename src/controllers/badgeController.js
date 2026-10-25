import prisma from "../config/prismaClient.js";
import CustomError from "../utils/CustomError.js";
import successResponse from "../utils/successResponse.js";
import badgeService from "../services/badgeService.js";
import { activeCurrentBadgeWhere } from "../utils/activeBadges.js";

async function getMyCurrentBadges(req, res, next) {
    const userId = Number(req.user?.id);
    if (isNaN(userId)) return next(new CustomError(401, "Unauthorized"));

    const language = req.language;
    if (!language) return next(new CustomError(500, "Language middleware not configured"));

    const badges = await prisma.currentUserBadge.findMany({
      where: { userId, ...activeCurrentBadgeWhere(language) },
      orderBy: { since: "desc" },
    });

    return successResponse(res, 200, "Current badges retrieved", badges, badges.length);
}

async function getMyBadgeHistory(req, res, next) {
    const userId = Number(req.user?.id);
    if (isNaN(userId)) return next(new CustomError(401, "Unauthorized"));

    const language = req.language;
    if (!language) return next(new CustomError(500, "Language middleware not configured"));

    const { page, limit } = req.query;

    const { items, meta } = await badgeService.getBadgeHistoryForUser(userId, {
      language,
      page,
      limit,
    });

    return successResponse(res, 200, "Badge history retrieved", items, items.length, meta);
}

export default {
  getMyCurrentBadges,
  getMyBadgeHistory,
};
