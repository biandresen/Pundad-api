🔹 PROJECT CONTEXT SNAPSHOT – DADJOKES APP

I am building a fullstack DadJokes app.

Stack

Frontend: React + TypeScript + React Router

Backend: Node.js + Express

Database: PostgreSQL with Prisma

Auth: JWT access tokens + refresh tokens

Pagination: custom usePagination hook (infinite + button modes)

Deployment: Production-ready (PM2 + Nginx)

Core Features Implemented
Content

Create joke

Draft system

Publish system

Tags

Like system

Comments (paginated)

Daily Joke (deterministic hash per day)

Random Joke

Search with filters (title/body/comments/tags)

Infinite scroll for feeds

Rankings / Badges

Hall of Fame

Top Creator (monthly)

Trending (weekly)

Most Commented (weekly)

Fastest Growing (24h likes)

Featured system uses DB persistence

Deterministic ranking logic

Idempotent upsert patterns

Navigation

Desktop: Left sidebar always visible

Mobile: Toggle left/right sidebars via header buttons

Coachmark implemented once for mobile

Explore button added on landing pages

Database Structure (Simplified)

Joke

id

title

body

tags

published

createdAt

authorId

likes

comments

User

id

username

role

streak

featuredWins

etc.

FeaturedJoke

id

jokeId

type (daily, trending, etc.)

date

(currently no language column)

Next Goal

Implement multi-language support (Norwegian + English) properly.

Requirements:

One app, one DB

Jokes must be language-scoped

Rankings and featured must be language-scoped

UI language switcher

No mixing Norwegian and English jokes

Pilot Norwegian first, then open English

Please guide me step-by-step in implementing this feature professionally.