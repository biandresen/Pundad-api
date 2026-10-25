import prisma from "./prismaClient.js";
import {
  assertBadgeDemoDevelopmentEnvironment, BADGE_DEMO_PASSWORD,
  clearBadgeLeaderboardDemo, seedBadgeLeaderboardDemo,
} from "./badgeLeaderboardDemo.js";

try {
  assertBadgeDemoDevelopmentEnvironment();
  if (process.argv.slice(2).some((arg) => arg !== "--clean")) throw new Error("Only --clean is supported.");
  if (process.argv.includes("--clean")) {
    console.log("Badge demo cleanup complete", await clearBadgeLeaderboardDemo(prisma));
  } else {
    console.log("Badge/leaderboard demo ready", await seedBadgeLeaderboardDemo(prisma));
    console.log(`Development-only demo password: ${BADGE_DEMO_PASSWORD}`);
    console.log("Fixtures include active, expired, future and non-expiring badges, plus paginated history.");
    console.log("Pause the development worker; clean these fixtures before resuming it or reaching the scoring cutover.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
