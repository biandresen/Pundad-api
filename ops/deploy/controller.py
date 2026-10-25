#!/usr/bin/env python3
"""Outbound-only deployment controller; accepts only current, trusted successful CI runs."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import time

from common import extract_zip, fingerprint, prune_releases, sha, write_json

CONFIG = Path("/etc/pundad/deploy.json")
STATE = Path("/var/lib/pundad-deploy")
CODE = Path("/usr/local/lib/pundad-deploy")
RELEASES = Path("/srv/pundad")


class Pending(Exception):
    """A current revision is not eligible; leave the running site intact."""


class GitHub:
    def api(self, endpoint, payload=None, output=None):
        command = ["/usr/bin/gh", "api", "--method", "GET" if payload is None else "POST", endpoint]
        if payload is not None:
            command += ["--input", "-"]
        result = subprocess.run(command, input=None if payload is None else json.dumps(payload).encode(),
                                stdout=output if output else subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=90, check=False)
        if result.returncode:
            # gh errors can include request details; never emit credentials or raw response bodies.
            raise RuntimeError("GitHub API request failed: " + endpoint.split("?")[0])
        return None if output else json.loads(result.stdout)


def trusted_pr(pr, repo, owner):
    return (pr.get("state") == "open" and not pr.get("draft") and
            pr.get("user", {}).get("login") == owner and
            pr.get("base", {}).get("ref") == "main" and
            pr.get("base", {}).get("repo", {}).get("full_name") == repo and
            pr.get("head", {}).get("repo", {}).get("full_name") == repo)


def targets(api, config, environment):
    specs = config["repositories"]
    mains = {key: sha(api.api(f"repos/{spec['name']}/git/ref/heads/main")["object"]["sha"])
             for key, spec in specs.items()}
    result = {key: {"head": head, "event": "push", "branch": "main", "pr": None}
              for key, head in mains.items()}
    if environment == "production":
        return result
    prs = {}
    for key, spec in specs.items():
        rows = api.api(f"repos/{spec['name']}/pulls?state=open&base=main&sort=updated&direction=desc&per_page=100")
        prs[key] = [pr for pr in rows if trusted_pr(pr, spec["name"], config["trusted_owner"])]
    active = [(pr["updated_at"], key, pr) for key, rows in prs.items() for pr in rows]
    if not active:
        return result
    _, _, selected = max(active, key=lambda item: (item[0], item[2]["number"]))
    branch = selected["head"]["ref"]
    for key, rows in prs.items():
        matches = [pr for pr in rows if pr["head"]["ref"] == branch]
        if len(matches) > 1:
            raise Pending("Multiple trusted PRs for the same branch")
        if matches:
            pr = matches[0]
            if pr.get("mergeable") is False:
                raise Pending("Staging PR has merge conflicts")
            result[key] = {"head": sha(pr["head"]["sha"]), "event": "pull_request", "branch": branch,
                           "pr": pr["number"]}
    return result


def select(api, config, environment):
    selection = {"environment": environment, "components": {}}
    chosen = targets(api, config, environment)
    for key, target in chosen.items():
        spec = config["repositories"][key]
        repo = spec["name"]
        rows = api.api(f"repos/{repo}/actions/workflows/{spec['workflow_id']}/runs?event={target['event']}&head_sha={target['head']}&per_page=100")["workflow_runs"]
        rows = [run for run in rows if run.get("head_sha") == target["head"] and
                run.get("head_repository", {}).get("full_name") == repo and
                run.get("head_branch") == target["branch"] and
                run.get("event") == target["event"] and
                (target["pr"] is None or any(pr["number"] == target["pr"] for pr in run.get("pull_requests", [])))]
        if not rows:
            raise Pending(f"{key}: waiting for CI on the current revision")
        run = max(rows, key=lambda row: row["id"])
        if run["status"] != "completed" or run["conclusion"] != "success":
            raise Pending(f"{key}: latest CI has not succeeded")
        artifacts = api.api(f"repos/{repo}/actions/runs/{run['id']}/artifacts?per_page=100")["artifacts"]
        artifacts = [a for a in artifacts if a["name"].startswith(spec["artifact_prefix"] + "-") and not a["expired"]]
        if not artifacts and target["event"] == "push":
            cached = cached_main(key, target, run["id"])
            if cached:
                selection["components"][key] = cached
                continue
        if len(artifacts) != 1:
            raise Pending(f"{key}: expected one unexpired build artifact")
        artifact = artifacts[0]
        build_sha = sha(artifact["name"][len(spec["artifact_prefix"]) + 1:])
        if target["pr"] is None:
            if build_sha != target["head"]:
                raise Pending(f"{key}: main artifact does not match main")
        else:
            pr = api.api(f"repos/{repo}/pulls/{target['pr']}")
            if not trusted_pr(pr, repo, config["trusted_owner"]) or pr["head"]["sha"] != target["head"]:
                raise Pending(f"{key}: PR changed or is no longer trusted")
            if pr.get("mergeable") is not True or pr.get("merge_commit_sha") != build_sha:
                raise Pending(f"{key}: artifact is not the current PR test merge")
        if artifact.get("workflow_run", {}).get("head_sha") != target["head"]:
            raise Pending(f"{key}: artifact provenance does not match the run")
        selection["components"][key] = {**target, "repo": repo, "run": run["id"], "artifact": artifact["id"],
                                         "sha": build_sha, "digest": artifact.get("digest")}
    return selection


def cached_main(key, target, run_id):
    """Reuse a previously verified main artifact when GitHub retention has expired."""
    record = STATE / "production.json"
    if not record.exists():
        return None
    value = json.loads(record.read_text()).get("selection", {}).get("components", {}).get(key, {})
    if (value.get("head") == target["head"] and value.get("sha") == target["head"] and
            value.get("run") == run_id and value.get("event") == "push" and
            (STATE / "artifacts" / (str(value.get("artifact")) + ".zip")).is_file()):
        return value
    return None


def verify(api, config, selection):
    if not config.get("enabled", {}).get(selection["environment"], False):
        raise Pending("Deployment environment is disabled")
    if fingerprint(select(api, config, selection["environment"])) != fingerprint(selection):
        raise Pending("Deployment selection changed; refusing stale activation")


def reports(api, selection, state, deployment_ids=None):
    ids = deployment_ids or {}
    environment = selection["environment"]
    for key, component in selection["components"].items():
        try:
            if key not in ids:
                deployment = api.api(f"repos/{component['repo']}/deployments", {
                    "ref": component["sha"], "environment": environment, "auto_merge": False,
                    "required_contexts": [], "production_environment": environment == "production",
                    "transient_environment": environment == "staging",
                    "description": "Pi release from verified CI artifacts",
                    "payload": {"ci_run": component["run"], "source_head": component["head"]}})
                ids[key] = deployment["id"]
            api.api(f"repos/{component['repo']}/deployments/{ids[key]}/statuses", {
                "state": state, "environment_url": "https://staging.pundad.app" if environment == "staging" else "https://pundad.app",
                "log_url": f"https://github.com/{component['repo']}/actions/runs/{component['run']}",
                "description": "Pi deployment " + state, "auto_inactive": True})
        except (RuntimeError, KeyError):
            print(f"Warning: could not publish {key} deployment status", flush=True)
    return ids


def active_matches(selection):
    try:
        metadata = json.loads((RELEASES / selection["environment"] / "current/frontend/__version.json").read_text())
    except (OSError, ValueError):
        return False
    return (metadata.get("environment") == selection["environment"] and
            metadata.get("apiSha") == selection["components"]["api"]["sha"] and
            metadata.get("frontendSha") == selection["components"]["frontend"]["sha"])


def tick(api, config, environment):
    if not config.get("enabled", {}).get(environment, False):
        return
    record = STATE / (environment + ".json")
    state = json.loads(record.read_text()) if record.exists() else {}
    try:
        selection = select(api, config, environment)
    except Pending as error:
        print(environment + ": " + str(error), flush=True)
        return
    key = fingerprint(selection)
    if state.get("success") == key and active_matches(selection):
        print(environment + ": already deployed", flush=True)
        return
    if state.get("failed") == key and time.time() < state.get("retry_after", 0):
        print(environment + ": failure backoff (15 minutes)", flush=True)
        return
    ids = {}
    try:
        with tempfile.TemporaryDirectory(prefix="release-", dir=STATE) as directory:
            work = Path(directory)
            for name, component in selection["components"].items():
                cache = STATE / "artifacts"
                cache.mkdir(mode=0o700, exist_ok=True)
                archive = cache / (str(component["artifact"]) + ".zip")
                downloaded = not archive.exists()
                if downloaded:
                    archive = work / (name + ".zip")
                    with open(archive, "wb") as stream:
                        api.api(f"repos/{component['repo']}/actions/artifacts/{component['artifact']}/zip", output=stream)
                extract_zip(archive, work / name, component["digest"])
                if downloaded:
                    shutil.move(str(archive), cache / (str(component["artifact"]) + ".zip"))
            verify(api, config, selection)
            manifest = work / "selection.json"
            write_json(manifest, selection)
            ids = reports(api, selection, "in_progress")
            command = ["/usr/bin/python3", str(CODE / "production.py") if environment == "production"
                       else "/usr/local/lib/pundad-staging/deploy.py",
                       "--api-archive", str(work / "api/api.tar"), "--frontend-dir", str(work / "frontend"),
                       "--api-sha", selection["components"]["api"]["sha"],
                       "--frontend-sha", selection["components"]["frontend"]["sha"],
                       "--selection-file", str(manifest)]
            subprocess.run(command, check=True, timeout=1800)
            write_json(record, {"success": key, "selection": selection, "deployed_at": time.time()})
            reports(api, selection, "success", ids)
            print(environment + ": deployed successfully", flush=True)
    except Pending as error:
        print(environment + ": superseded: " + str(error), flush=True)
    except Exception:
        write_json(record, {**state, "failed": key, "retry_after": time.time() + 900})
        reports(api, selection, "failure", ids)
        raise


def maintain():
    """Bound retained code/cache without deleting current or previous application releases."""
    for environment in ("production", "staging"):
        lock_path = "/run/pundad-" + environment + "-deploy.lock"
        with open(lock_path, "a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                continue
            prune_releases(RELEASES / environment)
            builds = Path("/var/lib/pundad-" + environment + "-build/build")
            if builds.exists():
                rows = sorted([p for p in builds.iterdir() if p.is_dir() and not p.is_symlink()], key=lambda p: p.stat().st_mtime, reverse=True)
                for path in rows[2:]:
                    if path.stat().st_mtime < time.time() - 3600:
                        shutil.rmtree(path)
    cache = STATE / "artifacts"
    protected_cache = set()
    for environment in ("production", "staging"):
        record = STATE / (environment + ".json")
        if record.exists():
            for value in json.loads(record.read_text()).get("selection", {}).get("components", {}).values():
                protected_cache.add(str(value["artifact"]) + ".zip")
    if cache.exists():
        rows = sorted(cache.glob("*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
        for path in rows[20:]:
            if path.name not in protected_cache:
                path.unlink()
    mail = Path("/var/lib/pundad-staging/mail")
    if mail.exists():
        for path in mail.glob("*.json"):
            if path.lstat().st_mtime < time.time() - 7 * 86400:
                path.unlink()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["tick", "plan", "verify"])
    parser.add_argument("--environment", choices=["staging", "production"])
    parser.add_argument("--selection-file", type=Path)
    args = parser.parse_args()
    config = json.loads(CONFIG.read_text())
    api = GitHub()
    if args.action == "verify":
        verify(api, config, json.loads(args.selection_file.read_text()))
        return
    if args.action == "plan":
        try:
            print(json.dumps(select(api, config, args.environment), indent=2))
        except Pending as error:
            print("Waiting: " + str(error))
            raise SystemExit(2)
        return
    with open("/run/pundad-deploy.lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        errors = []
        for environment in ([args.environment] if args.environment else ["production", "staging"]):
            try:
                tick(api, config, environment)
            except Exception as error:
                errors.append(environment)
                print(environment + ": deployment failed (" + type(error).__name__ + "); inspect deployment/build logs", flush=True)
        maintain()
        if errors:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
