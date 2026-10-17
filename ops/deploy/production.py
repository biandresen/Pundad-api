#!/usr/bin/env python3
"""Production release deployer with private pre-migration backup and application rollback."""
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import pwd
import shutil
import stat
import subprocess
import time
import urllib.request

from backup import snapshot
from common import extract_api, sha

ROOT = Path("/srv/pundad/production")
CODE = Path("/usr/local/lib/pundad-deploy")
CONFIG = Path("/etc/pundad/production")
NODE = "/opt/pundad/node-v24.12.0/bin/node"


def run(*command, **kwargs):
    return subprocess.run(command, check=True, **kwargs)


def legacy(*command):
    run("/usr/sbin/runuser", "-u", "pi", "--", "/usr/bin/env",
        "PATH=/opt/pundad/node-v24.12.0/bin:/usr/sbin:/usr/bin:/bin", "PM2_HOME=/home/pi/.pm2",
        NODE, "/opt/pundad/pm2/bin/pm2", *command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def ready():
    for _ in range(40):
        try:
            with urllib.request.urlopen("http://127.0.0.1:4000/api/v1/auth/ready", timeout=3) as response:
                if response.status == 200 and json.load(response).get("message") == "Service is ready":
                    return True
        except (OSError, ValueError):
            pass
        time.sleep(1)
    return False


def worker_health(environment):
    user = "pi" if environment == "production" else "pundad-staging"
    state = Path("/var/lib/pundad-" + environment + "/pm2")
    if not (state / "rpc.sock").exists():
        raise RuntimeError("PM2 control socket unavailable")
    result = run("/usr/sbin/runuser", "-u", user, "--", "/usr/bin/env",
                 "PATH=/opt/pundad/node-v24.12.0/bin:/usr/sbin:/usr/bin:/bin", "PM2_HOME=" + str(state),
                 NODE, "/opt/pundad/pm2/bin/pm2", "jlist", capture_output=True, text=True)
    apps = json.loads(result.stdout)
    expected = {"pundad-" + environment + "-api", "pundad-" + environment + "-worker"}
    online = {app["name"] for app in apps if app.get("pm2_env", {}).get("status") == "online"}
    if not expected <= online:
        raise RuntimeError("Both API and worker must be online")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-archive", type=Path, required=True)
    parser.add_argument("--frontend-dir", type=Path, required=True)
    parser.add_argument("--api-sha", required=True)
    parser.add_argument("--frontend-sha", required=True)
    parser.add_argument("--selection-file", type=Path, required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("Run the installed production deployer as root")
    sha(args.api_sha)
    sha(args.frontend_sha)
    if not (args.frontend_dir / "index.html").is_file() or args.frontend_dir.is_symlink():
        raise ValueError("Frontend artifact requires index.html")
    for path in args.frontend_dir.rglob("*"):
        mode = path.lstat().st_mode
        if not stat.S_ISREG(mode) and not stat.S_ISDIR(mode):
            raise ValueError("Frontend contains a link or special file")
    selection = json.loads(args.selection_file.read_text())
    if selection["environment"] != "production" or any(c["event"] != "push" or c["branch"] != "main" for c in selection["components"].values()):
        raise ValueError("Production requires verified main push artifacts")
    if selection["components"]["api"]["sha"] != args.api_sha or selection["components"]["frontend"]["sha"] != args.frontend_sha:
        raise ValueError("Production inputs do not match selection")
    with open("/run/pundad-production-deploy.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        run("/usr/bin/python3", str(CODE / "controller.py"), "verify", "--selection-file", str(args.selection_file))
        identifier = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ") + "-" + args.api_sha[:8] + "-" + args.frontend_sha[:8]
        state = Path("/var/lib/pundad-production-build")
        build = state / "build" / identifier
        api = build / "api"
        api.mkdir(parents=True, mode=0o700)
        extract_api(args.api_archive, api)
        shutil.copytree(args.frontend_dir, build / "frontend")
        builder = pwd.getpwnam("pundad-production-build")
        for directory, dirs, files in os.walk(build):
            os.chown(directory, builder.pw_uid, builder.pw_gid)
            for name in dirs + files:
                os.chown(Path(directory) / name, builder.pw_uid, builder.pw_gid, follow_symlinks=False)
        backup = snapshot()
        print("Production pre-migration snapshot: " + str(backup), flush=True)
        run("systemd-run", "--unit=pundad-production-build-" + identifier.lower(), "--collect", "--wait", "--pipe",
            "--property=User=pundad-production-build", "--property=Group=pundad-production-build",
            "--property=WorkingDirectory=" + str(api), "--property=EnvironmentFile=/etc/pundad/production/api.env",
            "--property=ProtectHome=true", "--property=ProtectSystem=strict", "--property=PrivateTmp=true",
            "--property=NoNewPrivileges=true", "--property=MemoryMax=1G", "--property=CPUQuota=75%",
            "--property=RuntimeMaxSec=900", "--property=KillMode=control-group",
            "--property=ReadWritePaths=" + str(state),
            "--setenv=PATH=/opt/pundad/node-v24.12.0/bin:/usr/local/bin:/usr/bin:/bin",
            "--setenv=npm_config_cache=" + str(state / "npm-cache"), "/bin/sh", "-eu", "-c",
            "npm ci --include=dev --no-audit --no-fund; "
            "node --import /usr/local/lib/pundad-deploy/productionEnvironment.js node_modules/prisma/build/index.js generate; "
            "node --import /usr/local/lib/pundad-deploy/productionEnvironment.js node_modules/prisma/build/index.js migrate deploy")
        # Repeat trust/head checks after the potentially long build, before any switch.
        run("/usr/bin/python3", str(CODE / "controller.py"), "verify", "--selection-file", str(args.selection_file))
        metadata = {"environment": "production", "apiSha": args.api_sha, "frontendSha": args.frontend_sha, "release": identifier}
        (build / "frontend/__version.json").write_text(json.dumps(metadata) + "\n")
        for directory, dirs, files in os.walk(build):
            os.chown(directory, 0, 0)
            os.chmod(directory, 0o755)
            for name in dirs + files:
                path = Path(directory) / name
                os.chown(path, 0, 0, follow_symlinks=False)
                if not path.is_symlink():
                    path.chmod(0o755 if path.is_dir() or path.stat().st_mode & 0o111 else 0o644)
        release = ROOT / "releases" / identifier
        shutil.move(str(build), release)
        current = ROOT / "current"
        previous = current.resolve() if current.is_symlink() else None
        nginx_path = Path("/etc/nginx/sites-enabled/pundad.app").resolve()
        old_nginx = nginx_path.read_bytes()
        legacy_stopped = False

        def activate(target):
            link = ROOT / ".current-next"
            link.unlink(missing_ok=True)
            link.symlink_to(target, target_is_directory=True)
            os.replace(link, current)
            run("systemctl", "restart", "pundad-production.service")

        try:
            if previous is None:
                legacy_stopped = True
                legacy("stop", "pundad-api", "pundad-worker")
                legacy("delete", "pundad-api", "pundad-worker")
                legacy("save", "--force")
            activate(release)
            if not ready():
                raise RuntimeError("Production database readiness failed")
            time.sleep(3)
            worker_health("production")
            shutil.copyfile(CONFIG / "nginx.conf", nginx_path)
            run("nginx", "-t")
            run("systemctl", "reload", "nginx")
            run("systemctl", "enable", "pundad-production.service")
        except Exception:
            nginx_path.write_bytes(old_nginx)
            if previous:
                activate(previous)
                if not ready():
                    print("CRITICAL: previous production release also failed readiness", flush=True)
            elif legacy_stopped:
                run("systemctl", "stop", "pundad-production.service")
                current.unlink(missing_ok=True)
                legacy("start", "/home/pi/projects/backend/pundad-api/ecosystem.config.cjs", "--env", "production")
                legacy("save", "--force")
            run("nginx", "-t")
            run("systemctl", "reload", "nginx")
            raise
        if previous:
            link = ROOT / "previous"
            link.unlink(missing_ok=True)
            link.symlink_to(previous, target_is_directory=True)
        print(json.dumps(metadata), flush=True)


if __name__ == "__main__":
    main()
