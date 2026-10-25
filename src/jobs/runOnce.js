import * as featuredService from "../services/featuredService.js";
import prisma from "../config/prismaClient.js";
import { SUPPORTED_LANGUAGES } from "../constants.js";

try {
  for (const language of SUPPORTED_LANGUAGES) {
    await featuredService.computeDailyJoke({ language });
    await featuredService.computeTopCreatorThisMonth({ language });
    await featuredService.computeTrendingThisWeek({ language });
    await featuredService.computeMostCommentedThisWeek({ language });
    await featuredService.computeFastestGrowing24h({ language });
    const result = await featuredService.finalizeFastestGrowingDays({ language });
    console.log("Featured recomputation complete", { language, dailyCatchupRemaining: result.hasMore });
  }
} finally {
  await prisma.$disconnect();
}
