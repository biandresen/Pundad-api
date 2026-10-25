import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common


class FrontendAssets(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "staging"
        (self.root / "releases").mkdir(parents=True)

    def release(self, name):
        release = self.root / "releases" / name
        (release / "frontend/assets").mkdir(parents=True)
        (release / "frontend/index.html").write_text(name)
        (release / "frontend/__version.json").write_text(json.dumps({"environment": "staging", "release": name}))
        return release

    def test_only_previous_native_hashed_assets_are_retained(self):
        previous = self.release("a")
        (previous / "frontend/assets/DashboardLayout-abcdefgh.js").write_text("release a")
        (previous / "frontend/assets/index-abcdefgh.css").write_text("body {}")
        (previous / "frontend/assets/unhashed.js").write_text("do not retain")
        inherited = previous / "frontend/.retained-assets/assets"
        inherited.mkdir(parents=True)
        (inherited / "ancient-abcdefgh.js").write_text("two releases old")
        current = self.release("b")
        common.prepare_frontend_assets(self.root, current / "frontend", previous)
        retained = current / "frontend/.retained-assets/assets"
        self.assertEqual(sorted(path.name for path in retained.iterdir()), ["DashboardLayout-abcdefgh.js", "index-abcdefgh.css"])
        self.assertEqual((retained / "DashboardLayout-abcdefgh.js").read_text(), "release a")
        self.assertEqual((current / "frontend/index.html").read_text(), "b")
        self.assertEqual(json.loads((current / "frontend/__version.json").read_text())["release"], "b")

    def test_retention_rejects_cross_environment_and_reserved_artifact_paths(self):
        previous = self.release("a")
        current = self.release("b")
        (previous / "frontend/__version.json").write_text('{"environment":"production"}')
        with self.assertRaises(ValueError):
            common.prepare_frontend_assets(self.root, current / "frontend", previous)
        (current / "frontend/.retained-assets").mkdir()
        with self.assertRaises(ValueError):
            common.prepare_frontend_assets(self.root, current / "frontend", None)

    def test_previous_asset_symlinks_and_hash_collisions_are_rejected(self):
        previous = self.release("a")
        current = self.release("b")
        asset = previous / "frontend/assets/index-abcdefgh.js"
        asset.symlink_to(previous / "frontend/index.html")
        with self.assertRaises(ValueError):
            common.prepare_frontend_assets(self.root, current / "frontend", previous)
        asset.unlink()
        asset.write_text("old")
        (current / "frontend/assets/index-abcdefgh.js").write_text("different bytes for same name")
        with self.assertRaises(ValueError):
            common.prepare_frontend_assets(self.root, current / "frontend", previous)

    def test_atomic_activation_rollback_and_cleanup_keep_reachable_assets(self):
        old = self.release("00")
        previous = self.release("01")
        (previous / "frontend/assets/route-abcdefgh.js").write_text("previous route")
        current = self.release("02")
        common.prepare_frontend_assets(self.root, current / "frontend", previous)
        common.switch_current(self.root, previous)
        common.switch_current(self.root, current)
        common.switch_current(self.root, previous, name="previous")
        for name in ("03-failed", "04-failed", "05-failed"):
            self.release(name)
        common.prune_releases(self.root)
        self.assertFalse(old.exists())
        self.assertTrue(previous.exists())
        self.assertTrue(current.exists())
        self.assertEqual((self.root / "current/frontend/.retained-assets/assets/route-abcdefgh.js").read_text(), "previous route")
        common.switch_current(self.root, previous)
        self.assertEqual((self.root / "current/frontend/assets/route-abcdefgh.js").read_text(), "previous route")
        self.assertEqual((self.root / "current/frontend/index.html").read_text(), "01")
        self.assertFalse((self.root / ".current-next").exists())

    def test_atomic_activation_refuses_targets_outside_environment(self):
        with self.assertRaises(ValueError):
            common.switch_current(self.root, self.root.parent / "production/releases/a")


if __name__ == "__main__":
    unittest.main()
