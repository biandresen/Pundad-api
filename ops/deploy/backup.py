#!/usr/bin/env python3
"""Private production snapshots; explicit restore rehearsal in a disposable database."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path("/var/backups/pundad/production")


def pg(*args, **kwargs):
    return subprocess.run(["/usr/sbin/runuser", "-u", "postgres", "--", *args], check=True,
                          stderr=subprocess.PIPE, **kwargs)


def snapshot():
    if os.geteuid() != 0:
        raise RuntimeError("Run production backup as root")
    os.umask(0o077)
    directory = ROOT / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    directory.mkdir(parents=True, mode=0o700)
    with open(directory / "database.dump", "wb") as stream:
        pg("/usr/bin/pg_dump", "--format=custom", "--dbname=jokedb", stdout=stream)
    with open(directory / "roles.sql", "wb") as stream:
        pg("/usr/bin/pg_dumpall", "--roles-only", stdout=stream)
    subprocess.run(["/usr/bin/pg_restore", "--list", str(directory / "database.dump")],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    with tarfile.open(directory / "uploads.tar.gz", "w:gz", dereference=False) as archive:
        archive.add("/var/www/pundad-uploads", arcname="uploads")
    shutil.copy2("/etc/pundad/production/api.env", directory / "api.env")
    shutil.copy2("/etc/nginx/sites-enabled/pundad.app", directory / "nginx.conf")
    if Path("/home/pi/.pm2/dump.pm2").exists():
        shutil.copy2("/home/pi/.pm2/dump.pm2", directory / "legacy-pm2.json")
    current = Path("/srv/pundad/production/current")
    (directory / "manifest.json").write_text(json.dumps({
        "database": "jokedb", "release": str(current.resolve()) if current.is_symlink() else "legacy",
        "created_at": datetime.now(timezone.utc).isoformat(), "uploads_consistency": "filesystem copy; not atomic with database"}, indent=2))
    for file in directory.iterdir():
        file.chmod(0o600)
    # Keep seven completed snapshots, plus any explicitly named restore-test input.
    completed = sorted([p for p in ROOT.iterdir() if p.is_dir() and (p / "manifest.json").exists()])
    for old in completed[:-7]:
        shutil.rmtree(old)
    return directory


def rehearsal(directory):
    directory = Path(directory).resolve()
    if directory.parent != ROOT or not (directory / "manifest.json").is_file():
        raise ValueError("Choose a completed production snapshot")
    database = "pundad_restorecheck_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    pg("/usr/bin/createdb", database, stdout=subprocess.DEVNULL)
    try:
        with open(directory / "database.dump", "rb") as source:
            pg("/usr/bin/pg_restore", "--exit-on-error", "--no-owner", "--no-privileges", "--dbname=" + database,
               stdin=source, stdout=subprocess.DEVNULL)
        result = pg("/usr/bin/psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-d", database,
                    "-c", 'SELECT count(*) FROM "User";', stdout=subprocess.PIPE, text=True)
        count = int(result.stdout.strip())
        with tarfile.open(directory / "uploads.tar.gz") as archive:
            for member in archive.getmembers():
                if member.isfile():
                    with archive.extractfile(member) as stream:
                        while stream.read(1024 * 1024):
                            pass
        print("PASS: backup restored into a disposable database; User table readable (" + str(count) + " rows); upload archive readable.")
    finally:
        pg("/usr/bin/dropdb", database, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--rehearse", type=Path)
    args = parser.parse_args()
    if args.rehearse:
        rehearsal(args.rehearse)
    else:
        print(snapshot())
