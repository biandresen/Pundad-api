"""Host deployment helpers. Installed as root-owned code, never loaded from PR artifacts."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile
import zipfile


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
