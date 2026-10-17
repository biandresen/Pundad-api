// Installed outside releases; a PR artifact cannot replace this production guard.
const database = new URL(process.env.DATABASE_URL);
if (process.env.APP_ENV !== "production" || process.env.NODE_ENV !== "production" ||
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !["localhost", "127.0.0.1"].includes(database.hostname) ||
    database.username !== "jokeuser" || database.pathname !== "/jokedb" ||
    process.env.HOST !== "127.0.0.1" || process.env.PORT !== "4000" ||
    process.env.UPLOADS_DIR !== "/var/www/pundad-uploads" ||
    process.env.FRONTEND_BASE_URL !== "https://pundad.app" ||
    process.env.CORS_ORIGINS !== "https://pundad.app,https://www.pundad.app" ||
    process.env.EMAIL_DELIVERY !== "provider" || !process.env.RESEND_API_KEY ||
    !process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error("Production configuration does not match its approved database, origin, port, uploads, or delivery mode.");
}
