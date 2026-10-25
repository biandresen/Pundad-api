import { startOfUtcDay } from "./date.js";
import { normalizeLanguage } from "./language.js";

// Intervals are half-open: [since, validTo). Legacy daily badges have no expiry.
export function activeCurrentBadgeWhere(language, now = new Date()) {
  return {
    language: normalizeLanguage(language),
    since: { lte: now },
    AND: [
      { OR: [{ validTo: null }, { validTo: { gt: now } }] },
      {
        OR: [
          { badge: { not: "JOKE_OF_DAY" } },
          { since: { gte: startOfUtcDay(now) } },
        ],
      },
    ],
  };
}
