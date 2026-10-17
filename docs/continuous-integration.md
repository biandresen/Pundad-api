# Continuous integration: what runs before merging

CI means automatically checking a committed version of the project on a clean
machine. It complements local checks: it proves a change does not depend on
your Pi's private files, installed packages, or production credentials.

## The workflow for this project

```text
Edit in the -dev worktree
  -> run local checks
  -> commit and publish the feature branch
  -> open a pull request targeting main
  -> GitHub Actions installs dependencies and runs checks
  -> review the changes and merge after checks pass
```

Files in `.github/workflows/ci.yml` configure the checks. They run on pull
requests to `main`, pushes to `main`, and manual runs once the workflow is
available on the default branch. Jobs run on GitHub-hosted Ubuntu machines,
not on the production Pi. Their token has read-only repository permissions;
these workflows do not deploy or receive production credentials.

`.nvmrc` pins Node.js to 24.12.0, the version used for the existing tests on the
Pi. `npm ci` installs dependency versions from `package-lock.json`. Action
versions are pinned to immutable commit SHAs, with the release label recorded
beside each SHA. Concurrency cancels obsolete check runs for the same PR.

## API checks

The **API checks** job runs ESLint, validates the Prisma schema, generates
Prisma Client, and runs the existing Node test suite. Tests replace external
database and email services; their configured database URL is a dummy CI URL.
The development environment loader has tests proving it rejects production
targets and overrides an inherited production URL.

The **Database migrations** job creates a disposable PostgreSQL 17 service on
the GitHub runner. It applies every migration from an empty database, checks
migration status, compares the resulting schema with `prisma/schema.prisma`,
and runs the moderation seed. That database disappears with the job. It never
connects to the Pi's PostgreSQL server.

This catches different problems from mocked HTTP tests: missing migrations,
SQL that cannot initialize a new database, and a schema file that has drifted
away from its committed migrations.

Run the ordinary API checks locally in the backend development worktree:

```bash
npm run lint
npm test
```

Do not point the fresh-database migration check at production. It is intended
for the disposable CI database. Development setup continues to use the guarded
`npm run db:dev:deploy` and `npm run db:dev:seed` commands.

## Frontend checks

The **Frontend checks** job runs ESLint, Node tests for API error handling, and
the TypeScript/Vite production build. The tests cover rate-limit messages,
Retry-After countdowns, verification-related status codes, and network errors.
They are unit tests; browser interaction tests are a later addition.

The build uses relative API and upload origins. Nginx will route those paths
to the matching API in staging or production. The resulting `dist/` is uploaded
as a workflow artifact named for the checked commit and retained for seven
days. An artifact is a saved build result, not an automatic deployment.

Run these locally in the frontend development worktree:

```bash
npm run lint
npm test
npm run build
```

### Existing lint debt

The initial frontend check found 111 existing explicit `any` types. These are
recorded in `eslint-suppressions.json` using ESLint's bulk suppression feature.
The rule stays enabled: suppressions record counts per file/rule, rather than
disabling the rule for the whole project. New violations in a new file, or an
increase beyond a file's recorded count, fail lint. This is a migration aid,
not a guarantee that every newly edited line is independently checked.

When removing existing `any` types, prune stale entries and commit the updated
suppression file:

```bash
npm run lint:prune
```

Do not regenerate or increase the baseline merely to get a new PR to pass.
Three existing effect-dependency warnings remain informational; lint errors
block CI. Conditional hooks in the Drafts page were corrected by always
initializing the hooks and using pagination's existing `enabled` setting to
prevent unauthenticated requests. Context hook exports have narrow documented
Fast Refresh exceptions matching the project's provider/hook module layout.

## Protect main after the first successful CI run

The connected GitHub app cannot manage branch protection. Configure this in
each repository's GitHub settings after the new check names have appeared.

1. Open **Settings -> Branches -> Add branch protection rule**.
2. Set the branch pattern to `main`.
3. Enable **Require a pull request before merging**.
4. For a solo-maintained project, leave required approving reviews disabled;
   otherwise you cannot approve your own PR. Checks and PR review still apply.
5. Enable **Require status checks to pass before merging**.
6. For Pundad-api, select **API checks** and **Database migrations**.
7. For Pundad-app, select **Frontend checks**.
8. Enable **Require branches to be up to date before merging**.
9. Enable the option preventing bypass of these requirements by administrators
   if you want the same rules to apply to your own account.
10. Keep force pushes and branch deletions disallowed, then save the rule.

CI runs do not by themselves prevent a merge; protection makes successful
checks a requirement. GitHub Actions reports and PRs show the exact run and
commit being checked. Inspect failed logs, fix the branch, and publish another
commit; the PR updates and checks rerun.

## Next milestone: public staging

The agreed staging address is **staging.pundad.app**, publicly accessible.
It will use a separate staging API, PostgreSQL database, credentials, uploads,
and controlled email delivery. Production data and credentials must not be
available to PR preview code.

Deployment transport still needs configuration. The Pi's current SSH setup
cannot authenticate to GitHub for pushes, and the connected GitHub app returned
403 for repository writes and branch-protection access. The local CI changes
are ready, but publishing and live CI runs require Git authentication on the Pi.

Install GitHub CLI using your operating system's package manager, then run this
in your own Pi terminal (the browser authorization can happen on the laptop):

```bash
gh auth login --hostname github.com --git-protocol https --web --scopes workflow
gh auth setup-git
gh auth status
```

The workflow scope allows publishing `.github/workflows` files. Keep credentials
in the CLI's credential storage; do not paste tokens into repository files or
chat. For HTTPS publishing, use these canonical remotes in the appropriate
repositories (Git worktrees share their repository's remote configuration):

```bash
# Backend development worktree
git remote set-url origin https://github.com/biandresen/Pundad-api.git

# Frontend development worktree
git remote set-url origin https://github.com/biandresen/Pundad-app.git
```

After reviewing the local commits, publish each development branch and open a
PR targeting main. The frontend branch also descends from an earlier local
commit containing PWA support and the verification-page text-color fix; inspect
that commit when reviewing the full comparison with GitHub's main branch.

Git push authentication is separate from an authenticated network route from
GitHub Actions back to the Pi. Choose a restricted deployment connection or
outbound artifact retrieval before enabling staging deployment.

For backend previews on the same physical Pi, use a separate Unix identity and
restricted resource access; a separate database alone does not isolate arbitrary
PR code from production files. Only trusted PRs should reach that deployment
path. Public/fork PRs can run ordinary CI without receiving deployment secrets.

These workflows stop after checks/build artifacts. Staging deployment and
automatic production release/rollback are not implemented by this CI milestone.
