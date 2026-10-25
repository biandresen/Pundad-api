import prisma from "../config/prismaClient.js";
import { streakBonusStart } from "../config/streakBonusPolicy.js";
import { startOfUtcDay, isSameUtcDay, isYesterdayUtc } from "../utils/date.js";
import { normalizeLanguage } from "../utils/language.js";
import CustomError from "../utils/CustomError.js";
import { FEATURED_JOKE } from "../constants.js";

function nextStreak(streak, lastViewedAt, now) {
  if (!lastViewedAt) return 1;
  if (startOfUtcDay(now) <= startOfUtcDay(lastViewedAt)) return streak;
  return isYesterdayUtc(lastViewedAt, now) ? streak + 1 : 1;
}

async function checkPolicy(client, startsAt) {
  const existing = await client.dailyJokeStreak.findFirst({ select: { policyStartUtc: true } });
  if (existing && existing.policyStartUtc.getTime() !== startsAt?.getTime()) {
    throw new Error("STREAK_BONUS_START_UTC cannot be removed or changed after bonus progress starts");
  }
}

function progress(row, language, startsAt, now) {
  const status = !startsAt ? "disabled" : now < startsAt ? "scheduled" : "active";
  const streak = status === "active" && row &&
    (isSameUtcDay(row.lastViewedAt, now) || isYesterdayUtc(row.lastViewedAt, now)) ? row.streak : 0;
  return {
    language, status, startsAt: startsAt?.toISOString() ?? null,
    streak, bestStreak: row?.bestStreak ?? 0,
    lastViewedAt: row?.lastViewedAt.toISOString() ?? null,
    viewedToday: Boolean(row && isSameUtcDay(row.lastViewedAt, now)),
    daysUntilBonus: 7 - streak % 7,
  };
}

async function activeUser(client, userId) {
  const user = await client.user.findFirst({
    where: { id: userId, active: true, deletedAt: null },
    select: { dailyJokeStreak: true, dailyJokeBestStreak: true, dailyJokeLastViewedAt: true },
  });
  if (!user) throw new CustomError(404, "User not found");
  return user;
}

export async function getStreakBonusProgress({ userId, language, now = new Date() }) {
  const lang = normalizeLanguage(language), startsAt = streakBonusStart();
  await activeUser(prisma, userId);
  await checkPolicy(prisma, startsAt);
  const row = await prisma.dailyJokeStreak.findUnique({ where: { userId_language: { userId, language: lang } } });
  return progress(row, lang, startsAt, now);
}

export async function recordDailyJokeView({ userId, language, now = new Date() }) {
  const lang = normalizeLanguage(language), startsAt = streakBonusStart();
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const user = await activeUser(tx, userId);
        await checkPolicy(tx, startsAt);
        const globalStreak = nextStreak(user.dailyJokeStreak, user.dailyJokeLastViewedAt, now);
        const lastViewedAt = user.dailyJokeLastViewedAt && user.dailyJokeLastViewedAt > now ?
          user.dailyJokeLastViewedAt : now;
        const updated = await tx.user.update({
          where: { id: userId },
          data: {
            dailyJokeStreak: globalStreak,
            dailyJokeBestStreak: Math.max(user.dailyJokeBestStreak, globalStreak),
            dailyJokeLastViewedAt: lastViewedAt,
          },
          select: { dailyJokeStreak: true, dailyJokeBestStreak: true, dailyJokeLastViewedAt: true },
        });
        const key = { userId_language: { userId, language: lang } };
        let row = await tx.dailyJokeStreak.findUnique({ where: key });
        let awarded = false;
        const newBonusDay = startsAt && now >= startsAt &&
          (!row || startOfUtcDay(now) > startOfUtcDay(row.lastViewedAt));
        // Keep the legacy global view contract, but only actual published daily
        // content in this language can advance the scoring streak.
        const daily = newBonusDay ? await tx.featuredJoke.findFirst({
          where: {
            type: FEATURED_JOKE.DAILY, date: startOfUtcDay(now), language: lang,
            joke: { published: true, language: lang },
          },
          select: { id: true },
        }) : null;
        if (daily) {
          const streak = nextStreak(row?.streak ?? 0, row?.lastViewedAt, now);
          const data = { streak, bestStreak: Math.max(row?.bestStreak ?? 0, streak), lastViewedAt: now };
          row = await tx.dailyJokeStreak.upsert({
            where: key, update: data,
            create: { userId, language: lang, policyStartUtc: startsAt, ...data },
          });
          if (streak % 7 === 0) {
            // History only: the decorative account-wide STREAK badge is unchanged.
            // Leave scoringWindowStart null; that unique key identifies single-winner featured awards.
            await tx.badgeAward.create({ data: {
              userId, language: lang, badge: "STREAK_BONUS", awardedAt: now,
              validFrom: startOfUtcDay(now),
              context: { streak, points: 1, policyStartUtc: startsAt.toISOString() },
            } });
            awarded = true;
          }
        }
        return { ...updated, streakBonus: { ...progress(row, lang, startsAt, now), awarded } };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (attempt >= 7 || !["P2034", "P2002"].includes(error.code)) throw error;
    }
  }
}
