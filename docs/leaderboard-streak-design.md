# Daily viewing streak bonuses (#18)

Status: revised rule approved by the user on 2026-10-25 and implemented. This
supersedes the earlier display-only recommendation. The account-wide profile
streak remains; a separate language streak now earns modest leaderboard bonuses.

## Product rule

- View Joke of the Day on seven consecutive UTC days in one language to earn
  one point. Further milestones are days 14, 21, 28, and so on.
- NO and EN maintain independent bonus progress. Viewing both can advance each
  once that day. Reloads and retries never add another day or duplicate a bonus.
- A missed UTC day resets that language's progress on the next view. Earned
  points and historical bonus awards remain. Read-only progress shows zero when
  a full day has been missed, without mutating stored history.
- Award points on the milestone UTC day, including for week/month/all filters.
  A seven-day sequence spanning October/November earns its point in November if
  its seventh day is in November; it does not prorate across the two months.
- A bonus alone qualifies a reader for that language's leaderboard. Bonus points
  increase total score, but do not increase featured wins. Existing ordering is
  total score, featured wins, received likes, received comments, normalized
  username, then immutable user ID. Numeric values descend; the last two ascend.
- Existing global streak values do not produce bonus points. New language
  progress starts from its first actual view on or after the announced start day.

The seven-day interval and one-point weight are product decisions. Twenty-eight
consecutive days earn four points per language, compared with five for one Top
Creator award. No change was made to the existing global profile streak or its
best-streak display. The global flame badge remains decorative.

## Data and atomicity

Migration `20261025180000_language_streak_bonuses` adds the `STREAK_BONUS` badge
key and a `DailyJokeStreak` row keyed by `(userId, language)`, containing current
and best progress, last view, and the pinned policy start. It leaves all existing
users, streaks, and awards untouched; there is no backfill.

The daily view uses a serializable Prisma transaction with bounded retries for
serialization/uniqueness races. Global profile progress, language progress, and
any milestone award commit together or roll back together. The historical award
uses `(userId, badge, validFrom, language)` uniqueness, with `validFrom` set to the
milestone UTC midnight and `awardedAt` to the actual view instant. The
`scoringWindowStart` field stays null: its cross-user uniqueness belongs to
single-winner featured awards, not participation bonuses.

Bonus awards are permanent history records, without a `CurrentUserBadge` row.
Legacy `STREAK` rows never score. Inactive/deleted accounts cannot record bonus
progress and remain absent from leaderboards. Same-day and older delayed
requests cannot move progress backward or grant duplicate rewards.

The same transaction verifies a published daily featured joke for the selected
language and current UTC day before advancing bonus progress. Missing, stale,
draft, or mismatched-language daily content never qualifies. The original global
view contract remains available independently; it cannot generate bonus points.
An unavailable daily joke does not grant a free bonus day or bridge a missed day.

## API and UI

Both endpoints require authentication and use the resolved request language:

- `POST /api/v1/jokes/daily/view` retains the three global profile fields and
  adds `streakBonus` with language, status, startsAt, streak, bestStreak,
  lastViewedAt, viewedToday, daysUntilBonus, and awarded.
- `GET /api/v1/jokes/daily/streak` returns the same progress directly under data,
  without awarded, and never records a view. Status is disabled, scheduled, or
  active. At day seven, daysUntilBonus becomes seven for the next milestone.
- Leaderboard rows retain `featuredScore` as the displayed total for API
  compatibility and add `streakBonusPoints` for the selected period. Existing
  `winsTotal` and `winsByBadge` remain featured-only. Global dailyStreak and
  bestStreak remain informational.

The daily page sends the selected language, records only after a joke loads,
shows language-specific progress and milestone feedback, and retains the joke
when bonus recording fails. Saved progress can be read independently and the
view retried safely. NO/EN switches discard stale responses. The points guide,
leaderboard breakdown, and badge history explain the bonus in both languages.

## Rollout

1. Apply migrations and regenerate Prisma before starting the updated API.
2. Set optional `STREAK_BONUS_START_UTC=YYYY-MM-DD` on every API instance to an
   announced future UTC day. Missing/empty means disabled before activation;
   before the date, status is scheduled and views update only global progress.
3. Deploy all API instances before that day. Old API versions do not record new
   bonus progress; do not mix old and new daily-view handlers after activation.
4. Keep the date fixed once any language progress exists. Removing/changing it
   fails closed for progress and view requests. Restore the original setting to
   recover; already earned history and scores remain.
5. No scheduler is required: awards are created by the seventh-day view itself.
   There is no missed-visit catch-up or historical reconstruction. This setting
   is independent of the Fastest Growing scoring cutover.

The guarded local development migration was applied, with the development-only
start configured for **2026-10-26 00:00 UTC**. Production/staging settings and
records were not accessed or changed. The example environment leaves it blank.

## Validation

`test/streak.integration.test.js` uses isolated migrated PostgreSQL schemas and
public HTTP calls for prospective activation, milestones, retries/concurrency,
languages, UTC/DST boundaries, missed days, policy guards, inactive/deleted
accounts, real rollback/recovery, and reader-only period scores. Leaderboard
fixtures verify that bonus points do not become featured wins or leak across
languages/periods. UI checks cover progress, errors/retry, empty content,
language races, history, and responsive layout.
