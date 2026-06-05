/*
  Warnings:

  - A unique constraint covering the columns `[type,date,language]` on the table `FeaturedJoke` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[language,name]` on the table `Tag` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "Language" AS ENUM ('NO', 'EN');

-- DropIndex
DROP INDEX "FeaturedJoke_date_idx";

-- DropIndex
DROP INDEX "FeaturedJoke_type_date_key";

-- DropIndex
DROP INDEX "Tag_name_key";

-- AlterTable
ALTER TABLE "Joke" ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'NO';

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'NO';

-- AlterTable
ALTER TABLE "FeaturedJoke" ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'NO';

-- AlterTable
ALTER TABLE "JokeLike" ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'NO';

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'NO';

-- CreateIndex
CREATE INDEX "Joke_language_published_createdAt_idx" ON "Joke"("language", "published", "createdAt");

-- CreateIndex
CREATE INDEX "Joke_language_published_updatedAt_idx" ON "Joke"("language", "published", "updatedAt");

-- CreateIndex
CREATE INDEX "Joke_authorId_language_createdAt_idx" ON "Joke"("authorId", "language", "createdAt");

-- CreateIndex
CREATE INDEX "Joke_language_published_idx" ON "Joke"("language", "published");

-- CreateIndex
CREATE INDEX "Comment_language_createdAt_idx" ON "Comment"("language", "createdAt");

-- CreateIndex
CREATE INDEX "FeaturedJoke_language_type_date_idx" ON "FeaturedJoke"("language", "type", "date");

-- CreateIndex
CREATE INDEX "FeaturedJoke_language_date_idx" ON "FeaturedJoke"("language", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedJoke_type_date_language_key" ON "FeaturedJoke"("type", "date", "language");

-- CreateIndex
CREATE INDEX "JokeLike_language_createdAt_idx" ON "JokeLike"("language", "createdAt");

-- CreateIndex
CREATE INDEX "Tag_language_name_idx" ON "Tag"("language", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_language_name_key" ON "Tag"("language", "name");
