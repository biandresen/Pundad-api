#!/usr/bin/env python3
"""Operator-run first installation. Creates staging resources; never runs PR code as root."""
import base64
import grp
import hashlib
import hmac
import json
import os
from pathlib import Path
import pwd
import secrets
import shutil
import subprocess

if os.geteuid() != 0:
    raise SystemExit("Run this reviewed provisioning script with sudo.")

source = Path(__file__).resolve().parent
node_source = Path("/home/pi/.nvm/versions/node/v24.12.0")
node_target = Path("/opt/pundad/node-v24.12.0")
config_dir = Path("/etc/pundad/staging")
state_dir = Path("/var/lib/pundad-staging")
site_dir = Path("/srv/pundad/staging")

def run(*args):
    subprocess.run(args, check=True)

def account(name, home):
    try:
        record = pwd.getpwnam(name)
        if record.pw_dir != home or record.pw_shell != "/usr/sbin/nologin":
            raise SystemExit(f"Existing {name} account is not the expected service account.")
    except KeyError:
        run("useradd", "--system", "--user-group", "--create-home", "--home-dir", home,
            "--shell", "/usr/sbin/nologin", name)
        record = pwd.getpwnam(name)
    return record

app = account("pundad-staging", str(state_dir))
builder = account("pundad-staging-build", "/var/lib/pundad-staging-build")
account("cloudflared-staging", "/var/lib/cloudflared-staging")
www = grp.getgrnam("www-data")

def directory(path, mode, uid=0, gid=0):
    path.mkdir(parents=True, exist_ok=True)
    os.chown(path, uid, gid)
    path.chmod(mode)

directory(config_dir, 0o750, 0, app.pw_gid)
directory(state_dir, 0o700, app.pw_uid, app.pw_gid)
for name in ("mail", "pm2", "build", "npm-cache"):
    directory(state_dir / name, 0o700, app.pw_uid, app.pw_gid)
builder_state = Path("/var/lib/pundad-staging-build")
directory(builder_state, 0o700, builder.pw_uid, builder.pw_gid)
for name in ("build", "npm-cache"):
    directory(builder_state / name, 0o700, builder.pw_uid, builder.pw_gid)
directory(site_dir, 0o755)
directory(site_dir / "releases", 0o755)
directory(site_dir / "uploads", 0o2770, app.pw_uid, www.gr_gid)

version = subprocess.check_output([str(node_source / "bin/node"), "--version"], text=True).strip()
if version != "v24.12.0":
    raise SystemExit("The reviewed Node 24.12.0 runtime is required.")
directory(node_target / "bin", 0o755)
directory(node_target / "lib/node_modules", 0o755)
if not (node_target / "bin/node").exists():
    shutil.copy2(node_source / "bin/node", node_target / "bin/node")
if not (node_target / "lib/node_modules/npm").exists():
    shutil.copytree(node_source / "lib/node_modules/npm", node_target / "lib/node_modules/npm", symlinks=True)
for name, script in [("npm", "npm-cli.js"), ("npx", "npx-cli.js")]:
    link = node_target / "bin" / name
    if not link.exists():
        link.symlink_to(f"../lib/node_modules/npm/bin/{script}")
if not Path("/opt/pundad/pm2").exists():
    shutil.copytree(node_source / "lib/node_modules/pm2", "/opt/pundad/pm2", symlinks=True)

env_path = config_dir / "api.env"
def sql(statement):
    result = subprocess.run(["runuser", "-u", "postgres", "--", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", "postgres", "-At"],
                            input=statement, text=True, capture_output=True)
    if result.returncode:
        raise SystemExit("PostgreSQL provisioning failed; private SQL omitted.")
    return result.stdout.strip()

if not env_path.exists():
    if sql("SELECT count(*) FROM pg_roles WHERE rolname='pundad_staging';") != "0" or sql("SELECT count(*) FROM pg_database WHERE datname='pundad_staging';") != "0":
        raise SystemExit("Staging database/login already exists without its env file; refusing to replace credentials.")
    password = secrets.token_hex(32)
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 4096)
    client_key = hmac.new(salted, b"Client Key", "sha256").digest()
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.new(salted, b"Server Key", "sha256").digest()
    def b64(value):
        return base64.b64encode(value).decode()
    verifier = f"SCRAM-SHA-256$4096:{b64(salt)}${b64(stored_key)}:{b64(server_key)}"
    sql("CREATE ROLE pundad_staging LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD '" + verifier + "';")
    sql("CREATE DATABASE pundad_staging OWNER pundad_staging;")
    sql("REVOKE ALL ON DATABASE pundad_staging FROM PUBLIC;")
    config = {
        "NODE_ENV": "production", "APP_ENV": "staging", "HOST": "127.0.0.1", "PORT": "4002",
        "LOG_LEVEL": "info",
        "DATABASE_URL": f"postgresql://pundad_staging:{password}@127.0.0.1:5432/pundad_staging?schema=public&connect_timeout=5&pool_timeout=5",
        "FRONTEND_BASE_URL": "https://staging.pundad.app", "CORS_ORIGINS": "https://staging.pundad.app",
        "UPLOADS_DIR": "/srv/pundad/staging/uploads", "EMAIL_DELIVERY": "capture",
        "EMAIL_CAPTURE_DIR": "/var/lib/pundad-staging/mail",
        "JWT_ACCESS_SECRET": secrets.token_hex(48), "JWT_REFRESH_SECRET": secrets.token_hex(48),
    }
    fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
    with os.fdopen(fd, "w") as file:
        file.write("\n".join(f"{key}={value}" for key, value in config.items()) + "\n")
os.chown(env_path, 0, app.pw_gid)
env_path.chmod(0o640)

for name in ("ecosystem.config.cjs",):
    destination = config_dir / name
    shutil.copyfile(source / name, destination)
    os.chown(destination, 0, app.pw_gid)
    destination.chmod(0o640)
for name in ("pundad-staging.service", "cloudflared-staging.service"):
    destination = Path("/etc/systemd/system") / name
    shutil.copyfile(source / name, destination)
    destination.chmod(0o644)
shutil.copyfile(source / "nginx.conf", "/etc/nginx/sites-available/staging.pundad.app")
directory(Path("/usr/local/lib/pundad-staging"), 0o755)
directory(Path("/usr/local/lib/pundad-deploy"), 0o755)
shutil.copyfile(source.parent / "deploy/common.py", "/usr/local/lib/pundad-deploy/common.py")
Path("/usr/local/lib/pundad-deploy/common.py").chmod(0o644)
shutil.copyfile(source / "deploy.py", "/usr/local/lib/pundad-staging/deploy.py")
Path("/usr/local/lib/pundad-staging/deploy.py").chmod(0o644)
run("systemctl", "daemon-reload")
print(json.dumps({"database": "pundad_staging", "service_account": "pundad-staging", "credentials": "created privately; never printed", "services_started": False}))
