"""Offline tests for scripts/issues.py — no live network or AWS calls.

Run with: python3 -m pytest scripts/test_issues.py

The transport (`_urlopen`) and the credential provider (`agent_api_key`) are
faked, so every case is fully hermetic. Coverage: command->route/method
mapping, fixed-origin host rejection, mutation run-ID enforcement, conflict/
precondition exposure with nonzero exit, poll-cursor passthrough, and error
redaction of the authorization header and secret-provider response.
"""
from __future__ import annotations

import io
import json

import pytest

import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "issues", Path(__file__).resolve().parent / "issues.py"
)
issues = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(issues)


class FakeResponse:
    def __init__(self, status: int, payload):
        self.status = status
        self._body = json.dumps(payload).encode("utf-8")

    def read(self, size=-1):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Capture:
    """Records the last request and returns a scripted response."""

    def __init__(self, status=200, payload=None):
        self.status = status
        self.payload = payload if payload is not None else {"ok": True}
        self.request = None
        self.timeout = None

    def __call__(self, request, timeout):
        self.request = request
        self.timeout = timeout
        return FakeResponse(self.status, self.payload)


@pytest.fixture
def fake_key(monkeypatch):
    monkeypatch.setattr(issues, "agent_api_key", lambda: "SECRET-AGENT-KEY")


@pytest.fixture
def transport(monkeypatch):
    cap = Capture()
    monkeypatch.setattr(issues, "_urlopen", cap)
    return cap


def _run(argv, monkeypatch=None):
    return issues.run(argv)


# --------------------------------------------------------------------------- #
# Command -> route/method mapping
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "argv, method, path",
    [
        (["ops"], "GET", "/v1/ops"),
        (["list"], "GET", "/v1/issues"),
        (["get", "7"], "GET", "/v1/issues/7"),
        (["poll"], "GET", "/v1/issues/poll"),
        (["claim", "7", "--run-id", "r1"], "POST", "/v1/issues/7/claim"),
        (["release", "7", "--run-id", "r1"], "POST", "/v1/issues/7/release-claim"),
        (["patch", "7", "--run-id", "r1", "--status", "not_done"], "PATCH", "/v1/issues/7"),
        (
            ["dedup", "7", "--run-id", "r1", "--root-id", "3", "--note", "n"],
            "POST",
            "/v1/issues/7/deduplicate",
        ),
        (
            ["link-pr", "7", "--run-id", "r1", "--repository", "o/r", "--number", "9"],
            "POST",
            "/v1/issues/7/prs",
        ),
    ],
)
def test_command_maps_to_route(fake_key, transport, argv, method, path):
    code = _run(argv)
    assert code == 0
    req = transport.request
    assert req.method == method
    assert req.full_url == issues.FIXED_ORIGIN + path or req.full_url.startswith(
        issues.FIXED_ORIGIN + path + "?"
    )


def test_mutations_send_run_id_and_reads_do_not(fake_key, transport):
    _run(["claim", "7", "--run-id", "run-xyz"])
    assert transport.request.get_header("X-run-id") == "run-xyz"
    _run(["ops"])
    assert transport.request.get_header("X-run-id") is None


def test_dedup_body_shape(fake_key, transport):
    _run(["dedup", "7", "--run-id", "r1", "--root-id", "3", "--note", "same event"])
    body = json.loads(transport.request.data)
    assert body == {"rootIssueId": 3, "note": "same event"}


def test_link_pr_default_relationship(fake_key, transport):
    _run(["link-pr", "7", "--run-id", "r1", "--repository", "o/r", "--number", "9"])
    body = json.loads(transport.request.data)
    assert body == {"repository": "o/r", "number": 9, "relationship": "fix"}


# --------------------------------------------------------------------------- #
# Fixed-origin host rejection
# --------------------------------------------------------------------------- #
def test_rejects_non_canonical_origin(monkeypatch, capsys):
    monkeypatch.setenv("ISSUES_ORIGIN", "https://evil.example")
    monkeypatch.setattr(issues, "agent_api_key", lambda: "SECRET")
    called = {"n": 0}

    def boom(*a, **k):
        called["n"] += 1
        raise AssertionError("must not contact the network")

    monkeypatch.setattr(issues, "_urlopen", boom)
    code = _run(["ops"])
    assert code == 2
    assert called["n"] == 0
    err = capsys.readouterr().err
    assert "non-canonical" in err


# --------------------------------------------------------------------------- #
# Run-ID enforcement (fails closed BEFORE any secret fetch)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("cmd", ["claim", "release"])
def test_blank_run_id_fails_closed(monkeypatch, capsys, cmd):
    def no_key():
        raise AssertionError("credential must not be fetched")

    monkeypatch.setattr(issues, "agent_api_key", no_key)
    monkeypatch.setattr(issues, "_urlopen", lambda *a, **k: pytest.fail("no network"))
    code = _run([cmd, "7", "--run-id", "   "])
    assert code == 2
    assert "run-id" in capsys.readouterr().err


# --------------------------------------------------------------------------- #
# Conflict / precondition exposure with nonzero exit
# --------------------------------------------------------------------------- #
def test_conflict_body_exposed_and_nonzero(fake_key, monkeypatch, capsys):
    cap = Capture(status=409, payload={"outcome": "already_claimed", "claimedBy": "agent:other"})
    # HTTPError path: urllib raises for 4xx. Simulate via error class.
    import urllib.error

    def raise_http(request, timeout):
        raise urllib.error.HTTPError(
            request.full_url,
            409,
            "Conflict",
            {},
            io.BytesIO(json.dumps(cap.payload).encode("utf-8")),
        )

    monkeypatch.setattr(issues, "_urlopen", raise_http)
    code = _run(["claim", "7", "--run-id", "r1"])
    out = capsys.readouterr()
    assert code == 1
    assert "already_claimed" in out.out
    assert "HTTP 409" in out.err


# --------------------------------------------------------------------------- #
# Poll cursor passthrough (byte-for-byte)
# --------------------------------------------------------------------------- #
def test_poll_cursor_passthrough(fake_key, transport):
    import urllib.parse

    cursor = "eyJpZCI6IDQyfQ=="  # opaque; must be forwarded unchanged
    _run(["poll", "--cursor", cursor, "--limit", "10"])
    query = urllib.parse.urlparse(transport.request.full_url).query
    # The value must decode back byte-for-byte (percent-encoding is transparent).
    assert urllib.parse.parse_qs(query)["cursor"] == [cursor]


# --------------------------------------------------------------------------- #
# Error redaction
# --------------------------------------------------------------------------- #
def test_transport_error_redacts_auth_header(fake_key, monkeypatch, capsys):
    import urllib.error

    def raise_url(request, timeout):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(issues, "_urlopen", raise_url)
    code = _run(["ops"])
    err = capsys.readouterr().err
    assert code == 2
    assert "SECRET-AGENT-KEY" not in err
    assert "Bearer" not in err


def test_secret_provider_failure_redacted(monkeypatch, capsys):
    class Completed:
        returncode = 255
        stdout = ""
        stderr = "AWS raw dump containing OTHER-SECRET-abc123"

    monkeypatch.setattr(issues, "_run_aws", lambda args: Completed())
    monkeypatch.setattr(issues, "_urlopen", lambda *a, **k: pytest.fail("no network"))
    code = _run(["ops"])
    err = capsys.readouterr().err
    assert code == 2
    assert "OTHER-SECRET-abc123" not in err
    assert "issue-tracker/app" in err


def test_secret_missing_field_redacts_payload(monkeypatch, capsys):
    class Completed:
        returncode = 0
        stdout = json.dumps({"releaseApiKey": "OTHER-SECRET-xyz"})
        stderr = ""

    monkeypatch.setattr(issues, "_run_aws", lambda args: Completed())
    monkeypatch.setattr(issues, "_urlopen", lambda *a, **k: pytest.fail("no network"))
    code = _run(["ops"])
    err = capsys.readouterr().err
    assert code == 2
    assert "OTHER-SECRET-xyz" not in err
    assert "agentApiKey" in err
