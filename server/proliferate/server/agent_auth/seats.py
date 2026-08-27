"""Seat lifecycle glue (agent_auth spec §4 cell 1, seats v1).

A seat is a portable Claude Max subscription credential: one
``anthropic_subscription`` vault row whose ciphertext decrypts to a long-lived
``claude setup-token`` OAuth token. This module is the mint intake — the one
upward secret path (spec §3 flow 2): the runtime captures the token in memory,
the courier POSTs it here exactly once, and the vault row is born with the
user-entered identity (the token carries no profile scope, so the system can
learn neither email nor plan on its own).

Launch verification is NOT here: that is the ordinary launch probe, run
runtime-side under the seat's isolated home after the next delivery applies
(spec §3 flow 2's "Verification is the ordinary launch probe"). What IS here
is flow 5's **usage probe** — the soft signal (slice 4, meters): a one-token
request per active seat whose rate-limit headers feed ``seat_usage_sample``
and the settings meters. Advisory only, never a launch gate: nothing in the
launch/render path reads samples (import-scan enforced), and a probe failure
changes no launch behavior. Rotation stays a later slice.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION,
    SEAT_USAGE_BINDING_WINDOW_FIVE_HOUR,
    SEAT_USAGE_BINDING_WINDOW_SEVEN_DAY,
    SEAT_USAGE_STATUS_ALLOWED,
    SEAT_USAGE_STATUS_LIMITED,
    SEAT_USAGE_STATUS_PROBE_FAILED,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import AgentApiKeyRecord
from proliferate.db.store.agent_gateway import seat_usage as seat_usage_store
from proliferate.db.store.agent_gateway.records import SeatUsageSampleRecord
from proliferate.integrations.anthropic import (
    AnthropicIntegrationError,
    probe_subscription_usage,
)
from proliferate.lib.infra.time.wall_clock import utcnow
from proliferate.server.api_errors import CloudApiError
from proliferate.server.event_logging import log_cloud_event

_MAX_TITLE_LENGTH = 255
_MAX_TOKEN_LENGTH = 4096
_MAX_EMAIL_LENGTH = 255
_MAX_PLAN_TIER_LENGTH = 64


def compose_seat_title(
    *,
    title: str | None,
    email: str | None,
    plan_tier: str | None,
    existing_seat_count: int,
) -> str:
    """The seat's display identity: user words, or "Max seat N".

    An explicit ``title`` wins verbatim. Otherwise the entered email becomes
    "Max seat · <email>" (the spec §2 DDL's example shape) and the optional
    plan tier rides as a display tag — there is no plan column; the title IS
    the label the pane renders. With nothing entered, seats number themselves.
    """
    if title:
        base = title
    elif email:
        base = f"Max seat · {email}"
    else:
        base = f"Max seat {existing_seat_count + 1}"
    if plan_tier:
        base = f"{base} · {plan_tier}"
    return base


async def create_seat(
    db: AsyncSession,
    *,
    user_id: UUID,
    token: str,
    title: str | None = None,
    email: str | None = None,
    plan_tier: str | None = None,
) -> AgentApiKeyRecord:
    """Mint intake: persist a captured seat token as a vault row.

    Called by the keys-create route when the courier uploads a mint capture
    (``kind='anthropic_subscription'``). The token is validated only for
    shape-of-a-secret (non-empty, bounded) — the capture rule already gated
    the format runtime-side, and over-validating here would strand a token
    the vendor legitimately reshapes.
    """
    token = token.strip()
    if not token or len(token) > _MAX_TOKEN_LENGTH:
        raise CloudApiError(
            "invalid_agent_seat_token",
            "The seat token must be a non-empty string.",
            status_code=400,
        )
    # A setup-token is printable ASCII; anything else can never be a working
    # credential but CAN make the usage probe's HTTP layer reject (and, for
    # non-ASCII, quote) the Authorization header value. Refuse at intake so
    # that path is unreachable rather than merely caught downstream.
    if any(not 0x20 < ord(char) < 0x7F for char in token):
        raise CloudApiError(
            "invalid_agent_seat_token",
            "The seat token must be printable ASCII.",
            status_code=400,
        )
    title = title.strip() if title else None
    if title and len(title) > _MAX_TITLE_LENGTH:
        raise CloudApiError(
            "invalid_agent_api_key_title",
            f"Title must be 1-{_MAX_TITLE_LENGTH} characters.",
            status_code=400,
        )
    email = email.strip() if email else None
    if email and len(email) > _MAX_EMAIL_LENGTH:
        raise CloudApiError(
            "invalid_agent_seat_label",
            f"Email must be 1-{_MAX_EMAIL_LENGTH} characters.",
            status_code=400,
        )
    plan_tier = plan_tier.strip() if plan_tier else None
    if plan_tier and len(plan_tier) > _MAX_PLAN_TIER_LENGTH:
        raise CloudApiError(
            "invalid_agent_seat_label",
            f"Plan tier must be 1-{_MAX_PLAN_TIER_LENGTH} characters.",
            status_code=400,
        )

    existing = await agent_gateway_store.list_agent_api_keys(db, user_id=user_id)
    existing_seat_count = sum(
        1 for record in existing if record.kind == AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION
    )
    composed_title = compose_seat_title(
        title=title,
        email=email,
        plan_tier=plan_tier,
        existing_seat_count=existing_seat_count,
    )
    if len(composed_title) > _MAX_TITLE_LENGTH:
        composed_title = composed_title[:_MAX_TITLE_LENGTH]

    record = await agent_gateway_store.create_agent_seat(
        db,
        user_id=user_id,
        title=composed_title,
        value=token,
    )
    log_cloud_event(
        "agent_seat_minted",
        user_id=str(user_id),
        api_key_id=str(record.id),
    )
    return record


# --------------------------------------------------------------------------- #
# The usage probe (spec §3 flow 5's soft signal — slice 4, meters)
# --------------------------------------------------------------------------- #

# The capture-confirmed header set (live captures 2026-08-26, re-confirmed
# against real seats during this slice's build): a one-token /v1/messages
# request under a seat token returns the unified rate-limit headers,
# account-global. Utilizations are 0..1 fractions ("0.63"); resets are epoch
# seconds.
_HEADER_UTIL_5H = "anthropic-ratelimit-unified-5h-utilization"
_HEADER_UTIL_7D = "anthropic-ratelimit-unified-7d-utilization"
_HEADER_RESET_5H = "anthropic-ratelimit-unified-5h-reset"
_HEADER_RESET_7D = "anthropic-ratelimit-unified-7d-reset"
# Optional refinements — absence falls back to the HTTP status / derivation.
_HEADER_UNIFIED_STATUS = "anthropic-ratelimit-unified-status"
# The provider's own binding-window claim, observed live with values matching
# our vocabulary verbatim ("five_hour"). Preferred over derivation; an
# unrecognized value falls back to comparing utilizations.
_HEADER_REPRESENTATIVE_CLAIM = "anthropic-ratelimit-unified-representative-claim"
_UNIFIED_STATUS_ALLOWED = {"allowed", "allowed_warning"}
_UNIFIED_STATUS_LIMITED = {"rejected", "limited", "blocked"}

# Provider-error backoff doubles per consecutive failure to a one-hour cap.
_PROBE_BACKOFF_CAP_SECONDS = 3600.0
# How many trailing samples the cadence engine reads; enough to reach the
# backoff cap (active 300s doubles past 3600s within four failures).
_CADENCE_SAMPLE_WINDOW = 8
# The writer's retention horizon: samples older than 30 days are pruned.
_SAMPLE_RETENTION = timedelta(days=30)
# The pane-open poke's freshness floor: a sample younger than this is fresh
# enough, which makes the poke idempotent under pane flapping and keeps it
# from becoming an outbound-request amplifier.
_FORCE_MIN_AGE = timedelta(seconds=60)


@dataclass(frozen=True)
class ParsedSeatUsage:
    """One defensively parsed probe response — never a guessed number."""

    status: str
    util_5h: float | None = None
    util_7d: float | None = None
    reset_5h: datetime | None = None
    reset_7d: datetime | None = None
    binding_window: str | None = None


_PROBE_FAILED = ParsedSeatUsage(status=SEAT_USAGE_STATUS_PROBE_FAILED)


def _parse_fraction(raw: str | None) -> float | None:
    """A 0..1 utilization fraction, or None for absent/garbage/out-of-range.

    Strictly fractional by contract: a value above 1 (say, a future switch to
    percentages) is unparseable-per-contract, not divided by a guessed 100.
    """
    if raw is None:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    if not 0.0 <= value <= 1.0:
        return None
    return value


def _parse_epoch(raw: str) -> datetime | None:
    """Epoch seconds → aware UTC datetime; None for garbage. Seconds only."""
    try:
        value = float(raw)
    except ValueError:
        return None
    if value < 0:
        return None
    try:
        return datetime.fromtimestamp(value, tz=UTC)
    except (OverflowError, OSError, ValueError):
        return None


def parse_seat_usage_headers(
    http_status: int,
    headers: Mapping[str, str],
) -> ParsedSeatUsage:
    """Defensive parse of one probe response (delivery spec: an absent or
    unparseable header yields a ``probe_failed`` sample, never a crash or a
    guessed number).

    - Any status other than success or 429 is ``probe_failed`` outright (an
      auth failure or outage carries no usage truth).
    - All four capture-confirmed headers are required; any absent or
      unparseable one fails the whole sample — the meters render a dash, not
      a bar built from partial data.
    - ``binding_window`` prefers the provider's own claim header
      (``…-representative-claim``, live-observed carrying our vocabulary
      verbatim); an absent or unrecognized claim falls back to the window
      nearer its cap, and a tie leaves it None — no invented emphasis.
    - 429 with parseable headers is ``limited`` — the strongest signal the
      soft channel can carry; the unified-status header refines allowed vs
      limited when present and recognized.
    """
    if http_status >= 300 and http_status != 429:
        return _PROBE_FAILED
    lowered = {key.lower(): value for key, value in headers.items()}
    util_5h = _parse_fraction(lowered.get(_HEADER_UTIL_5H))
    util_7d = _parse_fraction(lowered.get(_HEADER_UTIL_7D))
    if util_5h is None or util_7d is None:
        return _PROBE_FAILED
    raw_reset_5h = lowered.get(_HEADER_RESET_5H)
    raw_reset_7d = lowered.get(_HEADER_RESET_7D)
    if raw_reset_5h is None or raw_reset_7d is None:
        return _PROBE_FAILED
    reset_5h = _parse_epoch(raw_reset_5h)
    reset_7d = _parse_epoch(raw_reset_7d)
    if reset_5h is None or reset_7d is None:
        return _PROBE_FAILED

    claimed = lowered.get(_HEADER_REPRESENTATIVE_CLAIM, "").strip().lower()
    if claimed in (
        SEAT_USAGE_BINDING_WINDOW_FIVE_HOUR,
        SEAT_USAGE_BINDING_WINDOW_SEVEN_DAY,
    ):
        binding_window: str | None = claimed
    elif util_5h > util_7d:
        binding_window = SEAT_USAGE_BINDING_WINDOW_FIVE_HOUR
    elif util_7d > util_5h:
        binding_window = SEAT_USAGE_BINDING_WINDOW_SEVEN_DAY
    else:
        binding_window = None

    status = (
        SEAT_USAGE_STATUS_LIMITED if http_status == 429 else SEAT_USAGE_STATUS_ALLOWED
    )
    unified = lowered.get(_HEADER_UNIFIED_STATUS, "").strip().lower()
    if unified in _UNIFIED_STATUS_ALLOWED:
        status = SEAT_USAGE_STATUS_ALLOWED
    elif unified in _UNIFIED_STATUS_LIMITED:
        status = SEAT_USAGE_STATUS_LIMITED

    return ParsedSeatUsage(
        status=status,
        util_5h=util_5h,
        util_7d=util_7d,
        reset_5h=reset_5h,
        reset_7d=reset_7d,
        binding_window=binding_window,
    )


def seat_usage_probe_interval(
    samples: Sequence[SeatUsageSampleRecord],
    *,
    active_interval: float,
    idle_interval: float,
) -> float:
    """Seconds from the newest sample to the next probe (pure; unit-tested).

    ``samples`` is newest-first. Three regimes:

    - **Backing off** — n trailing ``probe_failed`` samples: exponential from
      the active cadence, ``min(active * 2^n, 3600)`` (the one-hour cap).
    - **Active** — "a session runs on the seat", read from the seat's own
      account-global signal: utilization ROSE between the last two successful
      samples (a running session consumes; window-sliding decay is the idle
      signature). A seat with fewer than two successful samples probes at the
      active cadence until a steady pair exists.
    - **Idle** — everything else.
    """
    failures = 0
    for sample in samples:
        if sample.status == SEAT_USAGE_STATUS_PROBE_FAILED:
            failures += 1
        else:
            break
    if failures:
        return float(min(active_interval * (2.0**failures), _PROBE_BACKOFF_CAP_SECONDS))
    successes = [
        sample
        for sample in samples
        if sample.status != SEAT_USAGE_STATUS_PROBE_FAILED
    ][:2]
    if len(successes) < 2:
        return active_interval
    newest, previous = successes
    rose = (
        newest.util_5h is not None
        and previous.util_5h is not None
        and newest.util_5h > previous.util_5h
    ) or (
        newest.util_7d is not None
        and previous.util_7d is not None
        and newest.util_7d > previous.util_7d
    )
    return active_interval if rose else idle_interval


def next_seat_usage_probe_at(
    samples: Sequence[SeatUsageSampleRecord],
    *,
    active_interval: float,
    idle_interval: float,
) -> datetime | None:
    """When this seat's next probe is due; None means due now (no samples)."""
    if not samples:
        return None
    return samples[0].sampled_at + timedelta(
        seconds=seat_usage_probe_interval(
            samples,
            active_interval=active_interval,
            idle_interval=idle_interval,
        )
    )


async def seat_usage_probe(
    db: AsyncSession,
    *,
    api_key_id: UUID,
) -> SeatUsageSampleRecord | None:
    """Flow 5's soft signal for ONE seat: decrypt → one-token request → sample.

    The spec's importable ``seat_usage_probe(api_key_id) -> UsageSample``.
    Secret hygiene: the decrypted token lives in a local for the request only;
    it never reaches the sample, the logs, or an error (the integration
    raises status-only errors). Returns None when the seat vanished or was
    revoked mid-pass — nothing is recorded for a seat that is off.

    The writer prunes samples past the 30-day horizon on every write, so
    retention needs no separate janitor.
    """
    decrypt_failed = False
    fetched = None
    try:
        fetched = await agent_gateway_store.get_agent_seat_decrypted_for_probe(
            db, api_key_id=api_key_id
        )
    except Exception:
        # A corrupt ciphertext / rotated encryption key is a probe failure
        # for THIS seat, never a crash for the whole pass.
        decrypt_failed = True
    if fetched is None and not decrypt_failed:
        return None
    if fetched is None:
        parsed = _PROBE_FAILED
    else:
        _, seat_token = fetched
        try:
            http_status, headers = await probe_subscription_usage(
                oauth_token=seat_token
            )
            parsed = parse_seat_usage_headers(http_status, headers)
        except AnthropicIntegrationError:
            parsed = _PROBE_FAILED
    # A savepoint per seat write: if the insert itself fails (e.g. the seat's
    # user was hard-deleted between the roster read and here, tripping the
    # FK), only THIS seat's write rolls back — the session stays usable and
    # the tick's earlier samples survive.
    async with db.begin_nested():
        record = await seat_usage_store.insert_seat_usage_sample(
            db,
            api_key_id=api_key_id,
            status=parsed.status,
            util_5h=parsed.util_5h,
            util_7d=parsed.util_7d,
            reset_5h=parsed.reset_5h,
            reset_7d=parsed.reset_7d,
            binding_window=parsed.binding_window,
        )
        await seat_usage_store.prune_seat_usage_samples(
            db, older_than=utcnow() - _SAMPLE_RETENTION
        )
    return record


@dataclass(frozen=True)
class SeatUsageProbePassResult:
    probed: int = 0
    failed: int = 0
    skipped: int = 0


async def run_seat_usage_probe_pass(db: AsyncSession) -> SeatUsageProbePassResult:
    """One cadence tick over every active seat (all users).

    Revoked seats never appear in the roster (off for revoked seats). Each
    seat's due time derives from its own recent samples — active vs idle
    cadence plus the failure backoff — so one loop serves every seat without
    per-seat scheduler state.
    """
    now = utcnow()
    active_interval = settings.agent_seat_usage_probe_active_interval
    idle_interval = settings.agent_seat_usage_probe_idle_interval
    probed = failed = skipped = 0
    for seat in await agent_gateway_store.list_active_agent_seats(db):
        samples = await seat_usage_store.recent_seat_usage_samples(
            db, api_key_id=seat.id, limit=_CADENCE_SAMPLE_WINDOW
        )
        due_at = next_seat_usage_probe_at(
            samples,
            active_interval=active_interval,
            idle_interval=idle_interval,
        )
        if due_at is not None and due_at > now:
            skipped += 1
            continue
        try:
            record = await seat_usage_probe(db, api_key_id=seat.id)
        except Exception:
            # The last-resort belt: one seat's surprise (the probe itself
            # already absorbs decrypt and provider failures) never aborts the
            # pass for every other user's seats.
            skipped += 1
            continue
        if record is None:
            skipped += 1
            continue
        probed += 1
        if record.status == SEAT_USAGE_STATUS_PROBE_FAILED:
            failed += 1
    return SeatUsageProbePassResult(probed=probed, failed=failed, skipped=skipped)


async def latest_seat_usage(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[SeatUsageSampleRecord]:
    """The ``GET /seats/usage`` read: latest sample per active seat."""
    return await seat_usage_store.latest_seat_usage_samples(db, user_id=user_id)


async def force_seat_usage_samples(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[SeatUsageSampleRecord]:
    """The pane-open poke: one fresh sample per visible seat, now.

    A seat whose latest sample is younger than the freshness floor keeps it —
    "forces one fresh sample" is satisfied and the poke stays cheap however
    often the pane mounts. Probes run sequentially; the seat count is small
    and the pane renders whatever this returns.
    """
    now = utcnow()
    latest_by_seat = {
        record.api_key_id: record
        for record in await seat_usage_store.latest_seat_usage_samples(
            db, user_id=user_id
        )
    }
    seats = [
        record
        for record in await agent_gateway_store.list_agent_api_keys(
            db, user_id=user_id
        )
        if record.kind == AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION
    ]
    for seat in seats:
        latest = latest_by_seat.get(seat.id)
        if latest is not None and now - latest.sampled_at < _FORCE_MIN_AGE:
            continue
        try:
            await seat_usage_probe(db, api_key_id=seat.id)
        except Exception:
            # One seat's surprise never blanks the whole pane's read.
            continue
    return await seat_usage_store.latest_seat_usage_samples(db, user_id=user_id)
