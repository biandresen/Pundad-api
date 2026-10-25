export function streakBonusStart() {
  const value = process.env.STREAK_BONUS_START_UTC;
  if (value === undefined || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("STREAK_BONUS_START_UTC must be a UTC date in YYYY-MM-DD format");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("STREAK_BONUS_START_UTC must be a valid UTC calendar date");
  }
  return date;
}
