/*
  Warnings:

  - You are about to drop the column `language` on the `Comment` table. All the data in the column will be lost.
  - You are about to drop the column `language` on the `JokeLike` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[jokeId,userId]` on the table `JokeLike` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[token]` on the table `RefreshToken` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Joke_language_published_idx";

-- DropIndex
DROP INDEX "Comment_language_createdAt_idx";

-- DropIndex
DROP INDEX "Comment_language_createdAt_jokeId_idx";

-- DropIndex
DROP INDEX "JokeLike_language_createdAt_idx";

-- DropIndex
DROP INDEX "JokeLike_jokeId_userId_language_key";

-- DropIndex
DROP INDEX "Tag_language_name_idx";

-- AlterTable
ALTER TABLE "Comment" DROP COLUMN "language";

-- AlterTable
ALTER TABLE "JokeLike" DROP COLUMN "language";

-- CreateTable
CREATE TABLE "ModerationTerm" (
    "id" SERIAL NOT NULL,
    "term" TEXT NOT NULL,
    "category" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModerationTerm_term_key" ON "ModerationTerm"("term");

-- CreateIndex
CREATE INDEX "ModerationTerm_isActive_idx" ON "ModerationTerm"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "JokeLike_jokeId_userId_key" ON "JokeLike"("jokeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "ResetPasswordToken_userId_idx" ON "ResetPasswordToken"("userId");

-- CreateIndex
CREATE INDEX "ResetPasswordToken_expiresAt_idx" ON "ResetPasswordToken"("expiresAt");
