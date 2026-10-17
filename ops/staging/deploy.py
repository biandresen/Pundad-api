#!/usr/bin/env python3
"""Deploy reviewed API sources and a CI-built frontend to staging with rollback."""
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import tarfile
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--api-archive", type=Path, required=True)
parser.add_argument("--frontend-dir", type=Path, required=True)
parser.add_argument("--api-sha", required=True)
parser.add_argument("--frontend-sha", required=True)
args = parser.parse_args()
if os.geteuid() != 0:
    raise SystemExit("Run the reviewed staging deployer with sudo.")
if not all(re.fullmatch(r"[a-f0-9]{40}", sha) for sha in (args.api_sha, args.frontend_sha)):
    raise SystemExit("Supply full source/build commit SHAs.")
if not (args.frontend_dir / "index.html").is_file():
    raise SystemExit("The CI frontend artifact must contain index.html.")

lock = open("/run/pundad-staging-deploy.lock", "w")
fcntl.flock(lock, fcntl.LOCK_EX)
root = Path("/srv/pundad/staging")
state = Path("/var/lib/pundad-staging")
identity = pwd.getpwnam("pundad-staging")
release_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + args.api_sha[:8] + "-" + args.frontend_sha[:8]
build = state / "build" / release_id
build.mkdir(mode=0o700)
api = build / "api"
api.mkdir()
with tarfile.open(args.api_archive) as archive:
    for member in archive.getmembers():
        if member.issym() or member.islnk():
            raise SystemExit("API source archives must not contain links.")
        if Path(member.name).name in (".env", ".env.development"):
            raise SystemExit("Private environment files must not be deployed in source archives.")
    archive.extractall(api, filter="data")
shutil.copytree(args.frontend_dir, build / "frontend")
for directory, dirs, files in os.walk(build):
    os.chown(directory, identity.pw_uid, identity.pw_gid)
    for name in dirs + files:
        os.chown(Path(directory) / name, identity.pw_uid, identity.pw_gid, follow_symlinks=False)

command = [
    "systemd-run", "--unit=pundad-staging-build-" + release_id.lower(), "--collect", "--wait", "--pipe",
    "--property=User=pundad-staging", "--property=Group=pundad-staging",
    "--property=WorkingDirectory=" + str(api),
    "--property=EnvironmentFile=/etc/pundad/staging/api.env",
    "--property=ProtectHome=true", "--property=ProtectSystem=strict", "--property=PrivateTmp=true",
    "--property=NoNewPrivileges=true", "--property=MemoryMax=1G", "--property=CPUQuota=75%",
    "--property=ReadWritePaths=" + str(state),
    "--setenv=PATH=/opt/pundad/node-v24.12.0/bin:/usr/local/bin:/usr/bin:/bin",
    "--setenv=npm_config_cache=" + str(state / "npm-cache"),
    "/bin/sh", "-eu", "-c",
    "npm ci --no-audit --no-fund; "
    "node --import ./src/config/stagingEnvironment.js node_modules/prisma/build/index.js generate; "
    "node --import ./src/config/stagingEnvironment.js node_modules/prisma/build/index.js migrate deploy; "
    "node --import ./src/config/stagingEnvironment.js src/config/seed.js",
]
subprocess.run(command, check=True)
metadata = {"environment": "staging", "apiSha": args.api_sha, "frontendSha": args.frontend_sha, "release": release_id}
(build / "frontend/__version.json").write_text(json.dumps(metadata) + "\n")

# Freeze code as root-owned, read-only-to-the-service release files.
for directory, dirs, files in os.walk(build, followlinks=False):
    os.chown(directory, 0, 0)
    os.chmod(directory, 0o755)
    for name in dirs + files:
        file = Path(directory) / name
        os.chown(file, 0, 0, follow_symlinks=False)
        if not file.is_symlink():
            mode = 0o755 if file.is_dir() or file.stat().st_mode & 0o111 else 0o644
            file.chmod(mode)
release = root / "releases" / release_id
shutil.move(str(build), release)
current = root / "current"
previous = current.resolve() if current.is_symlink() else None

def activate(target):
    link = root / ".current-next"
    link.unlink(missing_ok=True)
    link.symlink_to(target, target_is_directory=True)
    os.replace(link, current)
    subprocess.run(["systemctl", "restart", "pundad-staging.service"], check=True)

def ready():
    for _ in range(30):
        try:
            with urllib.request.urlopen("http://127.0.0.1:4002/api/v1/auth/ready", timeout=5) as response:
                if response.status == 200:
                    return True
        except (OSError, ValueError):
            pass
        time.sleep(1)
    return False

try:
    activate(release)
    if not ready():
        raise RuntimeError("Staging API did not become ready.")
    enabled = Path("/etc/nginx/sites-enabled/staging.pundad.app")
    if not enabled.exists():
        enabled.symlink_to("/etc/nginx/sites-available/staging.pundad.app")
    subprocess.run(["nginx", "-t"], check=True)
    subprocess.run(["systemctl", "reload", "nginx"], check=True)
    subprocess.run(["systemctl", "enable", "pundad-staging.service"], check=True)
except Exception:
    if previous:
        activate(previous)
    raise

if previous:
    link = root / "previous"
    link.unlink(missing_ok=True)
    link.symlink_to(previous, target_is_directory=True)
print(json.dumps(metadata))
