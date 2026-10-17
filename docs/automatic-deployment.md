# Automatic PR staging and production deployment

This extends [the staging installation guide](staging.md). The implementation
lives in the backend's `ops/deploy/`, with the existing staging release deployer
under `ops/staging/`. Both repositories carry a copy of this guide.

## What happens after a push

```text
Edit in a -dev worktree -> commit -> push -> open/update a PR to main
  -> GitHub Actions: lint, tests, migration checks / frontend build
  -> successful current CI artifacts
  -> Pi's outbound controller selects and verifies them
  -> staging release -> API/database + worker checks -> deployment status on GitHub

Merge the tested PR into main
  -> CI runs again for the actual main commit
  -> Pi waits for successful current main CI in both repositories
  -> private production backup -> build/migrations -> production activation
  -> API/database + worker checks -> success, or preceding application restored
```

Opening a PR does not deploy unchecked code. Staging waits for successful CI.
Production also waits for the checks on the actual main commits after merging;
it does not promote a PR artifact based solely on its earlier checks.

GitHub-hosted runners do the CI work. The Pi runs a fixed root-owned controller
once per minute through `pundad-deploy.timer`. It calls GitHub's API and retrieves
artifacts over outbound HTTPS. No inbound deployment SSH port, Actions SSH key,
or self-hosted Actions runner was added to the Pi. An update normally becomes
eligible within about a minute after CI finishes, followed by build time; this
is polling, not a GitHub webhook.

## Who and what can deploy

- Staging accepts open, non-draft PRs **authored by `biandresen`**, from the same
  repository, targeting `main`. Fork PRs and PRs by other authors are not
  automatically deployed. They may still run ordinary GitHub CI.
- There is **one shared staging site**. The most recently updated eligible PR
  selects the branch. A trusted PR in the other repository with the same branch
  name is paired with it; otherwise the other component comes from current main.
  Paired PRs must both pass. An unready selected branch leaves staging as-is.
- To test API/frontend changes together, create the same feature branch name in
  both `-dev` worktrees and open both PRs. With different branch names they are
  independent previews and can compete for the shared slot.
- With no eligible PRs, staging selects the current main pair. Closing or merging
  a PR can therefore cause staging to move to another PR or back to main.
- Production selects only current `main` push runs from both repositories. A
  pending/failed run prevents deploying that new pair, even if the other repo
  has passed. The two repositories are still merged independently; use backward-
  compatible changes when a coordinated feature cannot tolerate an interim pair.

The controller uses fixed repository names and CI workflow IDs. It checks the
run's event, source SHA, source repository, branch, result, and PR association.
For PRs, the artifact must name the current GitHub test merge commit; a PR head
and its test merge are different SHAs. Main artifacts must name the current
main SHA. It rechecks the selection after download and again after building,
before activation. A newer push/changed selection prevents stale activation.

API CI now archives `git archive HEAD` as `api-<build-sha>`, containing `api.tar`.
Frontend CI uploads the built files as `frontend-<build-sha>`. Both retain
artifacts for 30 days. Overall successful CI, including the separate backend
migration job, is required even though the API artifact upload happens in the
API checks job. Artifact ZIP SHA256 digests are checked against GitHub metadata.
Extraction rejects traversal, links, special files, oversized archives, and
private API env files. Exact paired revisions appear at `/__version.json`.

The Pi retains verified artifact ZIPs privately. A previously deployed main
component can be reused after GitHub artifact expiry only if its current main
head and latest successful run still match the saved production selection and
the cached ZIP is present; its digest is checked again. If no such cache exists,
rerun CI for current main to create a fresh artifact. Failed newer CI is never
bypassed by that cache. GitHub API/rate-limit/authentication errors leave a
deployment waiting or failed; an already running release remains in place.

## Host installation and activation

These commands are for a server with the staging prerequisites already installed.
Review/adapt the hardcoded accounts, paths, DB identity, workflow IDs, and domains
for another project; do not run another project's provisioner unchanged.

```bash
cd /home/pi/projects/backend/pundad-api-dev
less ops/deploy/provision.py
less ops/deploy/controller.py
less ops/deploy/production.py
sudo python3 ops/deploy/provision.py
sudo install -o root -g root -m 644 ops/staging/deploy.py /usr/local/lib/pundad-staging/deploy.py
```

Provisioning installs reviewed Python/guard code under `/usr/local/lib/pundad-deploy`,
the production systemd/PM2/Nginx definitions, controller configuration, and private
state/backup directories. On first installation, both deployment environments
are disabled in `/etc/pundad/deploy.json`. Existing flags/config and production
credentials are preserved on subsequent runs. It does not restart production or
enable timers by itself. Later source edits do not replace the installed host
code automatically; review and install those host changes deliberately.

Production settings are copied privately from the original backend `.env` and
given explicit production APP_ENV, origin/CORS, port, uploads, and email delivery
settings. Existing JWT secrets, database credentials, sender addresses, and email
provider key are preserved. Rotating them was not necessary for this migration.
The generated file is `/etc/pundad/production/api.env`, root:pi mode 640.
Do not print it. systemd passes its values to the service; they are absent from
GitHub jobs and release archives.

The controller service reads the operator's existing GitHub CLI credentials via
`GH_CONFIG_DIR=/home/pi/.config/gh`. Those credentials already have repository and
workflow access and are broader than an ideal dedicated deployment identity.
Only fixed host code accesses them; build/runtime sandboxes hide `/home` and do
not inherit those credentials. A future dedicated GitHub App/token could narrow
this access, but is not needed for the functioning flow. If CLI authentication
expires, renew it in your own terminal and check the controller journal. On a new
host, authenticate CLI as described in the CI guide before enabling the timer.

Use `sudoedit /etc/pundad/deploy.json` to set `enabled.staging` and/or
`enabled.production` to JSON `true` after validating each environment. Do not
paste credentials into this file; it contains policy, IDs, and flags only.
Production can remain disabled while the controller proves staging deployment.

```bash
sudo systemd-analyze verify \
  /etc/systemd/system/pundad-production.service \
  /etc/systemd/system/pundad-deploy.service \
  /etc/systemd/system/pundad-deploy.timer \
  /etc/systemd/system/pundad-backup.service \
  /etc/systemd/system/pundad-backup.timer

sudo env GH_CONFIG_DIR=/home/pi/.config/gh GH_PROMPT_DISABLED=1 \
  python3 /usr/local/lib/pundad-deploy/controller.py plan --environment staging
sudo systemctl enable --now pundad-deploy.timer
sudo systemctl start --no-block pundad-deploy.service
```

`plan` reads GitHub and prints non-secret selected revisions; it does not deploy.
It exits with code 2 and a waiting explanation when current inputs are not ready.
The ordinary service logs waiting states without restarting or replacing the
running application. Selection is validated against the enabled flag again
before activation.

## Production release behavior

Production runs from `/srv/pundad/production/current/{api,frontend}`, a symlink to
a complete versioned release. The new `pundad-production.service` supervises a
separate PM2 runtime, with state under `/var/lib/pundad-production/pm2`.
It keeps Unix user `pi` so existing upload ownership remains compatible, but
`ProtectHome=true`, read-only release code, filesystem restrictions, and
`NoNewPrivileges=true` apply. It has a 1 GiB memory limit and 150% CPU quota.
Both API and worker must be online, and database readiness must pass.

The build uses separate no-login identity `pundad-production-build`, with a
private workspace, 1 GiB memory/75% CPU limit, and 900-second limit. `npm ci
--include=dev` installs the locked build tools explicitly, then Prisma Client
is generated and committed migrations are applied to `jokedb` with a fixed,
host-installed production environment guard preloaded. Production does **not**
run the moderation seed: that seed resets categories/isActive on existing rows.
The production database and `/var/www/pundad-uploads` stay in place.
PM2 uses its managed log files, which pm2-runtime also forwards to the journal.
The installer adds daily system logrotate rules for both environments: seven
archives, compression, and a 10 MiB maxsize check when logrotate runs. Direct
`/dev/stdout` log-file settings are avoided because PM2 cannot reopen systemd
stdout sockets as ordinary files.

Before each production build/migration, the deployer takes a private snapshot.
After the build it revalidates the GitHub selection, switches the release,
restarts production, checks readiness and API/worker processes, then validates
and gracefully reloads Nginx. The first migration removes only `pundad-api` and
`pundad-worker` from the old PM2 daemon and saves its remaining state; the old
PM2 logrotate module/daemon are left intact. Failure during this first cutover
restores the original PM2 apps and Nginx configuration. The old checkout and
`/var/www/pundad-frontend` remain available for inspection/recovery.

Subsequent activation failures restore the preceding versioned application
release, recheck readiness, and restore/reload the previous Nginx config.
Successful later deployments update `/srv/pundad/production/previous`. A first
successful release has no preceding versioned release. Restarts briefly interrupt
service; this is not a zero-downtime deployment. Database migrations/data changes
are never automatically reversed. A backup restore is an explicit incident
operation because restoring old data would discard newer writes.

## Backups and restore rehearsal

`/var/backups/pundad/production/<UTC-timestamp>/` is root-only and contains:

- `database.dump`: PostgreSQL custom-format snapshot of `jokedb`.
- `roles.sql`: role definitions/verifiers for recovery, also private.
- `uploads.tar.gz`: current persistent uploads.
- `api.env`: production credentials/settings.
- `nginx.conf`, legacy PM2 state if available, and a release/time manifest.

Backups run before production migrations and daily at **03:30 Europe/Oslo** via
`pundad-backup.timer`; seven completed snapshots are retained. This is a count
of snapshots, not seven days of history. Uploads are a filesystem copy and are
not transactionally atomic with the database. Backups currently live on the same
Pi/storage; they do not protect against loss of that disk. Off-device storage
needs a separate destination and credentials.

```bash
sudo systemctl enable --now pundad-backup.timer
sudo python3 /usr/local/lib/pundad-deploy/backup.py
sudo ls -lt /var/backups/pundad/production/
# Replace the example path with the completed snapshot printed above:
sudo python3 /usr/local/lib/pundad-deploy/backup.py \
  --rehearse /var/backups/pundad/production/YOUR_SNAPSHOT_TIMESTAMP
```

The rehearsal creates `pundad_restorecheck_<timestamp>`, restores the dump with
no owner/privilege changes, queries its User table, reads the upload archive,
then drops only that disposable database. It never restores over `jokedb`.
A rehearsal was completed before the production cutover. For an actual recovery,
pause deployments, select the intended snapshot/release, assess subsequent data
writes and migration compatibility, restore first into a separate database,
and plan an explicit cutover. Never feed roles.sql or a database dump into the
live server casually; these files can replace credentials/data.

## Inspection, failure handling, and maintenance

```bash
sudo systemctl status pundad-deploy.timer pundad-production.service
sudo systemctl list-timers pundad-deploy.timer pundad-backup.timer
sudo journalctl -u pundad-deploy.service --since '30 minutes ago'
sudo journalctl -u pundad-production.service --since '10 minutes ago'
sudo journalctl -u pundad-backup.service --since '2 days ago'
curl -fsS https://staging.pundad.app/__version.json
curl -fsS https://pundad.app/__version.json
curl -fsS https://pundad.app/api/v1/auth/ready
```

GitHub deployment records/statuses link to each environment and its CI run.
The Pi's private `/var/lib/pundad-deploy/{staging,production}.json` records the
successful selection and any failure backoff. Matching selections are not
redeployed every minute. A failed exact selection waits 15 minutes before a
retry; a new eligible selection can deploy immediately. API outage/status-report
errors are logged; GitHub status reporting is not required to keep an already
successful release running.

The controller keeps three newest release directories plus any `current` and
`previous` targets, two newest failed build directories (extra ones older than
one hour are pruned), twenty newest cached artifacts plus active selections,
and seven days of staging captured mail. Deploy locks protect release cleanup.
Disk space is still shared; inspect `df -h` when diagnosing failed builds.

For maintenance or a manual application rollback, first pause the timer and
wait for any active deployment to finish:

```bash
sudo systemctl stop pundad-deploy.timer
sudo systemctl status pundad-deploy.service
```

Do not kill an active deployment midway through a migration or switch. Set the
environment's enabled flag false for a longer pause. Manual rollback without
pausing automation would be replaced by the selected GitHub revision on a later
poll. The atomic symlink rollback procedure in the staging guide also applies
to production with its production paths/service and port 4000, after checking
the previous release is schema-compatible. Confirm readiness and public version
metadata after rollback; restarting code does not roll back the database.

When finished, restore the desired enabled flags and run
`sudo systemctl enable --now pundad-deploy.timer`. The original development
workflow is unchanged: edit in `-dev`, preview through port 5173, push a feature
branch, inspect CI/staging, and merge to deploy production.
