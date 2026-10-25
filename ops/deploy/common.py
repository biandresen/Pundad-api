"""Host deployment helpers. Installed as root-owned code, never loaded from PR artifacts."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tarfile
import zipfile


def prepare_frontend_assets(root, frontend, previous):
    """Retain one native asset generation inside the next atomic release."""
    root, frontend = Path(root), Path(frontend)
    retained = frontend / ".retained-assets"
    if retained.exists() or retained.is_symlink():
        raise ValueError("Frontend artifact uses the reserved retained-assets path")
    if previous is None:
        return
    previous = Path(previous)
    if previous.is_symlink() or previous.parent.resolve() != (root / "releases").resolve():
        raise ValueError("Previous release must belong to this environment")
    metadata = json.loads((previous / "frontend/__version.json").read_text())
    if metadata.get("environment") != root.name:
        raise ValueError("Previous release metadata belongs to another environment")
    assets = previous / "frontend/assets"
    if assets.is_symlink():
        raise ValueError("Previous assets must not be a symlink")
    if not assets.exists():
        return
    count, size = 0, 0
    for path in assets.rglob("*"):
        mode = path.lstat().st_mode
        if not stat.S_ISREG(mode) and not stat.S_ISDIR(mode):
            raise ValueError("Previous assets contain a link or special file")
        if path.is_file() and re.fullmatch(r".+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+", path.name):
            count += 1
            size += path.stat().st_size
            if count > 20000 or size > 250 * 1024 * 1024:
                raise ValueError("Previous assets exceed deployment limits")
            native = frontend / "assets" / path.relative_to(assets)
            if native.exists():
                with path.open("rb") as prior_file, native.open("rb") as current_file:
                    if hashlib.file_digest(prior_file, "sha256").digest() != hashlib.file_digest(current_file, "sha256").digest():
                        raise ValueError("Hashed asset name has different content across releases")
            target = retained / "assets" / path.relative_to(assets)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)


def switch_current(root, target, name="current"):
    """Atomically select an already prepared current/previous environment release."""
    root, target = Path(root), Path(target)
    if name not in ("current", "previous"):
        raise ValueError("Invalid release link name")
    if target.is_symlink() or target.parent.resolve() != (root / "releases").resolve() or not target.is_dir():
        raise ValueError("Activation target must be a release in this environment")
    link = root / ("." + name + "-next")
    if link.is_symlink():
        link.unlink()
    link.symlink_to(target, target_is_directory=True)
    os.replace(link, root / name)


def prune_releases(root):
    """Keep three newest directories and both selected release targets."""
    root = Path(root)
    protected = {path.resolve() for path in (root / "current", root / "previous") if path.is_symlink()}
    releases = root / "releases"
    if releases.exists():
        rows = sorted((path for path in releases.iterdir() if path.is_dir() and not path.is_symlink()),
                      key=lambda path: path.name, reverse=True)
        for path in rows[3:]:
            if path.resolve() not in protected:
                shutil.rmtree(path)


def sha(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{40}", value):
        raise ValueError("Expected a full Git commit SHA")
    return value


def write_json(path, value):
    path = Path(path)
    temp = path.with_suffix(path.suffix + ".next")
    with open(temp, "w", encoding="utf8") as stream:
        os.chmod(temp, 0o600)
        json.dump(value, stream, indent=2)
        stream.write("\n")
    os.replace(temp, path)


def fingerprint(selection):
    return hashlib.sha256(json.dumps(selection, sort_keys=True).encode()).hexdigest()


def safe_name(name):
    path = PurePosixPath(name)
    if not name or "\\" in name or path.is_absolute() or ".." in path.parts or ":" in name:
        raise ValueError("Unsafe archive path")
    return path


def extract_zip(archive, target, digest):
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest or ""):
        raise ValueError("Artifact requires a GitHub SHA256 digest")
    with open(archive, "rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != digest[7:]:
        raise ValueError("Artifact digest mismatch")
    target = Path(target)
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        if len(entries) > 20000 or sum(e.file_size for e in entries) > 250 * 1024 * 1024:
            raise ValueError("Artifact exceeds deployment limits")
        for entry in entries:
            name = safe_name(entry.filename)
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) and not stat.S_ISREG(mode) and not stat.S_ISDIR(mode)):
                raise ValueError("Artifact contains a link or special file")
            output = target.joinpath(*name.parts)
            if entry.is_dir():
                output.mkdir(parents=True, exist_ok=True)
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                with source.open(entry) as reader, open(output, "xb") as writer:
                    while chunk := reader.read(1024 * 1024):
                        writer.write(chunk)


def extract_api(archive, target):
    with tarfile.open(archive) as source:
        members = source.getmembers()
        if len(members) > 20000 or sum(m.size for m in members) > 250 * 1024 * 1024:
            raise ValueError("API archive exceeds deployment limits")
        for member in members:
            path = safe_name(member.name)
            if not member.isfile() and not member.isdir():
                raise ValueError("API archive contains a link or special file")
            if path.name == ".env" or (path.name.startswith(".env.") and not path.name.endswith(".example")):
                raise ValueError("Private environment files may not be deployed")
        source.extractall(target, filter="data")
    if not (Path(target) / "package-lock.json").is_file():
        raise ValueError("API release requires its dependency lockfile")
