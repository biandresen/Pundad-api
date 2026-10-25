-- Legacy awards retain NULL scoringWindowStart and their original scoring/history.
ALTER TABLE "BadgeAward" ADD COLUMN "scoringWindowStart" TIMESTAMP(3);
CREATE UNIQUE INDEX "BadgeAward_badge_language_scoringWindowStart_key"
ON "BadgeAward"("badge", "language", "scoringWindowStart");

CREATE TABLE "FeaturedAwardWindow" (
    "id" SERIAL NOT NULL,
    "badge" "BadgeKey" NOT NULL,
    "language" "Language" NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeaturedAwardWindow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FeaturedAwardWindow_badge_language_windowStart_key"
ON "FeaturedAwardWindow"("badge", "language", "windowStart");
