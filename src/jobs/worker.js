import "dotenv/config";
import logger from "../config/logger.js";
import { startScheduler } from "./scheduler.js";

try {
  logger.info(
    {
      event: "worker_starting",
    },
    "Worker starting"
  );

  startScheduler();
} catch (error) {
  logger.fatal(
    {
      event: "worker_start_failed",
      err: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    },
    "Worker failed to start"
  );

  process.exit(1);
}
