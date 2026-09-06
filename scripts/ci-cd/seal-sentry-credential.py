"""Seal the owning repository's upload token to one reviewed GitHub environment key."""

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

from nacl.public import PublicKey, SealedBox

SOURCE_REPOSITORY = "proliferate-ai/proliferate"
SOURCE_REF = "refs/heads/codex/foundation-signing"
WORKFLOW_REF = SOURCE_REPOSITORY + "/.github/workflows/release-desktop.yml@" + SOURCE_REF
DESTINATION = {
    "repository": "proliferate-ai/proliferate-next",
    "environment": "staging",
    "secret_name": "SENTRY_AUTH_TOKEN",
    "key_id": "3380204578043523366",
}
PUBLIC_KEY = "Js7GiBKHNlPwPgJ9vu1nlFvmwctyChO1tyA5gztzUXw="
SUNSET = datetime(2026, 9, 12, tzinfo=UTC)


def seal(secret: str, public_key: str) -> str:
    key = base64.b64decode(public_key, validate=True)
    if len(key) != 32 or base64.b64encode(key).decode("ascii") != public_key:
        raise ValueError("Invalid encryption key")
    message = secret.encode("utf-8")
    if not 0 < len(message) <= 48 * 1024:
        raise ValueError("Missing or oversized credential")
    # GitHub requires libsodium crypto_box_seal, including its ephemeral public key and MAC.
    return base64.b64encode(SealedBox(PublicKey(key)).encrypt(message)).decode("ascii")


def receipt(environment: dict[str, str], secret: str, now: datetime) -> dict:
    expected = {
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REPOSITORY": SOURCE_REPOSITORY,
        "GITHUB_REF": SOURCE_REF,
        "GITHUB_WORKFLOW_REF": WORKFLOW_REF,
        "GITHUB_SERVER_URL": "https://github.com",
    }
    if any(environment.get(key) != value for key, value in expected.items()):
        raise ValueError("Wrong execution owner")
    sha = environment.get("GITHUB_SHA", "")
    workflow_sha = environment.get("GITHUB_WORKFLOW_SHA", "")
    if not re.fullmatch(r"[a-f0-9]{40}", sha) or workflow_sha != sha:
        raise ValueError("Wrong workflow/source revision")
    if not all(
        re.fullmatch(r"[1-9][0-9]*", environment.get(k, ""))
        for k in ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]
    ):
        raise ValueError("Missing run identity")
    if now.tzinfo is None or now >= SUNSET:
        raise ValueError("Qualification adapter has expired")
    return {
        "schema": 1,
        "destination": {
            **DESTINATION,
            "public_key_sha256": hashlib.sha256(
                base64.b64decode(PUBLIC_KEY, validate=True)
            ).hexdigest(),
        },
        "source": {
            "repository": SOURCE_REPOSITORY,
            "ref": SOURCE_REF,
            "workflow_ref": WORKFLOW_REF,
            "sha": sha,
            "workflow_sha": workflow_sha,
            "run_id": environment["GITHUB_RUN_ID"],
            "run_attempt": environment["GITHUB_RUN_ATTEMPT"],
            "secret_name": "SENTRY_AUTH_TOKEN",
        },
        "created_at": now.astimezone(UTC).isoformat(),
        "encryption": "libsodium.crypto_box_seal",
        "encrypted_value": seal(secret, PUBLIC_KEY),
    }


def main() -> int:
    secret = os.environ.pop("SENTRY_AUTH_TOKEN", "")
    try:
        if len(sys.argv) != 1:
            raise ValueError("Arguments are unsupported")
        environment = dict(os.environ)
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True
        ).stdout.strip()
        if head != environment.get("GITHUB_SHA"):
            raise ValueError("Checkout does not match the dispatched revision")
        result = receipt(environment, secret, datetime.now(UTC))
        temporary = Path(environment["RUNNER_TEMP"])
        if not temporary.is_absolute() or not temporary.is_dir():
            raise ValueError("Runner temporary directory unavailable")
        directory = temporary / "sentry-custody"
        directory.mkdir(mode=0o700)
        fd = os.open(directory / "sealed.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(result, stream, separators=(",", ":"))
            stream.write("\n")
        print("Sealed credential artifact prepared for the fixed staging destination.")
        return 0
    except Exception:
        # Never print arbitrary exception text: a library or runner error may contain secret input.
        print("Credential sealing failed; no destination write was attempted.", file=sys.stderr)
        return 1
    finally:
        secret = ""


if __name__ == "__main__":
    raise SystemExit(main())
