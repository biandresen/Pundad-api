import CustomError from "../utils/CustomError.js";

const TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

export default async function verifyRegistrationTurnstile(req, res, next) {
  const token = req.body?.turnstileToken;
  if (typeof token !== "string" || !token.trim() || token.length > 2048) {
    return next(new CustomError(400, "Please complete the security check.", null, "TURNSTILE_FAILED"));
  }

  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  const isTestSecret = TEST_SECRETS.has(secret);
  const localTesting = process.env.APP_ENV === "development" && process.env.NODE_ENV === "development";
  const hostnames = (process.env.TURNSTILE_ALLOWED_HOSTNAMES || "")
    .split(",").map((hostname) => hostname.trim()).filter(Boolean);

  const unavailable = () => new CustomError(
    503, "The security check is unavailable. Please try again later.", null, "TURNSTILE_UNAVAILABLE",
  );
  if (!secret || (isTestSecret && !localTesting) || (!isTestSecret && !hostnames.length)) {
    return next(unavailable());
  }

  let validation;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return next(unavailable());
    validation = await response.json();
    if (!validation || typeof validation.success !== "boolean") return next(unavailable());
  } catch {
    // Never log the request body, secret, token, or upstream diagnostics.
    return next(unavailable());
  }

  if (
    !validation.success ||
    (!isTestSecret && (validation.action !== "register" || !hostnames.includes(validation.hostname)))
  ) {
    return next(new CustomError(
      400, "The security check failed or expired. Please try again.", null, "TURNSTILE_FAILED",
    ));
  }

  return next();
}
