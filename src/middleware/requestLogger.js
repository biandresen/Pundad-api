import logger from "../config/logger.js";

function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;
    const roundedDuration = Number(durationMs.toFixed(2));

    const path = req.originalUrl || req.url || "";
    const method = req.method;
    const statusCode = res.statusCode;

    const isProduction = process.env.NODE_ENV === "production";
    const isOptions = method === "OPTIONS";
    const isNotModified = statusCode === 304;
    const isError = statusCode >= 400;
    const isServerError = statusCode >= 500;
    const isSlow = roundedDuration >= 250;

    const isImportantPath =
      path.startsWith("/api/v1/auth") ||
      path.startsWith("/api/v1/moderation") ||
      path.startsWith("/api/v1/user") ||
      path.startsWith("/api/v1/jokes/daily/view");

    const isWriteMethod = method === "POST" || method === "PATCH" || method === "DELETE";

    const logPayload = {
      event: "http_request",
      requestId: req.id,
      method,
      path,
      statusCode,
      durationMs: roundedDuration,
      userId: req.user?.id ?? null,
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
    };

    if (!isProduction) {
      const shouldLog = isError || isSlow || isImportantPath || isWriteMethod;
      if (!shouldLog) return;
      if (isOptions) return;
      if (isNotModified) return;
    }

    if (isProduction) {
      const shouldLog = isError || isSlow || isImportantPath || isWriteMethod;
      if (!shouldLog) return;
      if (isOptions) return;
      if (isNotModified) return;
    }

    if (isServerError) {
      logger.error(logPayload, "request completed with server error");
      return;
    }

    if (isError) {
      logger.warn(logPayload, "request completed with client error");
      return;
    }

    logger.info(logPayload, "request completed");
  });

  next();
}

export default requestLogger;