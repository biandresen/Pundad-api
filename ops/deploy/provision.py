#!/usr/bin/env python3
"""Install reviewed host automation without enabling deployments or restarting production."""
import grp
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess

if os.geteuid() != 0:
    raise SystemExit("Run the reviewed installer with sudo")
os.umask(0o077)
source = Path(__file__).resolve().parent
target = Path("/usr/local/lib/pundad-deploy")
production = Path("/etc/pundad/production")
pi = pwd.getpwnam("pi")


def directory(path, mode, uid=0, gid=0):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    os.chown(path, uid, gid)
    path.chmod(mode)


try:
    builder = pwd.getpwnam("pundad-production-build")
except KeyError:
    subprocess.run(["useradd", "--system", "--user-group", "--create-home", "--home-dir", "/var/lib/pundad-production-build",
                    "--shell", "/usr/sbin/nologin", "pundad-production-build"], check=True)
    builder = pwd.getpwnam("pundad-production-build")
if builder.pw_dir != "/var/lib/pundad-production-build" or builder.pw_shell != "/usr/sbin/nologin":
    raise SystemExit("Unexpected production build account configuration")
directory(target, 0o755)
directory(production, 0o750, 0, pi.pw_gid)
directory("/srv/pundad/production", 0o755)
directory("/srv/pundad/production/releases", 0o755)
directory("/var/lib/pundad-production", 0o700, pi.pw_uid, pi.pw_gid)
directory("/var/lib/pundad-production/pm2", 0o700, pi.pw_uid, pi.pw_gid)
for name in ("", "/build", "/npm-cache"):
    directory("/var/lib/pundad-production-build" + name, 0o700, builder.pw_uid, builder.pw_gid)
directory("/var/lib/pundad-deploy", 0o700)
directory("/var/backups/pundad", 0o700)
directory("/var/backups/pundad/production", 0o700)

env_path = production / "api.env"
if not env_path.exists():
    script = '''import {readFileSync} from "node:fs";
import dotenv from "/home/pi/projects/backend/pundad-api/node_modules/dotenv/lib/main.js";
console.log(JSON.stringify(dotenv.parse(readFileSync("/home/pi/projects/backend/pundad-api/.env"))));'''
    values = json.loads(subprocess.check_output(["/opt/pundad/node-v24.12.0/bin/node", "--input-type=module", "-e", script], text=True))
    values.update(APP_ENV="production", NODE_ENV="production", HOST="127.0.0.1", PORT="4000", LOG_LEVEL="info",
                  FRONTEND_BASE_URL="https://pundad.app", CORS_ORIGINS="https://pundad.app,https://www.pundad.app",
                  UPLOADS_DIR="/var/www/pundad-uploads", EMAIL_DELIVERY="provider")
    with open(env_path, "x") as stream:
        for key, value in values.items():
            stream.write(key + "=" + json.dumps(value, ensure_ascii=False) + "\n")
os.chown(env_path, 0, pi.pw_gid)
env_path.chmod(0o640)
for file in source.iterdir():
    if file.is_file() and file.suffix in (".py", ".js"):
        shutil.copyfile(file, target / file.name)
        (target / file.name).chmod(0o644)
for name in ("ecosystem.config.cjs", "nginx.conf"):
    shutil.copyfile(source / name, production / name)
    os.chown(production / name, 0, pi.pw_gid)
    (production / name).chmod(0o640)
shutil.copyfile(source / "logrotate.conf", "/etc/logrotate.d/pundad-services")
Path("/etc/logrotate.d/pundad-services").chmod(0o644)
for name in ("pundad-production.service", "pundad-deploy.service", "pundad-deploy.timer", "pundad-backup.service", "pundad-backup.timer"):
    shutil.copyfile(source / name, Path("/etc/systemd/system") / name)
    (Path("/etc/systemd/system") / name).chmod(0o644)
config = Path("/etc/pundad/deploy.json")
if not config.exists():
    config.write_text(json.dumps({"trusted_owner": "biandresen", "enabled": {"staging": False, "production": False},
        "repositories": {"api": {"name": "biandresen/Pundad-api", "workflow_id": 387701573, "artifact_prefix": "api"},
                         "frontend": {"name": "biandresen/Pundad-app", "workflow_id": 387701588, "artifact_prefix": "frontend"}}}, indent=2) + "\n")
    config.chmod(0o600)
subprocess.run(["systemctl", "daemon-reload"], check=True)
print("Installed fixed automation and production definitions; secrets preserved privately; deployments disabled until explicitly enabled.")
