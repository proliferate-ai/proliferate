"""Unit tests for flow 5's seat usage probe (agent_auth slice 4, meters).

Three suites:

- Header parsing against the REAL capture shape (live one-token probe of
  2026-08-26, sanitized — utilization/reset values only, never credential
  material), plus the delivery spec's defensive cases: absent and garbage
  headers yield ``probe_failed``, never a crash or a guessed number.
- Cadence math: active vs idle interval selection, the exponential failure
  backoff with its one-hour cap.
- The ADVISORY-ONLY law as an import scan: no launch/render-path module may
  read ``seat_usage_sample`` — the constraint survives refactors because this
  test walks the real import graph, not a naming convention.
"""

from __future__ import annotations

import ast
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from proliferate.db.store.agent_gateway import SeatUsageSampleRecord
from proliferate.server.agent_auth.seats import (
    next_seat_usage_probe_at,
    parse_seat_usage_headers,
    seat_usage_probe_interval,
)

# The live capture of 2026-08-26 (sanitized): every anthropic-ratelimit-*
# header a one-token /v1/messages request under a seat token returned.
CAPTURE_2026_08_26 = {
    "anthropic-ratelimit-unified-status": "allowed",
    "anthropic-ratelimit-unified-5h-status": "allowed",
    "anthropic-ratelimit-unified-5h-reset": "1787813400",
    "anthropic-ratelimit-unified-5h-utilization": "0.63",
    "anthropic-ratelimit-unified-7d-status": "allowed",
    "anthropic-ratelimit-unified-7d-reset": "1788026400",
    "anthropic-ratelimit-unified-7d-utilization": "0.51",
    "anthropic-ratelimit-unified-overage-status": "allowed",
    "anthropic-ratelimit-unified-overage-reset": "1788220800",
    "anthropic-ratelimit-unified-overage-utilization": "0.0",
    "anthropic-ratelimit-unified-representative-claim": "five_hour",
    "anthropic-ratelimit-unified-fallback-percentage": "0.5",
    "anthropic-ratelimit-unified-fallback": "available",
    "anthropic-ratelimit-unified-reset": "1787813400",
}

ACTIVE = 300.0
IDLE = 1800.0


class TestParseSeatUsageHeaders:
    def test_real_capture_parses_allowed(self) -> None:
        parsed = parse_seat_usage_headers(200, CAPTURE_2026_08_26)
        assert parsed.status == "allowed"
        assert parsed.util_5h == 0.63
        assert parsed.util_7d == 0.51
        assert parsed.reset_5h == datetime.fromtimestamp(1787813400, tz=UTC)
        assert parsed.reset_7d == datetime.fromtimestamp(1788026400, tz=UTC)
        assert parsed.binding_window == "five_hour"

    def test_header_names_are_case_insensitive(self) -> None:
        upper = {key.upper(): value for key, value in CAPTURE_2026_08_26.items()}
        parsed = parse_seat_usage_headers(200, upper)
        assert parsed.status == "allowed"
        assert parsed.util_5h == 0.63

    def test_429_with_headers_is_limited(self) -> None:
        headers = dict(CAPTURE_2026_08_26)
        headers["anthropic-ratelimit-unified-status"] = "rejected"
        parsed = parse_seat_usage_headers(429, headers)
        assert parsed.status == "limited"
        assert parsed.util_5h == 0.63  # a limited sample still carries data

    def test_429_without_unified_status_is_still_limited(self) -> None:
        headers = dict(CAPTURE_2026_08_26)
        del headers["anthropic-ratelimit-unified-status"]
        assert parse_seat_usage_headers(429, headers).status == "limited"

    def test_auth_failure_is_probe_failed(self) -> None:
        # A revoked token's 401 carries no usage truth — and whatever headers
        # ride along are never trusted.
        parsed = parse_seat_usage_headers(401, CAPTURE_2026_08_26)
        assert parsed.status == "probe_failed"
        assert parsed.util_5h is None
        assert parsed.binding_window is None

    def test_server_error_is_probe_failed(self) -> None:
        assert parse_seat_usage_headers(500, {}).status == "probe_failed"

    def test_absent_utilization_header_is_probe_failed(self) -> None:
        headers = dict(CAPTURE_2026_08_26)
        del headers["anthropic-ratelimit-unified-5h-utilization"]
        assert parse_seat_usage_headers(200, headers).status == "probe_failed"

    def test_absent_reset_header_is_probe_failed(self) -> None:
        headers = dict(CAPTURE_2026_08_26)
        del headers["anthropic-ratelimit-unified-7d-reset"]
        assert parse_seat_usage_headers(200, headers).status == "probe_failed"

    def test_garbage_utilization_is_probe_failed(self) -> None:
        for garbage in ("garbage", "", "nan-ish", "1.7", "-0.1", "63%"):
            headers = dict(CAPTURE_2026_08_26)
            headers["anthropic-ratelimit-unified-5h-utilization"] = garbage
            parsed = parse_seat_usage_headers(200, headers)
            assert parsed.status == "probe_failed", garbage
            assert parsed.util_5h is None

    def test_garbage_reset_is_probe_failed(self) -> None:
        for garbage in ("soon", "", "-5", "2026-08-26T00:00:00Z"):
            headers = dict(CAPTURE_2026_08_26)
            headers["anthropic-ratelimit-unified-5h-reset"] = garbage
            assert parse_seat_usage_headers(200, headers).status == "probe_failed", garbage

    def test_no_headers_at_all_is_probe_failed(self) -> None:
        assert parse_seat_usage_headers(200, {}).status == "probe_failed"

    def test_boundary_fractions_parse(self) -> None:
        headers = dict(CAPTURE_2026_08_26)
        headers["anthropic-ratelimit-unified-5h-utilization"] = "0"
        headers["anthropic-ratelimit-unified-7d-utilization"] = "1"
        parsed = parse_seat_usage_headers(200, headers)
        assert parsed.util_5h == 0.0
        assert parsed.util_7d == 1.0

    def test_binding_prefers_provider_claim(self) -> None:
        # The claim wins even against the utilization comparison.
        headers = dict(CAPTURE_2026_08_26)
        headers["anthropic-ratelimit-unified-representative-claim"] = "seven_day"
        assert parse_seat_usage_headers(200, headers).binding_window == "seven_day"

    def test_binding_derives_when_claim_unrecognized(self) -> None:
        headers = dict(CAPTURE_2026_08_26)
        headers["anthropic-ratelimit-unified-representative-claim"] = "fortnight"
        # 5h 0.63 > 7d 0.51 → five_hour by derivation.
        assert parse_seat_usage_headers(200, headers).binding_window == "five_hour"

    def test_binding_ties_to_none_without_claim(self) -> None:
        headers = dict(CAPTURE_2026_08_26)
        del headers["anthropic-ratelimit-unified-representative-claim"]
        headers["anthropic-ratelimit-unified-5h-utilization"] = "0.5"
        headers["anthropic-ratelimit-unified-7d-utilization"] = "0.5"
        assert parse_seat_usage_headers(200, headers).binding_window is None


def _sample(
    *,
    minutes_ago: float,
    status: str = "allowed",
    util_5h: float | None = 0.5,
    util_7d: float | None = 0.4,
) -> SeatUsageSampleRecord:
    now = datetime.now(tz=UTC)
    return SeatUsageSampleRecord(
        id=1,
        api_key_id=uuid4(),
        sampled_at=now - timedelta(minutes=minutes_ago),
        util_5h=util_5h,
        util_7d=util_7d,
        reset_5h=now + timedelta(hours=2),
        reset_7d=now + timedelta(days=3),
        binding_window="five_hour",
        status=status,
    )


class TestSeatUsageCadence:
    def test_no_samples_is_due_now(self) -> None:
        assert (
            next_seat_usage_probe_at([], active_interval=ACTIVE, idle_interval=IDLE)
            is None
        )

    def test_rising_utilization_is_active(self) -> None:
        newest = _sample(minutes_ago=0, util_5h=0.55)
        previous = _sample(minutes_ago=5, util_5h=0.50)
        interval = seat_usage_probe_interval(
            [newest, previous], active_interval=ACTIVE, idle_interval=IDLE
        )
        assert interval == ACTIVE

    def test_decaying_utilization_is_idle(self) -> None:
        # The window slides and utilization drifts down: the idle signature.
        newest = _sample(minutes_ago=0, util_5h=0.45, util_7d=0.39)
        previous = _sample(minutes_ago=30, util_5h=0.50, util_7d=0.40)
        interval = seat_usage_probe_interval(
            [newest, previous], active_interval=ACTIVE, idle_interval=IDLE
        )
        assert interval == IDLE

    def test_flat_utilization_is_idle(self) -> None:
        newest = _sample(minutes_ago=0)
        previous = _sample(minutes_ago=30)
        assert (
            seat_usage_probe_interval(
                [newest, previous], active_interval=ACTIVE, idle_interval=IDLE
            )
            == IDLE
        )

    def test_single_sample_probes_at_active_cadence(self) -> None:
        # A fresh seat samples eagerly until a steady pair exists.
        assert (
            seat_usage_probe_interval(
                [_sample(minutes_ago=1)], active_interval=ACTIVE, idle_interval=IDLE
            )
            == ACTIVE
        )

    def test_failure_backoff_doubles_to_one_hour_cap(self) -> None:
        failed = _sample(minutes_ago=0, status="probe_failed", util_5h=None, util_7d=None)
        history = [_sample(minutes_ago=60)]
        expected = [600.0, 1200.0, 2400.0, 3600.0, 3600.0]
        for failures, want in enumerate(expected, start=1):
            samples = [replace(failed, id=i) for i in range(failures)] + history
            got = seat_usage_probe_interval(
                samples, active_interval=ACTIVE, idle_interval=IDLE
            )
            assert got == want, f"{failures} failures"

    def test_success_after_failures_clears_backoff(self) -> None:
        samples = [
            _sample(minutes_ago=0, util_5h=0.6),
            _sample(minutes_ago=10, status="probe_failed", util_5h=None, util_7d=None),
            _sample(minutes_ago=20, util_5h=0.5),
        ]
        interval = seat_usage_probe_interval(
            samples, active_interval=ACTIVE, idle_interval=IDLE
        )
        # Newest is a success; the stale failure no longer governs. Movement
        # (0.5 → 0.6) makes it active.
        assert interval == ACTIVE

    def test_next_due_at_offsets_from_newest_sample(self) -> None:
        newest = _sample(minutes_ago=0)
        previous = _sample(minutes_ago=30)
        due = next_seat_usage_probe_at(
            [newest, previous], active_interval=ACTIVE, idle_interval=IDLE
        )
        assert due == newest.sampled_at + timedelta(seconds=IDLE)


# --------------------------------------------------------------------------- #
# The advisory-only law: NOTHING in the launch path reads samples.
# --------------------------------------------------------------------------- #

SERVER_ROOT = Path(__file__).resolve().parents[2] / "proliferate"

# The complete set of modules allowed to touch seat_usage_sample, by repo
# path relative to server/proliferate. Everything else importing the store,
# the model, or the record is a violation — especially the launch/render
# path (state_render, selection_rules, service), which must never gate or
# shape a launch on a sample.
ALLOWED_IMPORTERS = {
    "db/models/agent_gateway.py",  # defines the table
    "db/store/agent_gateway/__init__.py",  # re-exports the record
    "db/store/agent_gateway/mappers.py",
    "db/store/agent_gateway/seat_usage.py",  # the store itself
    "server/agent_auth/seats.py",  # the probe (writer) + the usage read
    "server/agent_auth/api.py",  # GET /seats/usage + the pane-open refresh
    "server/agent_auth/models.py",  # the wire payload shape
    "server/agent_auth/worker.py",  # the probe loop metronome
    "main.py",  # lifespan start/stop of the metronome (never reads samples)
}

LAUNCH_PATH_MODULES = {
    "server/agent_auth/state_render.py",
    "server/agent_auth/selection_rules.py",
    "server/agent_auth/service.py",
}

SENTINEL_NAMES = {
    "SeatUsageSample",
    "SeatUsageSampleRecord",
    "seat_usage_sample_record",
    "insert_seat_usage_sample",
    "latest_seat_usage_samples",
    "recent_seat_usage_samples",
    "prune_seat_usage_samples",
}


def _imports_seat_usage(path: Path) -> bool:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            if any("seat_usage" in alias.name for alias in node.names):
                return True
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if "seat_usage" in module:
                return True
            if any(
                alias.name in SENTINEL_NAMES or "seat_usage" in alias.name
                for alias in node.names
            ):
                return True
    return False


class TestAdvisoryOnlyLaw:
    def test_only_allowed_modules_import_the_sample_store(self) -> None:
        violations = []
        for path in sorted(SERVER_ROOT.rglob("*.py")):
            rel = path.relative_to(SERVER_ROOT).as_posix()
            if _imports_seat_usage(path) and rel not in ALLOWED_IMPORTERS:
                violations.append(rel)
        assert violations == [], (
            "seat_usage_sample is advisory-only (never a launch gate); these "
            f"modules must not read it: {violations}"
        )

    def test_launch_path_is_never_allowlisted(self) -> None:
        # Belt for the allowlist itself: the launch/render path can never be
        # added to ALLOWED_IMPORTERS without tripping this.
        overlap = ALLOWED_IMPORTERS & LAUNCH_PATH_MODULES
        assert overlap == set()

    def test_allowlist_paths_exist(self) -> None:
        # A moved file silently exits the scan; keep the allowlist honest.
        missing = [
            rel for rel in ALLOWED_IMPORTERS if not (SERVER_ROOT / rel).is_file()
        ]
        assert missing == []
