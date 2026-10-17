# A reusable guide to isolated development on a shared server

This guide explains the development setup implemented for PunDad and shows how
to apply the same approach to another Node.js API, Vite frontend, and PostgreSQL
project. Replace `myapp` names and example paths with your own project names.
Example creation commands are for a new project; do not recreate the existing
PunDad resources.

This guide preserves the explanation of the first development milestone. For
the complete current deployment setup, continue with
[the staging runbook](staging.md), updated after public HTTPS verification on
17 October 2026. It includes CI/artifact selection, host provisioning, tunnel
credentials and DNS, services, deployments, rollback, and replication guidance.
The everyday status/checklist is in [development.md](development.md).

## 1. Understand the independent parts

| Part | What it provides |
| --- | --- |
| Git repository | Shared commit history, branches, and remotes |
| Git worktree | An editable directory checked out from that repository |
| Application process | A running instance of your API or development server |
| PostgreSQL server | The database service, which can host multiple databases |
| PostgreSQL database | A named collection of schemas, tables, and records |
| PostgreSQL role | An identity and its privileges; a role with LOGIN acts as a database user |
| Environment variables | Per-process settings selecting ports, databases, secrets, and behavior |
| Upload directory | Persistent files owned by a particular application environment |

A branch or worktree does not automatically create a separate database or
application process. Configure each part deliberately.

Development and production can share the same physical server while using
different working directories, processes, databases, credentials, and uploads.
They still share the machine's resources and outages. Git worktrees are not
containers or security sandboxes.

## 2. Inspect production before changing development

Find the production process's working directory and entry point using your
process manager, and inspect Nginx's configured roots and aliases. Find which
database and upload directory production uses without printing secret values.

If production runs from a source checkout, do development in a separate worktree.
Later, move production to dedicated versioned release directories.

Do not copy production `.env` files into development. A separate directory
connected to the production database would still change production data.

## 3. Create separate Git worktrees

From the backend's existing checkout:

```bash
git worktree add -b chore/development ../myapp-api-dev HEAD
```

From the frontend's existing checkout:

```bash
git worktree add -b chore/development ../myapp-web-dev HEAD
```

These commands create a new branch in each repository and check it out into
another directory. `HEAD` means start from the current commit.

A branch is a movable reference to a commit. A worktree is the physical
workspace where a commit's files are checked out and edited. Each worktree has
its own working files, index (staging area), and HEAD; the repository's object
database, branch references, and remotes are shared.

Changes in one worktree do not automatically edit files in another. Each
worktree normally checks out a different branch; Git ordinarily prevents the
same branch from being checked out in two worktrees simultaneously. Two
separate repositories can independently use the same branch name.

Useful commands:

```bash
git worktree list
git status
git branch --show-current
git diff
```

Install dependencies separately inside each new worktree:

```bash
npm ci
```

`npm ci` installs the lockfile's dependency versions. Sharing Git history does
not share runtime dependencies, private environment files, or uploads. Ignored
files and uncommitted changes from the original checkout are not automatically
copied into the new worktree.

Eventually, commit your changes, push the branch, and merge it through a pull
request. A worktree itself is not pushed to GitHub; commits and branch updates
are. Remove a finished worktree with `git worktree remove <path>` after saving
its changes and any local files you need.

## 4. Create one development database and one development login

One PostgreSQL installation can host both production and development databases.
Connect as a local administrator on a typical Debian/Raspberry Pi installation:

```bash
sudo -u postgres psql -d postgres
```

For a new project, create a restricted role and its database:

```sql
CREATE ROLE myapp_dev LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;

\password myapp_dev

CREATE DATABASE myapp_dev OWNER myapp_dev;
REVOKE ALL ON DATABASE myapp_dev FROM PUBLIC;
```

`\password` prompts for a password, avoiding a literal password in your shell's
command history. Use a generated password and store it privately. Hexadecimal
random passwords are convenient in connection URLs because they avoid special
characters that would require URL encoding.

There is only **one database** in this example. The other `myapp_dev` is a
**role**, meaning the identity used to connect. Their names do not have to match:
`myapp_dev_login` could own the `myapp_development` database instead.

Think of the role as **who** is connecting and the database as **where** it
connects. Permissions and ownership determine what that identity can do.
Roles exist across a PostgreSQL server; they are not stored separately inside
each database.

Use a dedicated development role with no production role memberships or
production table privileges. Database connection permissions and table
permissions are separate; being able to connect does not by itself grant
access to every table. Verify the actual privileges instead of relying on
database names alone. An example check, run as an administrator while connected
to the production database, is:

```sql
SELECT has_table_privilege('myapp_dev', 'public."User"', 'SELECT');
```

This checks one table and one privilege, not every possible production action.
Do not grant production privileges to fix a development configuration error.

## 5. Learn to inspect PostgreSQL

Inside `psql`:

```text
\l                  list databases
\du                 list roles
\c myapp_dev        connect to the development database
\conninfo           show the current connection
\dt                 list visible tables
\d "User"           describe a table named User
\q                  quit
```

Enter each command without the explanatory text. Backslash commands belong to
`psql`; they are not SQL and do not need semicolons. SQL statements do:

```sql
SELECT current_database(), current_user;
SELECT id, username FROM "User" LIMIT 5;
```

Double quotes preserve the capitalization in Prisma table names such as
`"User"`. Use your own table and column names for another project.

To connect as the actual application login rather than the administrator:

```bash
psql -h 127.0.0.1 -U myapp_dev -d myapp_dev -W
```

`-U` selects the role, `-d` selects the database, and `-W` prompts for its
password. The `postgres` operating-system account, the PostgreSQL `postgres`
role, and the `postgres` database are distinct things that commonly share a
name. `sudo -u postgres` selects the operating-system account; `psql` then
normally uses the matching database role through local peer authentication.
Authentication settings can differ on other installations.

## 6. Give development its own configuration

A dotenv-style file contains text entries such as:

```dotenv
NODE_ENV=development
APP_ENV=development
HOST=127.0.0.1
PORT=4001
DATABASE_URL=postgresql://myapp_dev:REPLACE_PASSWORD@127.0.0.1:5432/myapp_dev?schema=public
FRONTEND_BASE_URL=http://localhost:5173
UPLOADS_DIR=./uploads
JWT_ACCESS_SECRET=REPLACE_WITH_A_RANDOM_DEVELOPMENT_SECRET
JWT_REFRESH_SECRET=REPLACE_WITH_ANOTHER_RANDOM_DEVELOPMENT_SECRET
EMAIL_DELIVERY=console
```

Save actual development values in `.env.development`. Generate independent
secrets for each environment. Do not use the placeholder values above.

The leading dot in `.env` makes the file hidden in ordinary Unix directory
listings; `ls -a` includes it. The dot before `development` is a naming separator.
It does not cause the operating system to load the file or change its priority.

| Filename | Intended use |
| --- | --- |
| `.env` | Conventional default configuration file for dotenv |
| `.env.development` | Configuration selected for development by a tool or explicit code |
| `.env.production` | Configuration selected for production by a tool or explicit code |
| `.env.development.example` | Tracked documentation with placeholders, not actual credentials |

These are ordinary files. Environment variables exist in a running process.
Some code or tool must read the file and put its values into that process.

The `dotenv` package's default `config()` reads `.env`; it does not automatically
choose `.env.development` just because `NODE_ENV=development`. Vite has its own
mode-based rules: it reads `.env` and `.env.local`, plus the selected mode's
files such as `.env.development` or `.env.production`. Existing environment
variables take precedence in Vite. The custom backend loader below deliberately
uses a different policy for development.

Keep real secrets out of Git:

```gitignore
.env
.env.*
!.env.example
!.env.development.example
```

Protect the local file:

```bash
chmod 600 .env.development
```

Ignoring a file does not untrack an already tracked file or remove it from Git
history. Do not store secrets in frontend `VITE_*` variables; Vite embeds those
values in browser-delivered code. Restart the development process after editing
environment files so it reloads the configuration.

## 7. Preload development configuration before application imports

Here, a **loader** means a small startup module that reads and validates
configuration before the application runs. It is an ordinary JavaScript module,
not a special Node.js module-resolution loader.

Create `src/config/developmentEnvironment.js`. This generic example illustrates
the core pattern; add guards for your own ports, uploads, and secret requirements:

```js
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

let config;
try {
  config = parse(readFileSync(path.resolve(".env.development")));
} catch {
  throw new Error("Create .env.development before starting development.");
}

if (config.NODE_ENV !== "development" || config.APP_ENV !== "development") {
  throw new Error("Development commands require the development environment.");
}

let database;
try {
  database = new URL(config.DATABASE_URL);
} catch {
  throw new Error("Set a valid development DATABASE_URL.");
}

if (
  !["postgres:", "postgresql:"].includes(database.protocol) ||
  !["127.0.0.1", "localhost"].includes(database.hostname) ||
  database.pathname !== "/myapp_dev" ||
  database.username !== "myapp_dev"
) {
  throw new Error("Use the local development database and login.");
}

Object.assign(process.env, config);
```

`readFileSync` reads the file, `parse` turns the key/value text into a JavaScript
object, the checks reject an unexpected target, and `Object.assign` copies the
validated keys into the current Node process's environment.

For example, if the parent shell exported a production `DATABASE_URL`, Node
initially inherits it. `Object.assign(process.env, config)` replaces that matching
key with the development file's value. It does not clear unrelated environment
variables, edit the shell, rewrite `.env`, or change another running process.
Children started afterward ordinarily inherit the updated environment.

Add an npm script:

```json
{
  "scripts": {
    "dev": "node --import ./src/config/developmentEnvironment.js --watch src/server.js"
  }
}
```

`--import` runs the startup module before the entry point. This order matters:
modules can read configuration or create clients as soon as they are imported.
`--watch` restarts the program when watched source modules change.

Production entry points do not use this development loader. Apply the same
preload to development workers, seed commands, and migration commands, so those
commands use the same validated configuration.

## 8. Build the database from migrations

First generate the Prisma Client in the development worktree, loading the
development environment explicitly:

```bash
node --import ./src/config/developmentEnvironment.js node_modules/prisma/build/index.js generate
```

For the existing migration history and a seed script, wrappers can be:

```json
{
  "scripts": {
    "db:dev:deploy": "node --import ./src/config/developmentEnvironment.js node_modules/prisma/build/index.js migrate deploy",
    "db:dev:seed": "node --import ./src/config/developmentEnvironment.js src/config/seed.js"
  }
}
```

Run them to apply existing committed migrations and insert development seed data:

```bash
npm run db:dev:deploy
npm run db:dev:seed
```

Migrations reconstruct the database structure from versioned SQL. Seed scripts
insert chosen initial records. Neither requires copying production users or
other production data. Seed behavior depends on the script; inspect it before
running it.

Applying existing migrations is different from authoring new ones. Prisma's
`migrate dev` uses a shadow database. With the restricted role above, configure a
dedicated development shadow database and the connection setting supported by
your pinned Prisma version before authoring migrations. Never select production
as the shadow database. Shadow-database setup was not part of PunDad's first step.

## 9. Capture development email and construct environment-specific links

Keep the normal application flow, but replace the delivery step in development:

```js
let resend;

async function sendEmail(message) {
  if (process.env.EMAIL_DELIVERY === "console") {
    if (process.env.NODE_ENV !== "development") {
      throw new Error("Console email delivery is only available in development.");
    }

    console.info(JSON.stringify({
      event: "development_email",
      to: message.to,
      subject: message.subject,
      text: message.text,
    }));
    return { data: { id: "development-console-email" } };
  }

  resend ??= new Resend(process.env.RESEND_API_KEY);
  return resend.emails.send(message);
}
```

This is a simplified excerpt; import your provider and add its required sender
and other fields in the actual service. `??=` initializes the provider client
only if it has not already been initialized. The console branch returns before
initializing or contacting the provider. It does not send mail and then log it.

The account and verification token are still real records in the development
database. Open the link printed in the API terminal to test verification. These
development links contain tokens, so keep the terminal output private.

Choose the frontend origin before constructing links:

```js
export const FRONTEND_BASE_URL =
  process.env.FRONTEND_BASE_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://example.com"
    : "http://localhost:5173");

const verificationUrl = `${FRONTEND_BASE_URL}/verify-email/${rawToken}`;
```

An explicitly configured URL wins; the other values are fallbacks. Set a
different frontend URL for each environment. The environment label alone does
not substitute the correct URL for you.

## 10. Proxy browser requests through the frontend development server

In the frontend API configuration:

```ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "";
```

The empty origin makes an avatar path such as `/uploads/avatars/example.webp`
relative to the page's origin. An explicitly set Vite environment variable can
override these defaults; check that no local override points to production.

Add these server settings alongside your existing plugins in `vite.config.ts`:

```ts
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

The browser requests `http://localhost:5173/api/v1/...`. Vite forwards the request
on the server to the development API. That second request is server-to-server,
so the browser sees one origin. The proxy does not remove the API's own access
controls or CORS middleware; retain an appropriate development origin allowlist.

Bind both development servers to loopback. In VS Code Remote SSH, forward port
5173 and open `http://localhost:5173` on the laptop. Only that port needs
forwarding because Vite can reach the API on the same machine. `strictPort`
prevents Vite from silently switching to another port if 5173 is occupied.
Use the same hostname in verification links and the browser because cookies
are scoped to hosts. Nginx performs equivalent path routing after deployment;
Vite's development server does not serve the production site.

## 11. Verify isolation and the user flow

Check the behavior that could cause mistakes, not only whether the page loads:

- The development loader rejects a production database, upload directory, or port.
- An inherited production database URL is overridden by validated development settings.
- Missing development configuration stops startup instead of falling back to production.
- The development role has no unintended production privileges.
- Registration, verification, login, and cookie refresh work through the proxy.
- No real email provider is contacted in console delivery mode.
- Frontend compilation and the existing backend tests pass.
- Production processes remain online and use their existing configuration.

## 12. What was actually completed for PunDad

| Item | Implemented value |
| --- | --- |
| API worktree | `/home/pi/projects/backend/pundad-api-dev` |
| Frontend worktree | `/home/pi/projects/frontend/pundad-app-dev` |
| Branch in each repository | `chore/development-workflow` |
| Development database | `pundad_dev` |
| Development role | `pundad_dev` |
| API bind address | `127.0.0.1:4001` |
| Vite bind address | `127.0.0.1:5173` |
| Browser/verification origin | `http://localhost:5173` |
| Private backend configuration | `.env.development`, ignored by Git, permission mode 600 |
| Development uploads | `uploads/` inside the API worktree |
| Email delivery | Console output, no real messages sent |
| Database initialization | All 23 existing migrations, then 55 moderation terms |
| Checks at completion of step 1 | 18 backend tests, frontend build, and an HTTP registration/verification/login/refresh check passed |

No production data was copied. The original production backend checkout, its
`.env`, production database, PM2 processes, Nginx config, and deployed frontend
were left in place. Source changes in the new worktrees had not been committed
or pushed when this guide was written.

The table and paragraphs above record completion of the first milestone, not
the present rollout status. Since then, the baseline development/CI changes
were committed, published, and merged; CI and branch protection were enabled;
and the same `-dev` worktrees moved to `chore/staging-runtime` for the now-live
public staging system. No additional editable development directories were
created for staging. Staging runs installed releases under `/srv/pundad/staging`.

Shadow-database setup, automatic PR deployment, and production releases/rollback
are still pending. See [the staging runbook](staging.md) for the implemented
stages, exact commands and verification results, and what remains to automate.

## References

- [Git worktree documentation](https://git-scm.com/docs/git-worktree)
- [Node.js 24 startup options, including --import](https://nodejs.org/docs/latest-v24.x/api/cli.html#--importmodule)
- [dotenv configuration and override behavior](https://github.com/motdotla/dotenv#config)
- [PostgreSQL 17 psql](https://www.postgresql.org/docs/17/app-psql.html)
- [PostgreSQL 17 roles](https://www.postgresql.org/docs/17/database-roles.html)
- [Vite environment variables and modes](https://vite.dev/guide/env-and-mode.html)
- [Vite development proxy](https://vite.dev/config/server-options.html#server-proxy)
- [Prisma migration workflows](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production)
