/*
  Warnings:

  - You are about to drop the column `changedAt` on the `Joke` table. All the data in the column will be lost.
  - You are about to drop the column `changedAt` on the `Comment` table. All the data in the column will be lost.
  - You are about to drop the column `changedAt` on the `Tag` table. All the data in the column will be lost.
  - You are about to drop the column `changedAt` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Joke" DROP COLUMN "changedAt",
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Comment" DROP COLUMN "changedAt",
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Tag" DROP COLUMN "changedAt",
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "changedAt",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
