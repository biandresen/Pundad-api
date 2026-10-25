export function fastestGrowingDailyStart() {
  const value = process.env.FASTEST_GROWING_DAILY_START_UTC;
  if (value === undefined || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("FASTEST_GROWING_DAILY_START_UTC must be a UTC date in YYYY-MM-DD format");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("FASTEST_GROWING_DAILY_START_UTC must be a valid UTC calendar date");
  }
  return date;
}
