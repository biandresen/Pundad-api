# Badge and leaderboard regression tests

## Try the feature on the development server

If the leaderboard reports that `BadgeAward.scoringWindowStart` does not exist,
the API code/client is newer than the development database schema. From the
backend development worktree, apply the additive migration before testing:

```sh
npm run db:dev:deploy
npm run db:dev:seed:badges
```

The second command creates four verified, development-only accounts:
`demo_badge_alex`, `demo_badge_blair`, `demo_badge_casey`, and `demo_badge_drew`.
Their development-only password is `BadgeDemo2026!`. Start with Alex, open the
badge dashboard and leaderboard, and switch between NO and EN. The languages
have different leaders, all five featured badge types, current/expired/future
and non-expiring current rows, received likes/comments, and more than one page
of historical awards. Check week, month and all-time views; a historical daily
award can still contribute points after its active badge expires.

Fixtures use the current UTC day. Rerun the command when testing on another day.
It transactionally refreshes only its four marked demo accounts and their
content/engagement. It leaves other accounts/posts alone and refuses collisions
with accounts it does not own. Changes made while logged into a demo account
are part of the resettable fixture area, so rerunning the command clears them
and invalidates those demo sessions. Other users' comments/likes attached to demo
posts are also removed when those posts are refreshed.

Remove the fixtures with:

```sh
npm run db:dev:seed:badges -- --clean
```

Both commands load the existing development environment guard and additionally
require the local `pundad_dev` role/database and public schema. They never reset
the database, send verification emails, change the daily scoring cutover, or
create global feature/finalization checkpoints. The records are labeled UI demo
fixtures, not reconstructed genuine award outcomes. Pause the development worker
while inspecting fixed examples; real worker recomputation can replace active
winners. Run `npm run db:dev:seed:badges -- --clean` before resuming that worker
or reaching the configured daily scoring cutover. The synthetic Fastest Growing
history is explicitly legacy-shaped; retaining it during daily-mode computation
would correctly trigger the overlapping-legacy-award guard. Production/staging
processes are unaffected.

## Automated regression tests

Use the repository's Node version from `.nvmrc` and install dependencies with
`npm ci`. The normal `npm test` command runs existing unit/HTTP tests and skips
the PostgreSQL integration suites when `TEST_DATABASE_URL` is absent.

Create an empty, disposable PostgreSQL database whose name ends in `_test`,
using a role that can create and drop schemas. Set only `TEST_DATABASE_URL` to
that database. Never use a production database or copy production credentials.
For example, with a local test role and database:

```sh
TEST_DATABASE_URL='postgresql://test:test@127.0.0.1:5432/pundad_test?schema=public' \
  node --experimental-test-module-mocks --test test/*.integration.test.js
```

The shared fixture helper validates the database name, creates a randomly named
schema for each suite, applies the existing Prisma migrations, and sets that test
process's `DATABASE_URL` to its schema before importing application services.
Each suite closes Prisma connections and drops its own schema afterward. Public
schema data is untouched. An interrupted process can leave `test_*` schemas in
the disposable database; recreating that test database cleans them up.

The CI database job supplies PostgreSQL 17 and `TEST_DATABASE_URL`, runs the
integration suites after migration verification, and retains the existing seed
check. `TEST_DATABASE_URL` is test-only. Application migration and cutover details
for the approved Fastest Growing scoring change are documented separately.

The suites use fixed UTC timestamps and explicit fixtures for NO and EN. They
exercise public HTTP endpoints and featured service entry points, including
query validation, scoring, validity boundaries, language isolation, deterministic
winners, transaction rollback/recovery, concurrent runs, and unchanged post and
daily-view behavior. The registration/Turnstile suite remains part of `npm test`.

Run focused files during development, then `npm test`, `npm run lint`,
`npx prisma validate`, and `npx prisma generate`. Integration tests require local
TCP access to PostgreSQL and loopback HTTP listeners.

## Top Creator qualification (repeat in NO and EN)

- Create several published jokes in this UTC month. A joke with no likes, one
  other-user like, or one other-user like plus an author like does not qualify.
  Comments alone do not qualify it, including for the first joke of the month.
- Add a second distinct other-user like received this month, then use the admin
  monthly recompute action. The joke contributes one to its creator's count.
- More qualifying jokes win; ties use the total same-month non-author likes on
  those qualifying jokes, then lowest user ID. Extra likes on unqualified jokes
  and author likes cannot decide the tie.
- Remove a qualifying like or unpublish a joke and recompute. The provisional
  leader/award may change or clear. Existing completed-month history remains.
- Jokes created before the month (including older drafts published now), drafts,
  likes before the UTC month start or at/after its end, and other-language jokes
  do not contribute. UTC start is inclusive and next-month midnight exclusive.
- With no qualifying jokes, expect a flat `no_winner` result from recompute and
  empty monthly featured content. Otherwise keep the existing response shape,
  five-point award, and a qualifying joke as the featured example.

Run `test/featured.integration.test.js` and
`test/post-regression.integration.test.js` first. The monthly boundary fixtures
were also verified with a PostgreSQL server using a non-UTC session time zone.
Queries bind the UTC boundaries as timestamp values matching Prisma's columns.
Recompute still runs on boot and daily at 00:10 UTC; use the admin action when
checking changes immediately. Fixed UI demo awards are illustrative, not proof
that a demo creator currently satisfies this calculation.

## Seven-day streak bonus (repeat in NO and EN)

Migration `20261025180000_language_streak_bonuses` adds empty language progress
without converting global streak values. Regenerate Prisma before starting the
updated API. `STREAK_BONUS_START_UTC=YYYY-MM-DD` must announce a future UTC date;
missing/empty disables bonuses until configured, and the date cannot be removed
or changed once progress starts. Local development is scheduled for
**2026-10-26 00:00 UTC**. No scheduler is needed.

- Before activation, the daily page shows the scheduled UTC date. Global profile
  visits still count, while new language bonus progress stays zero.
- On/after activation, viewing an actual loaded daily joke starts that language
  at one. The page shows days until the next point. Signing out shows a login
  prompt; absent/failed content must not POST a view.
- The API independently requires a published daily featured joke in the same
  language and current UTC day for bonus progress. Missing, stale, draft, or
  mismatched-language records cannot qualify, even on the seventh day. The
  existing global view response remains independent of bonus eligibility.
- Use isolated fixed-clock tests for seven, fourteen and twenty-one consecutive
  UTC days. Each seventh day gives one historical STREAK_BONUS point. Reloads,
  concurrent tabs, and successful retries give no extra days or points.
- Earn a point in NO without authoring/receiving engagement: the reader appears
  in NO ranking with one point and zero featured wins. EN is independent. Bonus
  point counts use the milestone day in week/month/all filters.
- Miss a full UTC day: progress reads zero, then starts at one on the next view.
  Already earned points/history remain. The global profile counter retains its
  existing cross-language rules and never grants retroactive points.
- Induce a network failure in browser fixtures: the joke remains visible, saved
  progress can be read independently, and retry is available. Rapid NO/EN
  switches must not apply delayed results from the previous language.
- Verify the new flame bonus label in history, without an active bonus badge.
  The points guide explains the distinction from the decorative global flame.

Focused backend commands use `test/streak.integration.test.js` and
`test/leaderboard.integration.test.js` with TEST_DATABASE_URL. They cover exact
UTC/DST boundaries, no backfill, activation guards, actual database rollback,
retries/concurrency, missing/invalid configuration and inactive/deleted users.
Do not manipulate the clock or real accounts to simulate a week on dev. The
existing fixed UI demo awards remain illustrative; browser fixtures and isolated
test schemas exercise bonus milestones without rewriting genuine progress.
