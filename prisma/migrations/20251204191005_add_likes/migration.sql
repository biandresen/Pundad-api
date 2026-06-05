/*
  Warnings:

  - The primary key for the `JokeLike` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `JokeLike` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "JokeLike" DROP CONSTRAINT "JokeLike_pkey",
DROP COLUMN "id";
