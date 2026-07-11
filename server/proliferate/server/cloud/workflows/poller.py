"""Poll-trigger poller (spec 4.2/4.3).

Proliferate GETs a conforming endpoint on an interval and spawns one run per new
item, idempotently. The three-layer at-least-once story (spec 4.4):

    endpoint may replay items      (at-least-once delivery; crash-safe by contract)
          ↓
    workflow_trigger_item PK       (Proliferate: at-most-one SPAWN per item id)
          ↓
    issues-service claim() CAS     (service side: at-most-one CLAIM per issue)

The poller owns the middle layer. It runs alongside the schedule beat (same
worker process, spec 4.1): the tick calls ``run_poll_pass`` after firing schedule
triggers. Everything for one trigger happens in ONE transaction — the item
seen-set rows and the advanced cursor commit together, so a crash anywhere
re-polls the old cursor and the seen-set absorbs the replay. The cursor never
advances past items that weren't recorded.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

import httpx
import pydantic
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.workflows import (
    WORKFLOW_POLL_DEFAULT_LIMIT,
    WORKFLOW_POLL_ERROR_MAX_LENGTH,
    WORKFLOW_POLL_TOTAL_DEADLINE_SECONDS,
    WORKFLOW_POLLER_DEFAULT_BATCH_SIZE,
    WORKFLOW_TRIGGER_ITEM_STATUS_ERROR,
    WORKFLOW_TRIGGER_ITEM_STATUS_INVALID,
    WORKFLOW_TRIGGER_ITEM_STATUS_SPAWNED,
    WORKFLOW_TRIGGER_KIND_POLL,
)
from proliferate.db import engine as db_engine
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store.cloud_workflow_triggers import DuePollTrigger
from proliferate.integrations.sentry import capture_server_sentry_exception
from proliferate.integrations.workflow_poll import (
    PollAuthBinding,
    PollContentEncodingError,
    PollEndpointMismatchError,
    PollForbiddenHeaderError,
    PollInvalidHeaderError,
    PollResponseTooLargeError,
    fetch_poll_bytes,
)
from proliferate.middleware.request_context import with_correlation_context
from proliferate.server.cloud import net_guard
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import compiler
from proliferate.server.cloud.workflows.domain.poll_contract import PollPage, validate_item_data
from proliferate.server.cloud.workflows.poll_endpoint import guard_poll_endpoint
from proliferate.utils.crypto import decrypt_text

logger = logging.getLogger(__name__)

_FAILURE_ESCALATION_THRESHOLD = 3
_MAX_FAILURE_BACKOFF_SECONDS = 300.0

# Same shape the schedule scheduler uses; declared here to avoid a circular
# import (the scheduler imports this module for the poll pass).
SchedulerSessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]


@dataclass
class _PollActor:
    """Minimal owner identity — the owner-scoped services StartRun expects only
    read ``.id`` (runs execute as the workflow owner; v1 has no "Run as")."""

    id: UUID


def overlay_item_inputs(
    item_data: object,
    *,
    static_inputs: dict[str, object],
    item_schema: dict[str, object] | None,
) -> dict[str, object]:
    """Static presets ⊕ the item's own fields, taken directly by name (D17).

    The trigger's static ``args_json`` presets are the base; each declared input
    the item's ``data`` carries overrides its preset. There is no dot-path
    mapping — a field named ``issue_id`` in ``data`` fills the ``issue_id`` input,
    nothing else. The declared input names are the ``properties`` keys of the
    derived item schema; fields in ``data`` that are not declared inputs are
    ignored (``start_run`` rejects unknown inputs). Item shape is validated
    against the (derived) schema before this overlay, so this never fails.
    """

    inputs: dict[str, object] = dict(static_inputs or {})
    raw_properties = (item_schema or {}).get("properties", {})
    declared = set(raw_properties) if isinstance(raw_properties, dict) else set()
    if isinstance(item_data, dict):
        for name in declared:
            if name in item_data:
                inputs[name] = item_data[name]
    return inputs


def decrypt_poll_auth(trigger: DuePollTrigger) -> PollAuthBinding | None:
    """Decrypt and validate the exact stored binding before request construction."""

    if trigger.poll_auth_header is None and trigger.poll_auth_ciphertext is None:
        return None
    if not trigger.poll_auth_header or not trigger.poll_auth_ciphertext:
        raise PollInvalidHeaderError("Stored poll auth binding is incomplete.")
    try:
        value = decrypt_text(trigger.poll_auth_ciphertext)
    except Exception:
        # Ciphertext and crypto-library details are never part of an operator-facing
        # poll error (or a chained exception captured by tracing). Treat a damaged or
        # no-longer-decryptable stored credential as a pre-send binding failure.
        raise PollInvalidHeaderError(
            "Stored poll auth credential could not be resolved."
        ) from None
    return PollAuthBinding.create(trigger.poll_auth_header, value)


class PollErrorKind(StrEnum):
    """Stable, mechanically-switchable taxonomy for a failed poll fetch.

    In-process the failure modes are distinct exception TYPES; this enum is the
    stable name a later durable layer (WF-POLL-OCC fencing) can persist and branch
    on without re-parsing a human string. ``classify_poll_error`` maps any
    poll-path exception to exactly one kind.
    """

    PRE_SEND = "pre_send"  # rejected before request bytes leave
    DNS_POLICY = "dns_policy"  # SSRF guard denial (private/rebinding/scheme/userinfo)
    TIMEOUT = "timeout"  # per-op or total wall-clock deadline exceeded
    UPSTREAM_STATUS = "upstream_status"  # a non-2xx HTTP response
    SIZE = "size"  # body exceeded the byte cap
    CONTENT_ENCODING = "content_encoding"  # a non-identity Content-Encoding
    SCHEMA = "schema"  # 2xx body that isn't a valid PollPage
    TRANSPORT = "transport"  # connect/TLS/read failure with no status


class PollPageLimitError(Exception):
    """The endpoint returned more items than the request's explicit page limit."""


async def fetch_poll_page(
    *,
    url: str,
    endpoint: net_guard.VettedEndpoint,
    auth: PollAuthBinding | None,
    cursor: str | None,
    limit: int = WORKFLOW_POLL_DEFAULT_LIMIT,
) -> PollPage:
    """Fetch and parse one page within the same absolute transport deadline."""

    async with asyncio.timeout(WORKFLOW_POLL_TOTAL_DEADLINE_SECONDS):
        body = await fetch_poll_bytes(
            url=url,
            endpoint=endpoint,
            auth=auth,
            cursor=cursor,
            limit=limit,
        )
        page = PollPage.model_validate_json(body)
        if len(page.items) > limit:
            raise PollPageLimitError(
                f"Poll endpoint returned {len(page.items)} items for limit={limit}."
            )
        return page


def classify_poll_error(exc: Exception) -> PollErrorKind:
    """Map any poll-path exception to its stable ``PollErrorKind``.

    Ordered most-specific-first: timeout subclasses of ``httpx.HTTPError`` are
    caught before the generic transport bucket, and ``HTTPStatusError`` before the
    same. This is the single classification authority the human-message helper and
    (later) the durable fencing layer share."""

    if isinstance(
        exc,
        (PollForbiddenHeaderError, PollInvalidHeaderError, PollEndpointMismatchError),
    ):
        return PollErrorKind.PRE_SEND
    if isinstance(exc, CloudApiError):  # the SSRF guard's poll_endpoint_blocked
        return PollErrorKind.DNS_POLICY
    if isinstance(exc, PollResponseTooLargeError):
        return PollErrorKind.SIZE
    if isinstance(exc, PollContentEncodingError):
        return PollErrorKind.CONTENT_ENCODING
    if isinstance(exc, (httpx.TimeoutException, TimeoutError)):
        return PollErrorKind.TIMEOUT
    if isinstance(exc, httpx.HTTPStatusError):
        return PollErrorKind.UPSTREAM_STATUS
    if isinstance(exc, httpx.HTTPError):
        return PollErrorKind.TRANSPORT
    if isinstance(exc, pydantic.ValidationError):
        return PollErrorKind.SCHEMA
    if isinstance(exc, PollPageLimitError):
        return PollErrorKind.SCHEMA
    return PollErrorKind.SCHEMA


def describe_poll_error(exc: Exception) -> str:
    """Return a bounded, secret-free operator message for a poll failure.

    Never serialize an arbitrary upstream exception. In particular, Pydantic's
    validation text includes rejected input values, and an HTTP transport
    exception retains its request (including credential headers). A hostile
    endpoint can reflect a credential into an invalid response, so schema and
    transport failures expose only the stable kind/class, not ``str(exc)``.
    """

    kind = classify_poll_error(exc)
    if kind is PollErrorKind.UPSTREAM_STATUS and isinstance(exc, httpx.HTTPStatusError):
        message = f"HTTP {exc.response.status_code} from poll endpoint."
    elif kind in (PollErrorKind.SIZE, PollErrorKind.CONTENT_ENCODING, PollErrorKind.PRE_SEND):
        message = str(exc)
    elif kind is PollErrorKind.DNS_POLICY and isinstance(exc, CloudApiError):
        # The SSRF guard's structured denial (poll_endpoint_blocked) — surface its
        # message verbatim rather than the generic "not a valid page" fallback.
        message = exc.message
    elif kind is PollErrorKind.TIMEOUT:
        message = f"Poll request timed out: {exc.__class__.__name__}."
    elif kind is PollErrorKind.TRANSPORT:
        message = f"Poll request failed: {exc.__class__.__name__}."
    else:
        message = f"Poll response was not a valid page ({exc.__class__.__name__})."
    normalized = " ".join(message.split())
    if len(normalized) <= WORKFLOW_POLL_ERROR_MAX_LENGTH:
        return normalized
    return normalized[: WORKFLOW_POLL_ERROR_MAX_LENGTH - 1] + "…"


async def _poll_one_trigger(
    session_factory: SchedulerSessionFactory,
    *,
    trigger_id: UUID,
    now: datetime,
    policy: net_guard.NetworkPolicy = net_guard.PUBLIC_ONLY,
) -> int:
    async with session_factory() as db, db.begin():
        trigger = await trigger_store.claim_due_poll_trigger(db, trigger_id=trigger_id, now=now)
        if trigger is None:
            return 0  # taken by another beat, disabled, or no longer due

        # Bind tenant fields for the rest of this trigger's unit of work (observability
        # spec §8) so this beat's logs, and every log start_run/compiler emits below,
        # carry org/user instead of running anonymously.
        with with_correlation_context(
            organization_id=trigger.workflow_organization_id,
            user_id=trigger.workflow_owner_user_id,
            worker_id="workflow_poller",
        ):
            if trigger.workflow_archived:
                # Record the poll (advance last_poll_at, keep the cursor) so a
                # disabled/archived workflow's trigger stops being re-scanned every
                # beat.
                await trigger_store.persist_poll_cursor(
                    db,
                    trigger_id=trigger_id,
                    cursor=trigger.poll_cursor,
                    polled_at=now,
                    error="Workflow was archived.",
                )
                return 0

            try:
                # SSRF guard on the runtime fetch too: a cloud-hosted server polling
                # a private/metadata address is the same SSRF as the setup probe. The
                # guard runs the caller-supplied policy (never a debug/env bypass;
                # production always passes the immutable PUBLIC_ONLY default) and
                # returns the vetted IP the fetch PINS to — revalidated every tick so
                # a rebind between ticks is caught. Guard + fetch share ONE absolute
                # deadline (DNS resolution + request + parse). A block here — or a
                # forbidden legacy auth header from ``PollAuthBinding.create`` — is
                # recorded like any poll error: cursor kept, trigger stays enabled.
                async with asyncio.timeout(WORKFLOW_POLL_TOTAL_DEADLINE_SECONDS):
                    auth_binding = decrypt_poll_auth(trigger)
                    endpoint = await guard_poll_endpoint(trigger.poll_url, policy=policy)
                    page = await fetch_poll_page(
                        url=trigger.poll_url,
                        endpoint=endpoint,
                        auth=auth_binding,
                        cursor=trigger.poll_cursor,
                        limit=WORKFLOW_POLL_DEFAULT_LIMIT,
                    )
            except Exception as exc:
                # HTTP / shape error: record the error, advance last_poll_at, keep the
                # old cursor (never advance past items we didn't ingest). Trigger stays
                # enabled — the next due tick retries.
                await trigger_store.persist_poll_cursor(
                    db,
                    trigger_id=trigger_id,
                    cursor=trigger.poll_cursor,
                    polled_at=now,
                    error=describe_poll_error(exc),
                )
                return 0

            spawned = 0
            actor = _PollActor(id=trigger.workflow_owner_user_id)
            for item in page.items:
                inserted = await trigger_store.insert_trigger_item(
                    db,
                    trigger_id=trigger_id,
                    item_id=item.id,
                    status=WORKFLOW_TRIGGER_ITEM_STATUS_SPAWNED,
                )
                if not inserted:
                    continue  # replayed item — the seen-set PK dedupes it

                error = validate_item_data(item.data, trigger.poll_item_schema_json)
                if error is not None:
                    await trigger_store.mark_item(
                        db,
                        trigger_id=trigger_id,
                        item_id=item.id,
                        status=WORKFLOW_TRIGGER_ITEM_STATUS_INVALID,
                        error_message=error,
                    )
                    continue  # surfaced, never dropped, never spawned

                # Item inputs: static presets overlaid by the item's own fields, taken
                # directly by name (D17 — no dot-path mapping). Missing/typed-wrong
                # fields were already caught by validate_item_data above.
                inputs = overlay_item_inputs(
                    item.data,
                    static_inputs=trigger.args_json,
                    item_schema=trigger.poll_item_schema_json,
                )

                # Savepoint per item (Pablo amendment 2026-07-07, mirroring the
                # schedule scheduler's begin_nested around start_run): a start_run
                # failure rolls back only the run insert, not the whole transaction
                # (cursor + seen-set). The failure is recorded 'error' and the loop
                # continues; the seen-set row keeps the item from being retried.
                try:
                    async with db.begin_nested():
                        run = await compiler.start_run(
                            db,
                            actor,
                            trigger.workflow_id,
                            inputs=inputs,
                            target_mode=trigger.target_mode,
                            trigger_kind=WORKFLOW_TRIGGER_KIND_POLL,
                            target_workspace_id=trigger.target_workspace_id,
                            trigger_id=trigger_id,
                        )
                except CloudApiError as exc:
                    await trigger_store.mark_item(
                        db,
                        trigger_id=trigger_id,
                        item_id=item.id,
                        status=WORKFLOW_TRIGGER_ITEM_STATUS_ERROR,
                        error_message=f"{exc.code}: {exc.message}",
                    )
                    continue

                await trigger_store.mark_item(
                    db,
                    trigger_id=trigger_id,
                    item_id=item.id,
                    status=WORKFLOW_TRIGGER_ITEM_STATUS_SPAWNED,
                    run_id=run.id,
                )
                spawned += 1

            # Cursor persists in the SAME transaction as the item rows. has_more just
            # means the next due tick drains more — no special casing.
            await trigger_store.persist_poll_cursor(
                db,
                trigger_id=trigger_id,
                cursor=page.cursor,
                polled_at=now,
                error=None,
            )
            return spawned


async def run_poll_pass(
    session_factory: SchedulerSessionFactory,
    *,
    now: datetime,
    batch_size: int,
    policy: net_guard.NetworkPolicy = net_guard.PUBLIC_ONLY,
) -> int:
    """Poll every due poll trigger, each in its own transaction. Returns the
    number of runs spawned this pass. One trigger blowing up must not stall the
    rest of the beat (mirrors the schedule scheduler's per-trigger isolation)."""

    async with session_factory() as db:
        due_ids = await trigger_store.list_due_poll_trigger_ids(db, now=now, limit=batch_size)
    spawned = 0
    for trigger_id in due_ids:
        try:
            spawned += await _poll_one_trigger(
                session_factory, trigger_id=trigger_id, now=now, policy=policy
            )
        except Exception:
            logger.exception("workflow poll trigger failed trigger_id=%s", trigger_id)
    return spawned


# --- beat + loop -----------------------------------------------------------------
#
# Split out of the schedule tick (PR 1e): poll triggers used to run INLINE inside
# run_workflow_scheduler_tick, so a slow/failing poll endpoint delayed run delivery
# in the same tick. This is now its own gathered coroutine in the automations
# worker (server/proliferate/server/automations/worker/main.py) — mirrors
# run_workflow_scheduler_loop's shape (independent backoff + Sentry escalation) so
# a poll-beat failure never blocks the schedule beat's delivery phase.


async def run_workflow_poller_tick(
    *,
    session_factory: SchedulerSessionFactory,
    batch_size: int = WORKFLOW_POLLER_DEFAULT_BATCH_SIZE,
) -> int:
    from proliferate.utils.time import utcnow

    # D-003: the launch flag gates the background poll plane too (see the
    # scheduler tick's matching guard).
    if not settings.workflows_enabled:
        return 0
    now = utcnow()
    return await run_poll_pass(session_factory, now=now, batch_size=batch_size)


async def run_workflow_poller_loop(
    *,
    interval_seconds: float,
    batch_size: int = WORKFLOW_POLLER_DEFAULT_BATCH_SIZE,
    stop_event: asyncio.Event,
    validate_schema: Callable[[], Awaitable[None]] | None = None,
) -> None:
    logger.info(
        "Workflow poller worker started interval_seconds=%s batch_size=%s",
        interval_seconds,
        batch_size,
    )
    schema_validated = validate_schema is None
    consecutive_failures = 0
    while not stop_event.is_set():
        try:
            if not schema_validated and validate_schema is not None:
                await validate_schema()
                schema_validated = True
            spawned = await run_workflow_poller_tick(
                session_factory=db_engine.async_session_factory,
                batch_size=batch_size,
            )
            consecutive_failures = 0
            if spawned:
                logger.info("Workflow poller tick spawned=%s", spawned)
            next_delay = interval_seconds
        except Exception as exc:
            consecutive_failures += 1
            next_delay = min(
                interval_seconds * (2 ** (consecutive_failures - 1)),
                _MAX_FAILURE_BACKOFF_SECONDS,
            )
            logger.exception(
                "Workflow poller tick failed consecutive_failures=%s next_delay_seconds=%s",
                consecutive_failures,
                next_delay,
            )
            if consecutive_failures >= _FAILURE_ESCALATION_THRESHOLD:
                capture_server_sentry_exception(
                    exc,
                    level="error",
                    tags={"worker": "workflow_poller"},
                    extras={"consecutive_failures": consecutive_failures},
                    fingerprint=["workflow-poller", "tick-failed"],
                )
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=next_delay)
        except TimeoutError:
            continue
