# Badge and leaderboard dev review handoff

Implementation is validated for dev review, and the user authorized Conventional Commits and pushes for both feature branches on 2026-10-25. PR creation, merging, issue closure, and production/staging deployment remain outside that authorization. Both supplied worktrees started clean. No production secrets or records were read or modified. After isolated migration verification, the additive migrations were also applied through the guarded command to the local `pundad_dev` database. Production/staging were untouched.

## Delivered behavior

- Weekly/monthly current winners recalculate on each scheduled run, with deterministic ties and provisional award ownership transferred when the winner changes.
- Feature, historical award and current badge updates use Prisma transactions, serializable retries and database uniqueness constraints.
- Current badges use inclusive start and exclusive expiry, consistent requested language and safe legacy daily expiry. Historical awards remain visible.
- Daily joke selection rotates fairly over the full pool before repeat avoidance; retries preserve the persisted day/language choice and repair missing badge rows.
- Leaderboard accepts validated week/month/all and integer limits 1–100, excludes inactive/deleted users, uses stable normalized username/ID final ordering and ordinal positions.
- The revised approved #18 rule keeps the global profile streak informational,
  while independent NO/EN bonus streaks grant one point per seven consecutive
  UTC viewing days. Earned points remain after a missed day and qualify readers
  for that language/period. Bonus points do not increase featured wins.
- The approved #13 rule keeps hourly rolling discovery but grants one 3-point award per completed non-overlapping UTC day and language after an explicit cutover. Lowest joke ID resolves ties. The badge is active the next UTC day. Catch-up is bounded and legacy scores are preserved.
- Frontend shows weighted score/comments, translated accessible ranking rules, language refresh with fresh pagination, stale-response isolation and mounted expiry updates.
- Follow-up: Top Creator counts only published jokes created in the UTC month
  with at least two same-month likes from distinct other users. Ties use likes
  on qualifying jokes, then lowest user ID. No first-joke exemption or comment
  qualification; no qualifying jokes means no winner. Five points and completed
  history remain. Only the open month is reconciled, inside the existing transaction.
- The public `/points-and-ranking` guide is available in NO/EN with links from
  the login info card, About page, and leaderboard, replacing its disclosure.
  It distinguishes the rocket Fastest Growing award from crown Joke of the Day
  and gives an October/November earned-day attribution example.
- Global profile progress, language bonus progress, and milestone history now
  update atomically with serializable retries. Bonus awards use the new
  STREAK_BONUS key and never become active badges; old STREAK rows never score.
  A read-only progress endpoint and the daily view's additive response support
  translated progress, start dates, milestones, and safe retry in the UI.

## Issue mapping

| Repository / issue | Result |
| --- | --- |
| API #8 | Period/default/limit validation and matchedData contract corrected; HTTP and UTC tests |
| API #9 | Current weekly/monthly recalculation, changing winner ownership, stable ties/idempotency/history; snapshot limitation below |
| API #10 | Atomic logical writes, retry/legacy repair, concurrent unique constraints, rollback/recovery fixtures |
| API #11 | Shared active validity for current badge/profile/joke reads; next-UTC-midnight JOTD; safe legacy rows/history |
| API #12 | Language and validity filtering inside leaderboard badge projection without N+1 queries |
| API #13 | Alternatives/recommendation documented, user approved, daily scoring implemented with migration/cutover/checkpoints/catch-up |
| API #14 | Fair stable full-pool daily rotation, no immediate repeat with alternatives; pools 0/1/2/3/5, pool changes and language tests |
| API #15 | Active and non-deleted candidates only, no special admin ranking exception; historical data retained |
| API #16 | Normalized username then immutable ID fallback, ordinal ranks and near/exact tie tests |
| API #17 | Authorized language-aware recomputes, direct result data, default/invalid/empty/winner tests for NO/EN |
| API #18 | Revised approved rule: per-language seven-day bonus, retained global profile streak, reader eligibility, additive migration/activation, atomic milestones and permanent history |
| API #19 | Deterministic PostgreSQL and HTTP coverage; isolated fixtures and CI database job enabled |
| App #203 | Total score includes earned bonus breakdown; featured wins stay separate; translated guide/daily progress/history, UTC rules, responsive and keyboard checks |
| App #204 | Explicit request language, immediate refresh, fresh page 1 and delayed previous-language response isolation |
| App #205 | Active interval/language filtering and timers for mounted badge/avatar expiry; history preserved |

## Validation

All final checks passed:

- Backend full npm test with TEST_DATABASE_URL: **106 passed, 0 failed, 0 skipped**. Includes four demo-fixture safety cases, 21 featured calculation cases, ten leaderboard behavior cases plus its parent test, nine existing post/streak HTTP regression cases, twelve new bonus HTTP cases, and existing registration/Turnstile, moderation, rate-limit, readiness and environment suites. Node also reports the shared helper as a test file.
- Backend ESLint and syntax checks on changed JavaScript; Prisma validation/client generation; all 25 migrations applied to an isolated database; migration-to-schema comparison reported **No difference detected**. New bonus progress was empty after migration, confirming no backfill.
- Backend deployment policy/archive Python tests: **16 passed**.
- Frontend npm test: **5 files passed**, including **9 named deterministic badge tests**; ESLint and TypeScript/Vite production build passed.
- Whitespace/diff checks passed in both repositories.
- Live local development checks now pass for all week/month/all leaderboard requests in NO/EN, demo login, language-specific active badges and history page 2. Four marked demo users, eight demo posts and 174 awards were added; private before/after hashes confirmed the original two users and three jokes were unchanged. Demo refresh/cleanup is transactional, collision-protected, and removes only demo sessions/reset tokens. Commands and reset boundaries are in the testing guide.
- Baseline source copies exposed the original feature and leaderboard defects, while the new daily-scoring/earned-day/cutover regression slices were verified failing before their fixes. Neither live worktree was reset or reverted.
- The Top Creator follow-up first reproduced the volume-over-appreciation defect
  with a failing public service test, then passed qualification and winner checks.
  Exact UTC boundary tests also exposed time-zone conversion of raw Date binds;
  the aggregate now binds ISO UTC boundaries as timestamps matching Prisma's
  columns. All checks passed against an isolated PostgreSQL server with the
  `Europe/Oslo` session time zone. No dev or production database writes were made
  for this follow-up.

Playwright used fixed API fixtures with no application data writes. Verified NO/EN headers, history page-two reset, rapid NO/EN changes with delayed stale replies, current/avatar expiry while mounted, future activation, preserved expired history, empty/error states, matching API score/comments, keyboard disclosure, and 360px mobile layout without horizontal overflow. Browser/server were stopped.

Screenshots: [desktop](/tmp/pundad-badges-leaderboard-desktop.png), [mobile EN](/tmp/pundad-badges-leaderboard-mobile-en.png).

The subsequent public-guide checks read the local development frontend and
verified the two-other-user rule, separate rocket/crown awards, the 31 October /
1 November example, unchanged badge weights, all three links via keyboard, both
languages, and mobile width without horizontal overflow. The isolated browser
was closed afterward; the user's development servers were left running.

Streak UI checks used isolated browser fixtures: explicit NO/EN requests,
loaded content before view recording, no view writes for missing/failed content,
scheduled UTC date and disabled states, milestone feedback, independent saved
progress recovery and retry, stale content/view response isolation, logged-out
prompt, bonus history without an active bonus badge, correct total/bonus/featured
win breakdown, and 360px layout with the global streak column still rightmost.
The fixture browser and temporary frontend server were stopped. Artifacts:
[daily mobile NO](/tmp/pundad-streak-bonus-mobile-no.png),
[leaderboard desktop NO](/tmp/pundad-streak-leaderboard-desktop-no.png).
The local headless font set lacks some emoji glyphs; the catalog/labels remain
unchanged for existing icons and the new bonus uses the same flame.

## Parallel code review

### Standards

No documented breaches or substantive remaining maintainability findings in either tree. The initially duplicated frontend interval calculation was consolidated into one helper. New transaction, schema/configuration, fixture isolation, CI and frontend changes follow the existing architecture.

Deployment compatibility finding: an old API recompute or worker version must not run after cutover, even if the additive schema remains. That code bypasses the new guards and resumes hourly scoring. Roll forward or suspend scoring jobs while recovering.

### Spec

The earlier feature review found no actionable implementation defects or unrelated scope creep. The subsequent user-approved streak bonus supersedes the initial display-only recommendation for scoring, while retaining the informational global profile streak. Language/UTC boundaries, transactions, history preservation and API contracts remain explicit.

The exact issue #9 requirement “Recalculate each current-period winner on every scheduled run” is met. Weekly/monthly history still reflects the final scheduled snapshot, not a new calculation after period closure. This limitation remains explicit for dev review.

Review totals: Standards **0** remaining findings; Spec **0** actionable defects, with the historical-snapshot limitation retained.

The Top Creator follow-up was also reviewed separately against the preserved
pre-follow-up snapshot. Standards **0** documented breaches or substantive smell
findings; Spec **0** actionable findings. At that stage the streak bonus was a
proposal; it has since been explicitly approved and implemented.

The streak implementation had a fresh independent parallel review. Standards
reported **0** documented breaches or substantive smell findings. Spec found one
missing server-side daily-content check; a failing HTTP regression established
it, then the transaction was corrected to require matching published content
for that language/UTC day. Missing/stale/draft/wrong-language and seventh-day-gap
cases now pass. Both review axes confirmed **0 remaining findings** after the
fix, and the full backend suite and lint were rerun successfully.

## Migration, deployment and scheduler

1. Review migration [20261025151000_fastest_growing_daily_windows](../prisma/migrations/20261025151000_fastest_growing_daily_windows/migration.sql). It adds nullable BadgeAward.scoringWindowStart and its unique badge/language/day key, plus FeaturedAwardWindow checkpoints (including empty days). It does not rewrite legacy awards. Apply migrations and regenerate Prisma before starting updated processes.
2. Set the same non-secret FASTEST_GROWING_DAILY_START_UTC=YYYY-MM-DD for API and workers. Choose a **future UTC day after all legacy hourly awards**, deploy before it, and stop old processes before midnight. No actual environment files were changed here. Before any checkpoint, absence retains legacy mode; after activation, removal/emptying or changing the date fails closed for that language.
3. API and worker must share this policy setting. The frontend needs no new environment variable or dependency. Deploy backend behavior before frontend explanation changes.
4. Existing schedules remain: JOTD 00:05 UTC, weekly features hourly, monthly creator daily 00:10 UTC (also on boot). Every current-period computation now reevaluates its leader. The approved Top Creator threshold needs no additional migration, environment setting, or response field. Deploy the matching API and worker, then use admin recompute for an immediate current-month refresh; otherwise it changes on the next scheduled run. Completed months are not rewritten. Hourly discovery remains hourly.
5. Daily Fastest Growing finalization runs on worker boot and hourly for NO/EN, up to 31 missing days per language per run. Run-once now covers both languages/all features. Inspect hasMore for backlog; rerun or allow subsequent hourly runs. Admin daily recompute also uses this bounded finalizer.
6. New daily awards count on their earned UTC day for week/month ranking, even during late catch-up. Legacy awards retain awardedAt attribution and their original points.
7. After activation, do not roll back to the old scoring API/worker. Keep the additive migration; roll forward or suspend scoring/recompute jobs. Frontend rollback does not restore old backend scoring.
8. Apply [20261025180000_language_streak_bonuses](../prisma/migrations/20261025180000_language_streak_bonuses/migration.sql) and regenerate Prisma before deploying the streak API. It adds language progress and a separate bonus badge key without backfilling users or awards. Configure `STREAK_BONUS_START_UTC=YYYY-MM-DD` on all API instances for an announced future UTC date. No new cron/worker job is required. Missing/empty initially disables bonuses; removing/changing the date after progress starts fails closed. Earned points/history remain.
9. The guarded local dev migration is applied, with **2026-10-26 00:00 UTC** configured only in the ignored development environment. The existing file's other entries were preserved. A temporary marked-demo login verified scheduled progress (zero days, seven until the first point) for both NO/EN, then logged out without recording views. Production/staging settings and records are unchanged.

Detailed policy, cutover steps and limits: [Fastest Growing recommendation](fastest-growing-recommendation.md). Canonical environment/deployment reference: [master guide](development-deployment-guide.md). Test setup/commands: [testing guide](badge-leaderboard-testing.md).

## Limits to review

- Weekly/monthly historical winners are preserved snapshots at the last scheduled execution. Activity in the final hour/day and missed periods during downtime are not finalized retrospectively. A separate closed-period finalization policy would be needed for exact final totals.
- Daily scoring uses like rows and published jokes available at finalization. Deleted likes/jokes and unpublishing during downtime cannot be reconstructed from the existing mutable tables. Finalized daily awards remain fixed.
- Typical production award frequency was not measured; the #13 comparison uses known weights, deterministic sparse examples and mathematical maximums. No production data was queried.
- Rankings can reorder on deployment because inactive/deleted accounts disappear and the approved global streak comparator is removed. Legacy award history/scores remain unchanged.
- Browser checks used controlled API fixtures; perform the following checklist against the actual dev application before release.

## Dev verification checklist (repeat for NO and EN)

- [ ] Apply the reviewed migration to dev and regenerate Prisma; configure a future test cutover consistently for API/worker.
- [ ] Register and verify an account with the established development Turnstile/email flow; login/session refresh/logout still work.
- [ ] Create published jokes and drafts, edit title/body/tags, verify owner/admin permissions and other-language isolation.
- [ ] Confirm moderation rejects blocked create/edit text, allows ordinary word-boundary cases and preserves saved content after rejection.
- [ ] Recompute all features as admin; verify flat result data, explicit language, 401/403 and invalid language behavior.
- [ ] Add likes/comments/posts to change weekly/monthly leaders; recompute and verify only the current leader has the provisional active award and completed history remains.
- [ ] For Top Creator, verify zero/one/self likes and comments do not qualify a
  joke; two distinct other-user likes this month do. Check qualifying-joke count,
  like-count and user-ID ties, unlike/unpublish removal, old drafts, UTC month
  boundaries, and empty winners in both NO/EN.
- [ ] Check JOTD before/at UTC midnight, including a legacy null-expiry row; active badge disappears and historical award remains.
- [ ] Check week/month/all results, limit/default validation, displayed total and
  bonus breakdown, featured-win tie order, and informational global streak.
- [ ] Ensure inactive/deleted users are absent and administrator accounts follow
  ordinary ranking rules. A legacy global streak alone does not qualify, while
  an earned language bonus does.
- [ ] In each language, check scheduled/active status and bonus progress on the
  daily page. After seven consecutive UTC days, verify one permanent bonus point
  without adding a featured win or active badge. Reload/retry cannot duplicate it.
- [ ] Miss one full UTC day and verify progress resets while points/history
  remain. NO visits must not advance EN progress. Check month/week attribution
  on the milestone day, independently of the global profile streak.
- [ ] Switch badge language on history page 2 and switch rapidly during slow responses; confirm fresh page 1 and correct active/history language.
- [ ] With the test cutover active, confirm hourly discovery adds no awards; finalize a completed day and verify one 3-point winner per language, following-day active badge and earned-day leaderboard attribution.
- [ ] Repeat daily finalization concurrently and after a simulated outage; check empty-day checkpoints, no duplicates, historical scores and bounded backlog.
- [ ] Verify keyboard guide links from login/About/leaderboard, translated badge
  points and Fastest Growing month-boundary example, score/comments and long
  usernames at mobile/tablet/desktop sizes.

## Every changed repository file

Backend (38 files):

- [.env.development.example](/home/pi/projects/backend/pundad-api-dev/.env.development.example)
- [.github/workflows/ci.yml](/home/pi/projects/backend/pundad-api-dev/.github/workflows/ci.yml)
- [.gitignore](/home/pi/projects/backend/pundad-api-dev/.gitignore)
- [docs/badge-leaderboard-handoff.md](/home/pi/projects/backend/pundad-api-dev/docs/badge-leaderboard-handoff.md)
- [docs/badge-leaderboard-plan.md](/home/pi/projects/backend/pundad-api-dev/docs/badge-leaderboard-plan.md)
- [docs/badge-leaderboard-testing.md](/home/pi/projects/backend/pundad-api-dev/docs/badge-leaderboard-testing.md)
- [docs/development-deployment-guide.md](/home/pi/projects/backend/pundad-api-dev/docs/development-deployment-guide.md)
- [docs/fastest-growing-recommendation.md](/home/pi/projects/backend/pundad-api-dev/docs/fastest-growing-recommendation.md)
- [docs/leaderboard-streak-design.md](/home/pi/projects/backend/pundad-api-dev/docs/leaderboard-streak-design.md)
- [package.json](/home/pi/projects/backend/pundad-api-dev/package.json)
- [prisma/migrations/20261025151000_fastest_growing_daily_windows/migration.sql](/home/pi/projects/backend/pundad-api-dev/prisma/migrations/20261025151000_fastest_growing_daily_windows/migration.sql)
- [prisma/migrations/20261025180000_language_streak_bonuses/migration.sql](/home/pi/projects/backend/pundad-api-dev/prisma/migrations/20261025180000_language_streak_bonuses/migration.sql)
- [prisma/schema.prisma](/home/pi/projects/backend/pundad-api-dev/prisma/schema.prisma)
- [src/config/badgeLeaderboardDemo.js](/home/pi/projects/backend/pundad-api-dev/src/config/badgeLeaderboardDemo.js)
- [src/config/fastestGrowingPolicy.js](/home/pi/projects/backend/pundad-api-dev/src/config/fastestGrowingPolicy.js)
- [src/config/seedBadgeLeaderboardDemo.js](/home/pi/projects/backend/pundad-api-dev/src/config/seedBadgeLeaderboardDemo.js)
- [src/config/streakBonusPolicy.js](/home/pi/projects/backend/pundad-api-dev/src/config/streakBonusPolicy.js)
- [src/controllers/badgeController.js](/home/pi/projects/backend/pundad-api-dev/src/controllers/badgeController.js)
- [src/controllers/jokeController.js](/home/pi/projects/backend/pundad-api-dev/src/controllers/jokeController.js)
- [src/jobs/runOnce.js](/home/pi/projects/backend/pundad-api-dev/src/jobs/runOnce.js)
- [src/jobs/scheduler.js](/home/pi/projects/backend/pundad-api-dev/src/jobs/scheduler.js)
- [src/routes/featuredRouter.js](/home/pi/projects/backend/pundad-api-dev/src/routes/featuredRouter.js)
- [src/routes/jokeRouter.js](/home/pi/projects/backend/pundad-api-dev/src/routes/jokeRouter.js)
- [src/routes/leaderboardRouter.js](/home/pi/projects/backend/pundad-api-dev/src/routes/leaderboardRouter.js)
- [src/services/badgeService.js](/home/pi/projects/backend/pundad-api-dev/src/services/badgeService.js)
- [src/services/dailyStreakService.js](/home/pi/projects/backend/pundad-api-dev/src/services/dailyStreakService.js)
- [src/services/featuredService.js](/home/pi/projects/backend/pundad-api-dev/src/services/featuredService.js)
- [src/services/jokeService.js](/home/pi/projects/backend/pundad-api-dev/src/services/jokeService.js)
- [src/services/leaderboardService.js](/home/pi/projects/backend/pundad-api-dev/src/services/leaderboardService.js)
- [src/services/userService.js](/home/pi/projects/backend/pundad-api-dev/src/services/userService.js)
- [src/utils/activeBadges.js](/home/pi/projects/backend/pundad-api-dev/src/utils/activeBadges.js)
- [src/validation/leaderboardQueryValidator.js](/home/pi/projects/backend/pundad-api-dev/src/validation/leaderboardQueryValidator.js)
- [test/badge-demo.integration.test.js](/home/pi/projects/backend/pundad-api-dev/test/badge-demo.integration.test.js)
- [test/featured.integration.test.js](/home/pi/projects/backend/pundad-api-dev/test/featured.integration.test.js)
- [test/helpers/integrationDatabase.js](/home/pi/projects/backend/pundad-api-dev/test/helpers/integrationDatabase.js)
- [test/leaderboard.integration.test.js](/home/pi/projects/backend/pundad-api-dev/test/leaderboard.integration.test.js)
- [test/post-regression.integration.test.js](/home/pi/projects/backend/pundad-api-dev/test/post-regression.integration.test.js)
- [test/streak.integration.test.js](/home/pi/projects/backend/pundad-api-dev/test/streak.integration.test.js)

Frontend (18 files):

- [.gitignore](/home/pi/projects/frontend/pundad-app-dev/.gitignore)
- [eslint-suppressions.json](/home/pi/projects/frontend/pundad-app-dev/eslint-suppressions.json)
- [src/App.tsx](/home/pi/projects/frontend/pundad-app-dev/src/App.tsx)
- [src/components/atoms/AvatarWithBadges.tsx](/home/pi/projects/frontend/pundad-app-dev/src/components/atoms/AvatarWithBadges.tsx)
- [src/hooks/useBadgeClock.ts](/home/pi/projects/frontend/pundad-app-dev/src/hooks/useBadgeClock.ts)
- [src/i18n/translations.ts](/home/pi/projects/frontend/pundad-app-dev/src/i18n/translations.ts)
- [src/lib/axios.ts](/home/pi/projects/frontend/pundad-app-dev/src/lib/axios.ts)
- [src/lib/badges.ts](/home/pi/projects/frontend/pundad-app-dev/src/lib/badges.ts)
- [src/routes/pages/About.tsx](/home/pi/projects/frontend/pundad-app-dev/src/routes/pages/About.tsx)
- [src/routes/pages/Login.tsx](/home/pi/projects/frontend/pundad-app-dev/src/routes/pages/Login.tsx)
- [src/routes/pages/PointsAndRanking.tsx](/home/pi/projects/frontend/pundad-app-dev/src/routes/pages/PointsAndRanking.tsx)
- [src/routes/pages/dashboard/Badges.tsx](/home/pi/projects/frontend/pundad-app-dev/src/routes/pages/dashboard/Badges.tsx)
- [src/routes/pages/jokes/DailyJoke.tsx](/home/pi/projects/frontend/pundad-app-dev/src/routes/pages/jokes/DailyJoke.tsx)
- [src/routes/pages/jokes/Leaderboard.tsx](/home/pi/projects/frontend/pundad-app-dev/src/routes/pages/jokes/Leaderboard.tsx)
- [src/types/context.types.ts](/home/pi/projects/frontend/pundad-app-dev/src/types/context.types.ts)
- [src/types/leaderboard.types.ts](/home/pi/projects/frontend/pundad-app-dev/src/types/leaderboard.types.ts)
- [src/types/streak.types.ts](/home/pi/projects/frontend/pundad-app-dev/src/types/streak.types.ts)
- [test/badges.test.mjs](/home/pi/projects/frontend/pundad-app-dev/test/badges.test.mjs)

The ignored backend `.env.development` additionally gained only the non-secret
`STREAK_BONUS_START_UTC=2026-10-26` setting; other entries were preserved.

The original implementation baselines were backend 95522352eeb2ca04d2c1724e75fb54404e28c20f and frontend a8b4657188642fe0610a17471005b99a4e3deefb. Both feature branches were subsequently based on origin/main commits backend 75589fb and frontend 9e56f36; the committed source trees were identical and the uncommitted patches/files were verified preserved exactly. Backup branch `backup/badge-leaderboard-before-main-20261025` retains each original tip. Both worktrees use `feat/badge-leaderboard-correctness`, with commits and pushes now authorized for review. No PR creation, merge, issue closure, or production/staging deployment is included.
