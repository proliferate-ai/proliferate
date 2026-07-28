"""Billing enforcement corridors E5 (no denial cache) and E6 (fail closed on read errors).

Both pin law N6 and law N5 from the launch-hardening plan:

* **E5 / N5** — a 402 billing denial is a *verdict about right now*, never a
  cached state. An exhausted subject that gets denied and is then repaired (fresh
  credit granted, hold cleared) must be allowed on the very next authorization
  call, with no stale-denial window in between.
* **E6 / N6** — a billing-state READ failure on an enforcement path must fail
  CLOSED: a typed ``billing_unavailable`` deny (never an implicit allow, never a
  bare exception), plus a durable receipt that survives the caller's rollback,
  plus a ``report_critical`` alert. The receipt is best effort; the denial and
  the alert are not.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_READ_UNAVAILABLE,
    BILLING_HOLD_KIND_ADMIN_HOLD,
    BILLING_HOLD_STATUS_ACTIVE,
    BILLING_MODE_ENFORCE,
    REFILL_10H_GRANT_TYPE,
    WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingDecisionEvent, BillingHold
from proliferate.db.store.billing_subjects import (
    ensure_billing_grant,
    ensure_free_included_grant,
    ensure_personal_billing_subject,
)
from proliferate.server.billing import authorization as authorization_module
from proliferate.server.billing.authorization import (
    BillingStateUnavailableError,
    CloudSandboxResumeBlockedError,
    assert_cloud_sandbox_resume_allowed_for_owner,
)
from tests.integration.billing_accounting_helpers import (
    patch_global_session_factory,
    seed_usage_segment,
)


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"fail-closed-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


async def _seed_credits_exhausted_user(db_session: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    """A free-plan owner whose included sandbox hours are fully consumed."""
    user_id = await _create_user(db_session)
    subject = await ensure_personal_billing_subject(db_session, user_id)
    await ensure_free_included_grant(db_session, user_id)
    # Burn well past the (1h) included grant so the subject is over quota with no
    # paid overage -> credit_reason == credits_exhausted.
    await seed_usage_segment(db_session, user_id=user_id, hours=5.0)
    await db_session.commit()
    return user_id, subject.id


@pytest.mark.asyncio
async def test_billing_denial_is_never_cached_repair_allows_next_call(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Corridor E5: a 402 denial is not cached — repairing credit allows the next call.

    The gate is re-entered immediately after the repair, in the same test body,
    with no sleep: if any layer memoized the denial (per-request cache, snapshot
    cache, TTL on the block reason) this second call would still raise.
    """
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    monkeypatch.setattr(settings, "cloud_free_sandbox_hours", 1.0)
    user_id, subject_id = await _seed_credits_exhausted_user(db_session)

    with pytest.raises(CloudSandboxResumeBlockedError) as excinfo:
        await assert_cloud_sandbox_resume_allowed_for_owner(db_session, owner_user_id=user_id)
    assert excinfo.value.status_code == 402
    assert excinfo.value.reason == WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED

    # Mirror the production caller, which rolls back on the raised denial.
    await db_session.rollback()

    # Repair: a refill grant lands (the "credit purchased" path).
    await ensure_billing_grant(
        db_session,
        user_id=user_id,
        billing_subject_id=subject_id,
        grant_type=REFILL_10H_GRANT_TYPE,
        hours_granted=10.0,
        effective_at=datetime.now(UTC) - timedelta(minutes=1),
        expires_at=None,
        source_ref=f"test-refill:{uuid.uuid4().hex}",
    )
    await db_session.commit()

    # Immediately re-run the same gate: allowed, no stale-denial window.
    await assert_cloud_sandbox_resume_allowed_for_owner(db_session, owner_user_id=user_id)


@pytest.mark.asyncio
async def test_hold_release_allows_next_call_without_denial_window(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Corridor E5, hold variant: clearing an admin hold takes effect on the next call."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    user_id = await _create_user(db_session)
    subject = await ensure_personal_billing_subject(db_session, user_id)
    await ensure_free_included_grant(db_session, user_id)
    hold = BillingHold(
        billing_subject_id=subject.id,
        kind=BILLING_HOLD_KIND_ADMIN_HOLD,
        status=BILLING_HOLD_STATUS_ACTIVE,
        source="test",
    )
    db_session.add(hold)
    await db_session.commit()

    with pytest.raises(CloudSandboxResumeBlockedError):
        await assert_cloud_sandbox_resume_allowed_for_owner(db_session, owner_user_id=user_id)
    await db_session.rollback()

    hold.status = "resolved"
    hold.resolved_at = datetime.now(UTC)
    await db_session.commit()

    await assert_cloud_sandbox_resume_allowed_for_owner(db_session, owner_user_id=user_id)


@pytest.mark.asyncio
async def test_billing_read_failure_denies_with_receipt_and_alert(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Corridor E6 / law N6: an unreadable snapshot denies, receipts, and alerts.

    The three obligations are asserted separately because they fail in different
    ways: an implicit allow (silent overspend), a lost receipt (no forensics),
    and a missing alert (silent enforcement outage).
    """
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    # The receipt writes on its own session via db_session.open_async_transaction,
    # so the global factory has to point at the test engine.
    patch_global_session_factory(test_engine, monkeypatch)
    user_id = await _create_user(db_session)
    subject_id = (await ensure_personal_billing_subject(db_session, user_id)).id
    await db_session.commit()

    alerts: list[BaseException] = []
    monkeypatch.setattr(
        authorization_module,
        "report_critical",
        lambda error, **_kwargs: alerts.append(error),
    )

    async def _snapshot_boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("billing snapshot read failed")

    monkeypatch.setattr(
        authorization_module,
        "get_billing_snapshot_for_subject_in_session",
        _snapshot_boom,
    )

    # (a) typed deny — not an allow, and not the raw RuntimeError.
    with pytest.raises(BillingStateUnavailableError) as excinfo:
        await assert_cloud_sandbox_resume_allowed_for_owner(db_session, owner_user_id=user_id)
    error = excinfo.value
    assert error.code == "billing_unavailable"
    assert error.status_code == 503
    assert error.extra_detail["decision_type"] == BILLING_DECISION_READ_UNAVAILABLE
    assert error.billing_subject_id == subject_id
    assert error.owner_user_id == user_id
    assert isinstance(error.__cause__, RuntimeError)

    # (c) the alert fired on the way out.
    assert len(alerts) == 1
    assert isinstance(alerts[0], RuntimeError)

    # (b) the receipt is durable across the caller's rollback.
    await db_session.rollback()
    receipts = await db_session.scalar(
        select(func.count())
        .select_from(BillingDecisionEvent)
        .where(
            BillingDecisionEvent.billing_subject_id == subject_id,
            BillingDecisionEvent.decision_type == BILLING_DECISION_READ_UNAVAILABLE,
        )
    )
    assert receipts == 1
    receipt = await db_session.scalar(
        select(BillingDecisionEvent).where(
            BillingDecisionEvent.decision_type == BILLING_DECISION_READ_UNAVAILABLE
        )
    )
    assert receipt is not None
    assert receipt.would_block_start is True
    assert receipt.actor_user_id == user_id
    assert receipt.reason == "billing_unavailable"


@pytest.mark.asyncio
async def test_billing_read_failure_still_denies_when_receipt_write_fails(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Corridor E6: the receipt is best effort; the denial and the alert are not."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    patch_global_session_factory(test_engine, monkeypatch)
    user_id = await _create_user(db_session)
    await ensure_personal_billing_subject(db_session, user_id)
    await db_session.commit()

    alerts: list[BaseException] = []
    monkeypatch.setattr(
        authorization_module,
        "report_critical",
        lambda error, **_kwargs: alerts.append(error),
    )

    async def _snapshot_boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("billing snapshot read failed")

    async def _receipt_boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("receipt insert failed")

    monkeypatch.setattr(
        authorization_module,
        "get_billing_snapshot_for_subject_in_session",
        _snapshot_boom,
    )
    monkeypatch.setattr(authorization_module, "record_billing_decision_event", _receipt_boom)

    with pytest.raises(BillingStateUnavailableError):
        await assert_cloud_sandbox_resume_allowed_for_owner(db_session, owner_user_id=user_id)

    assert len(alerts) == 1
    await db_session.rollback()
    receipts = await db_session.scalar(
        select(func.count())
        .select_from(BillingDecisionEvent)
        .where(BillingDecisionEvent.decision_type == BILLING_DECISION_READ_UNAVAILABLE)
    )
    assert receipts == 0


@pytest.mark.asyncio
async def test_billing_read_failure_still_denies_when_alert_hook_fails(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Corridor E6: an observability outage must not become an enforcement outage."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    patch_global_session_factory(test_engine, monkeypatch)
    user_id = await _create_user(db_session)
    await ensure_personal_billing_subject(db_session, user_id)
    await db_session.commit()

    def _alert_boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("sentry transport down")

    async def _snapshot_boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("billing snapshot read failed")

    monkeypatch.setattr(authorization_module, "report_critical", _alert_boom)
    monkeypatch.setattr(
        authorization_module,
        "get_billing_snapshot_for_subject_in_session",
        _snapshot_boom,
    )

    with pytest.raises(BillingStateUnavailableError):
        await assert_cloud_sandbox_resume_allowed_for_owner(db_session, owner_user_id=user_id)

    # The receipt still lands even though the alert blew up.
    await db_session.rollback()
    receipts = await db_session.scalar(
        select(func.count())
        .select_from(BillingDecisionEvent)
        .where(BillingDecisionEvent.decision_type == BILLING_DECISION_READ_UNAVAILABLE)
    )
    assert receipts == 1


@pytest.mark.asyncio
async def test_billing_read_failure_receipts_sentinel_subject_when_resolution_fails(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Corridor E6: a failure BEFORE the subject resolves still lands a receipt.

    ``billing_decision_event.billing_subject_id`` is NOT NULL, so the gate
    receipts the all-zero sentinel rather than dropping the row.
    """
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    patch_global_session_factory(test_engine, monkeypatch)
    user_id = await _create_user(db_session)
    await db_session.commit()

    alerts: list[BaseException] = []
    monkeypatch.setattr(
        authorization_module,
        "report_critical",
        lambda error, **_kwargs: alerts.append(error),
    )

    async def _resolve_boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("subject resolution failed")

    monkeypatch.setattr(
        authorization_module,
        "resolve_billing_subject_id_for_user",
        _resolve_boom,
    )

    with pytest.raises(BillingStateUnavailableError) as excinfo:
        await assert_cloud_sandbox_resume_allowed_for_owner(db_session, owner_user_id=user_id)
    assert excinfo.value.billing_subject_id is None
    assert len(alerts) == 1

    await db_session.rollback()
    receipt = await db_session.scalar(
        select(BillingDecisionEvent).where(
            BillingDecisionEvent.decision_type == BILLING_DECISION_READ_UNAVAILABLE
        )
    )
    assert receipt is not None
    assert receipt.billing_subject_id == uuid.UUID(int=0)
    assert receipt.actor_user_id == user_id
