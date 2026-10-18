# Development, staging, and production: the master guide

This is the single maintained guide to the development and deployment system.
**Part 1 explains the reusable approach. Part 2 applies it to PunDad**, including
the installed paths, commands, email behavior, automated releases, and recovery.
The setup described here was implemented on 17 October 2026 and verified again
on 18 October 2026. Historical details are labelled separately from current use.

The canonical file is `docs/development-deployment-guide.md` in
`biandresen/Pundad-api`. Frontend documentation and the previous guide filenames
point here; they do not carry independently maintained copies. Change this file
when the workflow changes. Product architecture and API documentation remain
separate documents.

## Contents

- [Part 1: The reusable approach](#part-1-the-reusable-approach)
  - [Environments and components](#1-environments-and-components)
  - [Repositories, branches, and worktrees](#2-repositories-branches-and-worktrees)
  - [Configuration and startup loaders](#3-configuration-and-startup-loaders)
  - [Databases, migrations, and seed data](#4-databases-migrations-and-seed-data)
  - [Browser requests, proxies, and email](#5-browser-requests-proxies-and-email)
  - [CI, artifacts, and deployment](#6-ci-artifacts-and-deployment)
  - [Releases, supervision, and recovery](#7-releases-supervision-and-recovery)
  - [Applying the pattern elsewhere](#8-applying-the-pattern-elsewhere)
- [Part 2: The PunDad implementation](#part-2-the-pundad-implementation)
  - [Current environment map](#9-current-environment-map)
  - [Everyday development and PRs](#10-everyday-development-and-prs)
  - [Email and account verification](#11-email-and-account-verification)
  - [Configuration and database inspection](#12-configuration-and-database-inspection)
  - [Checks and main-branch protection](#13-checks-and-main-branch-protection)
  - [Automatic deployment policy](#14-automatic-deployment-policy)
  - [Host resources and source files](#15-host-resources-and-source-files)
  - [Reproducing the installation](#16-reproducing-the-installation)
  - [Manual staging deployment](#17-manual-staging-deployment)
  - [Inspection and troubleshooting](#18-inspection-and-troubleshooting)
  - [Backups and restore rehearsal](#19-backups-and-restore-rehearsal)
  - [Pausing deployment and rolling back](#20-pausing-deployment-and-rolling-back)
  - [Maintenance and retention](#21-maintenance-and-retention)
  - [Implementation history and verified limits](#22-implementation-history-and-verified-limits)

## Part 1: The reusable approach

### 1. Environments and components

An environment is a running system selected by its configuration, credentials,
processes, database, and files. Naming a Git branch `staging` does not create a
staging environment.

| Environment | Purpose | Data | Email delivery |
| --- | --- | --- | --- |
| Development | Fast local editing and feedback | Separate disposable development records | Terminal output |
| Staging | Test a release through production-like routing/runtime behavior | Separate staging records | Private capture for inspection |
| Production | Serve real users | Real persistent records | Real email provider |

The same application can run in all three environments. Keep their database
logins, JWT secrets, uploads, ports, and frontend origins separate. Staging should
not need production credentials or a copy of production users to test registration.

| Component | Responsibility |
| --- | --- |
| Frontend | Browser interface and requests to the API |
| API | Request validation, authentication, application behavior, database access |
| Worker | Scheduled/background work outside an individual HTTP request |
| Database | Persistent structured records |
| Upload directory | Persistent user files, outside replaceable application code |
| Reverse proxy | Static frontend delivery and routing of API/upload paths |
| Process supervisor | Starts/restarts applications and manages their lifecycle |
| CI runner | Checks a committed revision in a clean environment |
| Deployment controller | Selects eligible checked revisions and activates releases |

These components can share one physical server while using separate identities
and resources. They still share its kernel, disk, network, database server, and
outages. Worktrees and environment-variable names alone are not sandboxes.

### 2. Repositories, branches, and worktrees

A **repository** stores commit history. A **branch** is a movable reference to a
commit. A **worktree** is an editable directory with its own checked-out files,
HEAD, and Git staging area, sharing history and remotes with the repository.

Creating a worktree does not copy private ignored files, `node_modules`, running
processes, or a database. It checks out tracked files from a commit. Edits in
that directory do not immediately edit another worktree's files. Git normally
prevents the same branch from being checked out in two worktrees simultaneously.
Separate frontend/backend repositories can use the same branch name.

For a new project, from each original checkout:

```bash
# In the original backend checkout:
git worktree add -b chore/development ../myapp-api-dev HEAD

# In the original frontend checkout, run separately:
git worktree add -b chore/development ../myapp-web-dev HEAD
```

Install dependencies separately in each new directory with `npm ci`. This uses
the committed lockfile. Configure its private development settings separately.
Do not copy a production `.env` into a development worktree.

```bash
git worktree list
git status
git branch --show-current
git diff
```

Push commits and branches to GitHub; a worktree itself is not pushed. Use feature
branches for changes and a protected main branch for reviewed integration.
Remove a finished worktree with `git worktree remove <path>` after saving its
work and private files, rather than deleting its directory manually.

### 3. Configuration and startup loaders

Environment variables are settings in a running process. An env file is text;
some code or tool must load it into the process.

| File | Meaning |
| --- | --- |
| `.env` | Conventional default file read by dotenv |
| `.env.development` | Development-specific settings, if explicitly selected |
| `.env.production` | A tool's production-mode settings; not automatically a backend secret store |
| `.env.development.example` | Tracked placeholders documenting required settings |
| Service `api.env` | A private server file loaded by the service manager |

The leading dot hides a file in ordinary Unix listings; `ls -a` includes it.
The dot before `development` is a naming separator. Neither dot establishes
loading order or priority.

`dotenv.config()` normally reads `.env`; setting `NODE_ENV=development` does not
make dotenv automatically read `.env.development`. Vite has its own mode-based
rules: common env files plus the selected mode's files, with existing process
variables taking priority. Vite embeds `VITE_*` values into browser code, so
those values are public settings and must not hold secrets.

Keep real configuration out of Git and protect private files:

```gitignore
.env
.env.*
!.env.example
!.env.development.example
```

```bash
chmod 600 .env.development
```

Git ignore rules do not untrack files or remove secrets already committed to
history. Restart a process after changing its env file; an existing process
does not reread the file merely because it changed.

A **startup loader** here is an ordinary JavaScript module that reads/validates
configuration before the application imports database or email clients. It is
not a custom Node module-resolution loader. A simplified generic example:

```js
import { readFileSync } from "node:fs";
import { parse } from "dotenv";

const config = parse(readFileSync(".env.development"));
const database = new URL(config.DATABASE_URL);

if (config.APP_ENV !== "development" || config.NODE_ENV !== "development" ||
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !["localhost", "127.0.0.1"].includes(database.hostname) ||
    database.username !== "myapp_dev" || database.pathname !== "/myapp_dev") {
  throw new Error("Use the isolated development configuration.");
}

Object.assign(process.env, config);
```

This excerpt illustrates ordering and database validation; a real loader also
checks ports, upload paths, delivery mode, and required secrets. Start it before
the entry point:

```bash
node --import ./src/config/developmentEnvironment.js --watch src/server.js
```

Node first inherits shell variables. `Object.assign(process.env, config)` then
replaces matching keys with the validated development values. Thus an inherited
production `DATABASE_URL` cannot override that loader's development URL. It
does not edit the parent shell, clear unrelated keys, or change other processes.
Use the same loader for development API, worker, migration, and seed commands.

On a server, systemd can instead load a private `EnvironmentFile=` and a
preloaded validator can check those already supplied settings. `APP_ENV` labels
the deployment; `NODE_ENV=production` enables production behavior. Staging can
therefore use `APP_ENV=staging` together with `NODE_ENV=production`.

### 4. Databases, migrations, and seed data

One PostgreSQL server can host several independent databases. A **database** is
where records live. A **role/login** is who connects and what privileges it has.
The database and its login may have the same name; that does not mean there are
two databases. Unix accounts and PostgreSQL roles are also distinct objects.

For a fresh generic project, connect as a local PostgreSQL administrator:

```bash
sudo -u postgres psql -d postgres
```

Then create a restricted development login and database:

```sql
CREATE ROLE myapp_dev LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
\password myapp_dev
CREATE DATABASE myapp_dev OWNER myapp_dev;
REVOKE ALL ON DATABASE myapp_dev FROM PUBLIC;
```

`\password` prompts rather than putting a literal password in shell history.
Use a separately generated password. Repeat the pattern with independent
staging identities, not production credentials. A login should have no
production-role membership or production table grants. Database CONNECT
permissions and table permissions are separate; verify actual grants.

For a project with a capitalized `User` table, an administrator connected to the
production database could check one permission with:

```sql
SELECT has_table_privilege('myapp_dev', 'public."User"', 'SELECT');
```

That checks one table/operation, not every privilege. Adapt names to the schema.

**Migrations** are versioned schema changes. Applying committed migrations
reconstructs the schema without copying production data. **Seeds** insert or
update chosen initial records. Inspect seed behavior: a script that resets
moderation settings can be useful for test data and inappropriate for production.

Applying existing Prisma migrations with `migrate deploy` differs from authoring
new ones with `migrate dev`. The latter needs a development shadow database.
Never choose production as a shadow database or give a development role
production privileges to bypass a migration error. Application rollback does
not reverse a migration; design compatible schema changes deliberately.

### 5. Browser requests, proxies, and email

An origin includes scheme, hostname, and port. Relative API/upload URLs let the
browser use the frontend's own origin:

```ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "";
```

In development, Vite can forward `/api` and `/uploads` to the local API. This
server-to-server forwarding lets the browser see one origin. Keep an appropriate
API CORS allowlist; a proxy is not authentication.

```ts
// Inside the existing Vite configuration:
server: {
  host: "127.0.0.1",
  port: 5173,
  strictPort: true,
  proxy: {
    "/api": "http://127.0.0.1:4001",
    "/uploads": "http://127.0.0.1:4001",
  },
},
```

When Vite and the API run on a remote server, forward only the Vite port over
SSH to preview from a laptop. Keep the browser hostname consistent with links
and cookies. In staging/production, Nginx performs equivalent path routing;
Vite's development server does not serve the deployed site.

Email **content/token generation** and **delivery** are separate concerns. Keep
the real registration, verification-token, and reset-token behavior, while
changing the final delivery adapter by environment:

```js
// Conceptual dispatch; the actual adapter must enforce environment guards.
if (delivery === "console") return printDevelopmentMessage(message);
if (delivery === "capture") return savePrivateStagingMessage(message);
return sendThroughRealProvider(message);
```

Development prints a usable link; staging stores it privately; production sends
it. Neither development nor staging needs a real email-provider key. Build links
from an explicit frontend origin such as `FRONTEND_BASE_URL`, not a hardcoded
production domain. Captured messages contain live verification/reset tokens,
so they belong outside public upload/static directories.

### 6. CI, artifacts, and deployment

**Continuous integration (CI)** checks a committed revision on a clean runner:
dependency installation, lint, tests, schema/migration checks, and frontend
builds. **Deployment** installs and activates a selected checked version.
Passing CI is not, by itself, deployment or main-branch protection.

```mermaid
flowchart LR
  Edit[Feature branch] --> PR[Pull request]
  PR --> Checks[Successful PR checks]
  Checks --> Stage[Staging release]
  Stage --> Review[Inspect and test]
  Review --> Merge[Merge into main]
  Merge --> MainCI[Successful main checks]
  MainCI --> Production[Production release]
```


An **artifact** is saved build output: frontend static files, or a source archive
to install on the target architecture. `npm ci` uses lockfile versions; pinned
Node/action versions reduce unrelated variation. Native API dependencies should
be installed for the server's CPU/OS, not copied from an incompatible CI runner.

Protect main with required PRs, named checks, up-to-date branches, resolved
conversations, and restrictions on force pushes/deletion. A solo owner cannot
approve their own PR; required approving-review counts must suit the project.
Do not disable checks merely because a deployment is waiting for them.

A pull request can be checked using a temporary **test merge commit**: the PR
changes combined with its target branch. Its artifact build SHA can differ from
the PR branch-head SHA. Record and verify the exact artifact/run/build revision.
After merge, run CI on the actual main commit before deploying production.

This deployment pattern uses an **outbound controller on the server**. It checks
successful GitHub runs, downloads selected artifacts, verifies provenance/digests,
and invokes fixed installed deployers. CI runners do not receive production
credentials or run arbitrary privileged PR scripts on the shared server.

Only explicitly trusted PRs should enter that shared-server preview path. Keep
ordinary fork/contributor CI separate from deployment privileges. Revalidate
heads and eligibility after a build so a superseded version cannot activate.
With two repositories, define how API/frontend revisions are paired; merging
two repos is not one atomic operation.

### 7. Releases, supervision, and recovery

Use immutable application directories rather than updating a live source tree:

```text
/srv/myapp/production/
  releases/<release-a>/{api,frontend}/
  releases/<release-b>/{api,frontend}/
  current  -> releases/<release-b>
  previous -> releases/<release-a>
```

A **symlink** points to another filesystem path. Replacing `current` atomically
selects a complete API/frontend pair. Keep database records, uploads, credentials,
and captured mail outside replaceable releases. Atomic file selection does not
make application restarts or cross-repository merges zero-downtime operations.

PM2 supervises Node processes. systemd can supervise foreground `pm2-runtime`,
start it on boot, assign an identity, and apply filesystem/resource restrictions
to its API/worker process group. Separate PM2 homes keep environments apart.
Build identities should be separate from runtime identities, and release files
should become root-owned before activation.

**Liveness** asks whether the HTTP process responds. **Readiness** asks whether
it can serve dependent work, such as querying its database. A SPA returning HTML
200 is not an API readiness check. Check the worker too; API readiness alone
does not prove a background process started.

Take a private backup before production migrations. If startup fails, restore
the preceding application release. Do not automatically restore an old database:
that can discard new user writes. Rehearse backup restoration in a separate
temporary database. A dump of the database and a filesystem copy of uploads
are not necessarily one transactionally consistent snapshot.

Pause automation and let active deployment finish before a manual rollback;
otherwise the controller can replace the manual choice on its next poll. Keep
retention bounded and protect current/previous releases from cleanup. Local
backups help recover mistakes but do not survive loss of the same storage device.

### 8. Applying the pattern elsewhere

Follow this order for another project:

1. Inspect existing production paths, processes, database identity, and uploads.
2. Create isolated development worktrees, configuration, database/login, and
   guarded startup/migration commands.
3. Configure relative browser URLs, a local proxy, SSH preview, and development
   email delivery. Verify registration, verification, login, and refresh.
4. Add clean CI runs, disposable migration checks, artifacts, and protected main.
5. Provision staging identities/data/uploads and production-like runtime guards.
6. Install reviewed release tooling and proxy/tunnel configuration. Prove local
   routing, then DNS/HTTPS, private email capture, and startup rollback.
7. Enable trusted artifact-based staging automation.
8. Prepare production credentials, release paths, backups/restore rehearsal,
   readiness checks, and first-cutover recovery before enabling main deployment.
9. Verify normal PR and post-merge behavior, service boot configuration, retained
   data/uploads, deployment statuses, and the next scheduled backup.

Replace project names, domains, database identities, paths, Unix users, ports,
runtime versions, repository/workflow IDs, entry points, and email adapters
together. Hardcoded environment guards are intentional and must be adapted
with configuration. Do not reuse another installation's credentials or tunnel ID.
The following PunDad section is the concrete example, not a portable installer
for every server or framework.

## Part 2: The PunDad implementation

### 9. Current environment map

PunDad has separate repositories:

- Backend: `https://github.com/biandresen/Pundad-api`
- Frontend: `https://github.com/biandresen/Pundad-app`

| Setting | Development | Staging | Production |
| --- | --- | --- | --- |
| Browser origin | `http://localhost:5173`, forwarded over SSH | `https://staging.pundad.app` | `https://pundad.app` (also served at `www.pundad.app`) |
| API on Pi | `127.0.0.1:4001` | `127.0.0.1:4002` | `127.0.0.1:4000` |
| PostgreSQL database | `pundad_dev` | `pundad_staging` | `jokedb` |
| PostgreSQL login | `pundad_dev` | `pundad_staging` | `jokeuser` |
| API files | Backend `-dev` worktree | `/srv/pundad/staging/current/api` | `/srv/pundad/production/current/api` |
| Frontend files | Frontend `-dev` worktree, served by Vite | `/srv/pundad/staging/current/frontend` | `/srv/pundad/production/current/frontend` |
| Uploads | Backend worktree's `uploads/` | `/srv/pundad/staging/uploads` | `/var/www/pundad-uploads` |
| Server config | Backend worktree's `.env.development` | `/etc/pundad/staging/api.env` | `/etc/pundad/production/api.env` |
| Email | API terminal | Private JSON files on the Pi | Resend provider |
| Process management | Development terminals | `pundad-staging.service` and its PM2 runtime | `pundad-production.service` and its PM2 runtime |

The editable folders are:

```text
/home/pi/projects/backend/pundad-api-dev
/home/pi/projects/frontend/pundad-app-dev
```

The original checkouts without `-dev` remain as legacy/history locations. The
live production API/frontend now run from `/srv/pundad/production/current`, not
from the original checkout or `/var/www/pundad-frontend`. The production database,
uploads, existing JWT secrets, and provider settings were preserved during that
move. Old directories were retained for inspection, not deleted as assumed stale.

The same two development worktrees were used throughout the rollout; staging
and production release directories are installed snapshots, not extra editable
development projects. Branches change with each task. Check `git branch
--show-current` instead of assuming a worktree always uses a rollout branch.
Development/staging schemas came from migrations and moderation seeds; production
user data was not copied into either test environment.

```mermaid
flowchart TD
  Browser[Laptop browser] --> Edge[Cloudflare HTTPS]
  Edge --> ST[Dedicated staging tunnel]
  Edge --> PT[Existing production tunnel]
  ST --> SN[Nginx: staging.pundad.app]
  PT --> PN[Nginx: pundad.app and www.pundad.app]
  SN --> SF[Staging frontend and uploads]
  SN --> SA[Staging API: 127.0.0.1:4002]
  SA --> SD[(pundad_staging database)]
  PN --> PF[Production frontend and uploads]
  PN --> PA[Production API: 127.0.0.1:4000]
  PA --> PD[(jokedb database)]
```

The public TLS endpoint is Cloudflare. Each tunnel connects outbound from the
Pi and reaches local Nginx over HTTP loopback; no extra router port-forward or
Nginx TLS certificate was added for staging. Production's existing tunnel was
preserved. The staging banner depends on the browser hostname. Staging also
has noindex headers and a robots.txt disallowing crawling; it remains public.

### 10. Everyday development and PRs

Commands run **on the Pi over SSH** unless explicitly marked otherwise.
Start with a clean worktree. If `git status` shows work, commit or deliberately
save it before switching branches; do not overwrite it with checkout/reset.

For a new frontend change:

```bash
cd /home/pi/projects/frontend/pundad-app-dev
git status
git fetch origin
git switch -c feat/your-change origin/main
nvm use
npm ci
npm run dev
```

`nvm use` reads `.nvmrc`; load nvm in the terminal first if necessary. `npm ci`
is needed for a fresh worktree or changed lockfile, not on every code edit.
The service runtimes have their own explicit Node paths; they do not rely on
an interactive terminal's nvm setup.

In another Pi terminal, start the API:

```bash
cd /home/pi/projects/backend/pundad-api-dev
nvm use
npm run dev
```

Create a feature branch in the backend too before editing backend code. For
related changes in both repos, use the **same feature branch name** and open
both PRs; the controller pairs them by that name. The optional development worker
is a separate terminal/process:

```bash
cd /home/pi/projects/backend/pundad-api-dev
npm run dev:worker
```

It computes development features at startup and on its schedule. Run one worker
per environment. Stop development terminals with Ctrl+C, leaving the managed
staging/production services alone.

In VS Code Remote SSH, forward port **5173** in the Ports panel and open
`http://localhost:5173` on the laptop. The browser uses relative `/api/v1` and
`/uploads` paths; Vite proxies them on the Pi to port 4001. Only 5173 needs
forwarding. Use `localhost` consistently in the browser and verification links.
Alternatively, run this on the **laptop**, substituting the Pi's SSH address:

```bash
ssh -N -L 5173:127.0.0.1:5173 pi@YOUR_PI_SSH_ADDRESS
```

For an existing backend development database, apply committed migrations and
seed development moderation terms only when needed:

```bash
cd /home/pi/projects/backend/pundad-api-dev
npm run db:dev:deploy
npm run db:dev:seed
```

These guarded commands do not reset a database. Development shadow-database
configuration for authoring new Prisma migrations has **not** been set up. Do
not follow old instructions that run an unqualified `prisma migrate dev`.

Before publishing, run the relevant checks:

```bash
# Backend development worktree:
npm run lint
npm test
python3 -m unittest discover -s ops/deploy/tests -v

# Frontend development worktree, run separately:
npm run lint
npm test
npm run build
```

Then, in each changed repository:

```bash
git diff
git add path/to/changed-file
git commit -m "Describe the change"
git push -u origin HEAD
```

Open a **non-draft PR targeting main** in GitHub. A PR can also be created with
`gh pr create --base main` from the appropriate repository. Inspect CI and
staging, then merge once satisfied. Pushing more commits updates the same PR
and reruns checks. A docs-only eligible PR also follows deployment automation;
the controller does not skip changes based on file type.

```text
Feature branch -> PR -> successful current CI -> automatic staging
Merge PR -> successful current main CI -> automatic production
```

The Pi polls approximately once per minute after the preceding cycle finishes,
then builds/deploys. CI completion is not an instant activation signal. If the
shared staging site appears unchanged, check its version metadata and controller
journal before assuming the browser is broken.

### 11. Email and account verification

#### Registration security check (Cloudflare Turnstile)

Turnstile runs only on `/register`. The frontend uses `@marsidev/react-turnstile`
to load Cloudflare's script when that page mounts, sends `turnstileToken` with
the registration JSON, and gets a fresh challenge after every attempted
submission. The API verifies the token
before user lookups, password hashing, account creation, or email delivery.
Login, password reset, resend verification, and other forms do not use Turnstile.

| Environment | Frontend site key | API configuration |
| --- | --- | --- |
| Development | Public test key in frontend `.env.development` | Public test secret in backend `.env.development` |
| Staging | Real public key from frontend `.env.production` (the CI production build) | `/etc/pundad/staging/api.env` |
| Production | Real public key from frontend `.env.production` | `/etc/pundad/production/api.env` |

In Cloudflare's Turnstile widget settings, allow `pundad.app`; this also covers
`www.pundad.app` and `staging.pundad.app`. Use Managed mode
for the normal visible verification widget. The current public key is tracked
in the frontend so CI artifacts include it. **Never put the secret in a `VITE_`
variable, frontend file, GitHub artifact, or Git commit.**

Local development uses Cloudflare's published test pair:

```dotenv
# Frontend .env.development (already tracked)
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA

# Backend .env.development (private; also documented in its example file)
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

The API accepts these test secrets only with both `APP_ENV=development` and
`NODE_ENV=development`. It still calls Cloudflare Siteverify; it allows the test
response's dummy hostname/action. Published test secrets are refused in staging
and production. The real-secret path always requires action `register` and an
exact hostname from `TURNSTILE_ALLOWED_HOSTNAMES`.

Before deploying these changes, edit the private server configuration on the Pi:

```bash
sudoedit /etc/pundad/staging/api.env
```

Add the widget's real secret locally and the staging hostname:

```dotenv
TURNSTILE_SECRET_KEY=REPLACE_WITH_THE_REAL_WIDGET_SECRET
TURNSTILE_ALLOWED_HOSTNAMES=staging.pundad.app
```

Then edit production separately:

```bash
sudoedit /etc/pundad/production/api.env
```

```dotenv
TURNSTILE_SECRET_KEY=REPLACE_WITH_THE_REAL_WIDGET_SECRET
TURNSTILE_ALLOWED_HOSTNAMES=pundad.app,www.pundad.app
```

One widget/key pair can serve both environments when both domains are allowed
in Cloudflare. A separate staging widget is also possible, but then staging
needs a separately built frontend with its own site key; the current shared CI
artifact uses one public key for both environments.

Restart the local development API after adding its test secret. The normal
staging/production deployment restarts those services and loads their env files.
If updating keys on an already deployed version, rebuild the frontend for a site
key change and restart the corresponding API service for a secret change.
Missing settings or an unavailable Siteverify service block registration;
verification cannot silently be disabled by leaving the secret blank.

Verify in development first, then in staging before merging both repositories:
registration should show the widget, a successful submission should reach the
email-verification page, and an API registration without `turnstileToken`
should return `400` with code `TURNSTILE_FAILED`. Login should show no widget.
Tokens expire after five minutes and are single-use; failed submissions refresh
the challenge so retries use a new token. The frontend and API changes should
be released together: an older frontend cannot satisfy the protected endpoint.

If a Content Security Policy is added to the frontend in Nginx or Cloudflare,
allow `https://challenges.cloudflare.com` in `script-src` and `frame-src`.
The API's Helmet policy does not control the separately served frontend.

References: [client integration](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/),
[server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/),
and [test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).

#### Email delivery and verification

| Environment | Where the message goes | Real email sent? |
| --- | --- | --- |
| Development | JSON output in the API terminal, including `text` and link | No |
| Staging | `/var/lib/pundad-staging/mail/*.json` on the Pi | No |
| Production | Actual recipient through Resend | Yes |

**Development:** register using a recognizable dummy email, then find the
`development_email` JSON event in the API terminal. Open the URL in `text` in
the laptop browser. No provider credentials are required.

**Staging:** register at `https://staging.pundad.app`, then run on the Pi:

```bash
sudo ls -lt /var/lib/pundad-staging/mail/
```

Select the message's real filename and open it locally:

```bash
sudo less /var/lib/pundad-staging/mail/ACTUAL_FILENAME.json
```

Replace `ACTUAL_FILENAME.json`; it is not a literal file to create. Match the
**`to`** field to your dummy address. The **`text`** field contains the staging
verification link. Open it on the laptop; press `q` to exit `less`.

Verification links currently expire after **15 minutes**. Use resend verification
if the link expired and inspect the new message. Password-reset links currently
expire after **5 minutes**. The user/token records are real in that environment,
even though delivery is captured. Login remains blocked until verification.

Captured JSON contains recipient, subject, text, HTML, optional reply-to, and
creation time. Each message is mode 600 in a private directory outside the web
root. Keep token links out of chat, Git, and public logs. Staging has no public
mailbox UI, and public testers do not receive captured messages automatically.
The controller removes staging messages older than seven days.

The actual [email delivery adapter](../src/services/emailService.js) returns
from the console/capture branch before
calling the real provider. Console mode requires development; capture requires
staging and an absolute private capture path. Staging's validator rejects a real
provider key. Verification/reset URLs use `FRONTEND_BASE_URL`.

Staging/production refresh cookies use Secure, HttpOnly, SameSite=Lax, no Domain
attribute, and path `/api/v1/auth/refresh`. They are host-scoped; independent JWT
secrets separate staging from production. Inspect cookies in browser developer
tools; HttpOnly prevents page JavaScript from reading them.

### 12. Configuration and database inspection

The backend's private `.env.development` is ignored and mode 600. Its tracked
template is `.env.development.example`. A new development setup needs real,
independent random values in place of every secret/password placeholder:

```dotenv
NODE_ENV=development
APP_ENV=development
HOST=127.0.0.1
PORT=4001
LOG_LEVEL=debug
DATABASE_URL=postgresql://pundad_dev:REPLACE_PASSWORD@127.0.0.1:5432/pundad_dev?schema=public
FRONTEND_BASE_URL=http://localhost:5173
UPLOADS_DIR=./uploads
JWT_ACCESS_SECRET=REPLACE_WITH_INDEPENDENT_DEVELOPMENT_SECRET
JWT_REFRESH_SECRET=REPLACE_WITH_ANOTHER_DEVELOPMENT_SECRET
EMAIL_DELIVERY=console
```

For new development JWT values, `openssl rand -hex 48` generates a secret;
run it separately for each key and store the results privately. The loader
requires at least 32 characters for each development secret. Do not replace
the working private file with this example or regenerate production secrets
as an incidental development setup step.

The actual [development environment loader](../src/config/developmentEnvironment.js)
is loaded with `--import` before the API,
worker, or development database CLI. It requires local `pundad_dev` login/database,
host 127.0.0.1, port 4001, this worktree's `uploads/`, console email, and development
labels/secrets. It overrides inherited matching variables with validated values.
Missing/wrong development settings stop startup rather than falling back to a
production database.

Staging's systemd EnvironmentFile supplies APP_ENV=staging, NODE_ENV=production,
port 4002, staging database/login, staging frontend/CORS, staging uploads/capture
paths, and separate secrets. `src/config/stagingEnvironment.js` checks those
settings before application imports and rejects RESEND_API_KEY.

Production's EnvironmentFile supplies APP_ENV=production, NODE_ENV=production,
port 4000, local `jokedb`/`jokeuser`, production origin/CORS, existing upload path,
provider mode, and existing production credentials. Its fixed validator lives
outside releases at `/usr/local/lib/pundad-deploy/productionEnvironment.js`.
`CORS_ORIGINS` is staging-only origin for staging and
`https://pundad.app,https://www.pundad.app` for production. Guard checks validate
targets; independent generation/storage establishes secret separation, not a
runtime comparison with a production secret file.

`.env.production` in the frontend contains public relative paths:

```dotenv
VITE_API_BASE_URL=/api/v1
VITE_API_ORIGIN=
```

Nginx chooses the matching API/uploads by hostname. Do not replace those values
with a production API URL for local development. Actual backend secrets belong
in private server configuration, never frontend build variables.

To inspect PostgreSQL as a local administrator:

```bash
sudo -u postgres psql -d pundad_dev
```

Inside psql, enter these commands separately, without explanatory comments:

```text
\l
\du
\conninfo
\dt
\d "User"
\c pundad_staging
\q
```

They list databases/roles, show the connection, list/describe tables, switch
database, and quit. SQL statements need semicolons; psql backslash commands do
not. For read-only inspection after verifying the database:

```sql
BEGIN READ ONLY;
SELECT current_database(), current_user;
SELECT id, username, "emailVerified" FROM "User" ORDER BY id LIMIT 10;
ROLLBACK;
```

Double quotes preserve Prisma's capitalized table/column names. To test the
actual application login rather than administrator access:

```bash
psql -h 127.0.0.1 -U pundad_staging -d pundad_staging -W
```

Enter its password privately. `-U` selects who connects; `-d` selects where.
Do not print a connection URL/private env file into shared output, or run a
reset/cleanup against a database selected from an unchecked shell environment.

### 13. Checks and main-branch protection

Both repositories use `.github/workflows/ci.yml` and Node **24.12.0** from
`.nvmrc`. Jobs run on GitHub-hosted Ubuntu 24.04, use lockfiles, and pin third-party
action revisions to commit SHAs. Repository token permissions are read-only.
Obsolete check runs for the same PR are cancelled. Production credentials are
not given to these jobs.

| Required check | What it verifies |
| --- | --- |
| Backend: API checks | ESLint, Prisma schema validation/client generation, Node application tests, Python deployment policy/archive/cache tests; archives exact checked API source |
| Backend: Database migrations | Disposable PostgreSQL 17, all migrations, status/schema comparison, moderation seed |
| Frontend: Frontend checks | ESLint, API-error unit tests, TypeScript/Vite production build and artifact upload |

API HTTP tests use database/email substitutes and Node's experimental module
mocking through the `npm test` script; use the pinned Node runtime. Migration CI
uses its own temporary runner database, never the Pi's production database. The backend artifact is
`api-<build-sha>` containing `api.tar`; the frontend artifact is
`frontend-<build-sha>` containing the built static files. Both are retained for
**30 days**. Overall successful backend CI includes the separate migration job,
even though artifact upload occurs within API checks.

CI runs on PRs targeting main, pushes to main, and manual workflow dispatch.
The deployment controller accepts PR and **main push** runs. To refresh an expired
artifact for unchanged main, rerun the original current-main push run with
`gh run rerun RUN_ID --repo OWNER/REPO`; a new manual-dispatch run is not the
controller's main-push deployment event.

The frontend's initial 111 existing explicit-any violations are recorded in
`eslint-suppressions.json` using bulk counts per file/rule. The rule remains
enabled; new files/increased counts fail lint. When removing old violations,
use `npm run lint:prune` and commit the resulting reduction, not an inflated
baseline. Three pre-existing hook-dependency warnings were informational at
rollout. Conditional hooks in Drafts were fixed; narrow context-module Fast
Refresh exceptions follow the provider/hook layout.

To reproduce main protection in GitHub after check names exist:

1. Settings -> Branches -> protection rule for `main`.
2. Require a pull request, required checks, and up-to-date branches.
3. Backend checks: **API checks** and **Database migrations**.
4. Frontend check: **Frontend checks**.
5. Require resolved conversations and enforce requirements for administrators.
6. Disallow force pushes and main-branch deletion.
7. Required approving reviews are zero for the solo owner, who cannot approve
   their own PR. Keep the PR/check gates enabled.

Canonical HTTPS remotes are the PunDad repository URLs above with `.git` appended.
Worktrees share their repository's remote configuration. GitHub CLI was installed
and authenticated because the connected app could not perform the needed
repository/protection writes. For a new host, authorize CLI in your own terminal:

```bash
gh auth login --hostname github.com --git-protocol https --web --scopes workflow
gh auth setup-git
gh auth status
```

The workflow scope was needed to publish workflow files; artifact reads need
repository/Actions access. Keep credentials in CLI storage, not Git or chat.

### 14. Automatic deployment policy

The fixed root-owned controller is
`/usr/local/lib/pundad-deploy/controller.py`. `pundad-deploy.timer` runs its
oneshot service approximately every minute after the previous cycle ends.
Transport is outbound GitHub API/artifact retrieval. There is no deployment SSH
port/key in Actions and no self-hosted Actions runner on the production Pi.

**Staging selection:** open, non-draft PRs by **biandresen**, in the same repository,
targeting main. Forks and other authors may run ordinary CI but do not deploy
automatically. The most recently updated eligible PR selects a branch. A trusted
PR in the other repository with that same branch name is paired; otherwise the
other component comes from its current main. Both selected CI runs must pass.
An unready selected revision leaves the current site in place. There is one
shared staging slot, not one site per PR. With no eligible PRs it follows main.

**Production selection:** current main push revisions from **both** repositories,
with their latest matching CI successful. A failed/pending current run blocks
the new pair. Sequential merges in two repositories are not atomic; keep API
contracts compatible with interim pairs. Re-running the same PR build is not
promotion to production; post-merge main CI must succeed.

The controller verifies fixed repo/workflow IDs, event, source repo/branch/SHA,
PR association, current test merge for a PR, artifact name/provenance, and ZIP
SHA256 digest. ZIP extraction rejects unsafe paths, links, special files, and
oversized payloads. API deployers also filter source extraction: staging rejects
links and `.env`/`.env.development`; production additionally rejects other private
`.env.*` files except example templates. Secret files must remain untracked,
regardless of those guards. The controller revalidates after download and again
after building, before activation. It uses installed privileged code rather than
executing a root deployer supplied in a PR artifact.

It records exact selections under `/var/lib/pundad-deploy/` and public non-secret
release metadata at `/__version.json`. A saved success is skipped only when the
**actually active** metadata also matches both selected revisions/environment.
An exact failed selection has a 15-minute retry backoff; a different eligible
selection can run sooner. API/authentication failures leave the running release
in place. GitHub deployment records/statuses link to the site and CI run; status
reporting failure does not tear down a successful running release.

Verified artifact ZIPs are cached privately. If GitHub retention expires, an
unchanged main component can reuse its saved successful production artifact only
when current head/latest successful run still match and its cached ZIP exists;
the digest is checked again. Failed newer CI is not bypassed. If the cache is
absent, rerun the original current-main push CI run to obtain fresh artifacts.

The controller reads the operator's existing CLI credentials using
`GH_CONFIG_DIR=/home/pi/.config/gh`. Those credentials have broader repository/
workflow rights than a dedicated deployment identity would need. Fixed host
code uses them; API/worker/build sandboxes hide `/home` and do not inherit that
credential configuration. Expired CLI authentication needs renewal by the
operator. A narrower dedicated identity is a future improvement, not an
already configured component.

### 15. Host resources and source files

The backend owns executable infrastructure definitions. These are source files
to review before an operator installs them; editing or merging them does not
automatically replace privileged host code.

| Source in backend | Purpose |
| --- | --- |
| `src/config/developmentEnvironment.js` | Guarded private development loader |
| `src/config/stagingEnvironment.js` | Staging startup validator |
| `src/services/emailService.js` | Console/capture/provider delivery adapters |
| `src/constants.js` | Frontend base URL and environment CORS settings |
| Auth service/controller/router | Database-backed readiness endpoint |
| `src/config/logger.js` | Environment labelling, including APP_ENV |
| `ops/staging/provision.py`, `deploy.py` | Staging host resources and release activation |
| `ops/staging/*.service`, ecosystem config, Nginx config | Staging API/worker/tunnel runtime definitions |
| `ops/deploy/provision.py`, `controller.py`, `common.py` | Fixed host automation, trust/archive checks, retention |
| `ops/deploy/production.py`, `productionEnvironment.js` | Production build/backup/activation/rollback and fixed guard |
| `ops/deploy/backup.py`, backup service/timer | Private snapshots and temporary restore rehearsal |
| `ops/deploy/logrotate.conf` | Managed PM2 file-log rotation |
| `ops/deploy/tests/` | Deployment policy, archive, cache, and active-state tests |
| `.github/workflows/ci.yml`, `.nvmrc` | CI and Node version |

The frontend's `vite.config.ts` contains the development proxy;
`src/routes/layouts/Layout.tsx` adds the staging banner; public build settings use
relative API/upload paths. Its workflow builds and uploads the frontend artifact.

| Installed resource | Purpose |
| --- | --- |
| `/etc/pundad/deploy.json` | Trusted owner, repo/workflow IDs, per-environment enable flags; root-only |
| `/usr/local/lib/pundad-deploy/` | Reviewed root-owned controller/helpers/production guard |
| `/usr/local/lib/pundad-staging/deploy.py` | Reviewed root-owned staging deployer |
| `/opt/pundad/node-v24.12.0`, `/opt/pundad/pm2` | Copied pinned Node/npm/PM2 runtime outside hidden `/home` |
| `/etc/pundad/{staging,production}/` | Private api.env and installed PM2/proxy definitions |
| `/srv/pundad/{staging,production}/releases/` | Root-owned API/frontend release pairs |
| `/srv/pundad/{staging,production}/{current,previous}` | Active/preceding successful application selection |
| `/var/lib/pundad-{staging,production}/pm2/` | Separate PM2 runtime state |
| `/var/lib/pundad-{staging,production}-build/` | Separate private builder work/cache directories |
| `/var/lib/pundad-staging/mail/` | Private captured staging email |
| `/var/lib/pundad-deploy/` | Controller success/backoff records and verified artifact cache |
| `/var/backups/pundad/production/` | Root-only production snapshots |
| `/etc/cloudflared/pundad-staging.yml` | Dedicated staging tunnel ingress |
| `/etc/cloudflared/pundad-staging/<UUID>.json` | Private tunnel credential |
| `/etc/nginx/sites-available/staging.pundad.app` | Staging virtual host, enabled by the deployer |
| `/etc/nginx/sites-enabled/pundad.app` | Production virtual host selecting the release frontend |
| `/etc/logrotate.d/pundad-services` | Installed log-rotation rules |

Staging Unix identities are `pundad-staging`, `pundad-staging-build`, and
`cloudflared-staging`, all without interactive logins. Production runs as **pi**
to preserve existing upload ownership, with separate `pundad-production-build`
for builds. Production PM2 home is not the legacy `/home/pi/.pm2`.

Both application services use ProtectHome, a mostly read-only filesystem,
NoNewPrivileges, private tmp/devices, root-owned releases, and limited writable
state/uploads. The API and worker share their environment's process limits:

| Service group | Memory limit | CPU quota |
| --- | --- | --- |
| Staging API + worker | 768 MiB | 50% of one CPU |
| Production API + worker | 1 GiB | 150% of one CPU |
| Each transient build | 1 GiB | 75% of one CPU, 900-second limit |
| Staging tunnel | 256 MiB | 25% of one CPU |

Staging uploads are owned by its runtime identity with group www-data, mode
2770; setgid preserves Nginx's group access and service umask 0007 limits access.
Staging mail explicitly uses 600. Staging/production api.env files are root-owned,
group-readable by the corresponding runtime group, mode 640. Only staging state
and uploads are writable to the staging service; production writes its own state
and existing uploads. These restrictions reduce shared-host interference but
do not turn the Pi into independent VMs.

### 16. Reproducing the installation

This section is an **operator installation recipe**, not the everyday workflow.
The existing Pi is already provisioned. Do not rerun creation commands to look
at it. Review scripts and target identity before administrative changes.

#### 16.1 Prerequisites and the existing-production assumption

The scripts were verified on Debian 13.2 ARM64 (`aarch64`), Python 3.13.5,
PostgreSQL 17.6, Nginx 1.26.3, cloudflared 2025.11.1, Node 24.12.0, and PM2
6.0.14. These are observed versions, not claims of the latest releases.

Prepare systemd, Nginx/www-data, PostgreSQL, Python with tar extraction-filter
support, Git, curl, logrotate with its system schedule, GitHub CLI, and an
authenticated operator with sudo. PostgreSQL local administration uses Unix
`postgres` with peer authentication; app logins use local TCP/password auth.
Install cloudflared at `/usr/local/bin/cloudflared`, with an account authorized
for the intended domain/tunnel. The provisioners do not install these OS packages.

The staging provisioner expects Node/PM2 under
`/home/pi/.nvm/versions/node/v24.12.0`. With nvm already installed:

```bash
nvm install 24.12.0
nvm use 24.12.0
npm install --global pm2@6.0.14
```

The production provisioner is a migration from the existing PunDad installation:
it privately imports `/home/pi/projects/backend/pundad-api/.env`, expects
`jokedb`/`jokeuser`, existing uploads, old PM2 apps, and production Nginx/tunnel.
It is **not** a blank-server production database creator. For a new project or
complete disaster recovery, establish those prerequisites or deliberately adapt
the provisioner to securely restore/create production first. Do not invent
placeholder production secrets and run it expecting a restored application.

Use reviewed source from the backend's current main, including `ops/staging/`
and `ops/deploy/`, plus its frontend counterpart. Obtain a clean updated feature/
setup branch in the `-dev` worktree without resetting the legacy production
checkout. Keep lockfiles and source guards matched to their configuration.

#### 16.2 Set up isolated development on a new installation

For a fresh installation without those worktree directories, start from fetched
main rather than the legacy checkout's old HEAD:

```bash
cd /home/pi/projects/backend/pundad-api
git fetch origin
git worktree add -b chore/development ../pundad-api-dev origin/main

# In the frontend repository, separately:
cd /home/pi/projects/frontend/pundad-app
git fetch origin
git worktree add -b chore/development ../pundad-app-dev origin/main
```

The directory/branch creation above is not needed on the existing Pi. It updates
remote references without pulling/resetting the original checkouts. Install in
the new -dev worktrees. Create a fresh development role/database from administrator
psql only if they do not already exist:

```sql
CREATE ROLE pundad_dev LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
\password pundad_dev
CREATE DATABASE pundad_dev OWNER pundad_dev;
REVOKE ALL ON DATABASE pundad_dev FROM PUBLIC;
```

Verify it has no production privileges. In the backend development worktree:

```bash
nvm use
npm ci
cp .env.development.example .env.development
chmod 600 .env.development
```

Edit that private file with the new development login password and independent
JWT secrets before starting anything. The template is deliberately not runnable
with its placeholder connection credentials. Generate the client and apply
committed development migrations/seed:

```bash
node --import ./src/config/developmentEnvironment.js node_modules/prisma/build/index.js generate
npm run db:dev:deploy
npm run db:dev:seed
```

Install frontend dependencies with `nvm use` and `npm ci` in its own worktree,
then preview/test through the SSH-forwarded Vite proxy as described above.

#### 16.3 Provision staging and fixed automation

From the reviewed backend development source:

```bash
cd /home/pi/projects/backend/pundad-api-dev
less ops/staging/provision.py
less ops/staging/deploy.py
less ops/deploy/provision.py
less ops/deploy/controller.py
less ops/deploy/production.py
sudo python3 ops/staging/provision.py
sudo python3 ops/deploy/provision.py
```

Staging provisioning creates its Unix identities, private paths/env, restricted
PostgreSQL login/database, independent credentials, copied runtime, services,
deployer, and Nginx definition. The database role is NOSUPERUSER, NOCREATEDB,
NOCREATEROLE, NOREPLICATION, NOINHERIT, without production-role membership/grants.
The password is generated privately and SQL uses a SCRAM verifier. Public access
to the new staging database is revoked. Staging schemas/data are initialized
by the first release migration/seed, not by copying production records.

Automation provisioning installs fixed host helpers, production definitions,
backup/rotation/timer files, production builder, and controller state/config.
It privately copies existing production credentials into a service-readable file
with explicit production labels/origin/CORS/port/uploads/delivery settings.

Both scripts reload systemd definitions but do not start deployment or production
on first install. Initial controller flags are false. Reruns preserve env files,
secrets, and existing enable flags but reinstall reviewed host definitions. A
staging database/login without its expected private env file causes a refusal
rather than replacement credentials. These are not general secret-rotation or
repair tools. On the already active Pi, pause deployment and wait for an idle
controller before reinstalling host tooling; review which definitions will change.

#### 16.4 Create the staging tunnel

Production uses its existing tunnel/configuration. Create a separate locally
managed tunnel rather than changing `/etc/cloudflared/config.yml` or restarting
production's tunnel. Authenticate with `cloudflared tunnel login` if no operator
account certificate exists, authorizing the intended account/domain in a browser.

```bash
/usr/local/bin/cloudflared tunnel --origincert /home/pi/.cloudflared/cert.pem list
/usr/local/bin/cloudflared tunnel --origincert /home/pi/.cloudflared/cert.pem create pundad-staging
```

If a matching tunnel already exists, inspect/reuse it with its actual credential
instead of creating another. For a new installation, record the newly generated
UUID and credential path; do not reuse this Pi's UUID for a different tunnel.
Install only that tunnel's credential, not the more powerful account certificate:

```bash
stage_tunnel_id=YOUR_NEW_TUNNEL_UUID
sudo install -d -o root -g cloudflared-staging -m 750 /etc/cloudflared/pundad-staging
sudo install -o root -g cloudflared-staging -m 640 \
  "/home/pi/.cloudflared/${stage_tunnel_id}.json" \
  "/etc/cloudflared/pundad-staging/${stage_tunnel_id}.json"
sudoedit /etc/cloudflared/pundad-staging.yml
```

Write this config, substituting that UUID in both places:

```yaml
tunnel: YOUR_NEW_TUNNEL_UUID
credentials-file: /etc/cloudflared/pundad-staging/YOUR_NEW_TUNNEL_UUID.json
metrics: 127.0.0.1:20252
ingress:
  - hostname: staging.pundad.app
    service: http://127.0.0.1:80
    originRequest:
      httpHostHeader: staging.pundad.app
  - service: http_status:404
```

The explicit Host header selects the staging Nginx virtual host. The catch-all
does not forward other hostnames. Validate and set config ownership:

```bash
sudo chown root:root /etc/cloudflared/pundad-staging.yml
sudo chmod 644 /etc/cloudflared/pundad-staging.yml
sudo -u cloudflared-staging /usr/local/bin/cloudflared \
  --config /etc/cloudflared/pundad-staging.yml tunnel ingress validate
sudo systemd-analyze verify \
  /etc/systemd/system/pundad-staging.service \
  /etc/systemd/system/cloudflared-staging.service \
  /etc/systemd/system/pundad-production.service \
  /etc/systemd/system/pundad-deploy.service \
  /etc/systemd/system/pundad-deploy.timer \
  /etc/systemd/system/pundad-backup.service \
  /etc/systemd/system/pundad-backup.timer
```

Provisioning installed the tunnel unit but did not create its credentials/config;
the preceding steps do that. Make a reviewed local staging release using section
17, then check direct API and host-routed Nginx before publishing DNS:

```bash
curl -fsS http://127.0.0.1:4002/api/v1/auth/ready
curl -fsS -H 'Host: staging.pundad.app' http://127.0.0.1/api/v1/auth/ready
curl -fsS -H 'Host: staging.pundad.app' http://127.0.0.1/__version.json
sudo nginx -t
sudo systemctl enable --now cloudflared-staging.service
```

#### 16.5 Publish the correct DNS record

In **Cloudflare -> pundad.app -> DNS**, this Pi's record is:

| Field | Installed value |
| --- | --- |
| Type | CNAME |
| Name | `staging` |
| Target | `4ac15581-a307-4b70-8b41-5eeb1c929c0f.cfargotunnel.com` |
| Proxy | Proxied / orange cloud |
| TTL | Auto |

A different installation must use its own tunnel UUID/account/domain. The UUID
is not a secret; the JSON credential and operator certificate are. The tunnel
must belong to the same Cloudflare account as the domain.

During setup, the saved operator certificate could manage tunnels in the correct
account but its DNS scope was **bloggy-app.dev**. The CLI appended that zone and
created `staging.pundad.app.bloggy-app.dev`. That unintended new record was
removed; the correct `pundad.app` record was added in its dashboard. Production
DNS records were preserved. Verify the exact resulting hostname instead of
trusting a successful CLI message; do not blindly use `--overwrite-dns`.

```bash
curl -fsSI https://staging.pundad.app/
curl -fsS https://staging.pundad.app/api/v1/auth/ready
curl -fsS https://staging.pundad.app/__version.json
curl -fsS https://staging.pundad.app/robots.txt
```

Then open the public site on the laptop, check the staging banner, and test the
captured-email registration flow. A DNS record alone does not install/start the
tunnel, Nginx host, or API.

#### 16.6 Enable automatic staging, then production

Authenticate the operator's GitHub CLI and check main protection/CI. The installed
root-only `/etc/pundad/deploy.json` contains policy and enable flags, not secrets:

```json
{
  "trusted_owner": "biandresen",
  "enabled": {"staging": true, "production": true},
  "repositories": {
    "api": {"name": "biandresen/Pundad-api", "workflow_id": 387701573, "artifact_prefix": "api"},
    "frontend": {"name": "biandresen/Pundad-app", "workflow_id": 387701588, "artifact_prefix": "frontend"}
  }
}
```

This shows the final PunDad configuration. Initial provisioning uses **false**
enable flags; use `sudoedit /etc/pundad/deploy.json` to enable staging first.
For another project, discover its CI IDs with `gh api
repos/OWNER/REPO/actions/workflows/ci.yml`, rather than copying PunDad IDs.

```bash
sudo env GH_CONFIG_DIR=/home/pi/.config/gh GH_PROMPT_DISABLED=1 \
  python3 /usr/local/lib/pundad-deploy/controller.py plan --environment staging
sudo systemctl enable --now pundad-deploy.timer
```

`plan` is read-only and prints selected non-secret revisions. Exit code 2 with
a waiting message means current inputs are ineligible, not that it deployed.
The timer/service leaves the current site alone while checks are pending.

Before enabling production, prove staging/rollback, validate production settings,
take a private backup and rehearse restoration (section 19), and ensure successful
current main push CI in both repos. Then set production enabled and allow the
controller's next cycle. `sudo systemctl start --no-block pundad-deploy.service`
can request an earlier cycle when none is active. Do not restart/kill an active
deployment to hurry it up.

The first production cutover removes only legacy `pundad-api` and `pundad-worker`
from the original PM2 daemon and saves its remaining state. The old logrotate
module/daemon remain. On failure during that first activation, the deployer
restores original PM2 apps/Nginx. Later failures restore the preceding versioned
application. The original checkout and old frontend directory remain for
inspection/recovery, not as the active source deployment.

Finally enable the tested backup schedule:

```bash
sudo systemctl enable --now pundad-backup.timer
sudo systemctl is-enabled pundad-production.service pundad-deploy.timer pundad-backup.timer
```

### 17. Manual staging deployment

This is an operator escape hatch and first-install path; ordinary PR work uses
the automatic controller. Select reviewed commits and successful current CI
runs, not an arbitrary newest run on a moving branch.

```bash
gh run list --repo biandresen/Pundad-api --branch YOUR_BRANCH --limit 5
gh run list --repo biandresen/Pundad-app --branch YOUR_BRANCH --limit 5

stage_api_run=YOUR_SUCCESSFUL_API_RUN_ID
stage_frontend_run=YOUR_SUCCESSFUL_FRONTEND_RUN_ID
gh run view "$stage_api_run" --repo biandresen/Pundad-api --json headSha,event,conclusion,url,jobs
gh run view "$stage_frontend_run" --repo biandresen/Pundad-app --json headSha,event,conclusion,url,jobs
gh api "repos/biandresen/Pundad-app/actions/runs/${stage_frontend_run}/artifacts" \
  --jq '.artifacts[] | {name,expired,id}'
```

Inspect every required job and artifact expiry. For a PR frontend, obtain the
actual test-merge build SHA from `frontend-<sha>`, not the branch-head field.
For the API manual archive, choose the reviewed API commit whose successful
checks you verified. The automatic path instead downloads/verifies the API CI
archive for the exact checked build commit as well.

```bash
stage_api_sha=YOUR_REVIEWED_40_CHARACTER_API_COMMIT
stage_frontend_sha=YOUR_ARTIFACT_40_CHARACTER_BUILD_COMMIT
stage_workspace=$(mktemp -d /tmp/pundad-stage-release.XXXXXX)

git -C /home/pi/projects/backend/pundad-api-dev fetch origin
git -C /home/pi/projects/backend/pundad-api-dev show --no-patch --oneline "$stage_api_sha"
git -C /home/pi/projects/backend/pundad-api-dev archive \
  --format=tar --output="$stage_workspace/api.tar" "$stage_api_sha"
gh run download "$stage_frontend_run" --repo biandresen/Pundad-app \
  --name "frontend-${stage_frontend_sha}" --dir "$stage_workspace/frontend"
test -f "$stage_workspace/frontend/index.html"

sudo python3 /usr/local/lib/pundad-staging/deploy.py \
  --api-archive "$stage_workspace/api.tar" \
  --frontend-dir "$stage_workspace/frontend" \
  --api-sha "$stage_api_sha" \
  --frontend-sha "$stage_frontend_sha"
```

Replace all placeholders and do not invoke the privileged copy of a deployer
from an arbitrary PR. Manual SHA format checks do not prove that an archive
matches its declared SHA or passed CI; the operator verifies inputs. Automatic
deployment additionally enforces its provenance/digest/selection checks.

The staging deployer serializes on `/run/pundad-staging-deploy.lock`, builds as
its restricted builder, installs locked dependencies with `--include=dev`,
generates Prisma Client, applies staging migrations, and seeds test moderation
terms. It freezes a root-owned release, writes version metadata, atomically
switches current, restarts the service, checks readiness, validates/enables
the Nginx site, reloads gracefully, and enables the app at boot. Automatic runs
also revalidate the selection and require both API and worker online.

Production has a separate installed deployer/guard, production build identity,
and `/run/pundad-production-deploy.lock`. It takes a pre-migration backup and
does **not** run the moderation seed, which would reactivate/reset administrator
settings. Native dependencies are installed on the Pi. Application activation
is brief downtime, not blue/green deployment. Persistent records/uploads stay
outside releases, and a build/migration may have changed data before activation.

### 18. Inspection and troubleshooting

Read the public release pair and database readiness:

```bash
curl -fsS https://staging.pundad.app/__version.json
curl -fsS https://pundad.app/__version.json
curl -fsS https://staging.pundad.app/api/v1/auth/ready
curl -fsS https://pundad.app/api/v1/auth/ready
```

`/api/v1/auth/health` is HTTP liveness. `/ready` executes a database query and
returns 503 with a generic message when unavailable. It deliberately does not
expose private diagnostics. `__version.json` exposes environment, API build SHA,
frontend build SHA, and release ID, with no-store caching.

```bash
sudo systemctl status pundad-production.service pundad-staging.service
sudo systemctl status cloudflared.service cloudflared-staging.service
sudo systemctl list-timers pundad-deploy.timer pundad-backup.timer
sudo systemctl show pundad-deploy.service -p ActiveState -p Result
sudo journalctl -u pundad-deploy.service --since '30 minutes ago'
sudo journalctl -u pundad-production.service --since '10 minutes ago'
sudo journalctl -u pundad-staging.service --since '10 minutes ago'
sudo journalctl -u cloudflared-staging.service --since '10 minutes ago'
readlink -f /srv/pundad/production/current
readlink -f /srv/pundad/staging/current
sudo nginx -t
```

The deployer and backup are oneshot services: inactive after successful
completion is normal. Inspect `Result`, timestamps/journal, and their enabled
timers. API/worker/tunnel services should remain active. PM2 runtime forwards
managed log files to the service journal. Plain `pm2 list` uses the old pi home,
so it does not show these separate managed environments. Do not use `pm2 kill`
or restart the old ecosystem to manage production; that could start duplicates.

Restart a managed environment only when needed:

```bash
sudo systemctl restart pundad-staging.service
# Production, when intentionally required:
sudo systemctl restart pundad-production.service
```

A restart briefly interrupts service and reruns worker startup computations.
For a changed env file, restart the service to load it. For a changed systemd
unit, also run `sudo systemctl daemon-reload`. Editing source definitions alone
does not install or activate them.

| Symptom | First checks |
| --- | --- |
| No staging DNS answer | Correct zone/name/proxied CNAME and tunnel UUID; exact hostname, not an appended old zone |
| Tunnel unavailable | Tunnel journal, credential access/UUID, enabled service |
| Wrong/default website | Tunnel Host header, Nginx server_name, enabled virtual host; local curl must supply Host |
| Nginx API 502 | Service/journal, API loopback port, direct readiness; build/startup/recovery logs |
| Health 200 but ready 503 | Database connectivity, role/config/migrations; inspect private server logs |
| PR passes but site unchanged | Shared-slot selection, other component's main/PR CI, current test-merge SHA, timer flags/journal, failure backoff |
| Merge does not deploy | Both current main push workflows must pass; eligible artifacts/cache must exist; manual dispatch is a different event |
| API JSON parsing error | Status and Content-Type; a SPA HTML fallback is not a successful API response |
| No staging verification inbox email | Expected: inspect the matching private JSON file on the Pi |
| Wrong verification domain | FRONTEND_BASE_URL in the actual environment; restart after changing config |
| Login/refresh trouble | Verification state, browser hostname/HTTPS, cookie attributes/path, selected environment |
| Upload 403 | Correct environment path, owner/group/modes and Nginx access; avoid broad chmod workarounds |
| Old frontend/PWA | Version metadata, browser network, hard reload or staging-only site-data reset |
| Migration/build failure | Exact database, committed migration history, lockfile/tool availability and build journal; never reset production to clear an error |
| CLI cannot call GitHub | Operator CLI authentication/access, API/rate limits, journal; renew credentials locally |
| Old CLI PR edit hits deprecated Projects fields | Installed CLI 2.46 hit this; structured REST `gh api --method PATCH ... --input <json-file>` was used |

Frontend index and sw.js use no-cache; hashed assets cache seven days; missing
assets return 404 and React navigation routes fall back to index.html. Service
worker/browser caches belong to each hostname separately. A staging noindex
header or robots rule is not an access-control mechanism.

Python's default HTTP user agent received Cloudflare 403/error 1010 during
verification while curl/accepted client requests succeeded. No edge protection
was disabled. Inspect whether a 403 is from Cloudflare or the app before changing
authentication/CORS. Avoid sharing cookies, auth headers, or verification URLs.

### 19. Backups and restore rehearsal

Production snapshots are private under
`/var/backups/pundad/production/<UTC-timestamp>/`:

| File | Contents |
| --- | --- |
| `database.dump` | Custom-format PostgreSQL snapshot of jokedb |
| `roles.sql` | Server role definitions/verifiers; sensitive recovery material |
| `uploads.tar.gz` | Existing production uploads |
| `api.env` | Production credentials/settings; sensitive |
| `nginx.conf` | Current production Nginx definition |
| `legacy-pm2.json`, when present | Old PM2 saved state, potentially including credentials |
| `manifest.json` | Backup time, active release/legacy origin, consistency note |

Directories are root-only and files mode 600. Backups run **before production
migrations** and daily at **03:30 Europe/Oslo** using the backup timer, serialized
with the production deploy lock. Seven completed snapshots are retained: seven
snapshots, not necessarily seven days when deployments are frequent. Uploads
are a filesystem copy, not atomic with the database transaction snapshot.

```bash
sudo systemctl status pundad-backup.timer
sudo journalctl -u pundad-backup.service --since '2 days ago'
sudo ls -lt /var/backups/pundad/production/
```

Create an additional private snapshot or rehearse a selected completed one:

```bash
sudo python3 /usr/local/lib/pundad-deploy/backup.py
# Use the actual completed snapshot path printed above:
sudo python3 /usr/local/lib/pundad-deploy/backup.py \
  --rehearse /var/backups/pundad/production/YOUR_SNAPSHOT_TIMESTAMP
```

Rehearsal creates `pundad_restorecheck_<timestamp>`, restores without original
ownership/privilege assignments, queries its User table, reads the upload
archive, and drops only that temporary database. It does not restore over jokedb.
It was run successfully before cutover. The scheduled backup also succeeded
on 18 October 2026 at 03:30 Oslo time.

For an actual data incident, pause deployment, choose the intended snapshot and
compatible release, assess writes since the snapshot, restore/test into another
database, and plan an explicit cutover. Do not casually import roles.sql or an
old dump into the live server. Code rollback does not require restoring data.

Backups currently remain on the Pi/storage. Off-device backup storage has **not**
been configured and needs its own destination/credentials. There is no scheduled
staging backup system; test data may be disposable, but any data you want to keep
needs a deliberate backup plan. Migrations reconstruct a schema, not user records.

### 20. Pausing deployment and rolling back

First stop new timer invocations and let any current deployment finish:

```bash
sudo systemctl stop pundad-deploy.timer
sudo systemctl show pundad-deploy.service -p ActiveState -p Result
```

Wait while the controller is active/activating. **Do not kill/restart the active
deployment service** during migration or activation. For a longer per-environment
pause, set its enable flag false in `/etc/pundad/deploy.json`; checks also verify
the flag before activation. Manual rollback without pausing is replaced by the
selected GitHub pair on a future poll because active metadata is checked.

Inspect the target and confirm schema compatibility before changing current.
The following uses staging by default; choose production intentionally instead:

```bash
rollback_env=staging
case "$rollback_env" in
  staging) rollback_port=4002; rollback_url=https://staging.pundad.app ;;
  production) rollback_port=4000; rollback_url=https://pundad.app ;;
  *) exit 1 ;;
esac
readlink -f "/srv/pundad/${rollback_env}/current"
readlink -f "/srv/pundad/${rollback_env}/previous"

sudo flock "/run/pundad-${rollback_env}-deploy.lock" sh -eu -c '
  rollback_root="/srv/pundad/$1"
  rollback_target=$(readlink -e "$rollback_root/previous")
  case "$rollback_target" in "$rollback_root"/releases/*) ;; *) exit 1 ;; esac
  test -d "$rollback_target/api"
  test -f "$rollback_target/frontend/index.html"
  ln -s "$rollback_target" "$rollback_root/.current-rollback"
  mv -Tf "$rollback_root/.current-rollback" "$rollback_root/current"
  systemctl restart "pundad-${1}.service"
' sh "$rollback_env"

curl --retry 15 --retry-all-errors --retry-delay 1 -fsS \
  "http://127.0.0.1:${rollback_port}/api/v1/auth/ready"
curl -fsS "${rollback_url}/__version.json"
```

This requires a valid previous link, absent after a first-ever successful
versioned release. It intentionally stops if `.current-rollback` already exists:
inspect leftovers instead of overwriting them blindly. It does not change the
previous link, undo migrations/uploads, or automatically recover if this manual
target itself fails. In-flight requests can cross a release boundary even with
an atomic symlink change. Check both processes/journal as well as HTTP readiness.

After maintenance, restore intended enable flags, then resume automation:

```bash
sudo systemctl enable --now pundad-deploy.timer
```

Resuming can redeploy the selected latest GitHub revision; it does not permanently
pin the manually chosen older release. To keep a rollback for investigation,
leave the relevant automation paused until a compatible fix is ready.

### 21. Maintenance and retention

The controller prunes while respecting deploy locks:

- Three newest application release directories, plus current/previous targets.
- Two newest failed build directories; extra ones older than one hour are removed.
- Twenty newest cached artifact ZIPs, plus artifacts referenced by active saved
  staging/production selections.
- Staging captured mail older than seven days.

Production backup code keeps seven completed snapshots. System logrotate handles
staging/production PM2 file logs daily, retains seven archives, compresses them,
and checks a 10 MiB maxsize **when logrotate runs**; this is not a hard file-size
quota. PM2 runtime also forwards those logs to the journal. It uses managed file
logging rather than trying to reopen systemd's stdout socket as a file.

```bash
df -h
sudo systemctl status logrotate.timer
sudo /usr/sbin/logrotate --debug /etc/logrotate.d/pundad-services
```

The logrotate debug command only inspects; it does not rotate files. Disk is
shared with production. Do not remove current/previous release targets, env
files, persistent uploads, or database files as routine cleanup. Downloaded
operator artifacts in `/tmp` are not running releases and can be removed after
verified deployment. Unfinished/failed backup directories may need inspection;
the seven-snapshot policy applies to completed backups, not arbitrary directories.

### 22. Implementation history and verified limits

Rollout sequence, preserved here instead of maintaining separate milestone guides:

1. Created the two Git worktrees, development login/database, private guarded
   configuration, local proxy/SSH preview, and console email. Applied the existing
   migration history and moderation seed without copying production user data.
2. Added CI and main protection. Baseline PRs were backend #1 and frontend #187.
   The frontend baseline also included PWA support and the verification-page
   text-color fix. Existing lint debt was recorded rather than hiding the rule.
3. Provisioned isolated public staging, dedicated tunnel/DNS, private email,
   reviewed artifact-based manual releases, version metadata, and readiness.
4. Added the outbound controller, exact API artifacts, trusted PR pairing, fixed
   production guard/deployer, backups/restore rehearsal, automatic main releases,
   retention, and process checks. Setup PRs were backend #2 and frontend #188.
5. Follow-up backend #3 added actual-active-release consistency checks and fixed
   PM2/systemd logging, with log rotation. Its API-only PR staged against frontend
   main and its merge triggered production again.

The first production startup failed because PM2 tried to open `/dev/stdout`,
which was a systemd/journal socket. Automatic first-cutover recovery restored
legacy API/worker and Nginx. Managed PM2 file logging fixed startup, and a fresh
verified retry succeeded. This exercised real production first-cutover recovery;
it was not just a simulated test. Separately, staging startup fault injection
proved restoration of its preceding good application and database readiness.

Verified outcomes include local/public staging registration, private capture
and verification, rejected unverified login, successful login/refresh, cookie
attributes, frontend/assets/banner metadata, and upload filesystem routing.
Temporary smoke accounts/messages/fixtures were removed. Production frontend,
public API/CORS, preserved uploads, database readiness, new API/worker states,
and successful GitHub deployment reports were checked. The old PM2 daemon kept
only its logrotate module; duplicate production API/workers were removed.

The last verified main application pair from the rollout was backend
`d0c7b8fbdbc21c2ab756d823c77522374eae8d0e` and frontend
`f03c68d3b22a3208555d213dd1bae1c8d6b01f4e`; both environments served it after
successful CI. This is a **historical verification record**, not an instruction
to pin future deployment to those commits. The earliest manually deployed
frontend build was a different PR test-merge SHA, illustrating why a branch head
is not always an artifact build SHA. Old CI artifacts expire.

At the final rollout verification, 29 API tests, 16 deployment-policy/archive/
cache/state tests, five frontend tests, lint, migration/schema checks, and the
frontend build passed. Those counts describe that revision, not a permanent
required test count. Development/staging role isolation and sandbox access to
production env/PM2 files were also checked.

Still outside the implemented setup: off-device backups, development migration
shadow database, per-PR staging sites, maintained full browser integration tests,
and zero-downtime deployment. Shared-machine isolation is not VM isolation.
Boot-enabled units/timers were checked without rebooting production solely as
a test. HTTP smoke checks did not replace visual/manual laptop browser testing.

Use this master guide for the current workflow. The old development, isolated
development, CI, staging, and automatic-deployment guide files are entry-point
links only; they must not accumulate separate operating instructions again.
