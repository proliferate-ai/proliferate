"""Synthetic-only proof of the fixed-recipient Sentry custody adapter."""

import base64
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from nacl.exceptions import CryptoError
from nacl.public import PrivateKey, SealedBox

SPEC = importlib.util.spec_from_file_location(
    "custody", Path(__file__).with_name("seal-sentry-credential.py")
)
custody = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(custody)
NOW = datetime(2026, 9, 5, tzinfo=UTC)


class FixedClock:
    @staticmethod
    def now(zone):
        return NOW


SHA = "a" * 40


def environment():
    return {
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REPOSITORY": custody.SOURCE_REPOSITORY,
        "GITHUB_REF": custody.SOURCE_REF,
        "GITHUB_WORKFLOW_REF": custody.WORKFLOW_REF,
        "GITHUB_SERVER_URL": "https://github.com",
        "GITHUB_SHA": SHA,
        "GITHUB_WORKFLOW_SHA": SHA,
        "GITHUB_RUN_ID": "123456789",
        "GITHUB_RUN_ATTEMPT": "1",
    }


class CustodyTests(unittest.TestCase):
    def test_real_sealed_box_roundtrip_preserves_exact_bytes_and_is_randomized(self):
        private = PrivateKey.generate()
        public = base64.b64encode(bytes(private.public_key)).decode("ascii")
        secret = "synthetic token ☃ with preserved whitespace \n"
        first, second = [custody.seal(secret, public) for _ in range(2)]
        self.assertNotEqual(first, second)
        encrypted = base64.b64decode(first, validate=True)
        self.assertEqual(SealedBox(private).decrypt(encrypted), secret.encode("utf-8"))
        self.assertEqual(len(encrypted), len(secret.encode("utf-8")) + 48)
        changed = encrypted[:-1] + bytes([encrypted[-1] ^ 1])
        with self.assertRaises(CryptoError):
            SealedBox(private).decrypt(changed)
        with self.assertRaises(CryptoError):
            SealedBox(PrivateKey.generate()).decrypt(encrypted)

    def test_fixed_destination_and_large_key_id_remain_exact(self):
        result = custody.receipt(environment(), "synthetic-not-an-actual-token", NOW)
        self.assertEqual(result["destination"]["key_id"], "3380204578043523366")
        self.assertIsInstance(result["destination"]["key_id"], str)
        self.assertEqual(result["destination"]["repository"], "proliferate-ai/proliferate-next")
        self.assertEqual(result["destination"]["environment"], "staging")
        self.assertEqual(result["destination"]["secret_name"], "SENTRY_AUTH_TOKEN")
        self.assertEqual(result["source"]["sha"], SHA)
        self.assertNotIn("synthetic-not-an-actual-token", json.dumps(result))

    def test_wrong_execution_or_revision_refuses_before_encryption(self):
        mutations = {
            "GITHUB_EVENT_NAME": "pull_request",
            "GITHUB_REPOSITORY": "other/repo",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_WORKFLOW_REF": "other",
            "GITHUB_SERVER_URL": "https://example.test",
            "GITHUB_SHA": "bad",
            "GITHUB_WORKFLOW_SHA": "b" * 40,
            "GITHUB_RUN_ID": "0",
            "GITHUB_RUN_ATTEMPT": "",
        }
        for key, value in mutations.items():
            with self.subTest(key=key), patch.object(custody, "seal") as seal:
                with self.assertRaises(ValueError):
                    custody.receipt({**environment(), key: value}, "synthetic", NOW)
                seal.assert_not_called()

    def test_adapter_sunset_is_exclusive(self):
        custody.receipt(environment(), "synthetic", custody.SUNSET - timedelta(microseconds=1))
        with patch.object(custody, "seal") as seal:
            for now in [
                custody.SUNSET,
                custody.SUNSET + timedelta(seconds=1),
                NOW.replace(tzinfo=None),
            ]:
                with self.assertRaises(ValueError):
                    custody.receipt(environment(), "synthetic", now)
            seal.assert_not_called()

    def test_empty_oversized_and_bad_keys_refuse(self):
        for secret, public in [
            ("", custody.PUBLIC_KEY),
            ("x" * (48 * 1024 + 1), custody.PUBLIC_KEY),
            ("synthetic", "bad"),
            ("synthetic", base64.b64encode(b"x" * 31).decode()),
        ]:
            with self.assertRaises(ValueError):
                custody.seal(secret, public)

    def test_main_only_writes_sealed_receipt_and_does_not_inherit_token_to_git(self):
        secret = "synthetic-main-token"
        stdout, stderr = io.StringIO(), io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            env = {**environment(), "RUNNER_TEMP": directory, "SENTRY_AUTH_TOKEN": secret}

            def git(*args, **kwargs):
                self.assertNotIn("SENTRY_AUTH_TOKEN", os.environ)
                return subprocess.CompletedProcess(args, 0, stdout=SHA + "\n")

            with (
                patch.dict(os.environ, env, clear=True),
                patch.object(custody.subprocess, "run", git),
                patch.object(custody.sys, "argv", ["seal-sentry-credential.py"]),
                patch.object(custody, "datetime", FixedClock),
                redirect_stdout(stdout),
                redirect_stderr(stderr),
            ):
                self.assertEqual(custody.main(), 0)
            files = list(Path(directory).rglob("*"))
            receipt = Path(directory) / "sentry-custody/sealed.json"
            self.assertEqual([p for p in files if p.is_file()], [receipt])
            self.assertEqual(receipt.stat().st_mode & 0o777, 0o600)
            self.assertEqual(receipt.parent.stat().st_mode & 0o777, 0o700)
            self.assertNotIn(secret, receipt.read_text() + stdout.getvalue() + stderr.getvalue())
            record = json.loads(receipt.read_text())
            self.assertEqual(
                record["destination"],
                custody.receipt(environment(), "synthetic", NOW)["destination"],
            )

    def test_library_errors_cannot_print_token_or_create_artifact(self):
        secret = "synthetic-error-token"
        stdout, stderr = io.StringIO(), io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.dict(
                    os.environ,
                    {**environment(), "RUNNER_TEMP": directory, "SENTRY_AUTH_TOKEN": secret},
                    clear=True,
                ),
                patch.object(
                    custody.subprocess,
                    "run",
                    return_value=subprocess.CompletedProcess([], 0, stdout=SHA),
                ),
                patch.object(custody, "seal", side_effect=RuntimeError(secret)),
                patch.object(custody.sys, "argv", ["seal-sentry-credential.py"]),
                patch.object(custody, "datetime", FixedClock),
                redirect_stdout(stdout),
                redirect_stderr(stderr),
            ):
                self.assertEqual(custody.main(), 1)
            self.assertEqual(list(Path(directory).iterdir()), [])
        self.assertNotIn(secret, stdout.getvalue() + stderr.getvalue())
        self.assertIn("Credential sealing failed", stderr.getvalue())

    def test_preexisting_directory_and_extra_arguments_cannot_emit_new_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "sentry-custody"
            target.mkdir()
            original = target / "sealed.json"
            original.write_text("existing")
            for argv in [
                ["seal-sentry-credential.py"],
                ["seal-sentry-credential.py", "other-key"],
            ]:
                with (
                    patch.dict(
                        os.environ,
                        {
                            **environment(),
                            "RUNNER_TEMP": directory,
                            "SENTRY_AUTH_TOKEN": "synthetic",
                        },
                        clear=True,
                    ),
                    patch.object(
                        custody.subprocess,
                        "run",
                        return_value=subprocess.CompletedProcess([], 0, stdout=SHA),
                    ),
                    patch.object(custody.sys, "argv", argv),
                    patch.object(custody, "datetime", FixedClock),
                    redirect_stdout(io.StringIO()),
                    redirect_stderr(io.StringIO()),
                ):
                    self.assertEqual(custody.main(), 1)
                self.assertEqual(original.read_text(), "existing")


if __name__ == "__main__":
    unittest.main()
