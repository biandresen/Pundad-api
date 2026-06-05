import express from "express";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import hpp from "hpp";
import cookieParser from "cookie-parser";

// INTERNAL IMPORTS
import { UPLOADS_DIR } from "./config/paths.js";
import CustomError from "./utils/CustomError.js";
import globalErrorHandler from "./middleware/globalErrorHandler.js";
import requestContext from "./middleware/requestContext.js";
import requestLogger from "./middleware/requestLogger.js";
import routes from "./routes/index.js";
import { CORS_ORIGINS } from "./constants.js";
import { generalApiLimiter } from "./middleware/rateLimiters.js";
import { languageMiddleware } from "./middleware/languageMiddleware.js";

const app = express();

/**
 * Use a Set for fast lookup when checking whether an origin is allowed.
 */
const allowedOrigins = new Set(CORS_ORIGINS);

/**
 * Trust the first proxy hop.
 * This is appropriate when running behind Nginx / Cloudflare.
 */
app.set("trust proxy", 1);

// --------------------------------------------------
// 1) REQUEST CONTEXT + STRUCTURED REQUEST LOGGING
// --------------------------------------------------
app.use(requestContext);
app.use(requestLogger);

// --------------------------------------------------
// 2) BASIC SECURITY HEADERS
// --------------------------------------------------
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  }),
);

// --------------------------------------------------
// 3) CORS FOR API ROUTES
// --------------------------------------------------
app.use(
  "/api",
  cors({
    origin: (origin, cb) => {
      // Allow requests from tools like curl/Postman
      if (!origin) return cb(null, true);

      if (allowedOrigins.has(origin)) return cb(null, true);

      return cb(new CustomError(403, `CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
    exposedHeaders: ["Retry-After", "x-request-id"],
  }),
);

// --------------------------------------------------
// 4) BODY PARSERS + COOKIES
// --------------------------------------------------
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());

// --------------------------------------------------
// 5) REQUEST HARDENING
// --------------------------------------------------
app.use(hpp());

// --------------------------------------------------
// 6) RESPONSE COMPRESSION
// --------------------------------------------------
app.use(compression());

// --------------------------------------------------
// 7) STATIC FILES
// --------------------------------------------------
app.use(
  "/uploads",
  express.static(UPLOADS_DIR, {
    etag: true,
    lastModified: true,
    setHeaders: (res) => {
      if (process.env.NODE_ENV === "production") {
        res.setHeader("Cross-Origin-Resource-Policy", "same-site");
      } else {
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      }
    },
  }),
);

// --------------------------------------------------
// 8) GENERAL API RATE LIMITING
// --------------------------------------------------
app.use("/api", generalApiLimiter);

// --------------------------------------------------
// 9) API-SPECIFIC MIDDLEWARE
// --------------------------------------------------
app.use("/api/v1", languageMiddleware);

// --------------------------------------------------
// 10) API ROUTES
// --------------------------------------------------
app.use("/api/v1/auth", routes.authRouter);
app.use("/api/v1/user", routes.userRouter);
app.use("/api/v1/jokes", routes.jokeRouter);
app.use("/api/v1/comments", routes.commentRouter);
app.use("/api/v1/tags", routes.tagRouter);
app.use("/api/v1/badges", routes.badgeRouter);
app.use("/api/v1/featured", routes.featuredRouter);
app.use("/api/v1/leaderboard", routes.leaderboardRouter);
app.use("/api/v1/moderation", routes.moderationRouter);
app.use("/api/v1/contact", routes.contactRouter);

// --------------------------------------------------
// 11) UNHANDLED ROUTES
// --------------------------------------------------
app.all("/{*splat}", (req, res, next) => {
  next(new CustomError(404, `Can't find ${req.originalUrl} on this server!`));
});

// --------------------------------------------------
// 12) GLOBAL ERROR HANDLER
// --------------------------------------------------
app.use(globalErrorHandler);

export default app;
