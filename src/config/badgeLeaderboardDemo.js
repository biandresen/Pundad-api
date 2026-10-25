import bcrypt from "bcrypt";
import { addUtcDays, addUtcMonths, startOfUtcDay, startOfUtcMonth, startOfUtcWeek } from "../utils/date.js";

export const BADGE_DEMO_PASSWORD = "BadgeDemo2026!";
const SEED = "badge-leaderboard-demo-v1";
const ACCOUNTS = ["alex", "blair", "casey", "drew"].map((name, index) => ({
  username: `demo_badge_${name}`,
  email: `badge-demo-${name}@example.test`,
  preferredLanguage: index < 2 ? "NO" : "EN",
  dailyJokeStreak: [30, 7, 14, 365][index],
}));

export function assertBadgeDemoDevelopmentEnvironment(env = process.env) {
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { /* Fail below without printing credentials. */ }
  if (env.APP_ENV !== "development" || env.NODE_ENV !== "development" ||
      !url || !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.pathname !== "/pundad_dev" || url.username !== "pundad_dev" ||
      (url.searchParams.get("schema") ?? "public") !== "public") {
    throw new Error("Badge demo commands require the local development pundad_dev database and role (public schema).");
  }
}

async function ownedAccounts(tx) {
  const existing = await tx.user.findMany({ where: { OR: [
    { username: { in: ACCOUNTS.map((account) => account.username) } },
    { email: { in: ACCOUNTS.map((account) => account.email) } },
  ] }, select: { id: true, username: true, email: true, termsVersion: true } });
  for (const row of existing) {
    if (row.termsVersion !== SEED || !ACCOUNTS.some((account) =>
      account.username === row.username && account.email === row.email)) {
      throw new Error("A demo username or email belongs to an account outside this fixture; nothing was changed.");
    }
  }
  return existing;
}

async function removeOwnedAccounts(tx, accounts) {
  const ids = accounts.map((account) => account.id);
  if (!ids.length) return;
  // Demo accounts and their content form the resettable fixture area.
  await tx.comment.deleteMany({ where: { OR: [
    { authorId: { in: ids } }, { joke: { authorId: { in: ids } } },
  ] } });
  await tx.jokeLike.deleteMany({ where: { OR: [
    { userId: { in: ids } }, { joke: { authorId: { in: ids } } },
  ] } });
  await tx.joke.deleteMany({ where: { authorId: { in: ids } } });
  await tx.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await tx.resetPasswordToken.deleteMany({ where: { userId: { in: ids } } });
  await tx.user.deleteMany({ where: { id: { in: ids } } });
}

export async function clearBadgeLeaderboardDemo(prisma) {
  return prisma.$transaction(async (tx) => {
    const accounts = await ownedAccounts(tx);
    await removeOwnedAccounts(tx, accounts);
    return { removedAccounts: accounts.length };
  });
}

export async function seedBadgeLeaderboardDemo(prisma, { now = new Date() } = {}) {
  const password = await bcrypt.hash(BADGE_DEMO_PASSWORD, 10);
  const day = startOfUtcDay(now);
  const tomorrow = addUtcDays(day, 1);
  const month = startOfUtcMonth(now);
  const week = startOfUtcWeek(now);
  const previousMonth = addUtcMonths(month, -1);
  return prisma.$transaction(async (tx) => {
    await removeOwnedAccounts(tx, await ownedAccounts(tx));
    const accounts = [];
    for (const account of ACCOUNTS) {
      accounts.push(await tx.user.create({ data: {
        ...account, password, emailVerified: true, emailVerifiedAt: now,
        termsAcceptedAt: now, termsVersion: SEED,
        dailyJokeBestStreak: account.dailyJokeStreak, dailyJokeLastViewedAt: now,
      } }));
    }
    for (const language of ["NO", "EN"]) {
      const posts = [];
      for (const account of accounts) {
        const post = await tx.joke.create({ data: {
          authorId: account.id, language, published: true, createdAt: now,
          title: `[Demo ${language}] ${account.username}`,
          body: language === "NO" ? "Hvorfor tok datamaskinen på seg jakke? Den hadde mange vinduer åpne."
            : "Why did the computer put on a coat? It had too many windows open.",
        } });
        posts.push(post);
        for (const actor of accounts.filter((other) => other.id !== account.id)) {
          await tx.jokeLike.create({ data: { jokeId: post.id, userId: actor.id, createdAt: now } });
        }
        await tx.comment.createMany({ data: accounts.filter((other) => other.id !== account.id).slice(0, 2)
          .map((actor) => ({ jokeId: post.id, authorId: actor.id, createdAt: now,
            body: language === "NO" ? "[Demo] Denne fikk meg til å le!" : "[Demo] That made me laugh!" })) });
      }
      // Older completed periods give every account a second history page without
      // adding points to the current week/month. Each historical daily date is distinct.
      for (let index = 0; index < accounts.length; index++) {
        for (let offset = 0; offset < 20; offset++) {
          const date = addUtcDays(previousMonth, -(1 + index * 20 + offset));
          await tx.badgeAward.create({ data: {
            userId: accounts[index].id, language, badge: "JOKE_OF_DAY", awardedAt: date,
            validFrom: date, validTo: addUtcDays(date, 1), context: { seed: SEED, jokeId: posts[index].id },
          } });
        }
      }
      const [leader, weekly, fastest, expired] = language === "NO" ? [0, 1, 2, 3] : [2, 3, 0, 1];
      for (const [index, badge] of [
        [leader, "TOP_CREATOR_MONTH"], [leader, "JOKE_OF_DAY"],
        [weekly, "TRENDING_WEEK"], [weekly, "MOST_COMMENTED_WEEK"], [fastest, "FASTEST_GROWING"],
      ]) {
        const validFrom = badge === "TOP_CREATOR_MONTH" ? month : badge.endsWith("_WEEK") ? week : day;
        const validTo = badge === "TOP_CREATOR_MONTH" ? addUtcMonths(month, 1) : badge.endsWith("_WEEK") ? addUtcDays(week, 7) : tomorrow;
        const context = { seed: SEED, jokeId: posts[index].id };
        await tx.badgeAward.create({ data: { userId: accounts[index].id, language, badge,
          awardedAt: now, validFrom, validTo, context } });
        await tx.currentUserBadge.create({ data: { userId: accounts[index].id, language, badge,
          since: validFrom, validTo, context } });
      }
      await tx.currentUserBadge.create({ data: { userId: accounts[leader].id, language,
        badge: "STREAK", since: day, validTo: null, context: { seed: SEED } } });
      const yesterday = addUtcDays(day, -1);
      const expiredContext = { seed: SEED, jokeId: posts[expired].id };
      await tx.badgeAward.create({ data: { userId: accounts[expired].id, language, badge: "JOKE_OF_DAY",
        awardedAt: yesterday, validFrom: yesterday, validTo: day, context: expiredContext } });
      await tx.currentUserBadge.create({ data: { userId: accounts[expired].id, language, badge: "JOKE_OF_DAY",
        since: yesterday, validTo: day, context: expiredContext } });
      await tx.currentUserBadge.create({ data: { userId: accounts[expired].id, language, badge: "TOP_CREATOR_MONTH",
        since: tomorrow, validTo: addUtcDays(tomorrow, 1), context: { seed: SEED } } });
      await tx.badgeAward.create({ data: { userId: accounts[fastest].id, language, badge: "TOP_CREATOR_MONTH",
        awardedAt: previousMonth, validFrom: previousMonth, validTo: month, context: { seed: SEED } } });
    }
    return { usernames: accounts.map((account) => account.username), languages: ["NO", "EN"] };
  }, { timeout: 30_000 });
}
