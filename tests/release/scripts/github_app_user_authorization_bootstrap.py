"""One-time GitHub App user-authorization bootstrap via the OAuth device flow.

The T3 seed seam (``github_app_seed.py``) plants the durable user's GitHub App
user-to-server authorization WITHOUT a browser by *refreshing* a bootstrap
refresh token. But that bootstrap token has to be obtained once, interactively,
by the GitHub identity the durable user maps to authorizing the target App.

This script makes that one interactive step as small and reproducible as
possible using GitHub's OAuth **device flow** (no callback URL, no client
secret, no browser automation): it prints a short user code + a URL; the
operator opens the URL *while signed in as the fixture GitHub identity*
(proliferate-e2e-bot for the staging App) and approves; the script then polls
for the token pair and records the refresh token into the seed state file.

It is deliberately dependency-free (stdlib ``urllib`` only) so it runs from any
machine with internet access and a browser — it does NOT need VPC access or the
server checkout. Only ``github_app_seed.py seed`` needs the DB (run that in-VPC
afterward for the staging lane).

Prerequisites on the target GitHub App (App settings → owner's Developer
settings → GitHub Apps → <app>):
  * "Enable Device Flow" must be ON (device flow is opt-in per App).
  * "Expire user authorization tokens" must be ON, or GitHub returns no refresh
    token and the seed seam has nothing durable to rotate.

Usage:
  python github_app_user_authorization_bootstrap.py \
      --client-id Iv23liLLfpwZWNDEpVe6            # staging App (proliferate-cloud-staging)

  # options:
  #   --state-file PATH   where to write the refresh token (default:
  #                       $RELEASE_E2E_GITHUB_APP_SEED_STATE or
  #                       ~/.proliferate-local/dev/release-e2e-github-seed.json)
  #   --print-only        do NOT write the state file; just print the refresh
  #                       token (set it as the staging RELEASE_E2E_GITHUB_APP_SEED_REFRESH_TOKEN
  #                       secret and run the in-VPC seed with that env instead).

Never prints the access token. Prints the refresh token only with --print-only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

_DEVICE_CODE_URL = "https://github.com/login/device/code"
_TOKEN_URL = "https://github.com/login/oauth/access_token"
_DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"

_DEFAULT_STATE_PATH = (
    Path.home() / ".proliferate-local" / "dev" / "release-e2e-github-seed.json"
)


def _post_form(url: str, data: dict[str, str]) -> dict[str, object]:
    body = urllib.parse.urlencode(data).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Accept": "application/json", "User-Agent": "proliferate-release-e2e"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:  # pragma: no cover - network path
        raise SystemExit(f"GitHub returned HTTP {exc.code} for {url}: {exc.read().decode('utf-8', 'replace')}")
    if not isinstance(payload, dict):
        raise SystemExit(f"Unexpected non-object response from {url}: {payload!r}")
    return payload


def _request_device_code(client_id: str) -> dict[str, object]:
    payload = _post_form(_DEVICE_CODE_URL, {"client_id": client_id})
    if "device_code" not in payload:
        raise SystemExit(
            f"Device-code request failed: {payload}. Is 'Enable Device Flow' ON for this App, "
            f"and is the client id correct?"
        )
    return payload


def _poll_for_token(client_id: str, device_code: str, interval: int, expires_in: int) -> dict[str, object]:
    deadline = time.monotonic() + expires_in
    wait = max(interval, 5)
    while time.monotonic() < deadline:
        time.sleep(wait)
        payload = _post_form(
            _TOKEN_URL,
            {"client_id": client_id, "device_code": device_code, "grant_type": _DEVICE_GRANT},
        )
        error = payload.get("error")
        if not error:
            return payload
        if error == "authorization_pending":
            continue
        if error == "slow_down":
            wait += 5
            continue
        if error in ("expired_token", "access_denied", "incorrect_device_code"):
            raise SystemExit(f"Device authorization failed: {error} ({payload.get('error_description')})")
        raise SystemExit(f"Unexpected device-flow error: {payload}")
    raise SystemExit("Device authorization timed out before it was approved.")


def _persist_state(state_path: Path, payload: dict[str, object]) -> None:
    refresh_token = payload.get("refresh_token")
    if not isinstance(refresh_token, str) or not refresh_token.strip():
        raise SystemExit(
            "GitHub returned no refresh_token. Turn ON 'Expire user authorization tokens' in the App "
            "settings, revoke the just-granted authorization, and re-run — the seed seam rotates a refresh "
            "token, so a non-expiring (refresh-less) token is not usable."
        )
    state_path.parent.mkdir(parents=True, exist_ok=True)
    body = {
        "refresh_token": refresh_token.strip(),
        "bootstrapped_at": datetime.now(timezone.utc).isoformat(),
        "source": "github_app_user_authorization_bootstrap.py (device flow)",
    }
    fd, tmp = tempfile.mkstemp(dir=str(state_path.parent), prefix=".seed-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(body, handle)
        os.replace(tmp, state_path)
        os.chmod(state_path, 0o600)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client-id", required=True, help="the target GitHub App's client id")
    parser.add_argument("--state-file", default=None, help="where to write the refresh token")
    parser.add_argument(
        "--print-only",
        action="store_true",
        help="print the refresh token instead of writing the state file",
    )
    args = parser.parse_args()

    device = _request_device_code(args.client_id)
    user_code = device["user_code"]
    verification_uri = device["verification_uri"]
    interval = int(device.get("interval", 5))
    expires_in = int(device.get("expires_in", 900))

    print("=" * 72, file=sys.stderr)
    print("GitHub App user-authorization bootstrap (device flow)", file=sys.stderr)
    print("=" * 72, file=sys.stderr)
    print(f"1. Open:  {verification_uri}", file=sys.stderr)
    print(f"2. Enter code:  {user_code}", file=sys.stderr)
    print(
        "3. IMPORTANT: be signed in to GitHub as the fixture identity that has\n"
        "   access to the fixture repo (staging App -> proliferate-e2e-bot), then\n"
        "   approve the authorization. Waiting...",
        file=sys.stderr,
    )

    token_payload = _poll_for_token(args.client_id, str(device["device_code"]), interval, expires_in)

    if args.print_only:
        refresh_token = token_payload.get("refresh_token")
        if not isinstance(refresh_token, str) or not refresh_token.strip():
            raise SystemExit(
                "GitHub returned no refresh_token — enable 'Expire user authorization tokens' and re-run."
            )
        print(refresh_token.strip())
        print(
            "Refresh token printed above. Set it as the staging RELEASE_E2E_GITHUB_APP_SEED_REFRESH_TOKEN "
            "secret, then run `github_app_seed.py seed <durable-email>` in-VPC against the staging DB.",
            file=sys.stderr,
        )
        return

    state_path = Path(
        args.state_file
        or os.environ.get("RELEASE_E2E_GITHUB_APP_SEED_STATE", "").strip()
        or _DEFAULT_STATE_PATH
    )
    _persist_state(state_path, token_payload)
    print(f"Bootstrap refresh token written to {state_path}.", file=sys.stderr)
    print(
        "Next: run `github_app_seed.py seed <durable-email>` (in-VPC against the staging DB for the "
        "staging lane) to plant the durable user's authorization row.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
