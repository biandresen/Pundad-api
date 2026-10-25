# Fastest Growing investigation: API issue #13

Status: approved by the user and implemented. The daily policy activates only when FASTEST_GROWING_DAILY_START_UTC is configured and that UTC day begins. Before activation, absent configuration retains legacy hourly awards; after a daily checkpoint exists, removing the configuration fails closed.

## Current behavior and magnitude

The worker chooses a winner every hour from likes received during the preceding rolling 24 hours. Each hourly feature creates a historical award worth 3 leaderboard points, keyed by language and hour. Repeated runs in the same hour are idempotent, but successive hours are distinct awards.

For one user, 24 wins yield 72 points per UTC day, 168 wins yield 504 points per seven days, and a 31-day month can yield 744 wins and 2,232 points. Other award weights are Joke of the Day 4, Trending Week 3, Most Commented Week 2, and Top Creator Month 5. A single hourly Fastest Growing award equals a weekly Trending award; two exceed a monthly Top Creator award. A sparse example is one eligible like with no competition: it can win approximately 24 overlapping hourly windows and earn roughly 72 points despite there being only one underlying event. The exact number depends on the like timestamp and scheduler boundaries. Typical production frequency is unknown; no production data was queried.

## Recommended rule

Keep hourly rolling 24-hour feature selection for discovery. Decouple that display from scoring awards. Award **one Fastest Growing winner per completed UTC calendar day, per language**, using received-like events in the non-overlapping interval `[00:00 UTC, next 00:00 UTC)`. Each daily award remains worth 3 points. No likes means no award. Choose the joke with most likes; ties use ascending immutable joke ID, consistently with the other featured calculations.

The day’s award goes to that joke’s author. Multiple jokes by one author do not combine: this remains a joke-level feature. NO and EN pools, feature rows and award uniqueness remain independent. A like event contributes to exactly one daily scoring window. Deleting and recreating a like remains an event-policy question outside this ticket; this proposal does not add an immutable engagement ledger.

The maximum is 3 points per day per language, 21 per seven days, and 93 per 31-day month. This is an intentional frequency advantage over weekly awards, substantially smaller than the current 504/2,232 maxima. Changing the 3-point weight would require a separate product decision. Daily JOTD remains 4 points; the daily engagement award is slightly lower.

Hourly display must distinguish “currently fastest growing” from “daily Fastest Growing award”. A rolling display win alone grants no scoring award or historical award. The active daily badge belongs to the most recently completed day’s scoring winner for the following UTC day; history records its earned day and evidence window. The user approved this active-badge interval with the daily scoring rule.

## Alternatives

- Preserve hourly awards and cap their scoring contribution at one per user per UTC day. This limits each user’s points but can still credit the same likes on two consecutive days and rewards the number of distinct hourly leaders rather than a single daily winner.
- Award once on winner changes or use a cooldown. A leader can alternate across windows and reuse the same activity. A cooldown bounds frequency but does not ensure non-overlapping activity.
- Retain hourly history and apply diminishing returns. This preserves more history but complicates explanations and ranking; activity is still counted repeatedly.
- Use fixed hourly non-overlapping windows. Likes count once, but up to 24 scored awards per day still outweigh the other categories.
- Award once daily from a rolling window. At exactly midnight this can equal a completed UTC day; running at arbitrary times risks overlap or gaps. Explicit day keys and closed intervals are clearer and retry-safe.

## Historical policy and implementation dependencies

Keep existing historical awards and their scores unchanged unless a separate retrospective policy is approved. Existing hourly history remains genuine history under the old rule; deleting or deduplicating it would change old and all-time rankings. Document an effective UTC day for the new policy, with no double award during cutover. Old hourly rows and new daily scoring awards must be distinguishable so monthly and all-time queries can apply the correct rule.

Implementation and deployment:

1. Migration `20261025151000_fastest_growing_daily_windows` adds nullable `BadgeAward.scoringWindowStart` with a unique badge/language/window key, plus `FeaturedAwardWindow` checkpoints. Existing awards keep null metadata and unchanged timestamps/points. Checkpoints include no-winner days. Regenerate the Prisma client and apply migrations before deploying the updated processes.
2. Set `FASTEST_GROWING_DAILY_START_UTC=YYYY-MM-DD` consistently in the API and worker environment. Choose a **future UTC day after the last legacy hourly award**. A malformed date or a cutover overlapping legacy hourly awards fails explicitly before changing awards; this prevents old/new midnight identity collisions. After the first finalized daily window, changing the cutover in either direction or removing/emptying the setting fails closed for that language; hourly scoring cannot silently resume. Before any daily windows exist, an absent/empty setting retains legacy mode, so deployment must explicitly set it to activate the approved rule.
3. Deploy the API and worker before the chosen cutover, and stop all old worker versions before that midnight. Hourly discovery continues; at/after cutover it grants no badge or historical award. Existing legacy active badges are cleared for that language while historical rows remain. After activation, do not roll back to pre-policy API recompute or worker code: that code bypasses the cutover guard and resumes hourly scoring. Keeping the additive migration does not prevent this. Roll forward, or suspend scoring/recompute jobs while recovering.
4. Every hourly worker run and worker boot finalizes completed UTC days for NO and EN. Each day is one serializable transaction spanning award/current badge/checkpoint, with bounded serialization/unique retries. Up to 31 missing days per language are processed per run; `hasMore` reports a remaining backlog, continued on the next run. `npm run dev:runOnce` processes all features in both languages and reports catch-up remaining. Admins may call `POST /api/v1/featured/admin/recompute/fastest-growing-daily?lang=NO` (or EN) to process the same bounded backlog. No partial current day is finalized.
5. Catch-up history uses the original earned day (`scoringWindowStart`) for leaderboard period attribution. Legacy awards still use their original `awardedAt`. Expired catch-up awards never replace an active current winner. A current daily badge uses `[windowEnd, windowEnd + 1 day)`. At midnight before the worker runs there may briefly be no active daily winner; no stale winner remains active.
6. Daily awards carry `rule: UTC_DAY_V1`, window start/end, winner joke and like count. Tests cover UTC boundary likes, exact ties, language isolation, empty days, repeated/concurrent runs, DB-trigger rollback, bounded catch-up, legacy preservation and rejected overlapping/malformed cutovers. No production records were queried or rewritten.

The daily winner is calculated from the published joke pool and like rows available at finalization. The existing mutable engagement model cannot reconstruct likes removed before delayed finalization or jokes removed/unpublished during downtime; an immutable event ledger would be a separate product/data architecture change. Once a window is finalized, later edits do not rewrite its award. Regular hourly finalization limits delay under normal operations.

Weekly/monthly schedules retain their existing cadence (weekly hourly, monthly daily), with each run now recalculating the open-period winner. Completed-period snapshots are preserved. Exact closed-period finalization and long-outage reconstruction for those categories remain separate follow-up decisions.
