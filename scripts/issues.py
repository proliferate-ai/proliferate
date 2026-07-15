#!/usr/bin/env python3
"""Safe REST helper for the production issue tracker (F2 operating surface).

This is the complete machine interface an agent uses to operate the queue. It
speaks only to the fixed issues origin, fetches the agent credential by
reference for each invocation, and exposes exactly nine commands that map onto
the accepted F1 REST surface:

    list  poll  get  ops  claim  release  patch  dedup  link-pr

It never creates issues by hand, never fetches private report objects, and
never dumps raw provider payloads. The agent credential and the secret-provider
response are redacted from every error path; they are never printed, logged, or
persisted. See specs/developing/debugging/issue-triage.md for the human runbook.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

# The one canonical origin. The helper refuses to talk to any other host so it
# cannot be pointed at an attacker-controlled or staging endpoint by accident.
FIXED_ORIGIN = "https://issues.proliferate.com"

# Where the machine credential lives. Fetched fresh for every invocation through
# the approved AWS path; there is no second durable copy in the local ops env.
SECRET_ID = "issue-tracker/app"
SECRET_FIELD = "agentApiKey"

CONNECT_TIMEOUT_S = 5.0
READ_TIMEOUT_S = 20.0
# urllib uses a single timeout for connect+read; use the larger bound.
REQUEST_TIMEOUT_S = READ_TIMEOUT_S

# Bounded reads so a misbehaving or oversized response cannot exhaust memory or
# flood stdout. Applies to both the API response and the secret-provider output.
MAX_RESPONSE_BYTES = 1_048_576  # 1 MiB
MAX_SECRET_BYTES = 65_536

REDACTED = "[redacted]"

MUTATIONS = {"claim", "release", "patch", "dedup", "link-pr"}


class HelperError(Exception):
    """A helper-level failure whose message is already safe to print."""


# --------------------------------------------------------------------------- #
# Origin and credential
# --------------------------------------------------------------------------- #
def resolve_origin() -> str:
    """Return the canonical origin, rejecting any other host.

    An operator may set ``ISSUES_ORIGIN`` in the local ops environment, but it
    must equal the fixed origin. Any other value fails closed rather than
    silently redirecting agent traffic.
    """
    origin = os.environ.get("ISSUES_ORIGIN", FIXED_ORIGIN)
    if origin != FIXED_ORIGIN:
        raise HelperError(
            f"refusing non-canonical issues origin; only {FIXED_ORIGIN} is allowed"
        )
    return origin


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse every redirect.

    Python's default redirect handler copies the Authorization header onto the
    follow-up request, so a redirect from the fixed origin could forward the
    bearer token off-origin. The fixed tracker origin never legitimately
    redirects agent routes, so redirects fail closed: returning ``None`` makes
    urllib raise the 3xx as an ``HTTPError`` and no second request is issued.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


_OPENER = urllib.request.build_opener(_NoRedirect())


def _urlopen(request: urllib.request.Request, timeout: float):
    """Transport seam. Faked in tests; never contacts the network there."""
    return _OPENER.open(request, timeout=timeout)  # noqa: S310


def _run_aws(args: list[str]) -> subprocess.CompletedProcess:
    """Subprocess seam for the AWS CLI. Faked in tests."""
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=REQUEST_TIMEOUT_S,
    )


def agent_api_key() -> str:
    """Fetch ``agentApiKey`` from ``issue-tracker/app`` via the approved AWS path.

    The value is returned to the caller in memory only. It is never printed or
    written to disk, and any provider failure is reported without echoing the
    provider's raw response (which could contain other secret fields).
    """
    try:
        completed = _run_aws(
            [
                "aws",
                "secretsmanager",
                "get-secret-value",
                "--secret-id",
                SECRET_ID,
                "--query",
                "SecretString",
                "--output",
                "text",
            ]
        )
    except FileNotFoundError as exc:
        raise HelperError("aws CLI not found; cannot resolve the agent credential") from exc
    except subprocess.TimeoutExpired as exc:
        raise HelperError("timed out reading the agent credential from AWS") from exc

    if completed.returncode != 0:
        # Deliberately does NOT include the provider's raw stderr/stdout.
        raise HelperError(
            f"could not read secret {SECRET_ID} (AWS exited {completed.returncode})"
        )

    payload = (completed.stdout or "")[:MAX_SECRET_BYTES]
    try:
        secret = json.loads(payload)
        key = secret[SECRET_FIELD]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        # Never surface the parsed/raw secret material in the error.
        raise HelperError(
            f"secret {SECRET_ID} missing field {SECRET_FIELD}"
        ) from exc

    if not isinstance(key, str) or not key.strip():
        raise HelperError(f"secret {SECRET_ID} field {SECRET_FIELD} is empty")
    return key


# --------------------------------------------------------------------------- #
# Request/response
# --------------------------------------------------------------------------- #
def _build_url(origin: str, path: str, query: dict | None) -> str:
    url = origin + path
    if query:
        filtered = {k: v for k, v in query.items() if v is not None}
        if filtered:
            url = f"{url}?{urllib.parse.urlencode(filtered)}"
    return url


def _read_bounded(response) -> bytes:
    """Read at most the bound; anything larger is a protocol error, not data."""
    data = response.read(MAX_RESPONSE_BYTES + 1)
    if len(data) > MAX_RESPONSE_BYTES:
        raise HelperError(
            f"response exceeded the {MAX_RESPONSE_BYTES}-byte bound; refusing to process it"
        )
    return data


def request(
    method: str,
    path: str,
    *,
    key: str,
    query: dict | None = None,
    body: dict | None = None,
    run_id: str | None = None,
) -> tuple[int, object]:
    """Issue one request and return ``(status, parsed_json_or_text)``.

    Raises :class:`HelperError` on transport/protocol failure. Auth headers are
    never included in any raised message.
    """
    origin = resolve_origin()
    url = _build_url(origin, path, query)

    data = None
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if run_id is not None:
        headers["X-Run-Id"] = run_id

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with _urlopen(req, timeout=REQUEST_TIMEOUT_S) as response:
            raw = _read_bounded(response)
            return response.status, _parse_success(raw)
    except urllib.error.HTTPError as exc:
        if 300 <= exc.code < 400:
            # The no-redirect handler surfaces 3xx here without issuing a
            # follow-up request; the bearer token never leaves the origin.
            raise HelperError(
                f"server responded with a redirect (HTTP {exc.code}); refusing to follow"
            ) from exc
        # A 4xx/5xx with a body (e.g. 409 conflict, 412 precondition) is a
        # meaningful, non-secret API response. Expose its body, not the request.
        raw = _read_bounded(exc) if exc.fp else b""
        return exc.code, _parse_error(raw)
    except urllib.error.URLError as exc:
        raise HelperError(f"transport error contacting {origin}: {_safe_reason(exc)}") from exc
    except TimeoutError as exc:
        raise HelperError(f"timed out contacting {origin}") from exc


def _parse_success(raw: bytes) -> dict:
    """Parse a 2xx body strictly: it must be a JSON object or the call fails.

    A successful status with non-JSON or unexpectedly shaped content is a
    protocol error, not data. The body is withheld from the error message so a
    misrouted response can never leak through stderr.
    """
    text = raw.decode("utf-8", errors="replace")
    if not text:
        return {}
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise HelperError(
            "successful response was not valid JSON (body withheld)"
        ) from exc
    if not isinstance(payload, dict):
        raise HelperError(
            "successful response had an unexpected shape (expected a JSON object)"
        )
    return payload


def _parse_error(raw: bytes) -> object:
    """Parse an error body leniently so conflict/precondition JSON is exposed."""
    text = raw.decode("utf-8", errors="replace")
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}


def _safe_reason(exc: Exception) -> str:
    """A short, non-secret reason string. Never echoes headers or credentials."""
    reason = getattr(exc, "reason", exc)
    return str(reason)[:200]


# --------------------------------------------------------------------------- #
# Output
# --------------------------------------------------------------------------- #
def _emit(status: int, payload: object) -> int:
    """Print bounded JSON to stdout; return the process exit code.

    2xx -> 0. Everything else (including exposed 409/412 conflict bodies) exits
    nonzero so a caller cannot mistake a conflict for success.

    The payload is already bounded at read time, so the serialized document is
    printed whole; truncating serialized JSON would emit an invalid document.
    """
    text = json.dumps(payload, indent=2, sort_keys=True)
    print(text)
    if 200 <= status < 300:
        return 0
    print(f"request failed with HTTP {status}", file=sys.stderr)
    return 1


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #
def _require_run_id(run_id: str | None) -> str:
    if run_id is None or not run_id.strip():
        raise HelperError("a unique --run-id is required for every mutation")
    return run_id.strip()


def cmd_list(args, key: str) -> int:
    query = {
        "status": args.status,
        "kind": args.kind,
        "cursor": args.cursor,
        "limit": args.limit,
    }
    status, payload = request("GET", "/v1/issues", key=key, query=query)
    return _emit(status, payload)


def cmd_poll(args, key: str) -> int:
    # The cursor is passed through byte-for-byte; the helper never rewrites it.
    query = {"cursor": args.cursor, "limit": args.limit}
    status, payload = request("GET", "/v1/issues/poll", key=key, query=query)
    return _emit(status, payload)


def cmd_get(args, key: str) -> int:
    status, payload = request("GET", f"/v1/issues/{args.id}", key=key)
    return _emit(status, payload)


def cmd_ops(args, key: str) -> int:
    status, payload = request("GET", "/v1/ops", key=key)
    return _emit(status, payload)


def cmd_claim(args, key: str) -> int:
    run_id = _require_run_id(args.run_id)
    status, payload = request(
        "POST", f"/v1/issues/{args.id}/claim", key=key, run_id=run_id
    )
    return _emit(status, payload)


def cmd_release(args, key: str) -> int:
    run_id = _require_run_id(args.run_id)
    status, payload = request(
        "POST", f"/v1/issues/{args.id}/release-claim", key=key, run_id=run_id
    )
    return _emit(status, payload)


def cmd_patch(args, key: str) -> int:
    run_id = _require_run_id(args.run_id)
    body: dict = {}
    if args.status is not None:
        body["status"] = args.status
    if args.note is not None:
        body["note"] = args.note
    if args.component is not None:
        body["resolutionComponent"] = args.component
    if not body:
        raise HelperError("patch needs at least one of --status/--note/--component")
    status, payload = request(
        "PATCH", f"/v1/issues/{args.id}", key=key, body=body, run_id=run_id
    )
    return _emit(status, payload)


def cmd_dedup(args, key: str) -> int:
    run_id = _require_run_id(args.run_id)
    body = {"rootIssueId": args.root_id, "note": args.note}
    status, payload = request(
        "POST",
        f"/v1/issues/{args.id}/deduplicate",
        key=key,
        body=body,
        run_id=run_id,
    )
    return _emit(status, payload)


def cmd_link_pr(args, key: str) -> int:
    run_id = _require_run_id(args.run_id)
    body = {
        "repository": args.repository,
        "number": args.number,
        "relationship": args.relationship,
    }
    status, payload = request(
        "POST", f"/v1/issues/{args.id}/prs", key=key, body=body, run_id=run_id
    )
    return _emit(status, payload)


COMMANDS = {
    "list": cmd_list,
    "poll": cmd_poll,
    "get": cmd_get,
    "ops": cmd_ops,
    "claim": cmd_claim,
    "release": cmd_release,
    "patch": cmd_patch,
    "dedup": cmd_dedup,
    "link-pr": cmd_link_pr,
}


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="issues",
        description="Safe REST helper for the production issue tracker.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="GET /v1/issues")
    p_list.add_argument("--status")
    p_list.add_argument("--kind")
    p_list.add_argument("--cursor")
    p_list.add_argument("--limit", type=int)

    p_poll = sub.add_parser("poll", help="GET /v1/issues/poll")
    p_poll.add_argument("--cursor")
    p_poll.add_argument("--limit", type=int)

    p_get = sub.add_parser("get", help="GET /v1/issues/{id}")
    p_get.add_argument("id", type=int)

    sub.add_parser("ops", help="GET /v1/ops")

    p_claim = sub.add_parser("claim", help="POST /v1/issues/{id}/claim")
    p_claim.add_argument("id", type=int)
    p_claim.add_argument("--run-id", required=True)

    p_release = sub.add_parser("release", help="POST /v1/issues/{id}/release-claim")
    p_release.add_argument("id", type=int)
    p_release.add_argument("--run-id", required=True)

    p_patch = sub.add_parser("patch", help="PATCH /v1/issues/{id}")
    p_patch.add_argument("id", type=int)
    p_patch.add_argument("--run-id", required=True)
    p_patch.add_argument("--status")
    p_patch.add_argument("--note")
    p_patch.add_argument("--component")

    p_dedup = sub.add_parser("dedup", help="POST /v1/issues/{id}/deduplicate")
    p_dedup.add_argument("id", type=int)
    p_dedup.add_argument("--run-id", required=True)
    p_dedup.add_argument("--root-id", type=int, required=True)
    p_dedup.add_argument("--note", required=True)

    p_link = sub.add_parser("link-pr", help="POST /v1/issues/{id}/prs")
    p_link.add_argument("id", type=int)
    p_link.add_argument("--run-id", required=True)
    p_link.add_argument("--repository", required=True)
    p_link.add_argument("--number", type=int, required=True)
    p_link.add_argument("--relationship", default="fix")

    return parser


def run(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    handler = COMMANDS[args.command]
    try:
        # Validate the run ID before touching the credential provider so a
        # missing --run-id fails closed without a secret fetch.
        if args.command in MUTATIONS:
            _require_run_id(getattr(args, "run_id", None))
        key = agent_api_key()
        return handler(args, key)
    except HelperError as exc:
        print(str(exc), file=sys.stderr)
        return 2


def main() -> int:
    return run(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
