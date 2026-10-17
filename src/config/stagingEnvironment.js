import path from "node:path";

// Preloaded before the deployed API imports dotenv or creates database clients.
if (process.env.APP_ENV !== "staging" || process.env.NODE_ENV !== "production") {
  throw new Error("The staging runtime requires APP_ENV=staging and NODE_ENV=production.");
}

let database;
try {
  database = new URL(process.env.DATABASE_URL);
} catch {
  throw new Error("Set a valid staging DATABASE_URL.");
}

if (
  !["postgres:", "postgresql:"].includes(database.protocol) ||
  !["localhost", "127.0.0.1"].includes(database.hostname) ||
  database.username !== "pundad_staging" ||
  database.pathname !== "/pundad_staging"
) {
  throw new Error("Staging requires its own local pundad_staging database and login.");
}

if (process.env.HOST !== "127.0.0.1" || process.env.PORT !== "4002") {
  throw new Error("Staging must listen on 127.0.0.1:4002.");
}

if (process.env.FRONTEND_BASE_URL !== "https://staging.pundad.app") {
  throw new Error("Staging verification links must use https://staging.pundad.app.");
}

if (process.env.CORS_ORIGINS !== "https://staging.pundad.app") {
  throw new Error("Staging must allow only its own frontend origin.");
}

if (path.resolve(process.env.UPLOADS_DIR || "") !== "/srv/pundad/staging/uploads") {
  throw new Error("Staging requires its own uploads directory.");
}

if (
  process.env.EMAIL_DELIVERY !== "capture" ||
  process.env.EMAIL_CAPTURE_DIR !== "/var/lib/pundad-staging/mail" ||
  process.env.RESEND_API_KEY
) {
  throw new Error("Staging must capture email locally without production provider credentials.");
}

for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]) {
  if (!process.env[key] || process.env[key].length < 32) {
    throw new Error(`Set a separate staging ${key} of at least 32 characters.`);
  }
}
