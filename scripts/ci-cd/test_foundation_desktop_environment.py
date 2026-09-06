"""Execute the actual qualification workflow's environment, manifest and receipt blocks."""

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/release-desktop.yml"
DOCUMENT = json.loads(subprocess.check_output(
    ["ruby", "-ryaml", "-rjson", "-e", "puts JSON.generate(YAML.load_file(ARGV[0]))", str(WORKFLOW)],
    text=True,
))
STEPS = DOCUMENT["jobs"]["sign"]["steps"]
ORIGINS = {"staging": "https://api-staging.proliferate.com", "prod": "https://api.proliferate.com"}


def block(step_name):
    step = next(step for step in STEPS if step.get("name") == step_name)
    return re.search(r"python3 - <<'PYCODE'\n(.*?)\nPYCODE", step["run"], re.S).group(1)


def environment(target):
    return {
        "PATH": os.environ["PATH"], "VITE_ENV": target, "VITE_API_URL": ORIGINS[target],
        "RELEASE": "a" * 40, "VITE_RELEASE": "a" * 40, "VITE_SHELL": "desktop",
        "VITE_TELEMETRY_MODE": "prod", "SOURCE_SHA256": "b" * 64, "SOURCEMAP_PAIRS": "3",
    }


def execute(step, env):
    return subprocess.run([sys.executable, "-c", block(step)], env=env, capture_output=True, text=True)


class DesktopEnvironmentTests(unittest.TestCase):
    def test_only_fixed_targets_pass_before_build_and_signing_credentials(self):
        dispatch = DOCUMENT.get("on", DOCUMENT.get("true"))["workflow_dispatch"]
        choice = dispatch["inputs"]["target_environment"]
        self.assertEqual(choice["default"], "staging")
        self.assertEqual(choice["options"], ["staging", "prod"])
        self.assertEqual(DOCUMENT["env"]["VITE_ENV"], "${{ inputs.target_environment || 'staging' }}")
        self.assertEqual(DOCUMENT["env"]["VITE_API_URL"], "${{ inputs.target_environment == 'prod' && 'https://api.proliferate.com' || 'https://api-staging.proliferate.com' }}")
        self.assertLess(
            next(i for i, s in enumerate(STEPS) if s.get("name") == "Verify the fixed desktop environment"),
            next(i for i, s in enumerate(STEPS) if s.get("name") == "Fetch the fixed reviewed source archive"),
        )
        for target in ORIGINS:
            with self.subTest(target=target):
                env = environment(target)
                good = execute("Verify the fixed desktop environment", env)
                self.assertEqual(good.returncode, 0, good.stderr)
                for changed in (
                    {"VITE_ENV": "production"}, {"VITE_ENV": ""},
                    {"VITE_API_URL": "https://other.example.test"},
                    {"VITE_RELEASE": "c" * 40}, {"VITE_TELEMETRY_MODE": "dev"},
                    {"VITE_SHELL": "web"},
                ):
                    self.assertNotEqual(execute("Verify the fixed desktop environment", {**env, **changed}).returncode, 0)

    def test_packaged_runtime_must_match_target_source_and_actual_bytes(self):
        for target in ORIGINS:
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                resources = Path(directory) / "Contents/Resources/runtime"
                resources.mkdir(parents=True)
                (resources / "node").write_bytes(b"synthetic signed node bytes")
                (resources / "anyharness.mjs").write_bytes(b"synthetic runtime bytes")
                record = {
                    "release": "a" * 40, "env": target, "serverOrigin": ORIGINS[target],
                    "nodeSha256": "old pre-signing hash",
                    "runtimeSha256": hashlib.sha256((resources / "anyharness.mjs").read_bytes()).hexdigest(),
                }
                env = {**environment(target), "BUILT_APP": directory}
                step = "Sign Node then record its final hash and sign the containing app"
                manifest = resources / "manifest.json"
                for changed in ({}, {"env": "other"}, {"serverOrigin": "https://other.example.test"}, {"release": "c" * 40}, {"runtimeSha256": "wrong"}):
                    manifest.write_text(json.dumps({**record, **changed}))
                    result = execute(step, env)
                    if changed:
                        self.assertNotEqual(result.returncode, 0)
                    else:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertEqual(json.loads(manifest.read_text())["nodeSha256"], hashlib.sha256((resources / "node").read_bytes()).hexdigest())

    def test_final_receipt_and_archive_names_keep_environment_and_hash(self):
        upload = next(step for step in STEPS if step.get("name") == "Retain signed candidate and verification receipt")
        self.assertEqual(upload["with"]["name"], "foundation-desktop-${{ env.VITE_ENV }}-${{ env.RELEASE }}")
        self.assertEqual(upload["with"]["retention-days"], 7)
        for target in ORIGINS:
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "qualification").mkdir()
                artifact = root / f"qualification/Proliferate-{target}-arm64.zip"
                artifact.write_bytes(f"synthetic {target} archive".encode())
                (root / "notary-result.json").write_text(json.dumps({"status": "Accepted"}))
                result = execute("Notarize, staple and verify the actual candidate app", {**environment(target), "RUNNER_TEMP": directory})
                self.assertEqual(result.returncode, 0, result.stderr)
                receipt = json.loads((root / "qualification/receipt.json").read_text())
                self.assertEqual((receipt["environment"], receipt["api_origin"]), (target, ORIGINS[target]))
                self.assertEqual(receipt["artifact_sha256"], hashlib.sha256(artifact.read_bytes()).hexdigest())
                self.assertEqual(receipt["source_revision"], "a" * 40)
                self.assertFalse(receipt["installed_oauth_qualified"])
                self.assertEqual(receipt["sentry_project"], "proliferate/desktop")
                self.assertTrue(receipt["sourcemaps_uploaded"])
                self.assertFalse(receipt["served_sourcemaps"])


if __name__ == "__main__":
    unittest.main()
