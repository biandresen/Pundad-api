import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import prepare_frontend_assets, switch_current


@unittest.skipUnless(shutil.which("nginx"), "nginx is required for isolated HTTP validation")
class NginxAssets(unittest.TestCase):
    def test_both_templates_deliver_current_and_previous_assets_with_correct_headers(self):
        for environment, template in (("production", "ops/deploy/nginx.conf"), ("staging", "ops/staging/nginx.conf")):
            with self.subTest(environment=environment), tempfile.TemporaryDirectory(prefix="pundad-nginx-") as temporary:
                directory = Path(temporary)
                root = directory / environment
                previous = root / "releases/a"
                current = root / "releases/b"
                for release in (previous, current):
                    (release / "frontend/assets").mkdir(parents=True)
                    (release / "frontend/index.html").write_text("<html>" + release.name + "</html>")
                    (release / "frontend/sw.js").write_text("// worker")
                    (release / "frontend/manifest.webmanifest").write_text('{"name":"PunDad"}')
                    (release / "frontend/__version.json").write_text(json.dumps({"environment": environment, "release": release.name}))
                    (release / "frontend/__build.json").write_text(json.dumps({"buildId": release.name}))
                (previous / "frontend/assets/index-aaaaaaaa.css").write_text("body { color: red }")
                (previous / "frontend/assets/DashboardLayout-aaaaaaaa.js").write_text("export default 'a'")
                (current / "frontend/assets/index-bbbbbbbb.css").write_text("body { color: blue }")
                prepare_frontend_assets(root, current / "frontend", previous)
                switch_current(root, current)
                with socket.socket() as listener:
                    listener.bind(("127.0.0.1", 0))
                    port = listener.getsockname()[1]
                source = (Path(__file__).resolve().parents[3] / template).read_text()
                source = source.replace("listen 80;", f"listen 127.0.0.1:{port};").replace(f"/srv/pundad/{environment}", str(root))
                config = directory / "nginx.conf"
                config.write_text(f"pid {directory}/nginx.pid; error_log {directory}/error.log; events {{}} http {{ include /etc/nginx/mime.types; access_log off; {source} }}")
                process = subprocess.Popen([shutil.which("nginx"), "-p", str(directory), "-c", str(config), "-g", "daemon off;"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                try:
                    origin = f"http://127.0.0.1:{port}"
                    for attempt in range(100):
                        try:
                            urllib.request.urlopen(origin + "/__version.json", timeout=1).close()
                            break
                        except OSError:
                            if process.poll() is not None:
                                self.fail(process.stderr.read().decode())
                            time.sleep(0.01)
                    for asset, mime in (("index-aaaaaaaa.css", "text/css"), ("DashboardLayout-aaaaaaaa.js", "application/javascript"), ("index-bbbbbbbb.css", "text/css")):
                        with urllib.request.urlopen(origin + "/assets/" + asset) as response:
                            self.assertEqual(response.status, 200)
                            self.assertEqual(response.headers.get_content_type(), mime)
                            self.assertIn("immutable", response.headers["Cache-Control"])
                    for path in ("/", "/index.html", "/dashboard?lang=no", "/sw.js"):
                        with urllib.request.urlopen(origin + path) as response:
                            self.assertIn("no-cache", response.headers["Cache-Control"])
                    with urllib.request.urlopen(origin + "/manifest.webmanifest") as response:
                        self.assertEqual(response.headers.get_content_type(), "application/manifest+json")
                        self.assertIn("no-cache", response.headers["Cache-Control"])
                    with urllib.request.urlopen(origin + "/__version.json") as response:
                        self.assertEqual(response.headers["Cache-Control"], "no-store")
                        self.assertEqual(json.load(response)["release"], "b")
                    with urllib.request.urlopen(origin + "/__build.json") as response:
                        self.assertEqual(response.headers["Cache-Control"], "no-store")
                        self.assertEqual(json.load(response)["buildId"], "b")
                    for missing in ("/assets/missing-aaaaaaaa.css", "/assets/missing-aaaaaaaa.js"):
                        with self.assertRaises(urllib.error.HTTPError) as caught:
                            urllib.request.urlopen(origin + missing)
                        response = caught.exception
                        self.assertEqual(response.code, 404)
                        self.assertEqual(response.headers["Cache-Control"], "no-store")
                        self.assertNotIn(b"<html>b</html>", response.read())
                        response.close()
                    with self.assertRaises(urllib.error.HTTPError) as hidden:
                        urllib.request.urlopen(origin + "/.retained-assets/assets/index-aaaaaaaa.css")
                    self.assertEqual(hidden.exception.code, 404)
                    hidden.exception.close()
                    switch_current(root, previous)
                    with urllib.request.urlopen(origin + "/assets/index-aaaaaaaa.css") as response:
                        self.assertEqual(response.headers.get_content_type(), "text/css")
                    with urllib.request.urlopen(origin + "/__version.json") as response:
                        self.assertEqual(json.load(response)["release"], "a")
                finally:
                    process.terminate()
                    process.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
