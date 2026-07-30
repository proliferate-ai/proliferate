"""The reconcile pass reads each open segment on behalf of its actor (W-F1).

``run_billing_reconcile_pass`` is the 15-minute loop that pauses live sandboxes
and writes the ``enforce_active_spend`` receipts. It resolved each subject's
snapshot with no actor, which on an ORG subject is a hole: an org subject has no
``user_id`` of its own, so every part of the snapshot that reaches its rows
*through a user* has nothing to resolve through and reads zero.

``remaining_seconds`` survives that, because grants list by
``billing_subject_id`` and segment-open already minted the allowance onto the
payer — which is precisely why this was never caught by the pause behaviour.
``active_sandbox_count`` and ``active_cloud_repo_count`` do not: they reach
their rows through ``billing_subject.user_id``, so an org member's live sandbox
was invisible to the very receipt recording that their sandbox got paused.

The pass had no test coverage at all before this, which is the other half of why
the hole persisted.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_ENFORCE_ACTIVE_SPEND,
    BILLING_HOLD_KIND_PAYMENT_FAILED,
    BILLING_HOLD_STATUS_ACTIVE,
    BILLING_MODE_ENFORCE,
)
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingDecisionEvent, BillingHold, UsageSegment
from proliferate.db.models.cloud.sandboxes import CloudSandbox, CloudSandboxStatus
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.billing_runtime_usage import resolve_billing_subject_id_for_user
from proliferate.server.billing import reconciler as reconciler_module
from tests.integration.billing_accounting_helpers import patch_global_session_factory


@pytest.fixture(autouse=True)
def _enforce_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)


class _NoStatesProvider:
    """A sandbox provider that reports nothing running."""

    async def list_sandbox_states(self) -> list[object]:
        return []


async def _org_member(db_session: AsyncSession) -> tuple[User, uuid.UUID]:
    user = User(
        email=f"reconciler-actor-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    org = Organization(name=f"org-{uuid.uuid4().hex[:8]}", status="active")
    db_session.add(org)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=org.id,
            user_id=user.id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
        )
    )
    await db_session.flush()
    return user, org.id


@pytest.mark.asyncio
async def test_enforce_receipt_sees_the_org_members_live_sandbox(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An org-paid pause receipt must report the actor's real sandbox count.

    A payment-failed hold is the cleanest way to force ``active_spend_hold``
    without depending on grant arithmetic. What is under test is the resulting
    receipt: before the fix ``active_sandbox_count`` was 0 on an org subject
    even with a live sandbox, so the durable record of a pause could not say
    what had been running.
    """
    user, _org_id = await _org_member(db_session)
    subject_id = await resolve_billing_subject_id_for_user(db_session, user.id)

    sandbox = CloudSandbox(
        owner_user_id=user.id,
        status=CloudSandboxStatus.ready,
        provider_sandbox_id=None,
    )
    db_session.add(sandbox)
    await db_session.flush()

    now = datetime.now(UTC)
    db_session.add(
        BillingHold(
            billing_subject_id=subject_id,
            kind=BILLING_HOLD_KIND_PAYMENT_FAILED,
            status=BILLING_HOLD_STATUS_ACTIVE,
            source="test",
            source_ref=None,
        )
    )
    # Open segment (``ended_at is None``) — that is what the pass iterates. The
    # actor lives on the segment, which is exactly what the snapshot lookup now
    # threads through.
    db_session.add(
        UsageSegment(
            user_id=user.id,
            billing_subject_id=subject_id,
            workspace_id=None,
            sandbox_id=sandbox.id,
            external_sandbox_id=None,
            sandbox_execution_id=None,
            started_at=now - timedelta(minutes=30),
            ended_at=None,
            is_billable=True,
            opened_by="provision",
            closed_by=None,
        )
    )
    await db_session.commit()

    patch_global_session_factory(test_engine, monkeypatch)
    # The pass resolves a provider whenever anything is open, so stub it rather
    # than let the test reach E2B. Reporting no live states means the segment
    # matches nothing and enforcement short-circuits before any pause work —
    # which is what this test wants: the receipt, not the pause.
    monkeypatch.setattr(
        reconciler_module,
        "get_configured_sandbox_provider",
        lambda: _NoStatesProvider(),
    )

    await reconciler_module.run_billing_reconcile_pass()

    receipt = (
        await db_session.execute(
            select(BillingDecisionEvent).where(
                BillingDecisionEvent.billing_subject_id == subject_id,
                BillingDecisionEvent.decision_type == BILLING_DECISION_ENFORCE_ACTIVE_SPEND,
            )
        )
    ).scalar_one()
    assert receipt.actor_user_id == user.id
    assert receipt.active_sandbox_count == 1, (
        "the org-paid pause receipt must count the actor's live sandbox, "
        "not read 0 because an org subject has no user_id of its own"
    )
