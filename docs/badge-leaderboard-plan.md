# Badge and leaderboard implementation plan

## Worktree safety
Both supplied worktrees were clean at inspection. Existing commits are preserved without rebasing, resetting or discarding. Frontend baseline: a8b4657188642fe0610a17471005b99a4e3deefb. Backend baseline: 95522352eeb2ca04d2c1724e75fb54404e28c20f. Both branches are feat/registration-turnstile, ahead 4 / behind 6 relative to local origin tracking refs. No commits or remote mutations authorized.

This section records the original inspection. After implementation, validation,
and review, the user authorized Conventional Commits and pushes on 2026-10-25.
The final branch in both worktrees is `feat/badge-leaderboard-correctness`;
the handoff records its updated main baseline and rollout requirements.

## Reviewed issues (full descriptions)
- [8: Fix: validate and honor leaderboard period and limit query parameters](https://github.com/biandresen/Pundad-api/issues/8)
- [9: Fix: continuously recalculate current weekly and monthly featured winners](https://github.com/biandresen/Pundad-api/issues/9)
- [10: Fix: make featured-result and badge-award updates atomic and recoverable](https://github.com/biandresen/Pundad-api/issues/10)
- [11: Fix: enforce active badge expiration, including Joke of the Day](https://github.com/biandresen/Pundad-api/issues/11)
- [12: Fix: filter leaderboard badge data by language and active validity](https://github.com/biandresen/Pundad-api/issues/12)
- [13: Investigation: rebalance fastest-growing awards and leaderboard scoring](https://github.com/biandresen/Pundad-api/issues/13)
- [14: Fix: make Joke of the Day selection fair and deterministic](https://github.com/biandresen/Pundad-api/issues/14)
- [15: Fix: exclude inactive and deleted users from leaderboard results](https://github.com/biandresen/Pundad-api/issues/15)
- [16: Fix: add deterministic ordering for exact leaderboard ties](https://github.com/biandresen/Pundad-api/issues/16)
- [17: Fix: make featured admin recompute endpoints language-aware and return correct responses](https://github.com/biandresen/Pundad-api/issues/17)
- [18: Investigation: define streak eligibility and language behavior for leaderboards](https://github.com/biandresen/Pundad-api/issues/18)
- [19: Test: add regression coverage for badge, featured, streak, and leaderboard calculations](https://github.com/biandresen/Pundad-api/issues/19)
- [203: Improve: show and explain the score that determines leaderboard ranking](https://github.com/biandresen/Pundad-app/issues/203)
- [204: Fix: refresh badge data when the active language changes](https://github.com/biandresen/Pundad-app/issues/204)
- [205: Fix: defensively hide expired or wrong-language active badges in the UI](https://github.com/biandresen/Pundad-app/issues/205)

## Dependency order
1. Shared backend current-badge predicate: requested language, since <= request time, validTo > request time or null; legacy JOKE_OF_DAY null expiry bounded by since UTC day. Frontend consumes existing since, validTo, language metadata.
2. In parallel: backend featured transaction work (#9/#10/#14, plus #11 JOTD award expiry); leaderboard query validation/ranking reads (#8/#12/#15/#16); frontend badge refresh/defensive presentation (#204/#205) using established metadata.
3. Admin recompute contracts (#17): authenticated admin, validated lang query/header using NO default convention, direct service result under data with status/jokeId/language. Frontend #203 can proceed against existing featuredScore and unchanged weight/tie fields once these are confirmed.
4. Integrate #11 badge/user/joke read projections using shared predicate. Keep registration, joke creation/editing, moderation writes unchanged.
5. Extend #19 deterministic tests at approved public seams; real isolated PostgreSQL tests for rollback/retry/concurrency. Test unchanged global viewing streaks and the approved display-only leaderboard behavior.
6. Focused tests and incremental checks, then full test/lint/build/Prisma checks; review standards and spec in parallel against recorded clean baselines and uncommitted working-tree diffs.

## Combined correctness work
- #9/#10: one serializable transaction per logical feature update with bounded retries for serialization/unique races. Current week/month award is provisional; replace its ownership when the winner changes, retain completed-period history. Existing unique keys are sufficient together with serialization; confirm through actual DB concurrency tests.
- #9/#14: stable feature ties by immutable ID; daily picks against the full stable ID pool, avoiding the yesterday-excluded modulo defect. Persist same-day choice and repair missing award/current rows on retry.
- #11/#12/#205: one validity interpretation across backend response paths and frontend active presentation; history remains visible.
- #8/#16/#203: defaults month/25, limit integer 1–100, UTC Monday weeks/month boundaries, ordinal ranks, final normalized username then immutable ID order. Weights: monthly creator 5, daily 4, fastest 3, trending 3, most commented 2. Approved ordering: score, wins, received likes, received comments, normalized username, ID. Global streak remains visible.

## Approved design decisions
The user approved the documented #13 and #18 recommendations on 2026-10-25 after their alternatives were presented. Test seams were also explicitly approved.

- #13: hourly rolling discovery remains; scoring grants one 3-point award per language and completed non-overlapping UTC day, with lowest joke ID resolving ties. The badge is active the following UTC day. Preserve legacy history/scores; require an explicit future cutover date to enable the rule. Add daily scoring identity/checkpoints and an additive Prisma migration, plus bounded catch-up, concurrency and cutover tests.
- #18: global streak remains visible, but leaves language leaderboard ordering. Streak alone still does not grant eligibility. No streak state migration or backfill.

## Scheduler/schema/deployment
Keep hourly weekly, hourly rolling discovery, daily monthly and 00:05 UTC daily schedules. Every scheduled week/month recomputation updates current leaders. Finalize completed fastest-growing scoring days on worker boot and hourly for NO/EN, with bounded chronological catch-up. Migration adds nullable scoring-day metadata and a finalized-window table without rewriting legacy rows. Enable the rule using FASTEST_GROWING_DAILY_START_UTC, consistent across API and workers; do not access production secrets or run against production. Explicitly document rollover and downtime limitations for weekly/monthly historical snapshots.

## Approved Top Creator follow-up (2026-10-25)

The user approved a quality threshold: count only published jokes created in the
current UTC month with at least two likes from distinct other users received in
that same month. Count each qualifying joke once. Rank creators by qualifying
joke count, then those jokes' qualifying likes, then ascending immutable user ID.
Self-likes and comments do not contribute; the first joke has no exemption. No
qualifying joke means no winner. Keep five points, language separation, current
period reconciliation, and completed-period history.

Both feature worktrees remained on `feat/badge-leaderboard-correctness`; existing
dirty files were copied before this follow-up to
`/tmp/pundad-creator-quality-before-zeot3_oc` for preservation and review.

1. Add a failing public featured-service regression using isolated PostgreSQL.
2. Replace the monthly candidate aggregate inside the existing serializable
   transaction; retain the response fields, schema, and award-writing path.
3. Exercise exact UTC boundaries, self-likes, comments, drafts, old posts,
   NO/EN, tie changes, unlike/unpublish, retries, rollback, and concurrent runs.
4. In parallel, update NO/EN Top Creator descriptions and clarify earned-day
   attribution for the rocket Fastest Growing award with a month-boundary example.
5. Run focused checks, full test/lint/build checks, and parallel standards/spec
   review. Document the unchanged daily 00:10 UTC monthly recompute schedule;
   eligibility changes take effect on the next scheduled/admin recompute.

No additional migration, environment variable, or API field is required. Deploy
the updated API and worker together before relying on the new frontend wording.
Streak scoring was initially a separate recommendation; the user subsequently
approved the implementation below.

## Approved streak-bonus follow-up (2026-10-25)

The revised #18 decision grants one point at each seven consecutive UTC days
viewing Joke of the Day per language. NO/EN bonus progress is separate, while
global profile streaks remain. Earned points survive missed days and count on
the milestone date; bonus-only readers qualify. Existing global counts and old
STREAK rows never generate retroactive points. Featured wins remain featured-only.

Existing work was preserved in `/tmp/pundad-streak-before-ddtfcza7`. Tests stay
at the previously approved HTTP/service, real-database, and frontend seams.

1. Add a failing daily-view HTTP regression before implementing progress.
2. Add the STREAK_BONUS enum and per-user/language DailyJokeStreak table in an
   additive migration. Verify migration/schema equivalence and no backfill.
3. Put global progress, language progress, and milestone awards in one Prisma
   serializable transaction with bounded concurrency retries. Expose a read-only
   progress endpoint and an additive daily-view response.
4. In parallel, include earned bonus points and reader eligibility in leaderboard
   reads; wire explicit-language frontend progress, score breakdown, history, and
   NO/EN explanations against that contract.
5. Test milestones, expiry/reset boundaries, UTC/DST, language isolation, period
   attribution, retries/concurrency, rollback, start policy, and existing flows.
6. Run focused checks, broader checks and independent parallel code reviews;
   update the handoff and stop for dev review without committing/pushing.

`STREAK_BONUS_START_UTC` announces a future start day, optional/disabled before
activation and pinned once progress exists. Local development starts 2026-10-26
at 00:00 UTC after the guarded migration. No production/staging settings change.
No new scheduler is needed; milestones are awarded on actual daily views.

## Validation and handoff
Run deterministic period, validity/legacy boundary, retry, rollback, concurrency, tie, NO/EN, and changing-winner fixtures. Baseline frontend tests pass; sandbox blocks backend loopback HTTP tests, so rerun with the permitted network execution scope. Registration/Turnstile, moderation and create/edit regressions must pass. Report every changed file, issue status, pending design decisions, migration/deploy/scheduler/env implications and NO/EN dev checklist. Stop for dev review without committing or pushing.
