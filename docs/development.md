# Development and deployment rollout

The rollout is incremental: isolate development, add CI, deploy staging, then
automate production releases and rollback. The original backend checkout still
runs production until the production release step explicitly moves it.

For a reusable explanation of the concepts and setup, see [the isolated development guide](isolated-development-guide.md).

## Step 1: isolated development

Development uses Git worktrees on the `chore/development-workflow` branch:

- API: `/home/pi/projects/backend/pundad-api-dev`
- Frontend: `/home/pi/projects/frontend/pundad-app-dev`

A worktree shares Git history with the original repository but has its own
branch and files. Edits here do not change the original production checkout.
Use these directories for development terminals and editor windows. Do not
remove them with `rm`; use `git worktree remove` when they are no longer needed.

The existing `jokedb` database, production `.env`, PM2 processes, Nginx config,
and `/var/www` deployment are unchanged by this step.

### Database and configuration

PostgreSQL has a separate `pundad_dev` database owned by a `pundad_dev` login.
That login has no superuser, role-management, or database-creation privileges,
and is not a member of the production role. No production user data is copied.

The API worktree has a private, ignored `.env.development`. A committed
`.env.development.example` describes its settings without real secrets.
Development commands explicitly load this file before any application code.
They reject the production database name, wrong role, production upload path,
real email delivery, and production API port. They override inherited variables
so a production `DATABASE_URL` in a shell cannot silently change their target.

Apply existing migrations and seed only moderation terms:

```bash
cd /home/pi/projects/backend/pundad-api-dev
npm run db:dev:deploy
npm run db:dev:seed
```

These commands never reset a database. Authoring new migrations with
`prisma migrate dev` needs a separately configured shadow database; configure
that before starting schema-change work. Do not grant the development login
production privileges to work around a migration error.

### Run the API and frontend

In one Pi terminal:

```bash
cd /home/pi/projects/backend/pundad-api-dev
npm run dev
```

In another:

```bash
cd /home/pi/projects/frontend/pundad-app-dev
npm run dev
```

Both servers bind to `127.0.0.1`. Forward port **5173** with VS Code Remote SSH
and visit `http://localhost:5173` on the laptop. Keep that same hostname when
opening verification links so session cookies stay on the same origin.

The browser requests relative `/api/v1` and `/uploads` paths. Vite proxies them
on the Pi to `127.0.0.1:4001`. Only the frontend port needs forwarding. Nginx will
provide equivalent routing for staging and production.

Register a test account using an address such as `tester@example.test`.
Verification and reset emails are printed as JSON in the API terminal. Open
the URL in the `text` field in the laptop browser. No email provider credentials
are required and no real email is sent. The database and avatar files belong
only to this development environment.

The worker is separate and optional during ordinary frontend work:

```bash
cd /home/pi/projects/backend/pundad-api-dev
npm run dev:worker
```

It updates development data on startup and on its schedule. Run only one worker
per environment. Stop development processes with Ctrl+C in their terminals;
leave the production PM2 processes running.

### Checks

```bash
# API worktree
npm test

# Frontend worktree
npm run build
```

Use browser Network tools to confirm API requests go to
`http://localhost:5173/api/v1/...`. CI workflow files now define linting gates. Browser smoke tests are a later
addition. Backend tests substitute external
services and must not require production secrets.

## Remaining steps

1. Review and merge the CI pull requests after all required checks pass.
2. Configure staging DNS/TLS, isolated API/database/uploads, and email capture.
3. Deploy trusted PRs to a shared staging slot with a deployment lock.
4. Move production processes to versioned release directories, then enable
   deployment after merge, readiness checks, backups, and application rollback.

Production deployment transport (restricted SSH over an authenticated network
or outbound artifact retrieval) must be chosen before deployment automation.

## Continuous integration

CI workflows for lint, tests, migration checks, and build artifacts are published
in pull requests, and their first GitHub runs passed. See
[the CI guide](continuous-integration.md) for the workflows, local commands,
branch protection settings, and the public staging plan.

## Staging runtime

The next environment is the public staging site. See [the staging guide](staging.md)
for accounts, services, private email capture, manual deployments, and inspection.
