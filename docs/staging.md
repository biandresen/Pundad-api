# Public staging on the Raspberry Pi

Staging is the production-like test site at **https://staging.pundad.app**.
It uses test data and captures email privately instead of sending real mail.
Production continues using its existing runtime and database.

## Architecture

```text
Browser -> HTTPS at Cloudflare -> dedicated staging tunnel
  -> Nginx staging virtual host
     -> /                 static CI frontend artifact
     -> /api/             staging API on 127.0.0.1:4002
     -> /uploads/         staging upload directory

systemd pundad-staging.service
  -> PM2 runtime (separate home and Unix identity)
     -> pundad-staging-api
     -> pundad-staging-worker
        -> PostgreSQL pundad_staging
```

PM2 manages the two Node processes. systemd starts PM2 on boot and applies
filesystem and resource restrictions to PM2 and every child it starts.
The separate tunnel avoids restarting or editing production's tunnel.

## Environment separation

| Resource | Staging value |
| --- | --- |
| Linux service identity | `pundad-staging`, no interactive login |
| Database and database login | `pundad_staging` |
| Runtime credentials | `/etc/pundad/staging/api.env`, root/staging group only |
| Release directories | `/srv/pundad/staging/releases/<release>/` |
| Active API/frontend pair | `/srv/pundad/staging/current` symlink |
| Previous successful application release | `/srv/pundad/staging/previous` symlink after a subsequent deployment |
| Uploaded files | `/srv/pundad/staging/uploads/` |
| Captured email | `/var/lib/pundad-staging/mail/`, private files with mode 600 |
| PM2 state | `/var/lib/pundad-staging/pm2/` |
| Tunnel process identity | `cloudflared-staging`, separate from the API identity |
| Tunnel configuration | `/etc/cloudflared/pundad-staging.yml` |

`NODE_ENV=production` enables production behavior, including secure cookies.
`APP_ENV=staging` identifies the deployment environment. They answer different
questions: optimized runtime behavior versus which deployment this is.

`src/config/stagingEnvironment.js` is preloaded before either application
process starts. It verifies the staging database/login, loopback port, frontend
origin, uploads, email capture path, and independent JWT secrets. A production
mail-provider key is rejected. Staging's CORS allowlist contains only its own
frontend origin.

The API and worker share staging data, but have no production database grants.
The service's `ProtectHome=true` hides `/home`, including the production
checkout, its `.env`, GitHub credentials, and the production PM2 socket. The
system filesystem and application release are read-only inside the service.
Only staging state and uploads are writable. Memory/CPU limits apply to the
whole API/worker group. This reduces interference but does not make a shared
physical machine equivalent to an isolated VM; deploy only trusted PR code.

The worker runs staging computations at startup and on its schedule. It uses
only the staging database. Production's worker remains a different process.

## First installation

Review the scripts under `ops/staging/` before running administrative commands.
Provisioning creates accounts, the database/login, private secrets, a copied
Node 24.12.0 and PM2 runtime, directories, and service definitions. It does not
start the services or copy production records.

```bash
sudo python3 ops/staging/provision.py
```

Secrets are generated on the Pi and never included in Git. Rerunning provision
preserves the existing environment file and database credentials. If a database
exists without its expected private environment file, provisioning stops rather
than replacing credentials.

The tunnel is created once using the operator's existing Cloudflare account
certificate. Its new tunnel-specific credentials are copied into a directory
readable only by root and the tunnel account. The tunnel process cannot read
the operator's account certificate or production tunnel credentials.

After local HTTP readiness is verified, the DNS route for staging.pundad.app
is pointed to the new tunnel. Its configuration contains only that hostname
and a catch-all 404. No existing DNS record should be overwritten silently.

## Manual deployment of an explicitly reviewed revision

This milestone provides an operator-run deployer. Automatic PR deployment is
the next milestone; the presence of this script does not itself create an
automatic deployment trigger.

1. Run CI on the desired backend and frontend branches.
2. Verify the exact commit IDs and successful run results.
3. Archive that backend commit with `git archive`.
4. Download the successful frontend run's `frontend-<commit>` artifact.
5. Run the fixed staging deployer with those inputs and their full commit IDs:

```bash
sudo python3 ops/staging/deploy.py \
  --api-archive /path/to/reviewed-api.tar \
  --frontend-dir /path/to/unpacked-ci-dist \
  --api-sha <40-character-api-commit> \
  --frontend-sha <40-character-frontend-build-commit>
```

The placeholders above describe inputs; replace them before executing.
PR frontend artifacts are built from GitHub's test merge commit, so record
the artifact's actual build commit rather than assuming it equals the branch
head. `/__version.json` exposes the deployed revisions without secrets.

The deployer serializes operations with a host lock. It extracts sources into
a new build directory, installs dependencies and generates Prisma Client on
the Pi's ARM architecture, applies staging migrations, and seeds moderation
terms. Build commands run as the restricted staging identity in a systemd
sandbox, not as root or as the production owner. Root only manages files and
service activation.

Code is frozen into a root-owned release directory. A single atomic symlink
switch activates the complete API/frontend pair, then staging restarts.
The deployer waits for `/api/v1/auth/ready`, enables the staging Nginx site after
`nginx -t`, and reloads Nginx gracefully. A failed application startup restores
the preceding application release when one exists. Application rollback does
not undo database migrations: schema changes must remain compatible with the
previous release. On the first deployment there is no preceding release.

Uploaded files, captured mail, credentials, and database records are outside
the release directories and survive deployment. Old releases are retained
for inspection and rollback; a retention policy will be added with automation.

## Check and inspect staging

```bash
curl -fsS https://staging.pundad.app/api/v1/auth/ready
curl -fsS https://staging.pundad.app/__version.json
sudo systemctl status pundad-staging.service cloudflared-staging.service
sudo journalctl -u pundad-staging.service --since '10 minutes ago'
```

`/api/v1/auth/health` is liveness: the HTTP process responds. `/ready` checks
database connectivity and returns 503 without private diagnostic details when
the dependency is unavailable. Deployment uses readiness, not merely a 200
HTML response from the SPA fallback.

Your ordinary `pm2 list` belongs to the production user's PM2 home. It does not
list staging's processes. Use the staging systemd service and its journal to
inspect the managed staging API and worker.

Staging has a visible test-site banner, `X-Robots-Tag: noindex` headers, and a
robots.txt disallowing crawling. Those settings are indexing requests, not
access controls: the staging site is public as requested.

## Test registration and email verification

Register a test account on the staging site. The email is stored privately on
the Pi, with a real staging verification link. List recent messages:

```bash
sudo ls -lt /var/lib/pundad-staging/mail/
```

Read the selected message locally, for example with `sudo less` and its full
filename, then open the link on the laptop. These files contain verification
or password-reset tokens: keep them out of chat, Git, and web-served directories.
Public testers do not automatically receive these captured messages.

Login/refresh cookies are secure, HTTP-only, and host-scoped to staging.
Production cookies and staging JWT secrets are independent. Test records and
uploads may later be reset without touching production.

## Source control and future automation

The previous development/CI PRs were merged to establish protected main.
Staging code is developed on `chore/staging-runtime` in both existing `-dev`
worktrees. The original production checkout is not pulled or restarted.

The next step is a narrowly scoped deployment trigger that selects trusted
successful PR revisions and invokes the already-reviewed host deployer.
It must not run privileged scripts supplied by arbitrary PR code or expose
production credentials to a runner. Production release directories, backups,
readiness verification, and post-merge deployment remain a later milestone.
