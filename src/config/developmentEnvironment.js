import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";

// Loaded with --import before the API, worker, or database CLI imports anything.
// Production continues to use its existing environment and entry points.
const envFile = path.resolve(".env.development");
let config;

try {
  config = parse(readFileSync(envFile));
} catch {
  throw new Error("Create .env.development from .env.development.example before running development commands.");
}

if (config.NODE_ENV !== "development" || config.APP_ENV !== "development") {
  throw new Error("Development commands require NODE_ENV=development and APP_ENV=development.");
}

let database;
try {
  database = new URL(config.DATABASE_URL);
} catch {
  throw new Error("Set a valid development DATABASE_URL in .env.development.");
}

if (
  !["postgres:", "postgresql:"].includes(database.protocol) ||
  !["127.0.0.1", "localhost"].includes(database.hostname) ||
  database.pathname !== "/pundad_dev" ||
  database.username !== "pundad_dev"
) {
  throw new Error("Development commands require the local pundad_dev database and pundad_dev role.");
}

if (config.HOST !== "127.0.0.1" || config.PORT !== "4001") {
  throw new Error("Development commands require HOST=127.0.0.1 and PORT=4001.");
}

if (path.resolve(config.UPLOADS_DIR || "") !== path.resolve("uploads")) {
  throw new Error("Development uploads must use this checkout's uploads directory.");
}

if (config.EMAIL_DELIVERY !== "console") {
  throw new Error("Development commands require EMAIL_DELIVERY=console.");
}

if (config.TURNSTILE_SECRET_KEY !== TURNSTILE_TEST_SECRET) {
  throw new Error("Development commands require Cloudflare's published Turnstile test secret.");
}

for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]) {
  if (!config[key] || config[key].length < 32) {
    throw new Error(`Set a separate development ${key} of at least 32 characters.`);
  }
}

// An inherited production DATABASE_URL must never override the development file.
Object.assign(process.env, config);
