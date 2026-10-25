-- Existing global streaks and historical awards are deliberately not backfilled.
ALTER TYPE "BadgeKey" ADD VALUE 'STREAK_BONUS';

CREATE TABLE "DailyJokeStreak" (
    "userId" INTEGER NOT NULL,
    "language" "Language" NOT NULL,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3) NOT NULL,
    "policyStartUtc" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DailyJokeStreak_pkey" PRIMARY KEY ("userId", "language")
);

ALTER TABLE "DailyJokeStreak" ADD CONSTRAINT "DailyJokeStreak_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
