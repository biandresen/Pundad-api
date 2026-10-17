import copy
import hashlib
import io
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import controller
from common import extract_api, extract_zip

A = "a" * 40
B = "b" * 40
C = "c" * 40
REPO = "owner/api"
CONFIG = {"enabled": {"production": True, "staging": True}, "trusted_owner": "owner", "repositories": {"api": {
    "name": REPO, "workflow_id": 123, "artifact_prefix": "api"}}}


def pr():
    return {"number": 2, "state": "open", "draft": False, "user": {"login": "owner"},
            "base": {"ref": "main", "repo": {"full_name": REPO}},
            "head": {"sha": B, "ref": "feature", "repo": {"full_name": REPO}},
            "mergeable": True, "merge_commit_sha": C, "updated_at": "2026-10-17T00:00:00Z"}


class API:
    def __init__(self, event="push"):
        self.pull = pr()
        self.run = {"id": 10, "status": "completed", "conclusion": "success", "event": event,
                    "head_sha": A if event == "push" else B, "head_repository": {"full_name": REPO},
                    "head_branch": "main" if event == "push" else "feature", "pull_requests": [{"number": 2}]}
        self.artifact = {"id": 20, "name": "api-" + (A if event == "push" else C), "expired": False,
                         "workflow_run": {"head_sha": self.run["head_sha"]}, "digest": "sha256:" + "d" * 64}

    def api(self, endpoint):
        if "/git/ref/" in endpoint:
            return {"object": {"sha": A}}
        if "/pulls?" in endpoint:
            return [self.pull]
        if endpoint.endswith("/pulls/2"):
            return self.pull
        if "/artifacts?" in endpoint:
            return {"artifacts": [self.artifact]}
        if "/runs?" in endpoint:
            return {"workflow_runs": [self.run]}
        raise AssertionError(endpoint)


class Policy(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        old = controller.STATE
        controller.STATE = Path(temp.name)
        self.addCleanup(temp.cleanup)
        self.addCleanup(setattr, controller, "STATE", old)

    def test_verified_main_cache_survives_github_expiration(self):
        api = API()
        selected = controller.select(api, CONFIG, "production")
        (controller.STATE / "artifacts").mkdir()
        (controller.STATE / "artifacts/20.zip").write_bytes(b"cached; digest checked at extraction")
        import json
        (controller.STATE / "production.json").write_text(json.dumps({"selection": selected}))
        api.artifact["expired"] = True
        self.assertEqual(controller.select(api, CONFIG, "production"), selected)

    def test_cache_cannot_substitute_a_different_head_or_run(self):
        api = API()
        selected = controller.select(api, CONFIG, "production")
        (controller.STATE / "artifacts").mkdir()
        (controller.STATE / "artifacts/20.zip").touch()
        import json
        (controller.STATE / "production.json").write_text(json.dumps({"selection": selected}))
        self.assertIsNone(controller.cached_main("api", {"head": B}, 10))
        self.assertIsNone(controller.cached_main("api", {"head": A}, 11))

    def test_successful_current_main_is_production(self):
        result = controller.select(API(), CONFIG, "production")
        self.assertEqual(result["components"]["api"]["sha"], A)

    def test_failed_or_incomplete_ci_never_deploys(self):
        for field, value in [("conclusion", "failure"), ("status", "in_progress"), ("head_sha", B)]:
            api = API()
            api.run[field] = value
            with self.subTest(field=field), self.assertRaises(controller.Pending):
                controller.select(api, CONFIG, "production")

    def test_main_artifact_cannot_name_another_commit(self):
        api = API()
        api.artifact["name"] = "api-" + B
        with self.assertRaises(controller.Pending):
            controller.select(api, CONFIG, "production")

    def test_trusted_pr_uses_current_test_merge(self):
        result = controller.select(API("pull_request"), CONFIG, "staging")
        self.assertEqual(result["components"]["api"]["sha"], C)

    def test_stale_pr_merge_is_rejected(self):
        api = API("pull_request")
        api.pull["merge_commit_sha"] = A
        with self.assertRaises(controller.Pending):
            controller.select(api, CONFIG, "staging")

    def test_forks_other_authors_and_drafts_are_not_trusted(self):
        for mutate in [lambda p: p["head"]["repo"].update(full_name="attacker/api"),
                       lambda p: p["user"].update(login="attacker"),
                       lambda p: p.update(draft=True)]:
            value = pr()
            mutate(value)
            self.assertFalse(controller.trusted_pr(value, REPO, "owner"))

    def test_artifact_provenance_and_expiration_required(self):
        for mutate in [lambda a: a.update(expired=True), lambda a: a["workflow_run"].update(head_sha=B)]:
            api = API()
            mutate(api.artifact)
            with self.assertRaises(controller.Pending):
                controller.select(api, CONFIG, "production")

    def test_revalidation_detects_branch_change(self):
        api = API()
        selection = controller.select(api, CONFIG, "production")
        api.artifact["id"] = 21
        with self.assertRaises(controller.Pending):
            controller.verify(api, CONFIG, selection)

    def test_matching_branches_pair_both_repositories(self):
        config = {"trusted_owner": "owner", "repositories": {
            "api": {"name": "owner/api"}, "frontend": {"name": "owner/frontend"}}}
        class PairAPI:
            def api(self, endpoint):
                if "/git/ref/" in endpoint:
                    return {"object": {"sha": A}}
                item = pr()
                repo = "owner/api" if "owner/api/" in endpoint else "owner/frontend"
                item["head"]["repo"]["full_name"] = repo
                item["base"]["repo"]["full_name"] = repo
                return [item]
        result = controller.targets(PairAPI(), config, "staging")
        self.assertTrue(all(t["pr"] == 2 and t["head"] == B for t in result.values()))

    def test_production_never_selects_a_pr(self):
        result = controller.targets(API("pull_request"), CONFIG, "production")
        self.assertEqual(result["api"]["event"], "push")
        self.assertIsNone(result["api"]["pr"])


class Archives(unittest.TestCase):
    def test_zip_checks_digest_and_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("../outside", "bad")
            digest = "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
            with self.assertRaises(ValueError):
                extract_zip(path, Path(directory) / "out", digest)
            with self.assertRaises(ValueError):
                extract_zip(path, Path(directory) / "out", "sha256:" + "0" * 64)

    def test_api_rejects_links_and_private_env(self):
        for name, kind in [(".env", tarfile.REGTYPE), (".env.production", tarfile.REGTYPE),
                           ("link", tarfile.SYMTYPE), ("../outside", tarfile.REGTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "api.tar"
                with tarfile.open(path, "w") as archive:
                    item = tarfile.TarInfo(name)
                    item.type = kind
                    item.linkname = "/etc/passwd" if kind == tarfile.SYMTYPE else ""
                    archive.addfile(item, io.BytesIO(b""))
                with self.assertRaises(ValueError):
                    extract_api(path, Path(directory) / "out")

    def test_valid_zip_extracts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("index.html", "hello")
            digest = "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
            extract_zip(path, Path(directory) / "out", digest)
            self.assertEqual((Path(directory) / "out/index.html").read_text(), "hello")


if __name__ == "__main__":
    unittest.main()
