/*
  Warnings:

  - A unique constraint covering the columns `[jokeId,userId,language]` on the table `JokeLike` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "JokeLike_jokeId_userId_key";

-- CreateIndex
CREATE UNIQUE INDEX "JokeLike_jokeId_userId_language_key" ON "JokeLike"("jokeId", "userId", "language");
