"""Billing authorization gates for managed cloud starts."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import NoReturn
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_ENFORCE_ACTIVE_SPEND,
    BILLING_DECISION_ORG_LIMIT_PAUSE,
    BILLING_DECISION_READ_UNAVAILABLE,
    BILLING_DECISION_USER_LIMIT_PAUSE,
    BILLING_MODE_ENFORCE,
    WORKSPACE_ACTION_BLOCK_KIND_CAP_EXHAUSTED,
    WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
    WORKSPACE_ACTION_BLOCK_KIND_OVERAGE_DISABLED,
)
from proliferate.db import session_ops as db_session
from proliferate.db.store import billing as billing_store
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.billing_runtime_usage import (
    record_billing_decision_event,
    resolve_billing_subject_id_for_user,
)
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.errors import ProliferateError
from proliferate.integrations.sentry import report_critical
from proliferate.lib.infra.time.wall_clock import utcnow
from proliferate.server.billing.budget_limits import window_bounds
from proliferate.server.billing.domain.plans import authorization_message
from proliferate.server.billing.snapshots import get_billing_snapshot_for_subject_in_session

# Block reasons that mean "you are out of included/managed cloud hours" — the
# client keys off these to show upgrade-your-plan copy. Everything else is a
# generic start block (payment attention, admin/spend hold, compute cap).
_CREDITS_EXHAUSTED_REASONS = frozenset(
    {
        WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
        WORKSPACE_ACTION_BLOCK_KIND_OVERAGE_DISABLED,
        WORKSPACE_ACTION_BLOCK_KIND_CAP_EXHAUSTED,
    }
)

# Stable machine codes on the 402 detail body. These are part of the client
# contract — the desktop maps them to actionable toast copy, so do not rename
# without updating consumers.
BILLING_BLOCK_CODE_CREDITS_EXHAUSTED = "billing_credits_exhausted"
BILLING_BLOCK_CODE_START_BLOCKED = "billing_start_blocked"
# Distinct from both of the above: billing said nothing at all because the read
# failed. Clients must not render top-up/upgrade copy for this — it is a
# retryable platform fault, not a quota verdict.
BILLING_BLOCK_CODE_UNAVAILABLE = "billing_unavailable"

# The receipt row's ``billing_subject_id`` is NOT NULL, but a read failure can
# strike while resolving the subject itself. Rather than lose the receipt (law
# N6: the receipt is the point), record the all-zero sentinel so the row still
# lands and reads as "subject never resolved". Greppable and impossible to
# confuse with a real subject id.
_UNRESOLVED_BILLING_SUBJECT_ID = UUID(int=0)

# Hard bound on the best-effort receipt write inside
# ``_deny_unreadable_billing_state``. That write opens a SECOND pool checkout
# during exactly the outage that broke the first one, so without a bound a
# saturated pool would hold the 503 denial hostage for the full
# ``pool_timeout`` (30s). The denial is the obligation; the receipt is not
# allowed to delay it by more than this.
_BILLING_RECEIPT_WRITE_TIMEOUT_SECONDS = 5.0

logger = logging.getLogger(__name__)


def billing_block_error_code(reason: str | None) -> str:
    """Map a block reason to the stable 402 ``detail.code`` the client keys off."""
    if reason in _CREDITS_EXHAUSTED_REASONS:
        return BILLING_BLOCK_CODE_CREDITS_EXHAUSTED
    return BILLING_BLOCK_CODE_START_BLOCKED


class CloudSandboxResumeBlockedError(ProliferateError):
    """Raised when a cloud sandbox must not be started/resumed for billing.

    Surfaced as a structured 402 so the UI can prompt a top-up / show the
    over-limit reason instead of silently failing the wake. This is the LIVE
    start/resume gate (spec §4.3): a sandbox the reconciler paused for an active
    spend hold or an over-cap compute budget must not be woken by an incoming
    request.

    This is EXPECTED business logic (a quota denial), not a page-worthy failure:
    the ``code``/``reason``/``remaining_seconds`` on the 402 let the client show
    an actionable message, and the ``billing_subject_id``/``owner_user_id`` let
    the background materialization path log the denial with correlation context
    instead of firing ``report_critical`` (see materialization/runner.py).
    """

    status_code = 402

    def __init__(
        self,
        message: str,
        *,
        decision_type: str,
        reason: str | None = None,
        billing_subject_id: UUID | None = None,
        owner_user_id: UUID | None = None,
        remaining_seconds: int | None = None,
    ) -> None:
        super().__init__(
            message,
            code=billing_block_error_code(reason),
            status_code=self.status_code,
        )
        self.decision_type = decision_type
        self.reason = reason
        self.billing_subject_id = billing_subject_id
        self.owner_user_id = owner_user_id
        self.remaining_seconds = remaining_seconds
        # Machine-readable fields on the 402 body (main.py copies extra_detail
        # into detail): a stable reason code plus remaining seconds when known.
        extra_detail: dict[str, object] = {"decision_type": decision_type}
        if reason is not None:
            extra_detail["reason"] = reason
        if remaining_seconds is not None:
            extra_detail["remaining_seconds"] = remaining_seconds
        self.extra_detail = extra_detail


class BillingStateUnavailableError(ProliferateError):
    """Raised when the enforcement gate could not READ billing state (law N6).

    This is the fail-closed arm of corridor E6: a DB error (or any unexpected
    blowup) while resolving the paying subject or its snapshot must never
    degrade into an implicit allow. It is deliberately NOT a 402 — a 402 asserts
    a billing verdict we do not have, which would send the client to a top-up
    screen for what is really a platform fault. 503 + a distinct
    ``billing_unavailable`` code says "unreadable, retry", matching the other
    retryable-dependency 503s in the cloud services (see
    ``require_cloud_provisioning_configured``).

    Unlike ``CloudSandboxResumeBlockedError`` this IS page-worthy: every raise is
    accompanied by a ``report_critical`` alert and a durable
    ``billing_decision_event`` receipt, so a silent enforcement outage is
    impossible in either direction.
    """

    code = BILLING_BLOCK_CODE_UNAVAILABLE
    status_code = 503

    def __init__(
        self,
        message: str = "Billing state could not be read. Please retry.",
        *,
        decision_type: str = BILLING_DECISION_READ_UNAVAILABLE,
        billing_subject_id: UUID | None = None,
        owner_user_id: UUID | None = None,
    ) -> None:
        super().__init__(message)
        self.decision_type = decision_type
        self.billing_subject_id = billing_subject_id
        self.owner_user_id = owner_user_id
        # Mirror the 402's machine-readable shape so a client can branch on
        # ``detail.decision_type`` without special-casing the unavailable body.
        self.extra_detail: dict[str, object] = {"decision_type": decision_type}


async def _write_unreadable_billing_state_receipt(
    *,
    billing_subject_id: UUID | None,
    owner_user_id: UUID | None,
) -> None:
    """Write the read-unavailable receipt on its own session (best effort)."""
    async with db_session.open_async_transaction() as receipt_db:
        await record_billing_decision_event(
            receipt_db,
            billing_subject_id=billing_subject_id or _UNRESOLVED_BILLING_SUBJECT_ID,
            actor_user_id=owner_user_id,
            workspace_id=None,
            decision_type=BILLING_DECISION_READ_UNAVAILABLE,
            mode=settings.cloud_billing_mode,
            # The read failed, so the only truthful claim is that we blocked:
            # would_block_start is the denial itself, not a snapshot verdict.
            would_block_start=True,
            would_pause_active=False,
            reason=BILLING_BLOCK_CODE_UNAVAILABLE,
            active_sandbox_count=0,
            remaining_seconds=None,
        )


async def _deny_unreadable_billing_state(
    error: Exception,
    *,
    billing_subject_id: UUID | None,
    owner_user_id: UUID | None,
) -> NoReturn:
    """Fail closed on a failed billing read: receipt, alert, typed deny (law N6).

    Law N6 splits into three obligations, and exactly one of them is
    unconditional: the DENIAL always happens (this function ends in a ``raise``
    on every path). The alert and the receipt are both attempted and both
    swallow their own failures — an observability outage must never become an
    enforcement outage.

    The receipt runs on its OWN session, not the caller's. Two reasons, both
    load-bearing: the caller's session is the one that just blew up (it may be
    in a failed transaction that cannot execute anything), and the production
    caller (materialization/runner._run_with_fresh_session) rolls back on
    exception — the same hazard that makes the quota gate below ``commit()``
    before raising. A separate session commits independently and survives that
    rollback.

    That second session is also a second pool checkout taken during the outage
    that broke the first one, so the receipt write is hard-bounded by
    ``_BILLING_RECEIPT_WRITE_TIMEOUT_SECONDS``: a saturated pool (or a hung DB)
    must not hold the denial for ``pool_timeout``. A timeout is treated exactly
    like any other receipt failure — logged, then the raise happens anyway.
    """
    context = {
        "billing_subject_id": (
            str(billing_subject_id) if billing_subject_id is not None else None
        ),
        "owner_user_id": str(owner_user_id) if owner_user_id is not None else None,
    }
    try:
        report_critical(
            error,
            tags={"domain": "billing", "action": "authorization_read"},
            extras=context,
        )
    except Exception:
        logger.exception("billing_read_alert_failed", extra=context)
    try:
        await asyncio.wait_for(
            _write_unreadable_billing_state_receipt(
                billing_subject_id=billing_subject_id,
                owner_user_id=owner_user_id,
            ),
            timeout=_BILLING_RECEIPT_WRITE_TIMEOUT_SECONDS,
        )
    except TimeoutError:
        # The dominant hazard is the pool CHECKOUT: during the outage that broke
        # the caller's session the pool is often saturated, and an unbounded wait
        # would hold this denial for pool_timeout (30s). Cancelling before a
        # connection is even held unwinds immediately. Give up on the receipt;
        # the alert already fired and the raise below happens regardless.
        logger.warning("billing_read_receipt_write_timed_out", extra=context)
    except Exception:
        # Never let receipt persistence swallow the denial: the raise below
        # happens either way, and the alert already fired.
        logger.exception("billing_read_receipt_write_failed", extra=context)
    raise BillingStateUnavailableError(
        billing_subject_id=billing_subject_id,
        owner_user_id=owner_user_id,
    ) from error


async def _compute_budget_cap_breach(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
    now: datetime,
) -> str | None:
    """Decision type if the org breaches an enabled compute cap, else None.

    Mirrors the reconciler's ``_resolve_compute_limit_pause`` semantics for the
    single-sandbox resume path: usage is summed by ``organization_id`` across
    the org's segments, a per-user cap is checked against that user's window
    usage (and wins), otherwise the org-wide cap sums the whole org.
    """
    limits = [
        limit
        for limit in await billing_store.list_budget_limits(db, organization_id)
        if limit.kind == "compute" and limit.enabled
    ]
    if not limits:
        return None

    async def _window_seconds(window: str, scope_user_id: UUID | None) -> float:
        start, end = window_bounds(window, now)
        return await billing_store.compute_usage_seconds_in_window_for_org(
            db,
            organization_id=organization_id,
            start=start,
            end=end,
            now=now,
            user_id=scope_user_id,
        )

    for limit in limits:
        if limit.user_id == user_id and await _window_seconds(limit.window, user_id) >= float(
            limit.cap_value
        ):
            return BILLING_DECISION_USER_LIMIT_PAUSE
    for limit in limits:
        if limit.user_id is None and await _window_seconds(limit.window, None) >= float(
            limit.cap_value
        ):
            return BILLING_DECISION_ORG_LIMIT_PAUSE
    return None


@dataclass(frozen=True)
class CloudSandboxBillingBlock:
    """A resolved "this subject may not run managed compute" decision.

    The decision half of the resume gate, without the raise: an owner whose
    paying subject is on an active spend hold or over an enabled compute budget
    cap. Callers that deny a request raise
    :class:`CloudSandboxResumeBlockedError`; callers that stop already-running
    compute (the E2B webhook's stray-wake re-pause) act on the pause path
    instead. Both record the same ``BillingDecisionEvent`` shape via
    :func:`record_cloud_sandbox_billing_block`.
    """

    billing_subject_id: UUID
    decision_type: str
    reason: str | None
    active_spend_hold: bool
    start_blocked: bool
    active_sandbox_count: int
    remaining_seconds: float | None


async def resolve_cloud_sandbox_billing_block(
    db: AsyncSession,
    *,
    owner_user_id: UUID | None,
) -> CloudSandboxBillingBlock | None:
    """Decide whether an owner's managed compute must be denied or stopped.

    Enforce-mode only (``CLOUD_BILLING_MODE=enforce``). Resolves the subject
    that PAYS the same way segment-open does — an org member bills the org
    subject, an org-less owner bills personal — then blocks on an active spend
    hold or an over-cap compute budget, the same two conditions that make the
    reconciler pause an open segment.

    Pure decision: it neither writes an audit row nor commits, so a caller with
    careful transaction phases (the E2B webhook) can record and commit on its
    own schedule.
    """
    if settings.cloud_billing_mode != BILLING_MODE_ENFORCE:
        return None
    if owner_user_id is None:
        return None
    # Law N6 / corridor E6: every read below (subject resolution, snapshot,
    # membership, budget-limit sums) is a billing-state read on an enforcement
    # path. If any of them fails we must not fall through to "no decision =
    # allowed", which is exactly what an uncaught exception here USED to leave to
    # chance at the seams that swallow errors. Deny with a typed 503 plus a
    # durable receipt and an alert instead. The guard lives HERE rather than in
    # the assert wrapper so every caller of the decision inherits it — the E2B
    # webhook's stray-wake re-pause (corridor N2) reads billing state through
    # this same function, and an unreadable read there must not silently leave
    # over-limit compute running either.
    billing_subject_id: UUID | None = None
    try:
        # Resolve the subject that pays the same way segment-open does: an org member
        # bills the org subject, an org-less owner bills personal. This must match
        # segment attribution — org compute now drains the org grant pool, so the
        # active-spend-hold snapshot has to read the org subject or a hold on the org
        # pool would never block an org member's resume.
        billing_subject_id = await resolve_billing_subject_id_for_user(db, owner_user_id)
        # Pass the owner so the free allowance is minted on an ORG subject too
        # (an org subject has no ``user_id`` of its own to fall back on). Without
        # it the gate would read an org pool that is empty only because the
        # allowance was never issued, and deny a new member's first start (W-F1).
        snapshot = await get_billing_snapshot_for_subject_in_session(
            db,
            billing_subject_id,
            grant_user_id=owner_user_id,
        )

        decision_type: str | None = None
        reason: str | None = None
        if snapshot.active_spend_hold:
            decision_type = BILLING_DECISION_ENFORCE_ACTIVE_SPEND
            reason = snapshot.hold_reason or "active_spend_hold"
        else:
            # Compute limits are org-scoped. The cloud_sandbox row has no org
            # column, but the owner is one membership lookup away — the same
            # resolution connect.py uses for identity tags and the segment open path
            # uses to stamp ``usage_segment.organization_id``.
            membership = await organizations_store.get_current_membership_for_user(
                db,
                owner_user_id,
            )
            if membership is not None:
                decision_type = await _compute_budget_cap_breach(
                    db,
                    organization_id=membership.organization.id,
                    user_id=owner_user_id,
                    now=utcnow(),
                )
                if decision_type is not None:
                    reason = "compute budget limit reached"
    except ProliferateError:
        # A typed billing/product error is already a decision; do not relabel it
        # as an unreadable read.
        raise
    except Exception as error:
        await _deny_unreadable_billing_state(
            error,
            billing_subject_id=billing_subject_id,
            owner_user_id=owner_user_id,
        )

    if decision_type is None:
        return None
    # The recorded decision stays on the paying subject even though compute caps
    # are summed by ``organization_id`` (matching the reconciler's
    # ``_resolve_compute_limit_pause``).
    return CloudSandboxBillingBlock(
        billing_subject_id=billing_subject_id,
        decision_type=decision_type,
        reason=reason,
        active_spend_hold=snapshot.active_spend_hold,
        start_blocked=snapshot.start_blocked,
        active_sandbox_count=snapshot.active_sandbox_count,
        remaining_seconds=snapshot.remaining_seconds,
    )


async def record_cloud_sandbox_billing_block(
    db: AsyncSession,
    block: CloudSandboxBillingBlock,
    *,
    actor_user_id: UUID | None,
    would_block_start: bool,
    would_pause_active: bool,
) -> None:
    """Stage the audit row for a resolved block, without committing.

    ``would_block_start``/``would_pause_active`` are the caller's effect: the
    request gate refuses a start, the webhook/reconciler stop running compute.
    """
    await record_billing_decision_event(
        db,
        billing_subject_id=block.billing_subject_id,
        actor_user_id=actor_user_id,
        workspace_id=None,
        decision_type=block.decision_type,
        mode=settings.cloud_billing_mode,
        would_block_start=would_block_start,
        would_pause_active=would_pause_active,
        reason=block.reason,
        active_sandbox_count=block.active_sandbox_count,
        remaining_seconds=block.remaining_seconds,
    )


async def assert_cloud_sandbox_resume_allowed(
    db: AsyncSession,
    sandbox: CloudSandboxValue,
) -> None:
    """Deny start/resume of a cloud sandbox that is over its billing limits.

    Enforce-mode only (``CLOUD_BILLING_MODE=enforce``). Resolves the owner's
    billing subject, then blocks on an active spend hold or an over-cap compute
    budget — the same conditions that make the reconciler pause an open segment.
    Records a ``BillingDecisionEvent`` and raises ``CloudSandboxResumeBlockedError``.

    Delegates to ``assert_cloud_sandbox_resume_allowed_for_owner``; the gate only
    reads ``sandbox.owner_user_id``, so the owner-id variant can run at seams that
    do not yet have a sandbox row (see the ensure service layer).
    """
    await assert_cloud_sandbox_resume_allowed_for_owner(db, owner_user_id=sandbox.owner_user_id)


async def assert_cloud_sandbox_resume_allowed_for_owner(
    db: AsyncSession,
    *,
    owner_user_id: UUID | None,
) -> None:
    """Owner-scoped resume gate: same checks as the sandbox variant, keyed by owner.

    Split out so a caller can gate before a cloud_sandbox row exists (the wake/
    ensure path flushes a new-row INSERT inside ``ensure_personal_cloud_sandbox_exists``,
    and this gate ``commit()``s its audit row before raising, so it must run first).
    Enforce-mode only (``CLOUD_BILLING_MODE=enforce``).
    """
    # Reads (and their fail-closed guard) live in the resolver; enforce-mode and
    # missing-owner short-circuits included.
    block = await resolve_cloud_sandbox_billing_block(db, owner_user_id=owner_user_id)
    if block is None:
        return

    # Persisting the verdict is billing I/O on the same session whose reads just
    # succeeded, and the conditions that break billing reads (read-only replica,
    # full disk, connection cap) break this write too. A failure here must land
    # in the same fail-closed corridor as a failed read: a typed 503 with a
    # receipt and an alert, never a bare RuntimeError. It must still DENY —
    # ``_deny_unreadable_billing_state`` raises on every path, so there is no
    # arm through this block that returns "allowed". Only the persistence I/O is
    # wrapped; the 402 raise below stays outside so a legitimate quota denial is
    # never relabelled as unreadable.
    try:
        await record_cloud_sandbox_billing_block(
            db,
            block,
            actor_user_id=owner_user_id,
            would_block_start=True,
            would_pause_active=block.active_spend_hold,
        )
        # Persist the decision before raising: the production caller
        # (materialization/runner._run_with_fresh_session) rolls back its session in
        # the exception handler, which would otherwise discard this un-committed
        # audit row. Safe at every call site: this gate runs first at each seam
        # (connect_ready_sandbox's opening statement, and the ensure service
        # layer before ensure_personal_cloud_sandbox_exists stages a row INSERT), so
        # no other writes are staged on this session yet.
        await db.commit()
    except ProliferateError:
        raise
    except Exception as error:
        await _deny_unreadable_billing_state(
            error,
            billing_subject_id=block.billing_subject_id,
            owner_user_id=owner_user_id,
        )

    raise CloudSandboxResumeBlockedError(
        authorization_message(block.reason)
        or "This sandbox is paused because your billing limit was reached.",
        decision_type=block.decision_type,
        reason=block.reason,
        billing_subject_id=block.billing_subject_id,
        owner_user_id=owner_user_id,
        remaining_seconds=block.remaining_seconds,
    )
