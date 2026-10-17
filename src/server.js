import "dotenv/config";
import app from "./app.js";
import "./config/prismaClient.js";
import moderationService from "./services/moderationService.js";
import logger from "./config/logger.js";

const port = process.env.PORT || 4000;
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0");

process.on("unhandledRejection", (reason) => {
  logger.error(
    {
      event: "unhandled_rejection",
      reason:
        reason instanceof Error
          ? { name: reason.name, message: reason.message, stack: reason.stack }
          : reason,
    },
    "Unhandled promise rejection"
  );
});

process.on("uncaughtException", (error) => {
  logger.fatal(
    {
      event: "uncaught_exception",
      err: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    },
    "Uncaught exception"
  );

  process.exit(1);
});


async function startServer() {
  try {
    await moderationService.loadModerationTerms();

    const cacheMeta = moderationService.getModerationCacheMeta();
    logger.info(
      {
        event: "moderation_cache_loaded",
        count: cacheMeta.count,
      },
      "Moderation cache loaded"
    );

    app.listen(port, host, () => {
      logger.info(
        {
          event: "server_started",
          port,
          env: process.env.NODE_ENV,
          host,
        },
        "Server started"
      );
    });
  } catch (error) {
    logger.fatal(
      {
        event: "server_start_failed",
        err: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      },
      "Failed to start server"
    );

    process.exit(1);
  }
}

startServer();
