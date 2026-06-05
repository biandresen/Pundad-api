/*
  Warnings:

  - The values [MOST_COMMENTED] on the enum `BadgeKey` will be removed. If these variants are still used in the database, this will fail.
  - The values [MOST_COMMENTED] on the enum `FeatureType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "BadgeKey_new" AS ENUM ('ADMIN', 'TOP_CREATOR_MONTH', 'JOKE_OF_DAY', 'TRENDING_WEEK', 'MOST_COMMENTED_WEEK', 'FASTEST_GROWING', 'STREAK');
ALTER TABLE "BadgeAward" ALTER COLUMN "badge" TYPE "BadgeKey_new" USING ("badge"::text::"BadgeKey_new");
ALTER TABLE "CurrentUserBadge" ALTER COLUMN "badge" TYPE "BadgeKey_new" USING ("badge"::text::"BadgeKey_new");
ALTER TYPE "BadgeKey" RENAME TO "BadgeKey_old";
ALTER TYPE "BadgeKey_new" RENAME TO "BadgeKey";
DROP TYPE "BadgeKey_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "FeatureType_new" AS ENUM ('DAILY_JOKE', 'TOP_CREATOR_MONTH', 'TRENDING_WEEK', 'MOST_COMMENTED_WEEK', 'FASTEST_GROWING');
ALTER TABLE "FeaturedJoke" ALTER COLUMN "type" TYPE "FeatureType_new" USING ("type"::text::"FeatureType_new");
ALTER TYPE "FeatureType" RENAME TO "FeatureType_old";
ALTER TYPE "FeatureType_new" RENAME TO "FeatureType";
DROP TYPE "FeatureType_old";
COMMIT;
