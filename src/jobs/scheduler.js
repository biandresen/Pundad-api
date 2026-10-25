import cron from "node-cron";
import logger from "../config/logger.js";
import * as featuredService from "../services/featuredService.js";
import { runLoggedJob } from "./runLoggedJob.js";

const TZ = "UTC";
const LANGUAGES = ["NO", "EN"];

/**
 * Run a job for all supported languages.
 */
async function runForAllLanguages(baseJobName, jobFn) {
  const results = [];

  for (const language of LANGUAGES) {
    const result = await runLoggedJob(
      `${baseJobName}_${language}`,
      () => jobFn({ language }),
      { language }
    );

    results.push({ language, result });
  }

  return results;
}

/**
 * Optional boot run, useful if the worker was down when a schedule should have run.
 */
async function runOnceOnBoot() {
  logger.info(
    {
      event: "scheduler_boot_run_started",
      timezone: TZ,
      languages: LANGUAGES,
    },
    "Scheduler boot run started"
  );

  try {
    if (typeof featuredService.computeDailyJoke === "function") {
      await runForAllLanguages("computeDailyJoke_boot", featuredService.computeDailyJoke);
    }

    await runForAllLanguages("computeTrendingThisWeek_boot", featuredService.computeTrendingThisWeek);
    await runForAllLanguages("computeMostCommentedThisWeek_boot", featuredService.computeMostCommentedThisWeek);
    await runForAllLanguages("computeFastestGrowing24h_boot", featuredService.computeFastestGrowing24h);
    await runForAllLanguages("finalizeFastestGrowingDays_boot", featuredService.finalizeFastestGrowingDays);
    await runForAllLanguages("computeTopCreatorThisMonth_boot", featuredService.computeTopCreatorThisMonth);

    logger.info(
      {
        event: "scheduler_boot_run_succeeded",
      },
      "Scheduler boot run completed"
    );
  } catch (error) {
    logger.error(
      {
        event: "scheduler_boot_run_failed",
        err: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      },
      "Scheduler boot run failed"
    );
  }
}

export function startScheduler() {
  logger.info(
    {
      event: "scheduler_started",
      timezone: TZ,
      languages: LANGUAGES,
    },
    "Scheduler started"
  );

  // Daily joke at 00:05 UTC
  cron.schedule(
    "5 0 * * *",
    async () => {
      await runForAllLanguages("computeDailyJoke", featuredService.computeDailyJoke);
    },
    { timezone: TZ }
  );

  // Fastest growing every hour
  cron.schedule(
    "0 * * * *",
    async () => {
      await runForAllLanguages("computeFastestGrowing24h", featuredService.computeFastestGrowing24h);
      await runForAllLanguages("finalizeFastestGrowingDays", featuredService.finalizeFastestGrowingDays);
    },
    { timezone: TZ }
  );

  // Trending week every hour
  cron.schedule(
    "0 * * * *",
    async () => {
      await runForAllLanguages("computeTrendingThisWeek", featuredService.computeTrendingThisWeek);
    },
    { timezone: TZ }
  );

  // Most commented week every hour
  cron.schedule(
    "0 * * * *",
    async () => {
      await runForAllLanguages("computeMostCommentedThisWeek", featuredService.computeMostCommentedThisWeek);
    },
    { timezone: TZ }
  );

  // Top creator once per day
  cron.schedule(
    "10 0 * * *",
    async () => {
      await runForAllLanguages("computeTopCreatorThisMonth", featuredService.computeTopCreatorThisMonth);
    },
    { timezone: TZ }
  );

  runOnceOnBoot();
}
