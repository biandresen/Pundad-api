/*
  Warnings:

  - A unique constraint covering the columns `[userId,badge,validFrom,language]` on the table `BadgeAward` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,badge,language]` on the table `CurrentUserBadge` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "BadgeAward_badge_awardedAt_idx";

-- DropIndex
DROP INDEX "BadgeAward_userId_awardedAt_idx";

-- DropIndex
DROP INDEX "BadgeAward_userId_badge_validFrom_key";

-- DropIndex
DROP INDEX "CurrentUserBadge_badge_idx";

-- DropIndex
DROP INDEX "CurrentUserBadge_userId_badge_key";

-- AlterTable
ALTER TABLE "BadgeAward" ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'NO';

-- AlterTable
ALTER TABLE "CurrentUserBadge" ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'NO';

-- CreateIndex
CREATE INDEX "BadgeAward_userId_language_awardedAt_idx" ON "BadgeAward"("userId", "language", "awardedAt");

-- CreateIndex
CREATE INDEX "BadgeAward_badge_language_awardedAt_idx" ON "BadgeAward"("badge", "language", "awardedAt");

-- CreateIndex
CREATE INDEX "BadgeAward_language_awardedAt_idx" ON "BadgeAward"("language", "awardedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BadgeAward_userId_badge_validFrom_language_key" ON "BadgeAward"("userId", "badge", "validFrom", "language");

-- CreateIndex
CREATE INDEX "Joke_language_published_id_idx" ON "Joke"("language", "published", "id");

-- CreateIndex
CREATE INDEX "Comment_language_createdAt_jokeId_idx" ON "Comment"("language", "createdAt", "jokeId");

-- CreateIndex
CREATE INDEX "CurrentUserBadge_userId_language_idx" ON "CurrentUserBadge"("userId", "language");

-- CreateIndex
CREATE INDEX "CurrentUserBadge_badge_language_idx" ON "CurrentUserBadge"("badge", "language");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentUserBadge_userId_badge_language_key" ON "CurrentUserBadge"("userId", "badge", "language");
