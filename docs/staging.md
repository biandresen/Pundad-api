# Development, CI, and public staging: setup and operations

This is the runbook for the setup completed on **17 October 2026**. It explains
what runs where, how to reproduce staging on another suitable machine, how to
deploy a reviewed revision, and how to investigate failures.

**Staging is live at https://staging.pundad.app.** It has its own database and
captures email privately. Deployment is currently an operator-run command.
GitHub Actions runs checks and saves frontend builds; it does not deploy yet.
Production still uses its original PM2 processes and frontend directory.

The commands below run in an SSH terminal **on the Pi**, unless marked as
browser/dashboard actions. Installation and deployment commands change host
state; inspection commands only read it. Example placeholders such as
`YOUR_API_COMMIT` must be replaced before running a block. Do not rerun first
installation just to inspect the working system.

## 1. How the guides fit together

- [development.md](development.md): everyday editing, startup, and laptop preview.
- [continuous-integration.md](continuous-integration.md): CI jobs and main-branch protection.
- This document: the complete staging installation and release procedure.
- The backend also contains `docs/isolated-development-guide.md`: the reusable
  explanation of worktrees, database roles, environment loaders, and development
  setup, including code examples.

The backend owns the implementation under `ops/staging/`. The frontend carries
an identical copy of this runbook so it is available from either workspace.

Quick navigation: [architecture and environments](#3-environments-and-directories),
[provisioning](#6-provision-staging-once),
[tunnel setup](#8-create-and-configure-the-dedicated-tunnel),
[CI artifacts](#9-select-verified-source-and-the-actual-frontend-artifact),
[deployment](#10-deploy-manually-from-reviewed-inputs),
[DNS and HTTPS](#12-publish-dns-and-verify-public-https),
[rollback](#15-rollback-recovery-and-retained-state),
[troubleshooting](#16-troubleshooting-by-layer), and
[remaining work](#18-completed-versus-still-planned).

## 2. What the independent parts do

| Part | Responsibility |
| --- | --- |
| Git branch | Names a line of committed changes; it does not deploy code |
| Git worktree | Separate editable files and branch checkout sharing the repository's history |
| GitHub Actions / CI | Checks a commit on a clean runner and saves the built frontend |
| Artifact | Saved build output; here, the files that would normally be in `dist/` |
| Release directory | Installed API plus frontend for one selected pair of commits |
| `current` symlink | Selects which release the API and Nginx serve |
| PM2 | Runs and restarts the staging API and background worker |
| systemd | Starts PM2 at boot, manages the service account, and restricts resources/access |
| Nginx | Serves static files and forwards API paths to the correct local Node process |
| Cloudflare Tunnel | Connects the public hostname to local Nginx through an outbound connection |
| PostgreSQL database | Holds one environment's tables and records |
| PostgreSQL login/role | Identity and privileges used to access that database |

Staging's PM2 runs in the foreground through `pm2-runtime` under systemd.
This keeps PM2's process supervision while letting systemd supervise the entire
process group. It is separate from production's existing PM2 daemon.

## 3. Environments and directories

| Setting | Development | Staging | Production today |
| --- | --- | --- | --- |
| Browser URL | `http://localhost:5173`, SSH-forwarded | `https://staging.pundad.app` | `https://pundad.app` |
| API address on Pi | `127.0.0.1:4001` | `127.0.0.1:4002` | `127.0.0.1:4000` |
| Database | `pundad_dev` | `pundad_staging` | `jokedb` |
| Database login | `pundad_dev` | `pundad_staging` | Existing production login |
| API files | Backend `-dev` worktree | `/srv/pundad/staging/current/api` | Original backend checkout |
| Frontend files | Frontend `-dev` worktree, served by Vite | `/srv/pundad/staging/current/frontend` | `/var/www/pundad-frontend` |
| Uploads | Backend `-dev` worktree's `uploads/` | `/srv/pundad/staging/uploads` | `/var/www/pundad-uploads` |
| Email | Printed in API terminal | Private JSON message files | Existing real delivery |
| Secrets/config | Ignored `.env.development` | `/etc/pundad/staging/api.env` | Existing production configuration |
| Process startup | `npm run dev`; optional dev worker | `pundad-staging.service` | Existing production PM2 setup |

The two editable worktrees are:

```text
/home/pi/projects/backend/pundad-api-dev
/home/pi/projects/frontend/pundad-app-dev
```

The original checkouts remain at the corresponding paths without `-dev`.
Worktrees were created with Git, rather than by copying production folders.
Each has its own working files, dependencies, and ignored local configuration.
They share Git history and remotes with their original repository.

The initial `chore/development-workflow` changes were merged into GitHub's
protected `main`. The same `-dev` directories now check out
`chore/staging-runtime`; no third development checkout was created. A local
checkout does not automatically follow GitHub's `main` after a merge. The
original production checkout was not pulled or restarted as part of this work.

There is one staging database and one staging database login that happen to
share a name. They are different kinds of object, not two databases. Neither
development nor staging was populated with production users or other records.
Their schemas came from committed migrations, then the moderation-term seed.

## 4. Request paths, HTTPS, and laptop development

```text
Laptop browser
  -> HTTPS staging.pundad.app at Cloudflare
  -> dedicated staging tunnel, initiated from the Pi
  -> http://127.0.0.1:80, with Host: staging.pundad.app
  -> Nginx selects the staging virtual host
       /             -> current/frontend/index.html and assets
       /api/...      -> http://127.0.0.1:4002/api/...
       /uploads/...  -> /srv/pundad/staging/uploads/...

systemd pundad-staging.service
  -> separate PM2 runtime
       pundad-staging-api    -> PostgreSQL pundad_staging
       pundad-staging-worker -> PostgreSQL pundad_staging
```

The browser sees one HTTPS origin. Relative frontend URLs such as `/api/v1`
and `/uploads/avatars/...` reach the matching environment through Nginx. The
same frontend artifact can be served from staging or production without
embedding a backend hostname. `VITE_*` settings are public build-time settings;
they must never contain secrets. The staging banner is selected by the browser
hostname `staging.pundad.app`.

Cloudflare provides the public TLS endpoint. On this Pi, its tunnel reaches
Nginx over loopback HTTP; no additional Nginx certificate or router port-forward
was installed for staging. The tunnel has only the staging hostname and a
catch-all 404. Production uses its existing separate tunnel.

During development, Vite does equivalent routing on port 5173 to API port 4001.
Start the API and frontend with `npm run dev` in separate `-dev` terminals.
In VS Code Remote SSH, open the Ports panel and forward **5173**, then browse
to `http://localhost:5173` on the laptop. Only that port needs forwarding.
Alternatively, run this on the **laptop**, using the actual Pi SSH address:

```bash
ssh -N -L 5173:127.0.0.1:5173 pi@YOUR_PI_SSH_ADDRESS
```

## 5. Reproduction prerequisites

The installer is specific to this Linux/systemd deployment. The observed host
is Debian 13.2 on ARM64 (`aarch64`), with Python 3.13.5, PostgreSQL 17.6, Nginx
1.26.3, cloudflared 2025.11.1, Node 24.12.0, and PM2 6.0.14. These are the
versions used, not a claim that every version is required or current.

Before using the scripts on a fresh server, prepare:

1. A Linux host with systemd, Nginx (`www-data` group), PostgreSQL, Python with
   `tarfile` extraction-filter support, Git, curl, and GitHub CLI. The provisioner
   does not install these operating-system packages or configure PostgreSQL's
   authentication rules. The example assumes working local peer administration
   as Unix user `postgres` and password-authenticated TCP connections on 5432.
2. The reviewed backend staging source and committed lockfiles. At the time of
   writing it is in [backend PR #2](https://github.com/biandresen/Pundad-api/pull/2),
   with the matching frontend banner in
   [frontend PR #188](https://github.com/biandresen/Pundad-app/pull/188).
   Do not assume these files are on `main` before those PRs merge.
3. Node **24.12.0** and PM2 **6.0.14** at the provisioner's expected source path:
   `/home/pi/.nvm/versions/node/v24.12.0`. With nvm already installed, the
   preparation is `nvm install 24.12.0`, `nvm use 24.12.0`, then
   `npm install --global pm2@6.0.14`. Adapt the script deliberately for another
   home directory or runtime installation; do not substitute paths blindly.
4. `cloudflared` installed at `/usr/local/bin/cloudflared`, plus a Cloudflare
   account that owns the domain and can create a locally managed tunnel. The
   service uses tunnel-specific credentials, not a dashboard-managed run token.
5. Operator `sudo` access for provisioning/deployment, and GitHub CLI access to
   read the repositories and download their Actions artifacts. GitHub runner
   credentials and production secrets are not prerequisites for a staging PR.

To authenticate GitHub CLI from your own terminal:

```bash
gh auth login --hostname github.com --git-protocol https --web --scopes workflow
gh auth setup-git
gh auth status
```

`workflow` scope was needed to publish workflow files. Artifact download needs
repository/Actions read access. Keep credentials in CLI storage, outside Git.

## 6. Provision staging once

From the **backend development checkout containing the reviewed staging code**:

```bash
cd /home/pi/projects/backend/pundad-api-dev
git status --short
less ops/staging/provision.py
less ops/staging/deploy.py
sudo python3 ops/staging/provision.py
```

The provisioner creates these host resources:

| Resource | Ownership/purpose |
| --- | --- |
| Unix `pundad-staging` | API/worker account; no interactive login |
| Unix `pundad-staging-build` | Separate account for dependency installation and migrations |
| Unix `cloudflared-staging` | Separate tunnel account; no access to API credentials |
| PostgreSQL role/database `pundad_staging` | Restricted login owns only the staging database |
| `/etc/pundad/staging/api.env` | Root/staging group, mode 640; generated private credentials |
| `/etc/pundad/staging/ecosystem.config.cjs` | Installed PM2 application definition |
| `/opt/pundad/node-v24.12.0` and `/opt/pundad/pm2` | Copied, root-owned runtime available with `/home` hidden |
| `/usr/local/lib/pundad-staging/deploy.py` | Fixed, reviewed, root-owned deployer |
| `/srv/pundad/staging/releases/` | Root-owned application release directories |
| `/srv/pundad/staging/uploads/` | Staging owner, `www-data` group, mode 2770 |
| `/var/lib/pundad-staging/` | Private runtime state, captured mail, PM2 state |
| `/var/lib/pundad-staging-build/` | Private build workspace and npm cache |
| `/etc/systemd/system/pundad-staging.service` | API/worker service definition |
| `/etc/systemd/system/cloudflared-staging.service` | Dedicated tunnel service definition |
| `/etc/nginx/sites-available/staging.pundad.app` | Staging virtual host, initially not enabled |

The role is `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`,
with no production-role membership or production table grants. Public access
to the new staging database is revoked. Passwords are generated privately;
the role is created with a SCRAM verifier rather than a plaintext password in
the administrative SQL. JWT secrets are generated independently of production.

The script calls `systemctl daemon-reload`, but **does not start services**.
It also does not create the Cloudflare tunnel or its credential/config files;
that is the next step. On rerun, it preserves the existing environment file
and database credentials, but reinstalls the reviewed host definitions/deployer.
If a database/login exists without its expected env file, it stops rather than
replacing credentials. It is not a general repair or secret-rotation tool.

Application files added for staging include:

| Source | What changed |
| --- | --- |
| `src/config/stagingEnvironment.js` | Preloaded staging configuration validation |
| `src/services/emailService.js` | Private staging email capture; development console/production delivery retained |
| `src/constants.js` | Environment-configured CORS allowlist |
| `src/services/authService.js`, controller/router | Database-backed `/api/v1/auth/ready` endpoint |
| `src/config/logger.js` | Environment label can use `APP_ENV` |
| `ops/staging/` | Provisioner, deployer, PM2/systemd/Nginx definitions |
| Frontend `src/routes/layouts/Layout.tsx` | Visible staging test-site banner |

## 7. Configuration loading and isolation

The private `api.env` contains ordinary `KEY=value` assignments. systemd reads
it using `EnvironmentFile=` and passes those values into PM2 and its children.
The filename itself has no special loading behavior. This is different from
development's explicit `.env.development` reader.

Important generated settings, with secrets omitted:

```dotenv
APP_ENV=staging
NODE_ENV=production
HOST=127.0.0.1
PORT=4002
DATABASE_URL=postgresql://pundad_staging:REPLACE_PASSWORD@127.0.0.1:5432/pundad_staging?schema=public&connect_timeout=5&pool_timeout=5
FRONTEND_BASE_URL=https://staging.pundad.app
CORS_ORIGINS=https://staging.pundad.app
UPLOADS_DIR=/srv/pundad/staging/uploads
EMAIL_DELIVERY=capture
EMAIL_CAPTURE_DIR=/var/lib/pundad-staging/mail
JWT_ACCESS_SECRET=REPLACE_WITH_INDEPENDENT_SECRET
JWT_REFRESH_SECRET=REPLACE_WITH_ANOTHER_INDEPENDENT_SECRET
LOG_LEVEL=info
```

This is explanatory, not a replacement file to install. Do not add a real mail
provider key. The provisioner already generated the actual values on the Pi.

`NODE_ENV=production` selects production runtime behavior, including secure
cookies. `APP_ENV=staging` identifies the deployment. PM2 starts both scripts
with `node --import ./src/config/stagingEnvironment.js ...`, so the validator
runs before application imports create clients. It checks database/login,
loopback host/port, frontend URL, CORS, uploads, mail capture, and secret length.
It rejects a nonempty `RESEND_API_KEY`. It does not prove that secrets differ
from production by comparing them; separation comes from independent generation
and the runtime's inability to read production configuration.

The dev loader instead parses `.env.development`, validates it, then uses
`Object.assign(process.env, config)` to override matching inherited shell
variables. Neither loader changes another process's environment. Staging's
system service receives its settings from its own file, not the operator's shell.
Restart a service after changing its environment file; editing it does not
modify an already running process. Unit-file changes also need
`sudo systemctl daemon-reload`.

`ProtectHome=true` hides `/home`, including production `.env`, GitHub CLI
credentials, and the production user's PM2 socket. `ProtectSystem=strict`
makes the main filesystem read-only inside the service. Staging can write only
its runtime state and uploads; its installed code is root-owned. Uploads inherit
the `www-data` group through the directory's setgid bit, while service umask
0007 prevents world access. Captured emails explicitly use mode 600.

API and worker together have a 768 MiB memory limit and CPU quota of 50% of one
CPU. The separate build service has a 1 GiB limit, 75% CPU quota, and 900-second
runtime limit. The tunnel has a 256 MiB limit and 25% CPU quota. These reduce
interference; a shared Pi still shares disk, kernel, PostgreSQL, and outages.
Only trusted code should be deployed here. CORS and noindex headers are not
authentication or a sandbox.

## 8. Create and configure the dedicated tunnel

Do this once, after provisioning. It does not edit production's
`/etc/cloudflared/config.yml` or restart its tunnel.

If the operator lacks an account certificate, run `cloudflared tunnel login`
and authorize the intended account/domain in the laptop browser. Our existing
certificate was `/home/pi/.cloudflared/cert.pem`. That certificate permits account
management operations and is more powerful than one tunnel's credential file.
Keep it in the operator's private home directory.

```bash
/usr/local/bin/cloudflared tunnel --origincert /home/pi/.cloudflared/cert.pem list
/usr/local/bin/cloudflared tunnel --origincert /home/pi/.cloudflared/cert.pem create pundad-staging
```

Record the new tunnel UUID reported by `create`. It also reports the generated
`~/.cloudflared/<UUID>.json` credential path. If a tunnel with that name already
exists, inspect/reuse it with its matching credentials instead of creating another.
For this Pi, the UUID is `4ac15581-a307-4b70-8b41-5eeb1c929c0f`.
**Generate a new tunnel ID when reproducing this on another installation.**

In the commands below, set the ID to the tunnel you just created:

```bash
stage_tunnel_id=YOUR_NEW_TUNNEL_UUID
sudo install -d -o root -g cloudflared-staging -m 750 /etc/cloudflared/pundad-staging
sudo install -o root -g cloudflared-staging -m 640 \
  "/home/pi/.cloudflared/${stage_tunnel_id}.json" \
  "/etc/cloudflared/pundad-staging/${stage_tunnel_id}.json"
sudoedit /etc/cloudflared/pundad-staging.yml
```

Write the following, substituting the UUID in both places:

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

The explicit Host header makes Nginx choose the staging virtual host. The
configuration contains paths and a tunnel ID, not the credential contents.
Protect the credential file as above; the account certificate is not copied.

```bash
sudo chown root:root /etc/cloudflared/pundad-staging.yml
sudo chmod 644 /etc/cloudflared/pundad-staging.yml
sudo -u cloudflared-staging /usr/local/bin/cloudflared \
  --config /etc/cloudflared/pundad-staging.yml tunnel ingress validate
sudo systemd-analyze verify \
  /etc/systemd/system/pundad-staging.service \
  /etc/systemd/system/cloudflared-staging.service
```

Make the first local deployment below before publishing DNS. Once local checks
pass, start the dedicated tunnel:

```bash
sudo systemctl enable --now cloudflared-staging.service
sudo systemctl status cloudflared-staging.service
```

## 9. Select verified source and the actual frontend artifact

CI runs on PRs targeting `main`, pushes to `main`, and manual workflow runs.
It runs on GitHub-hosted Ubuntu, with read-only repository permissions and no
production secrets. Backend CI has **API checks** and **Database migrations**;
frontend CI has **Frontend checks**. Migration CI uses its own disposable
PostgreSQL 17 database on the runner. Frontend artifacts expire after seven days.

Both repositories protect `main`: PR required, required checks, up-to-date
branches, resolved conversations, administrator enforcement, no force pushes
or branch deletion. Required approving reviews are zero for the solo owner;
you cannot approve your own PR. The full policy is in the CI guide.

Use GitHub's Actions/PR pages to choose a successful run for the exact change
you reviewed. Do not blindly deploy the latest run for a moving branch.
Inspect the run's commit, event, results, and frontend artifact name:

```bash
gh pr checks 2 --repo biandresen/Pundad-api
gh pr checks 188 --repo biandresen/Pundad-app
gh run list --repo biandresen/Pundad-api --branch chore/staging-runtime --limit 5
gh run list --repo biandresen/Pundad-app --branch chore/staging-runtime --limit 5

stage_api_run=YOUR_SUCCESSFUL_API_RUN_ID
stage_frontend_run=YOUR_SUCCESSFUL_FRONTEND_RUN_ID
gh run view "$stage_api_run" --repo biandresen/Pundad-api \
  --json headSha,event,conclusion,url,jobs
gh run view "$stage_frontend_run" --repo biandresen/Pundad-app \
  --json headSha,event,conclusion,url,jobs
gh api "repos/biandresen/Pundad-app/actions/runs/${stage_frontend_run}/artifacts" \
  --jq '.artifacts[] | {name,expired,id}'
```

Replace PR numbers and branch names for later changes. Confirm all required
jobs succeeded and the artifact is not expired. The artifact name is
`frontend-<full-build-sha>`, because the workflow names it with `github.sha`.
On a PR, that SHA is normally GitHub's temporary **test merge commit**, which
can differ from the PR head SHA in run metadata. Record the SHA from the exact
artifact you download, not a guessed branch SHA.

The first successful deployment used these records (historical, not an
instruction to always redeploy these old runs):

| Item | Recorded value |
| --- | --- |
| API CI run | `39043659394` |
| API source commit | `7bf30e0cbe57a31699a4e03c9fa5c24062d5495a` |
| Frontend CI run | `39043662506` |
| Frontend PR head | `ec22430d69caee5f121bf18493f98016599fcb01` |
| Frontend artifact build commit | `28c85b7463f76b9fe992d0d22c34ffbb889997ef` |
| Release | `20261017T150922Z-7bf30e0c-28c85b74` |

Those artifacts will expire. For later reproduction, obtain a fresh successful
run and record its artifact/build SHA. Subsequent documentation-only commits do
not change the application that is already running; version metadata continues
to identify the deployed application inputs.

## 10. Deploy manually from reviewed inputs

These commands are the operator deployment path today. They are not executed
by GitHub Actions. Set these values from the checks above:

```bash
stage_api_sha=YOUR_REVIEWED_40_CHARACTER_API_COMMIT
stage_frontend_sha=YOUR_ARTIFACT_40_CHARACTER_BUILD_COMMIT
stage_artifact_name="frontend-${stage_frontend_sha}"
stage_workspace=$(mktemp -d /tmp/pundad-stage-release.XXXXXX)

git -C /home/pi/projects/backend/pundad-api-dev fetch origin
git -C /home/pi/projects/backend/pundad-api-dev show --no-patch --oneline "$stage_api_sha"
git -C /home/pi/projects/backend/pundad-api-dev archive \
  --format=tar --output="$stage_workspace/api.tar" "$stage_api_sha"

gh run download "$stage_frontend_run" --repo biandresen/Pundad-app \
  --name "$stage_artifact_name" --dir "$stage_workspace/frontend"
test -f "$stage_workspace/frontend/index.html"

sudo python3 /usr/local/lib/pundad-staging/deploy.py \
  --api-archive "$stage_workspace/api.tar" \
  --frontend-dir "$stage_workspace/frontend" \
  --api-sha "$stage_api_sha" \
  --frontend-sha "$stage_frontend_sha"
```

Use the installed, reviewed deployer under `/usr/local/lib/`, not `sudo` on a
script supplied by an arbitrary PR. The deployer validates input structure and
SHA format; it does **not** independently prove successful CI, verify that an
archive matches the supplied SHA, or authenticate an artifact's provenance.
The operator must verify/select matching inputs. Automated deployment will need
to make those checks mandatory.

Deployment does the following:

1. Takes `/run/pundad-staging-deploy.lock` so only one deployer changes staging.
2. Creates a new candidate directory. It rejects source symlinks and private
   `.env`/`.env.development` files, uses filtered tar extraction, and accepts
   only ordinary frontend files/directories. Archives must still be reviewed.
3. Runs `npm ci`, Prisma Client generation, `prisma migrate deploy`, and the
   moderation seed in a transient restricted systemd build service. Prisma
   commands preload the staging validator. Native dependencies are installed
   on the Pi's ARM platform, rather than copied from an x86 GitHub runner.
4. Writes frontend `__version.json`, then freezes the candidate as root-owned
   files under `/srv/pundad/staging/releases/<release>/`.
5. Atomically changes `current` to the complete API/frontend pair and restarts
   `pundad-staging.service`. This can cause a brief staging interruption; it is
   not a zero-downtime or blue/green deployment.
6. Waits for the database-backed readiness endpoint. On activation/startup
   failure it switches back to the preceding application release, if one exists.
7. Enables the Nginx staging site, runs `nginx -t`, reloads Nginx gracefully,
   and enables the staging application service at boot.
8. On success, records the formerly active release in `previous` when there was
   one. There is no `previous` link after a first-ever successful deployment.

The builder is separate from the running application so that runtime code
cannot alter the new build while root freezes it. The build sees staging
credentials for migrations, never production credentials. Its work directories
are writable only within the build sandbox.

Uploads, captured email, credentials, and database data live outside releases
and survive a code deployment. Database migrations happen **before activation**;
application rollback does not undo them. Use backward-compatible schema changes
and reviewed data changes. A successful API readiness check does not prove that
the background worker has completed its work; inspect its logs as well.

Dependency note: the currently verified `npm ci` runs with `NODE_ENV=production`,
so npm's production omission rules apply. With the committed lockfile, the
Prisma CLI is installed and all migration steps succeeded. If dependency changes
remove it from that install, fix the reviewed build dependency strategy before
deployment; do not work around it with an unpinned privileged package install.

## 11. Verify locally before publishing DNS

```bash
curl -fsS http://127.0.0.1:4002/api/v1/auth/ready
curl -fsS -H 'Host: staging.pundad.app' http://127.0.0.1/api/v1/auth/ready
curl -fsS -H 'Host: staging.pundad.app' http://127.0.0.1/__version.json
curl -fsSI -H 'Host: staging.pundad.app' http://127.0.0.1/
sudo nginx -t
sudo systemctl status pundad-staging.service
```

The Host header matters: Nginx routes by hostname. A plain request to
`http://127.0.0.1/` can hit a different/default site. The frontend should have
`Cache-Control: no-cache` and `X-Robots-Tag: noindex, nofollow, nosnippet`.
`__version.json` should say `environment: staging` and use `Cache-Control: no-store`.
`/assets/` uses hashed filenames with seven-day caching. Missing assets return
404; frontend navigation paths fall back to `index.html` for the React router.
`sw.js` is served without long-lived caching so service-worker updates can be
checked. Cached browser/PWA state is separate for staging's hostname.

`/api/v1/auth/health` is **liveness**: the API responds. `/ready` is **readiness**:
the API can execute a database query. It returns 503 with a generic message if
the dependency is unavailable. A 200 SPA HTML fallback is not an API health check.

## 12. Publish DNS and verify public HTTPS

In the **Cloudflare dashboard**, select the `pundad.app` zone and add:

| DNS field | This installation |
| --- | --- |
| Type | CNAME |
| Name | `staging` |
| Target | `4ac15581-a307-4b70-8b41-5eeb1c929c0f.cfargotunnel.com` |
| Proxy status | Proxied / orange cloud |
| TTL | Auto |

On another installation, use **your newly created tunnel's UUID** in the target.
The tunnel must belong to the same Cloudflare account as the domain. The UUID
and CNAME target are not secrets; the credential JSON and account certificate are.

The Pi's existing account certificate could create/list tunnels in the correct
account, but was DNS-authorized for **bloggy-app.dev**, not **pundad.app**.
`cloudflared tunnel route dns ... staging.pundad.app` therefore created
`staging.pundad.app.bloggy-app.dev`. We removed that unintended record, then
added the correct record through the `pundad.app` dashboard. Production records
were preserved. Check the actual resulting hostname, not just a successful CLI
message. Do not use `--overwrite-dns` to bypass an unexplained existing record.

Once DNS resolves and the tunnel is connected:

```bash
curl -fsSI https://staging.pundad.app/
curl -fsS https://staging.pundad.app/api/v1/auth/ready
curl -fsS https://staging.pundad.app/__version.json
curl -fsS https://staging.pundad.app/robots.txt
```

Confirm readiness returns JSON with `Service is ready`, version metadata matches
the intended inputs, frontend assets load, and robots.txt disallows crawling.
Open the site in the **laptop browser** and check the staging banner. A DNS CNAME
alone does not create the local service, Nginx host, or tunnel; every layer above
must be working. Noindex/robots settings request that search engines avoid
indexing; this site remains publicly accessible as requested.

## 13. Test registration, captured email, and cookies

1. Register a new test account on staging, using an address you can recognize
   such as `tester@example.test`. Use a unique username if it already exists.
2. Confirm login is rejected before email verification.
3. In the Pi terminal, list the private captured message files:

   ```bash
   sudo ls -lt /var/lib/pundad-staging/mail/
   ```

4. Open the chosen full filename with `sudo less /var/lib/pundad-staging/mail/FILE.json`.
   Match its `to` field to your test email. Its `text` field has the staging
   verification URL. Open that URL in the laptop browser within its validity
   period (currently 15 minutes). The JSON also contains subject, HTML, and time.
5. Log in. Check refresh after a page reload/session restoration and, when
   testing uploads, confirm the returned `/uploads/...` URL loads on staging.

Messages are captured instead of sent to the real provider. They contain real
staging verification/reset tokens and are written with mode 600, outside all
web-served directories. Keep them out of chat, Git, and public logs. Public
testers do not receive them automatically; the operator must retrieve a chosen
link. There is no public mailbox UI. Expired links require a new verification
message rather than a database edit.

Refresh cookies are `Secure`, `HttpOnly`, `SameSite=Lax`, host-scoped (no Domain
attribute), and use path `/api/v1/auth/refresh`. HTTPS and independent staging
JWT secrets keep the staging session separate from production. See the cookie
in browser developer tools; HttpOnly prevents reading it from page JavaScript.

Tests actually completed on this installation:

- CI: 29 backend tests, ESLint, fresh PostgreSQL migrations/schema comparison
  and moderation seed; frontend lint, five tests, TypeScript and Vite build.
  Three pre-existing frontend hook-dependency warnings remain informational.
- Live local Nginx checks, then the same HTTP account flow through **public
  HTTPS** after the correct DNS record was saved.
- Frontend/asset delivery and the banner string in the built JavaScript;
  release metadata, cache/noindex headers, database readiness.
- Registration, private mode-600 email capture, staging URL/token verification,
  rejection of unverified login, successful verified login, refresh, and cookie
  attributes. Generated accounts, associated token/event rows, and test messages
  were removed from the staging database/mail directory afterward.
- A file written by the staging Unix account could be served by Nginx from
  staging uploads; the temporary fixture was removed. This was a filesystem/
  routing check, not a full browser avatar-upload test.
- Startup fault injection: a temporary API archive deliberately exited at
  startup. Deployment failed its readiness check, restored the good release,
  and the restored API passed its database check. That test used a synthetic
  all-zero API revision label solely for the fault fixture, not as a real commit.
- The sandbox could not read production `.env` or reach its PM2 socket; the
  staging role had neither production user-table read access nor production-role
  membership. Production services and public health stayed operational.

The HTTP smoke script used for the initial check lived in `/tmp`, not the
repository. It is not a maintained browser test suite; the sequence above is the
reproducible manual acceptance test. Visual layout and browser interaction still
deserve an ordinary laptop browser check.

## 14. Everyday inspection and database access

```bash
sudo systemctl status pundad-staging.service cloudflared-staging.service
sudo systemctl is-enabled pundad-staging.service cloudflared-staging.service
sudo journalctl -u pundad-staging.service --since '10 minutes ago'
sudo journalctl -u cloudflared-staging.service --since '10 minutes ago'
readlink -f /srv/pundad/staging/current
ls -l /srv/pundad/staging/
curl -fsS https://staging.pundad.app/__version.json
```

The journal includes PM2/application output for both API and worker. An ordinary
`pm2 list` uses the production user's PM2 home and does not list this staging
runtime. Do not run `pm2 kill` or change the production daemon to manage staging.
Use the service instead:

```bash
sudo systemctl restart pundad-staging.service
```

Restart only when needed; it briefly interrupts staging and reruns worker
startup work. Inspect the worker's logs after deployment, since it performs
scheduled feature/badge computations even when no browser is open. Stop/start
the staging service when necessary with `systemctl stop` / `systemctl start`.

To inspect PostgreSQL locally as an administrator:

```bash
sudo -u postgres psql -d pundad_staging
```

Inside psql, run these separately:

```text
\conninfo
\l
\du
\dt
\d "User"
```

For a read-only inspection transaction:

```sql
BEGIN READ ONLY;
SELECT current_database(), current_user;
SELECT id, username, "emailVerified" FROM "User" ORDER BY id LIMIT 10;
ROLLBACK;
```

Use `\q` to exit. Double quotes preserve Prisma's capitalized table/column names.
The database role and the Unix service account are different identities. Local
administrator access above is not a check of the app role's privileges. To test
the real application login, use `psql -h 127.0.0.1 -U pundad_staging -d pundad_staging -W`
and enter its private password locally. Never paste the connection URL or
environment file into shared output. Do not run reset/drop/cleanup commands
against a database selected from an unverified shell environment.

## 15. Rollback, recovery, and retained state

The deployer automatically restores the previously active **application** if
activation/readiness fails and a previous release existed. Its command still
exits unsuccessfully, as it should. Inspect the journal and confirm the restored
release is ready. If a build/migration fails before activation, `current` is
unchanged, but migrations/data operations may already have made changes.

To roll back a later successful application release manually, first inspect
`current` and `previous`, confirm the target is compatible with the database,
then run this under the same lock used by deployment:

```bash
readlink -f /srv/pundad/staging/current
readlink -f /srv/pundad/staging/previous

sudo flock /run/pundad-staging-deploy.lock sh -eu -c '
  stage_target=$(readlink -e /srv/pundad/staging/previous)
  case "$stage_target" in /srv/pundad/staging/releases/*) ;; *) exit 1 ;; esac
  test -d "$stage_target/api"
  test -f "$stage_target/frontend/index.html"
  ln -s "$stage_target" /srv/pundad/staging/.current-rollback
  mv -Tf /srv/pundad/staging/.current-rollback /srv/pundad/staging/current
  systemctl restart pundad-staging.service
'
curl --retry 15 --retry-all-errors --retry-delay 1 -fsS \
  http://127.0.0.1:4002/api/v1/auth/ready
curl -fsS https://staging.pundad.app/__version.json
```

This requires an existing valid `previous` link; it is absent after the first
deployment. The temporary link command intentionally stops if a leftover
`.current-rollback` exists: inspect that state rather than blindly overwriting
it. This manual procedure does not change the `previous` link or automatically
recover if the chosen rollback target also fails. The atomic link change avoids
partially switching API/frontend files; requests already in flight can still
cross a release boundary. There is no database down-migration or upload rollback.

Releases and failed candidates are currently retained; automated pruning is not
implemented. Disk space is shared with production. Inspect `df -h`, releases,
and private build state before cleanup. Never remove `current`'s target,
`previous`'s target, credentials, uploads, or database files as routine cleanup.
Temporary downloaded artifacts under `/tmp` can be discarded after a verified
deployment; they are not the running release.

No scheduled staging backup/restore system was installed in this milestone.
Rebuilding the schema from migrations is not the same as restoring user data.
Credentials, persistent uploads, and any test data worth keeping need a separate
private backup/restore plan. Keep production backups and production deployment
changes for the explicit production rollout step.

## 16. Troubleshooting by layer

| Symptom | Inspect |
| --- | --- |
| Hostname does not resolve | Correct Cloudflare zone/name, proxied CNAME, actual tunnel UUID, DNS propagation |
| Tunnel unavailable | `cloudflared-staging` journal, enabled service, credential-file access and UUID match |
| Wrong/default website | Hostname in tunnel ingress, explicit `httpHostHeader`, Nginx `server_name`, enabled staging site |
| Nginx 502 for API | Service/journal, loopback API port 4002, direct `/ready` |
| `/health` succeeds but `/ready` fails | PostgreSQL service, staging login/database, private env file, migrations; generic endpoint deliberately hides details |
| JSON parse errors in frontend | Check HTTP status and Content-Type; an API route must not return SPA HTML |
| Verification links point elsewhere | `FRONTEND_BASE_URL`, selected environment, restart after env changes |
| Registered tester gets no inbox mail | Expected capture mode; retrieve the private staging JSON message |
| Uploads return 403 | Owner/group/mode on staging upload path and created files; no world-readable chmod workaround |
| Browser shows an older frontend | `__version.json`, cache/service-worker state for staging, hard reload or staging-only site-data reset |
| Migration fails | Build journal, selected database, committed migrations and dependency lockfile; never use production privileges as a workaround |
| `gh pr edit` fails on old Projects fields | Installed CLI 2.46 encountered a deprecated GraphQL field; PR body update used REST `gh api --method PATCH ... --input <json-file>` |

During verification, Python's default HTTP user agent received Cloudflare 403
with **error code 1010**, while curl and the accepted client user agent succeeded.
The smoke client used that accepted user agent; no Cloudflare protection was
disabled. When diagnosing a 403, inspect whether it comes from Cloudflare or the
application before changing API authentication/CORS settings. Avoid sharing
private response cookies, verification URLs, or authentication headers.

## 17. Reusing this pattern for another project

Keep the separation of concerns, then replace project-specific values together:

| Replace | Places to update |
| --- | --- |
| Project/domain names | Nginx server name, tunnel ingress/DNS, frontend banner condition, URLs/CORS guards |
| Database/login names | Provisioner, private env generation, validator, migrations/seed configuration |
| API/dev ports | Startup guards, runtime settings, Nginx proxy, Vite proxy |
| Filesystem roots and Unix users | Provisioner, systemd units, PM2 config, deployer, validator, ownership |
| Runtime version/path | `.nvmrc`, provisioner runtime copy, PM2 interpreter, units, build PATH |
| Repositories/check names | Workflow files, branch protection, artifact selection/download commands |
| Application entry points | PM2 app scripts, readiness route, Prisma/seed commands |
| Capture/email behavior | Mail service adapter, private capture path, environment guard |
| Tunnel ID/credential paths | Newly created tunnel, installed config and CNAME target |

The hardcoded guards are intentional: changing only the env file should not
silently redirect staging to another database or upload directory. For a new
project, review/adapt the code and configuration as a unit, test its guards,
then provision it. Do not reuse this Pi's tunnel ID, credentials, or JWT secrets.
If the new host lacks systemd/Nginx/PostgreSQL or uses a different home/runtime
layout, adapt the installation method rather than assuming this script is portable.

## 18. Completed versus still planned

Completed: separate development worktrees/database and laptop preview; GitHub
CI and protected main; merged baseline CI PRs; public staging with separate
runtime/database/uploads/credentials; captured mail; manual artifact-based
deployment; release metadata; tested startup rollback; local and public HTTP
acceptance checks. Staging services are enabled for boot. Reboot recovery was
not tested by rebooting the production Pi.

Staging source is reviewable in backend PR #2 and frontend PR #188. Updating a
branch, merging a PR, editing source, or successfully completing CI does not
automatically change the running staging/production release today.

Still planned:

1. A trusted automatic staging deployment trigger and a restricted connection
   from GitHub Actions to the Pi, or outbound artifact retrieval by the Pi.
   Transport has not been selected/configured; no deployment runner, unrestricted
   sudo path, or production credential was given to PR jobs.
2. Selection/provenance checks for exact successful revisions and a policy for
   a **single shared staging slot**. Two independent repos require an explicit
   choice of the matching API/frontend pair; this is not a separate site per PR.
3. Release/build/mail retention and maintained browser integration tests.
4. Production versioned releases, a tested backup/restore plan, readiness-based
   activation and rollback, then deployment after merge to `main`.

The production-on-merge workflow must be added deliberately; it is not enabled
by the presence of CI or by the completed staging installation.
