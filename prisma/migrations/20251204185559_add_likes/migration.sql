-- CreateTable
CREATE TABLE "JokeLike" (
    "id" SERIAL NOT NULL,
    "jokeId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "JokeLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JokeLike_jokeId_userId_key" ON "JokeLike"("jokeId", "userId");

-- AddForeignKey
ALTER TABLE "JokeLike" ADD CONSTRAINT "JokeLike_jokeId_fkey" FOREIGN KEY ("jokeId") REFERENCES "Joke"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JokeLike" ADD CONSTRAINT "JokeLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
