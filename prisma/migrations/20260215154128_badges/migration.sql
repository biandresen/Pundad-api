-- CreateEnum
CREATE TYPE "FeatureType" AS ENUM ('DAILY_JOKE');

-- CreateEnum
CREATE TYPE "BadgeKey" AS ENUM ('ADMIN', 'TOP_CREATOR_MONTH', 'JOKE_OF_DAY', 'TRENDING_WEEK', 'MOST_COMMENTED', 'FASTEST_GROWING', 'STREAK');

-- AlterTable
ALTER TABLE "JokeLike" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "BadgeAward" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "badge" "BadgeKey" NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "context" JSONB,

    CONSTRAINT "BadgeAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrentUserBadge" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "badge" "BadgeKey" NOT NULL,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "context" JSONB,

    CONSTRAINT "CurrentUserBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturedJoke" (
    "id" SERIAL NOT NULL,
    "type" "FeatureType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "jokeId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturedJoke_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BadgeAward_userId_awardedAt_idx" ON "BadgeAward"("userId", "awardedAt");

-- CreateIndex
CREATE INDEX "BadgeAward_badge_awardedAt_idx" ON "BadgeAward"("badge", "awardedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BadgeAward_userId_badge_validFrom_key" ON "BadgeAward"("userId", "badge", "validFrom");

-- CreateIndex
CREATE INDEX "CurrentUserBadge_badge_idx" ON "CurrentUserBadge"("badge");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentUserBadge_userId_badge_key" ON "CurrentUserBadge"("userId", "badge");

-- CreateIndex
CREATE INDEX "FeaturedJoke_date_idx" ON "FeaturedJoke"("date");

-- CreateIndex
CREATE INDEX "FeaturedJoke_jokeId_idx" ON "FeaturedJoke"("jokeId");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedJoke_type_date_key" ON "FeaturedJoke"("type", "date");

-- CreateIndex
CREATE INDEX "Comment_jokeId_createdAt_idx" ON "Comment"("jokeId", "createdAt");

-- CreateIndex
CREATE INDEX "JokeLike_jokeId_createdAt_idx" ON "JokeLike"("jokeId", "createdAt");

-- CreateIndex
CREATE INDEX "JokeLike_userId_createdAt_idx" ON "JokeLike"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "BadgeAward" ADD CONSTRAINT "BadgeAward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentUserBadge" ADD CONSTRAINT "CurrentUserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedJoke" ADD CONSTRAINT "FeaturedJoke_jokeId_fkey" FOREIGN KEY ("jokeId") REFERENCES "Joke"("id") ON DELETE CASCADE ON UPDATE CASCADE;
