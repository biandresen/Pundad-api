import rateLimit from "express-rate-limit";

const headers = { standardHeaders: true, legacyHeaders: false };

function buildRateLimitHandler(defaultMessage) {
  return (req, res, _next, options) => {
    const retryAfterHeader = res.getHeader("Retry-After");
    const retryAfter =
      typeof retryAfterHeader === "string" || typeof retryAfterHeader === "number"
        ? Number(retryAfterHeader)
        : undefined;

    return res.status(options.statusCode).json({
      status: "fail",
      statusCode: options.statusCode,
      message: defaultMessage,
      retryAfter,
    });
  };
}

export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  ...headers,
  handler: buildRateLimitHandler("Too many requests. Please wait a moment and try again."),
});

export const readHeavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  ...headers,
  handler: buildRateLimitHandler("Too many requests. Please slow down and try again shortly."),
});

export const profileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  ...headers,
  handler: buildRateLimitHandler("Too many profile updates. Please wait before trying again."),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  ...headers,
  handler: buildRateLimitHandler("Too many authentication attempts. Please wait and try again."),
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  ...headers,
  handler: buildRateLimitHandler("Too many accounts created from this IP. Try again later."),
});

export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  ...headers,
  handler: buildRateLimitHandler("Too many password reset attempts. Try again later."),
});

export const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  ...headers,
  handler: buildRateLimitHandler("Too many contact messages. Try again later."),
});

export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  ...headers,
  handler: buildRateLimitHandler("Too many uploads. Please wait before trying again."),
});
