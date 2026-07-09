"""Billing authorization gates for managed cloud starts."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_AUTHORIZE_START,
    BILLING_DECISION_ENFORCE_ACTIVE_SPEND,
    BILLING_DECISION_ORG_LIMIT_PAUSE,
    BILLING_DECISION_USER_LIMIT_PAUSE,
    BILLING_MODE_ENFORCE,
)
from proliferate.db import session_ops as db_session
from proliferate.db.store import billing as billing_store
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.billing_runtime_usage import (
    record_billing_decision_event,
    resolve_billing_subject_id_for_workspace,
)
from proliferate.db.store.billing_subjects import (
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.errors import ProliferateError
from proliferate.server.billing import snapshot_state
from proliferate.server.billing.budget_limits import window_bounds
from proliferate.server.billing.domain.plans import authorization_message
from proliferate.server.billing.models import BillingSnapshot, SandboxStartAuthorization
from proliferate.server.billing.snapshots import (
    build_billing_snapshot,
    get_billing_snapshot_for_subject_in_session,
    state_with_overage_usage,
)
from proliferate.utils.time import utcnow


class CloudSandboxResumeBlockedError(ProliferateError):
    """Raised when a cloud sandbox must not be started/resumed for billing.

    Surfaced as a structured 402 so the UI can prompt a top-up / show the
    over-limit reason instead of silently failing the wake. This is the LIVE
    start/resume gate that the orphaned ``authorize_sandbox_start`` never wired
    up (spec §4.3): a sandbox the reconciler paused for an active spend hold or
    an over-cap compute budget must not be woken by an incoming request.
    """

    code = "billing_resume_blocked"
    status_code = 402

    def __init__(
        self,
        message: str,
        *,
        decision_type: str,
        reason: str | None = None,
    ) -> None:
        super().__init__(message, code=self.code, status_code=self.status_code)
        self.decision_type = decision_type
        self.reason = reason


async def authorize_sandbox_start_for_billing_subject(
    *,
    actor_user_id: UUID | None,
    billing_subject_id: UUID,
    workspace_id: UUID | None = None,
) -> SandboxStartAuthorization:
    async with db_session.open_async_transaction() as db:
        state = await snapshot_state.load_snapshot_state_for_subject(db, billing_subject_id)
        state = await state_with_overage_usage(db, state)
        snapshot = build_billing_snapshot(state)
        return await record_sandbox_start_authorization(
            db,
            snapshot,
            actor_user_id=actor_user_id,
            workspace_id=workspace_id,
        )


async def authorize_sandbox_start(
    *,
    user_id: UUID,
    workspace_id: UUID | None,
) -> SandboxStartAuthorization:
    async with db_session.open_async_transaction() as db:
        if workspace_id is None:
            state = await snapshot_state.load_snapshot_state_for_user(db, user_id)
        else:
            billing_subject_id = await resolve_billing_subject_id_for_workspace(
                db,
                workspace_id,
            )
            state = await snapshot_state.load_snapshot_state_for_subject(db, billing_subject_id)
        state = await state_with_overage_usage(db, state)
        snapshot = build_billing_snapshot(state)
        return await record_sandbox_start_authorization(
            db,
            snapshot,
            actor_user_id=user_id,
            workspace_id=workspace_id,
        )


async def record_sandbox_start_authorization(
    db: AsyncSession,
    snapshot: BillingSnapshot,
    *,
    actor_user_id: UUID | None,
    workspace_id: UUID | None,
) -> SandboxStartAuthorization:
    enforced = settings.cloud_billing_mode == BILLING_MODE_ENFORCE
    allowed = not enforced or not snapshot.start_blocked
    reason = snapshot.start_block_reason if snapshot.start_blocked else None
    await record_billing_decision_event(
        db,
        billing_subject_id=snapshot.billing_subject_id,
        actor_user_id=actor_user_id,
        workspace_id=workspace_id,
        decision_type=BILLING_DECISION_AUTHORIZE_START,
        mode=settings.cloud_billing_mode,
        would_block_start=snapshot.start_blocked,
        would_pause_active=snapshot.active_spend_hold,
        reason=reason,
        active_sandbox_count=snapshot.active_sandbox_count,
        remaining_seconds=snapshot.remaining_seconds,
    )
    return SandboxStartAuthorization(
        allowed=allowed,
        billing_subject_id=snapshot.billing_subject_id,
        start_blocked=snapshot.start_blocked,
        start_block_reason=snapshot.start_block_reason,
        active_spend_hold=snapshot.active_spend_hold,
        hold_reason=snapshot.hold_reason,
        message=authorization_message(reason),
        active_sandbox_count=snapshot.active_sandbox_count,
        remaining_seconds=snapshot.remaining_seconds,
        active_environment_limit=snapshot.active_environment_limit,
    )


async def _compute_budget_cap_breach(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    organization_id: UUID,
    user_id: UUID,
    now: datetime,
) -> str | None:
    """Decision type if the subject breaches an enabled org compute cap, else None.

    Mirrors the reconciler's ``_resolve_compute_limit_pause`` semantics for the
    single-sandbox resume path: a per-user cap is checked against that user's
    window usage (and wins), otherwise the org-wide cap sums the whole subject.
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
        return await billing_store.compute_usage_seconds_in_window(
            db,
            billing_subject_id=billing_subject_id,
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
    do not yet have a sandbox row (see the wake/ensure service layer).
    """
    await assert_cloud_sandbox_resume_allowed_for_owner(
        db, owner_user_id=sandbox.owner_user_id
    )


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
    if settings.cloud_billing_mode != BILLING_MODE_ENFORCE:
        return
    if owner_user_id is None:
        return
    subject = await ensure_personal_billing_subject(db, owner_user_id)
    snapshot = await get_billing_snapshot_for_subject_in_session(db, subject.id)
    now = utcnow()

    decision_type: str | None = None
    reason: str | None = None
    # Subject for the recorded decision event / compute-cap usage window. The
    # spend-hold path stays on the owner's personal subject; the compute-cap
    # path re-binds to the org billing subject (below) so it mirrors the
    # reconciler, which scopes compute limits by ``segment.billing_subject_id``.
    decision_subject_id = subject.id
    if snapshot.active_spend_hold:
        decision_type = BILLING_DECISION_ENFORCE_ACTIVE_SPEND
        reason = snapshot.hold_reason or "active_spend_hold"
    else:
        # ``ensure_personal_billing_subject`` always yields ``organization_id is
        # None`` (DB CheckConstraint), so the sandbox's org can't come from the
        # subject. The cloud_sandbox row has no org column either, but the owner
        # is one membership lookup away — the same resolution connect.py uses for
        # identity tags. Compute limits are org-scoped, so resolve the org, then
        # its billing subject, and check caps against that org subject's usage
        # (matching the reconciler's ``_resolve_compute_limit_pause``).
        membership = await organizations_store.get_current_membership_for_user(db, owner_user_id)
        if membership is not None:
            organization_id = membership.organization.id
            org_subject = await ensure_organization_billing_subject(db, organization_id)
            decision_type = await _compute_budget_cap_breach(
                db,
                billing_subject_id=org_subject.id,
                organization_id=organization_id,
                user_id=owner_user_id,
                now=now,
            )
            if decision_type is not None:
                decision_subject_id = org_subject.id
                reason = "compute budget limit reached"

    if decision_type is None:
        return

    await record_billing_decision_event(
        db,
        billing_subject_id=decision_subject_id,
        actor_user_id=owner_user_id,
        workspace_id=None,
        decision_type=decision_type,
        mode=settings.cloud_billing_mode,
        would_block_start=True,
        would_pause_active=snapshot.active_spend_hold,
        reason=reason,
        active_sandbox_count=snapshot.active_sandbox_count,
        remaining_seconds=snapshot.remaining_seconds,
    )
    # Persist the decision before raising: the production caller
    # (materialization/runner._run_with_fresh_session) rolls back its session in
    # the exception handler, which would otherwise discard this un-committed
    # audit row. Safe at every call site: this gate runs first at each seam
    # (connect_ready_sandbox's opening statement, and the wake/ensure service
    # layer before ensure_personal_cloud_sandbox_exists stages a row INSERT), so
    # no other writes are staged on this session yet.
    await db.commit()
    raise CloudSandboxResumeBlockedError(
        authorization_message(reason)
        or "This sandbox is paused because your billing limit was reached.",
        decision_type=decision_type,
        reason=reason,
    )
