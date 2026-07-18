"""Terminal lifecycle, expiry, race, and retention proofs for action approvals."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, func, literal_column, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db import session_ops
from proliferate.db.models.cloud.integration_approvals import (
    CloudIntegrationActionApproval,
    CloudIntegrationActionApprovalEvent,
)
from proliferate.db.models.cloud.integrations import CloudIntegrationAccount
from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker
from proliferate.db.models.organizations import OrganizationMembership
from proliferate.db.store.integrations import action_approvals as approvals_store
from proliferate.utils.time import utcnow
from tests.integration import test_cloud_integration_action_approvals_api as approval_helpers


@pytest.fixture(autouse=True)
def _worker_cloud_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cloud_worker_base_url", "http://cloud.test")


async def _run_after_row_lock_crosses_expiry[T](
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    *,
    approval_id: uuid.UUID,
    store_method_name: str,
    operation: Callable[[], Awaitable[T]],
) -> T:
    """Start before expiry, then release the target row only after DB expiry."""
    async with session_ops.open_async_session() as lock_db:
        expires_at = (
            await lock_db.execute(
                update(CloudIntegrationActionApproval)
                .where(CloudIntegrationActionApproval.id == approval_id)
                .values(
                    expires_at=(func.clock_timestamp() + literal_column("interval '1 second'"))
                )
                .returning(CloudIntegrationActionApproval.expires_at)
            )
        ).scalar_one()

        reached_store = asyncio.Event()
        original = getattr(approvals_store, store_method_name)

        async def signal_then_call(*args: object, **kwargs: object):
            reached_store.set()
            return await original(*args, **kwargs)

        monkeypatch.setattr(approvals_store, store_method_name, signal_then_call)
        operation_task = asyncio.create_task(operation())
        await asyncio.wait_for(reached_store.wait(), timeout=2)
        while (await db_session.scalar(select(func.clock_timestamp()))) <= expires_at:
            await asyncio.sleep(0.02)
        await session_ops.commit_session(lock_db)
    return await operation_task


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("decision", "approve_first", "terminal_status", "expected_from"),
    [
        ("reject", False, "rejected", "pending"),
        ("revoke", True, "revoked", "approved"),
    ],
)
async def test_rejected_and_revoked_approvals_never_admit_execution(
    client: AsyncClient,
    db_session: AsyncSession,
    decision: str,
    approve_first: bool,
    terminal_status: str,
    expected_from: str,
) -> None:
    context = await approval_helpers._setup_context(
        client,
        db_session,
        prefix=f"approval-{terminal_status}",
    )
    arguments = {"message": terminal_status}
    approval = await approval_helpers._request_action(client, context, arguments=arguments)
    approval_id = str(approval["id"])
    if approve_first:
        await approval_helpers._approve(client, context, approval_id)
    response = await client.post(
        f"{approval_helpers.APPROVALS_URL}/{approval_id}/{decision}",
        headers=context.auth.headers,
    )
    assert response.status_code == 200
    assert response.json()["approval"]["status"] == terminal_status
    assert (
        await approval_helpers._consume(context, approval_id=approval_id, arguments=arguments)
    ).result == terminal_status

    await db_session.rollback()
    event = (
        await db_session.execute(
            select(CloudIntegrationActionApprovalEvent).where(
                CloudIntegrationActionApprovalEvent.approval_id == uuid.UUID(approval_id),
                CloudIntegrationActionApprovalEvent.event_type == terminal_status,
            )
        )
    ).scalar_one()
    assert (event.from_status, event.to_status) == (expected_from, terminal_status)


@pytest.mark.asyncio
async def test_expired_approved_action_is_audited_from_actual_state_and_replaced(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    context = await approval_helpers._setup_context(
        client,
        db_session,
        prefix="approval-expiry",
    )
    arguments = {"message": "expires"}
    first = await approval_helpers._request_action(client, context, arguments=arguments)
    first_id = str(first["id"])
    await approval_helpers._approve(client, context, first_id)
    await db_session.execute(
        update(CloudIntegrationActionApproval)
        .where(CloudIntegrationActionApproval.id == uuid.UUID(first_id))
        .values(expires_at=utcnow() - timedelta(seconds=1))
    )
    await db_session.commit()

    refreshed = await client.get(
        f"{approval_helpers.APPROVALS_URL}/{first_id}",
        headers=context.auth.headers,
    )
    assert refreshed.status_code == 200
    assert refreshed.json()["status"] == "expired"
    assert (
        await approval_helpers._consume(context, approval_id=first_id, arguments=arguments)
    ).result == "expired"

    replacement = await approval_helpers._request_action(client, context, arguments=arguments)
    assert replacement["id"] != first_id
    await db_session.rollback()
    events = list(
        (
            await db_session.execute(
                select(CloudIntegrationActionApprovalEvent)
                .where(CloudIntegrationActionApprovalEvent.approval_id == uuid.UUID(first_id))
                .order_by(CloudIntegrationActionApprovalEvent.created_at)
            )
        ).scalars()
    )
    assert [(event.from_status, event.to_status) for event in events] == [
        (None, "pending"),
        ("pending", "approved"),
        ("approved", "expired"),
    ]


@pytest.mark.asyncio
async def test_concurrent_decisions_observe_one_deterministic_expiry(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    context = await approval_helpers._setup_context(
        client,
        db_session,
        prefix="approval-expiry-decision-race",
    )
    approval = await approval_helpers._request_action(
        client,
        context,
        arguments={"message": "expires during decision"},
    )
    approval_id = str(approval["id"])
    await db_session.execute(
        update(CloudIntegrationActionApproval)
        .where(CloudIntegrationActionApproval.id == uuid.UUID(approval_id))
        .values(expires_at=utcnow() - timedelta(seconds=1))
    )
    await db_session.commit()

    approved, rejected = await asyncio.gather(
        client.post(
            f"{approval_helpers.APPROVALS_URL}/{approval_id}/approve",
            headers=context.auth.headers,
        ),
        client.post(
            f"{approval_helpers.APPROVALS_URL}/{approval_id}/reject",
            headers=context.auth.headers,
        ),
    )
    assert approved.status_code == rejected.status_code == 200
    assert {approved.json()["result"], rejected.json()["result"]} == {"expired"}

    await db_session.rollback()
    events = list(
        (
            await db_session.execute(
                select(CloudIntegrationActionApprovalEvent).where(
                    CloudIntegrationActionApprovalEvent.approval_id == uuid.UUID(approval_id),
                    CloudIntegrationActionApprovalEvent.event_type == "expired",
                )
            )
        ).scalars()
    )
    assert len(events) == 1
    assert (events[0].from_status, events[0].to_status) == ("pending", "expired")


@pytest.mark.asyncio
async def test_decision_row_lock_crossing_expiry_cannot_approve(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = await approval_helpers._setup_context(
        client, db_session, prefix="approval-lock-expiry-decision"
    )
    approval = await approval_helpers._request_action(
        client, context, arguments={"message": "decision waits"}
    )
    approval_id = uuid.UUID(str(approval["id"]))

    response = await _run_after_row_lock_crosses_expiry(
        db_session,
        monkeypatch,
        approval_id=approval_id,
        store_method_name="mark_expired_if_due",
        operation=lambda: client.post(
            f"{approval_helpers.APPROVALS_URL}/{approval_id}/approve",
            headers=context.auth.headers,
        ),
    )
    assert response.status_code == 200
    assert response.json()["result"] == "expired"
    assert response.json()["approval"]["status"] == "expired"


@pytest.mark.asyncio
async def test_expiry_between_precheck_and_decision_cas_is_materialized(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = await approval_helpers._setup_context(
        client, db_session, prefix="approval-expiry-between-decision-checks"
    )
    approval = await approval_helpers._request_action(
        client, context, arguments={"message": "crosses between checks"}
    )
    approval_id = uuid.UUID(str(approval["id"]))
    expires_at = (
        await db_session.execute(
            update(CloudIntegrationActionApproval)
            .where(CloudIntegrationActionApproval.id == approval_id)
            .values(expires_at=func.clock_timestamp() + literal_column("interval '1 second'"))
            .returning(CloudIntegrationActionApproval.expires_at)
        )
    ).scalar_one()
    await db_session.commit()

    entered_cas = asyncio.Event()
    release_cas = asyncio.Event()
    original = approvals_store.transition_if_current

    async def delay_decision_cas(*args: object, **kwargs: object):
        entered_cas.set()
        await release_cas.wait()
        return await original(*args, **kwargs)

    monkeypatch.setattr(approvals_store, "transition_if_current", delay_decision_cas)
    decision = asyncio.create_task(
        client.post(
            f"{approval_helpers.APPROVALS_URL}/{approval_id}/approve",
            headers=context.auth.headers,
        )
    )
    await asyncio.wait_for(entered_cas.wait(), timeout=2)
    while (await db_session.scalar(select(func.clock_timestamp()))) <= expires_at:
        await asyncio.sleep(0.02)
    release_cas.set()

    response = await decision
    assert response.status_code == 200
    assert response.json()["result"] == "expired"
    assert response.json()["approval"]["status"] == "expired"
    events = (
        (
            await db_session.execute(
                select(CloudIntegrationActionApprovalEvent).where(
                    CloudIntegrationActionApprovalEvent.approval_id == approval_id,
                    CloudIntegrationActionApprovalEvent.event_type == "expired",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(events) == 1
    assert (events[0].from_status, events[0].to_status) == ("pending", "expired")


@pytest.mark.asyncio
async def test_consumption_row_lock_crossing_expiry_cannot_admit_execution(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = await approval_helpers._setup_context(
        client, db_session, prefix="approval-lock-expiry-consume"
    )
    arguments = {"message": "consume waits"}
    approval = await approval_helpers._request_action(client, context, arguments=arguments)
    approval_id = str(approval["id"])
    await approval_helpers._approve(client, context, approval_id)

    admission = await _run_after_row_lock_crosses_expiry(
        db_session,
        monkeypatch,
        approval_id=uuid.UUID(approval_id),
        store_method_name="consume_approved_matching",
        operation=lambda: approval_helpers._consume(
            context,
            approval_id=approval_id,
            arguments=arguments,
        ),
    )
    assert admission.result == "expired"
    assert admission.approval is not None and admission.approval.status == "expired"


@pytest.mark.asyncio
async def test_observation_row_lock_crossing_expiry_cannot_report_active(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = await approval_helpers._setup_context(
        client, db_session, prefix="approval-lock-expiry-observe"
    )
    approval = await approval_helpers._request_action(
        client, context, arguments={"message": "observation waits"}
    )
    approval_id = uuid.UUID(str(approval["id"]))

    response = await _run_after_row_lock_crosses_expiry(
        db_session,
        monkeypatch,
        approval_id=approval_id,
        store_method_name="mark_expired_if_due",
        operation=lambda: client.get(
            f"{approval_helpers.APPROVALS_URL}/{approval_id}",
            headers=context.auth.headers,
        ),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "expired"


@pytest.mark.asyncio
async def test_request_vs_terminal_transition_is_race_safe(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    context = await approval_helpers._setup_context(
        client,
        db_session,
        prefix="approval-request-transition",
    )
    arguments = {"message": "race"}
    existing = await approval_helpers._request_action(client, context, arguments=arguments)
    existing_id = str(existing["id"])
    await approval_helpers._approve(client, context, existing_id)

    retried, consumed = await asyncio.gather(
        approval_helpers._request_action(client, context, arguments=arguments),
        approval_helpers._consume(context, approval_id=existing_id, arguments=arguments),
    )
    assert consumed.result == "consumed"
    assert retried["status"] in {"approved", "pending"}
    await db_session.rollback()
    active = list(
        (
            await db_session.execute(
                select(CloudIntegrationActionApproval).where(
                    CloudIntegrationActionApproval.status.in_(("pending", "approved"))
                )
            )
        ).scalars()
    )
    assert len(active) <= 1


@pytest.mark.asyncio
async def test_concurrent_execution_admission_has_exactly_one_winner(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    context = await approval_helpers._setup_context(client, db_session, prefix="approval-race")
    arguments = {"message": "once"}
    approval = await approval_helpers._request_action(client, context, arguments=arguments)
    approval_id = str(approval["id"])
    await approval_helpers._approve(client, context, approval_id)

    results = await asyncio.gather(
        approval_helpers._consume(context, approval_id=approval_id, arguments=arguments),
        approval_helpers._consume(context, approval_id=approval_id, arguments=arguments),
    )
    assert sorted(result.result for result in results) == ["already_consumed", "consumed"]

    await db_session.rollback()
    events = list(
        (
            await db_session.execute(
                select(CloudIntegrationActionApprovalEvent).where(
                    CloudIntegrationActionApprovalEvent.approval_id == uuid.UUID(approval_id),
                    CloudIntegrationActionApprovalEvent.event_type == "consumed",
                )
            )
        ).scalars()
    )
    assert len(events) == 1
    assert (events[0].from_status, events[0].to_status) == ("approved", "consumed")


@pytest.mark.asyncio
async def test_audit_identity_survives_account_and_worker_deletion_without_raw_secret(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    context = await approval_helpers._setup_context(
        client,
        db_session,
        prefix="approval-audit",
    )
    secret = "xoxb-super-secret-provider-value"
    arguments = {
        "message": f"authorization=Bearer {secret}",
        "metadata": {"rawProviderPayload": secret},
    }
    approval = await approval_helpers._request_action(client, context, arguments=arguments)
    approval_id = str(approval["id"])
    assert secret not in str(approval)
    assert approval["contentPreview"] is None
    await approval_helpers._approve(client, context, approval_id)
    assert (
        await approval_helpers._consume(context, approval_id=approval_id, arguments=arguments)
    ).result == "consumed"

    await db_session.execute(
        delete(CloudIntegrationAccount).where(CloudIntegrationAccount.id == context.account_id)
    )
    await db_session.execute(
        delete(CloudRuntimeWorker).where(CloudRuntimeWorker.id == context.worker_id)
    )
    await db_session.commit()
    await db_session.rollback()

    persisted = await db_session.get(CloudIntegrationActionApproval, uuid.UUID(approval_id))
    assert persisted is not None
    assert persisted.owner_user_id == context.user_id
    assert persisted.integration_account_id == context.account_id
    assert persisted.runtime_worker_id == context.worker_id
    assert persisted.gateway_session_id == context.gateway_session_id
    assert persisted.safe_content_preview is None
    events = list(
        (
            await db_session.execute(
                select(CloudIntegrationActionApprovalEvent)
                .where(CloudIntegrationActionApprovalEvent.approval_id == uuid.UUID(approval_id))
                .order_by(
                    CloudIntegrationActionApprovalEvent.created_at,
                    CloudIntegrationActionApprovalEvent.id,
                )
            )
        ).scalars()
    )
    assert [(event.from_status, event.to_status) for event in events] == [
        (None, "pending"),
        ("pending", "approved"),
        ("approved", "consumed"),
    ]
    assert [event.actor_type for event in events] == [
        "runtime_worker",
        "user",
        "runtime_worker",
    ]
    assert events[1].actor_user_id == context.user_id
    assert events[0].actor_runtime_worker_id == context.worker_id
    assert events[2].actor_runtime_worker_id == context.worker_id
    assert all(secret not in event.safe_action_summary for event in events)


@pytest.mark.asyncio
async def test_removed_organization_member_cannot_list_or_manage_approval(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    context = await approval_helpers._setup_context(
        client,
        db_session,
        prefix="approval-org-removal",
        organization_scoped=True,
    )
    assert context.organization_id is not None
    approval = await approval_helpers._request_action(
        client,
        context,
        arguments={"message": "org action"},
    )
    approval_id = str(approval["id"])

    await db_session.execute(
        update(OrganizationMembership)
        .where(
            OrganizationMembership.organization_id == context.organization_id,
            OrganizationMembership.user_id == context.user_id,
        )
        .values(status="removed", removed_at=utcnow(), updated_at=utcnow())
    )
    await db_session.commit()

    listed = await client.get(
        approval_helpers.APPROVALS_URL,
        headers=context.auth.headers,
    )
    assert listed.status_code == 200
    assert listed.json()["items"] == []
    detail = await client.get(
        f"{approval_helpers.APPROVALS_URL}/{approval_id}",
        headers=context.auth.headers,
    )
    assert detail.status_code == 404
