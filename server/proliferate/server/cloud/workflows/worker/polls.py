"""Worker-facing poll-attempt service (WS4b, spec §10.3).

The exact prepare -> close-DB -> HTTP -> new-DB -> apply sequence the poll
contract requires:

    Beat -> workflow_fire_due_polls task
    prepare transaction:
      claim/fence attempt and freeze trigger config + requested cursor, commit
    -> close DB session -> SSRF-safe HTTP -> open a new DB session
    apply transaction:
      validate page + items; dedupe by (trigger_id, external_item_id); persist
      each new item as a durable run intent; record duplicate/dead-letter
      decisions; CAS the cursor only when every item is durable; when
      has_more, write the next-page outbox row in the SAME transaction

``run_one_poll_attempt`` drives page 1 for a Beat-claimed due trigger;
``run_next_page_attempt`` drives page N>1 for a claimed ``poll_next_page``
outbox row (no claim phase — page 1's claim already fenced the occurrence).
Both funnel through ``_fetch_and_apply``, so the no-lock-over-HTTP property
(no DB session open across the fetch) holds identically for every page.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    WORKFLOW_OUTBOX_KIND_POLL_NEXT_PAGE,
    WORKFLOW_POLL_CONTRACT_ERROR_REPEATED_CURSOR,
    WORKFLOW_POLL_DEFAULT_LIMIT,
    WORKFLOW_POLL_INBOX_STATUS_DEAD_LETTER,
    WORKFLOW_POLL_INBOX_STATUS_PENDING,
    WORKFLOW_POLL_INBOX_STATUS_SCHEDULED,
    WORKFLOW_POLL_MAX_ATTEMPTS,
    WORKFLOW_POLL_PAGE_BUDGET,
    WORKFLOW_POLL_PAGE_BUDGET_EXHAUSTED,
    WORKFLOW_TRIGGER_KIND_POLL,
)
from proliferate.db.store import cloud_workflow_polls as poll_store
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store import cloud_workflows as workflows_store
from proliferate.db.store import workflow_ledger as ledger
from proliferate.db.store.cloud_workflow_triggers import DuePollTrigger, _organization_id_for_owner
from proliferate.db.store.workflow_ledger import OutboxRecord, PollInboxRecord
from proliferate.middleware.request_context import with_correlation_context
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import compiler
from proliferate.server.cloud.workflows import poller as poller_module
from proliferate.server.cloud.workflows.domain.poll_contract import (
    PollPage,
    bound_error_message,
    overlay_item_inputs,
    validate_item_data,
)
from proliferate.server.cloud.workflows.poller import SchedulerSessionFactory
from proliferate.server.cloud.workflows.worker.poll_http import (
    decrypt_poll_auth_header,
    guard_poll_endpoint,
)

logger = logging.getLogger(__name__)


@dataclass
class _PollActor:
    """Minimal owner identity — the owner-scoped services StartRun expects only
    read ``.id`` (runs execute as the workflow owner; v1 has no "Run as")."""

    id: UUID


@dataclass(frozen=True)
class FrozenPollAttempt:
    """The trigger config + requested cursor frozen at the start of one poll
    attempt. Carries zero secrets beyond the one ciphertext the fetch needs;
    never persisted verbatim (the ciphertext stays out of the outbox payload —
    a continuation re-reads it live via ``get_poll_auth_ciphertext``)."""

    trigger_id: UUID
    workflow_id: UUID
    workflow_owner_user_id: UUID
    workflow_organization_id: UUID | None
    target_mode: str
    target_workspace_id: UUID | None
    poll_url: str
    poll_auth_header: str | None
    poll_auth_ciphertext: str | None
    item_schema: dict[str, object] | None
    args_json: dict[str, object]
    requested_cursor: str | None
    generation: int | None
    page_number: int


@dataclass
class PollItemCounts:
    """Mutable per-page tallies ``apply_poll_page`` accumulates while walking
    ``page.items`` — factored out of ``PollApplyOutcome`` so the tally and the
    cursor/CAS decision fields don't have to be threaded as one long
    positional tuple between the item loop and ``_advance_cursor``."""

    scheduled: int = 0
    dead_lettered: int = 0
    duplicates: int = 0
    pending_retry: int = 0


@dataclass(frozen=True)
class PollApplyOutcome:
    counts: PollItemCounts
    cursor_advanced: bool
    contract_error: bool = False
    budget_exhausted: bool = False
    next_page_queued: bool = False


def _freeze_attempt(trigger: DuePollTrigger, *, page_number: int) -> FrozenPollAttempt:
    return FrozenPollAttempt(
        trigger_id=trigger.id,
        workflow_id=trigger.workflow_id,
        workflow_owner_user_id=trigger.workflow_owner_user_id,
        workflow_organization_id=trigger.workflow_organization_id,
        target_mode=trigger.target_mode,
        target_workspace_id=trigger.target_workspace_id,
        poll_url=trigger.poll_url,
        poll_auth_header=trigger.poll_auth_header,
        poll_auth_ciphertext=trigger.poll_auth_ciphertext,
        item_schema=trigger.poll_item_schema_json,
        args_json=dict(trigger.args_json or {}),
        requested_cursor=trigger.poll_cursor,
        generation=trigger.poll_cursor_generation,
        page_number=page_number,
    )


# --- entry points ----------------------------------------------------------------


async def run_one_poll_attempt(
    session_factory: SchedulerSessionFactory, *, trigger_id: UUID, now: datetime
) -> PollApplyOutcome | None:
    """Page 1 of a Beat-claimed due poll trigger. ``None`` when nothing was
    claimable (already taken, disabled, not due) or the workflow is archived.

    ``session_factory`` is explicit (not defaulted to the production engine —
    mirrors ``poller.py``'s own ``_poll_one_trigger``/``run_poll_pass``) so a
    test can inject a test-database factory; production callers
    (``background/tasks/workflows.py``) pass the real one.
    """

    async with session_factory() as db, db.begin():
        trigger = await trigger_store.claim_due_poll_trigger(db, trigger_id=trigger_id, now=now)
        if trigger is None:
            return None
        with with_correlation_context(
            organization_id=trigger.workflow_organization_id,
            user_id=trigger.workflow_owner_user_id,
            worker_id="workflow_polls",
        ):
            if trigger.workflow_archived:
                await trigger_store.persist_poll_cursor(
                    db,
                    trigger_id=trigger_id,
                    cursor=trigger.poll_cursor,
                    polled_at=now,
                    error="Workflow was archived.",
                )
                return None
            attempt = _freeze_attempt(trigger, page_number=1)

    # NO DB session held here: the SSRF guard + HTTP fetch run with zero open
    # transaction — THE §7.3 no-lock-over-HTTP proof.
    return await _fetch_and_apply(session_factory, attempt, now=now)


async def run_next_page_attempt(
    session_factory: SchedulerSessionFactory, row: OutboxRecord, *, now: datetime
) -> PollApplyOutcome | None:
    """Page N>1, continuing the occurrence a ``poll_next_page`` outbox row
    recorded. No claim phase: page 1's claim already fenced the occurrence via
    ``poll_cursor_generation``; this re-reads the LIVE trigger config (an
    admin edit mid-chain takes effect on the next page, which is safe — only
    the frozen cursor/generation in the payload are load-bearing for the CAS).
    """

    assert row.trigger_id is not None
    attempt = await _load_continuation_attempt(session_factory, row)
    if attempt is None:
        return None
    return await _fetch_and_apply(session_factory, attempt, now=now)


async def _load_continuation_attempt(
    session_factory: SchedulerSessionFactory, row: OutboxRecord
) -> FrozenPollAttempt | None:
    assert row.trigger_id is not None
    async with session_factory() as db:
        trigger = await trigger_store.get_trigger(db, row.trigger_id)
        if trigger is None or trigger.kind != WORKFLOW_TRIGGER_KIND_POLL or not trigger.enabled:
            return None
        workflow = await workflows_store.get_workflow(db, trigger.workflow_id)
        if workflow is None or workflow.archived_at is not None:
            return None
        auth_ciphertext = await trigger_store.get_poll_auth_ciphertext(db, row.trigger_id)
        organization_id = await _organization_id_for_owner(
            db, owner_user_id=workflow.owner_user_id
        )
    payload = row.payload_json
    return FrozenPollAttempt(
        trigger_id=row.trigger_id,
        workflow_id=trigger.workflow_id,
        workflow_owner_user_id=workflow.owner_user_id,
        workflow_organization_id=organization_id,
        target_mode=trigger.target_mode,
        target_workspace_id=trigger.target_workspace_id,
        poll_url=trigger.poll_url or "",
        poll_auth_header=trigger.poll_auth_header,
        poll_auth_ciphertext=auth_ciphertext,
        item_schema=trigger.poll_item_schema_json,
        args_json=dict(trigger.args_json or {}),
        requested_cursor=payload.get("requested_cursor"),  # type: ignore[arg-type]
        generation=payload.get("generation"),  # type: ignore[arg-type]
        page_number=int(payload.get("page_number") or 1),
    )


# --- fetch (DB-free) + apply -----------------------------------------------------


async def _fetch_and_apply(
    session_factory: SchedulerSessionFactory, attempt: FrozenPollAttempt, *, now: datetime
) -> PollApplyOutcome | None:
    guard_poll_endpoint(attempt.poll_url)
    auth = decrypt_poll_auth_header(attempt.poll_auth_header, attempt.poll_auth_ciphertext)
    auth_header, auth_value = auth if auth is not None else (None, None)
    try:
        page = await poller_module.fetch_poll_page(
            url=attempt.poll_url,
            auth_header=auth_header,
            auth_value=auth_value,
            cursor=attempt.requested_cursor,
            limit=WORKFLOW_POLL_DEFAULT_LIMIT,
        )
    except Exception as exc:
        # Transient fetch/shape failure: cursor stays put (persist_poll_cursor
        # writes back the SAME requested_cursor), the next due occurrence retries.
        async with session_factory() as db, db.begin():
            await trigger_store.persist_poll_cursor(
                db,
                trigger_id=attempt.trigger_id,
                cursor=attempt.requested_cursor,
                polled_at=now,
                error=poller_module.poll_error_message(exc),
            )
        return None

    async with session_factory() as db, db.begin():
        with with_correlation_context(
            organization_id=attempt.workflow_organization_id,
            user_id=attempt.workflow_owner_user_id,
            worker_id="workflow_polls",
        ):
            return await apply_poll_page(db, attempt=attempt, page=page, now=now)


async def apply_poll_page(
    db: AsyncSession, *, attempt: FrozenPollAttempt, page: PollPage, now: datetime
) -> PollApplyOutcome:
    """Apply one fetched page inside the caller's transaction (commit-free)."""

    actor = _PollActor(id=attempt.workflow_owner_user_id)
    counts = PollItemCounts()
    all_durable = True

    for item in page.items:
        inbox = await _upsert_or_load_inbox_item(
            db, attempt=attempt, item_id=item.id, data=item.data
        )
        if inbox is None:
            counts.duplicates += 1
            continue

        schema_error = validate_item_data(item.data, attempt.item_schema)
        if schema_error is not None:
            await ledger.update_poll_inbox_item(
                db,
                inbox_id=inbox.id,
                status=WORKFLOW_POLL_INBOX_STATUS_DEAD_LETTER,
                last_error=bound_error_message(schema_error),
            )
            counts.dead_lettered += 1
            continue

        inputs = overlay_item_inputs(
            item.data, static_inputs=attempt.args_json, item_schema=attempt.item_schema
        )
        try:
            async with db.begin_nested():
                run = await compiler.start_run(
                    db,
                    actor,
                    attempt.workflow_id,
                    inputs=inputs,
                    target_mode=attempt.target_mode,
                    trigger_kind=WORKFLOW_TRIGGER_KIND_POLL,
                    target_workspace_id=attempt.target_workspace_id,
                    trigger_id=attempt.trigger_id,
                )
        except CloudApiError as exc:
            durable = await _record_start_run_failure(db, inbox=inbox, exc=exc)
            if durable:
                counts.dead_lettered += 1
            else:
                counts.pending_retry += 1
                all_durable = False
            continue

        await ledger.update_poll_inbox_item(
            db, inbox_id=inbox.id, status=WORKFLOW_POLL_INBOX_STATUS_SCHEDULED, run_id=run.id
        )
        counts.scheduled += 1

    if not all_durable:
        return PollApplyOutcome(counts=counts, cursor_advanced=False)
    return await _advance_cursor(db, attempt=attempt, page=page, now=now, counts=counts)


async def _upsert_or_load_inbox_item(
    db: AsyncSession, *, attempt: FrozenPollAttempt, item_id: str, data: dict[str, object]
) -> PollInboxRecord | None:
    """Insert a new pending inbox row, or return the existing PENDING row for a
    retry. Returns ``None`` when the item is an already-durable duplicate (a
    replayed page item whose earlier occurrence already scheduled/dead-lettered
    it) — nothing further to do."""

    inserted = await ledger.upsert_poll_inbox_item(
        db,
        trigger_id=attempt.trigger_id,
        external_item_id=item_id,
        payload_json=dict(data),
    )
    if inserted is not None:
        return inserted
    existing = await ledger.get_poll_inbox_item(
        db, trigger_id=attempt.trigger_id, external_item_id=item_id
    )
    assert existing is not None
    return existing if existing.status == WORKFLOW_POLL_INBOX_STATUS_PENDING else None


async def _record_start_run_failure(
    db: AsyncSession, *, inbox: PollInboxRecord, exc: CloudApiError
) -> bool:
    """Record a transient ``start_run`` failure against the inbox item. Returns
    ``True`` when this failure crossed the attempt ceiling into a durable
    dead-letter, ``False`` when it stays ``pending`` for the next occurrence."""

    message = bound_error_message(f"{exc.code}: {exc.message}")
    if inbox.attempt_count + 1 >= WORKFLOW_POLL_MAX_ATTEMPTS:
        await ledger.update_poll_inbox_item(
            db,
            inbox_id=inbox.id,
            status=WORKFLOW_POLL_INBOX_STATUS_DEAD_LETTER,
            last_error=message,
            increment_attempt=True,
        )
        return True
    await ledger.update_poll_inbox_item(
        db, inbox_id=inbox.id, last_error=message, increment_attempt=True
    )
    return False


async def _advance_cursor(
    db: AsyncSession,
    *,
    attempt: FrozenPollAttempt,
    page: PollPage,
    now: datetime,
    counts: PollItemCounts,
) -> PollApplyOutcome:
    if page.has_more and (page.cursor is None or page.cursor == attempt.requested_cursor):
        await poll_store.disable_poll_trigger_with_contract_error(
            db,
            trigger_id=attempt.trigger_id,
            now=now,
            error=WORKFLOW_POLL_CONTRACT_ERROR_REPEATED_CURSOR,
        )
        return PollApplyOutcome(counts=counts, cursor_advanced=False, contract_error=True)

    budget_exhausted = page.has_more and attempt.page_number >= WORKFLOW_POLL_PAGE_BUDGET
    applied = await poll_store.cas_advance_poll_cursor(
        db,
        trigger_id=attempt.trigger_id,
        expected_generation=attempt.generation,
        new_cursor=page.cursor,
        error=WORKFLOW_POLL_PAGE_BUDGET_EXHAUSTED if budget_exhausted else None,
    )
    if not applied:
        logger.warning("workflow poll cursor CAS lost trigger_id=%s", attempt.trigger_id)
        return PollApplyOutcome(
            counts=counts, cursor_advanced=False, budget_exhausted=budget_exhausted
        )

    next_page_queued = False
    if page.has_more and not budget_exhausted:
        await ledger.enqueue_outbox(
            db,
            kind=WORKFLOW_OUTBOX_KIND_POLL_NEXT_PAGE,
            trigger_id=attempt.trigger_id,
            payload_json={
                "requested_cursor": page.cursor,
                "generation": (attempt.generation or 0) + 1,
                "page_number": attempt.page_number + 1,
            },
        )
        next_page_queued = True

    return PollApplyOutcome(
        counts=counts,
        cursor_advanced=True,
        budget_exhausted=budget_exhausted,
        next_page_queued=next_page_queued,
    )
