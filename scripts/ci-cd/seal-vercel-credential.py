"""Seal the owning staging environment's deployment token to one reviewed GitHub environment key."""

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from nacl.public import PublicKey, SealedBox

SOURCE_REPOSITORY = "proliferate-ai/proliferate"
SOURCE_REF = "refs/heads/codex/foundation-signing"
WORKFLOW_REF = SOURCE_REPOSITORY + "/.github/workflows/release-desktop.yml@" + SOURCE_REF
DESTINATION = {
    "repository": "proliferate-ai/proliferate-next",
    "environment": "production",
    "secret_name": "VERCEL_TOKEN",
    "key_id": "3380204578043523366",
}
PUBLIC_KEY = "QfCOjg2wHZBu7ROwU0wOkpKK2jE4F6MGRYU7oKccYgA="
TEAM_ID = "team_hAhxscLSt2Kmp5tTVMsApgQ4"
PROJECTS = {
    "staging": "prj_3OiqUIdrBor3BV3UsqGwNWYFim4z",
    "production": "prj_dXJ04v6kVxGMRRFgl8tTDagyvgjX",
}
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
            "secret_name": "VERCEL_TOKEN",
        },
        "created_at": now.astimezone(UTC).isoformat(),
        "encryption": "libsodium.crypto_box_seal",
        "encrypted_value": seal(secret, PUBLIC_KEY),
    }


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Redirect refused")


def read_project(secret: str, project: str) -> dict:
    url = f"https://api.vercel.com/v9/projects/{project}?teamId={TEAM_ID}"
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
            if response.status != 200:
                raise ValueError("Project read refused")
            body = response.read(1_048_577)
            if len(body) > 1_048_576:
                raise ValueError("Project response oversized")
            return json.loads(body)
    except urllib.error.HTTPError as error:
        print(f"Configured Vercel project read returned HTTP {error.code}.", file=sys.stderr)
        raise ValueError("Project read refused") from None


def verify_projects(secret: str, read=read_project) -> dict:
    verified = {}
    for environment, project in PROJECTS.items():
        body = read(secret, project)
        if body.get("id") != project or body.get("accountId") != TEAM_ID:
            raise ValueError("Credential project authority mismatch")
        verified[environment] = project
    return {"team_id": TEAM_ID, "project_ids": verified, "read_access_verified": True}


def main() -> int:
    secret = os.environ.pop("VERCEL_TOKEN", "")
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
        result["source"]["environment"] = "staging"
        result["credential_authority"] = verify_projects(secret)
        temporary = Path(environment["RUNNER_TEMP"])
        if not temporary.is_absolute() or not temporary.is_dir():
            raise ValueError("Runner temporary directory unavailable")
        directory = temporary / "vercel-custody"
        directory.mkdir(mode=0o700)
        fd = os.open(directory / "sealed.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(result, stream, separators=(",", ":"))
            stream.write("\n")
        print("Sealed credential artifact prepared for the fixed production destination.")
        return 0
    except Exception:
        # Never print arbitrary exception text: a library or runner error may contain secret input.
        print("Credential sealing failed; no destination write was attempted.", file=sys.stderr)
        return 1
    finally:
        secret = ""


if __name__ == "__main__":
    raise SystemExit(main())
