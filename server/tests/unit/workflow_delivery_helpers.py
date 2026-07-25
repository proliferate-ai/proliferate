"""Shared seeding/custody helpers for workflow delivery store tests."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.store import workflow_deliveries as delivery_store
from proliferate.db.store import workflow_invocations as invocation_store
from proliferate.db.store.workflow_delivery_custody import (
    DesktopTarget,
    ExpectedDeliveryTarget,
    ManagedCloudTarget,
    WorkflowDeliverySnapshot,
)

DEFAULT_SANDBOX = "sbx-1"
DEFAULT_EPOCH = "epoch-1"
DEFAULT_INSTALL = "install-1"
DEFAULT_TARGET = ManagedCloudTarget(cloud_sandbox_id=DEFAULT_SANDBOX)
DEFAULT_DESKTOP_TARGET = DesktopTarget(desktop_install_id=DEFAULT_INSTALL)


async def seed_user(db: AsyncSession) -> UUID:
    user = User(email=f"wf-inv-{uuid4().hex}@example.com", hashed_password="x")
    db.add(user)
    await db.commit()
    return user.id


def insert_kwargs(
    *,
    user_id: UUID,
    idempotency_key: str = "key-1",
    request_hash: str = "a" * 64,
    invocation_id: UUID | None = None,
    target_kind: str = "managedCloud",
    desktop_install_id: str | None = None,
) -> dict[str, object]:
    return dict(
        invocation_id=invocation_id or uuid4(),
        user_id=user_id,
        workflow_definition_id=None,
        definition_revision=1,
        definition_schema_version=1,
        validated_catalog_version="2026-07-12.1",
        title_snapshot="Diagnose ticket",
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        arguments_json={"ticket": "PRO-1"},
        resolved_bundle_json={"contractVersion": 1},
        bundle_digest="b" * 64,
        target_kind=target_kind,
        desktop_install_id=desktop_install_id,
        logical_placement_json={"kind": "newWorkspace", "repository": {"kind": "none"}},
        resolved_placement_json={"kind": "newWorkspace", "repository": {"kind": "none"}},
    )


async def seed_delivery(
    session: AsyncSession,
    *,
    idempotency_key: str = "key-1",
    target_kind: str = "managedCloud",
    desktop_install_id: str | None = None,
) -> UUID:
    """Seed a fresh user plus one invocation+delivery; returns the invocation ID."""

    user_id = await seed_user(session)
    return await seed_invocation_with_delivery(
        session,
        user_id=user_id,
        idempotency_key=idempotency_key,
        target_kind=target_kind,
        desktop_install_id=desktop_install_id,
    )


async def seed_invocation_with_delivery(
    session: AsyncSession,
    *,
    user_id: UUID,
    idempotency_key: str = "key-1",
    target_kind: str = "managedCloud",
    desktop_install_id: str | None = None,
) -> UUID:
    inserted = await invocation_store.insert_workflow_invocation(
        session,
        **insert_kwargs(
            user_id=user_id,
            idempotency_key=idempotency_key,
            target_kind=target_kind,
            desktop_install_id=desktop_install_id,
        ),
    )
    assert inserted is not None
    await delivery_store.insert_workflow_delivery(session, invocation_id=inserted.id)
    await session.commit()
    return inserted.id


async def read_delivery(session: AsyncSession, invocation_id: UUID) -> WorkflowDeliverySnapshot:
    """Reload the delivery row, asserting it exists."""

    delivery = await delivery_store.get_workflow_delivery(session, invocation_id=invocation_id)
    assert delivery is not None
    return delivery


def run_object(invocation_id: UUID) -> dict[str, object]:
    """A minimal immutable run object bound to the invocation (design §6.3)."""

    return {
        "runId": str(invocation_id),
        "contractVersion": 1,
        "bundleDigest": "b" * 64,
    }


async def fix_delivery(
    session: AsyncSession,
    invocation_id: UUID,
    *,
    target: ExpectedDeliveryTarget = DEFAULT_TARGET,
    epoch: str = DEFAULT_EPOCH,
    run_json: dict[str, object] | None = None,
) -> WorkflowDeliverySnapshot | None:
    return await delivery_store.fix_runtime_payload(
        session,
        invocation_id=invocation_id,
        run_json=run_json or run_object(invocation_id),
        anyharness_data_epoch=epoch,
        expected_target=target,
    )


async def handoff_and_fix(
    session: AsyncSession,
    invocation_id: UUID,
    *,
    target: ExpectedDeliveryTarget = DEFAULT_TARGET,
    epoch: str = DEFAULT_EPOCH,
    run_json: dict[str, object] | None = None,
) -> WorkflowDeliverySnapshot:
    handed = await delivery_store.mark_delivery_handoff_started(
        session, invocation_id=invocation_id, expected_target=target
    )
    assert handed is not None
    fixed = await fix_delivery(
        session, invocation_id, target=target, epoch=epoch, run_json=run_json
    )
    assert fixed is not None
    return fixed


async def fail_after_handoff(
    session: AsyncSession,
    invocation_id: UUID,
    *,
    digest: str | None,
    epoch: str | None = DEFAULT_EPOCH,
    target: ExpectedDeliveryTarget = DEFAULT_TARGET,
) -> WorkflowDeliverySnapshot | None:
    """Deterministic target rejection stating exactly the observed custody."""

    return await delivery_store.record_delivery_failed_after_handoff(
        session,
        invocation_id=invocation_id,
        error_code="target_rejected",
        error_message="x",
        expected_runtime_payload_digest=digest,
        expected_data_epoch=epoch,
        expected_target=target,
    )


async def accept_delivery(
    session: AsyncSession,
    invocation_id: UUID,
    *,
    target: ExpectedDeliveryTarget = DEFAULT_TARGET,
    epoch: str = DEFAULT_EPOCH,
    anyharness_run_id: str | None = None,
    anyharness_workspace_id: str | None = None,
) -> WorkflowDeliverySnapshot | None:
    current = await delivery_store.get_workflow_delivery(session, invocation_id=invocation_id)
    assert current is not None and current.runtime_payload_digest is not None
    return await delivery_store.record_delivery_accepted(
        session,
        invocation_id=invocation_id,
        anyharness_run_id=anyharness_run_id or str(invocation_id),
        expected_runtime_payload_digest=current.runtime_payload_digest,
        expected_data_epoch=epoch,
        expected_target=target,
        anyharness_workspace_id=anyharness_workspace_id,
    )


async def project_observation(
    session: AsyncSession,
    invocation_id: UUID,
    *,
    revision: int,
    observation: dict[str, object],
    observed_at: datetime,
    target: ExpectedDeliveryTarget = DEFAULT_TARGET,
    epoch: str = DEFAULT_EPOCH,
    anyharness_run_id: str | None = None,
    expected_runtime_payload_digest: str | None = None,
) -> WorkflowDeliverySnapshot | None:
    digest = expected_runtime_payload_digest
    if digest is None:
        current = await delivery_store.get_workflow_delivery(session, invocation_id=invocation_id)
        assert current is not None and current.runtime_payload_digest is not None
        digest = current.runtime_payload_digest
    return await delivery_store.update_runtime_projection(
        session,
        invocation_id=invocation_id,
        anyharness_run_id=anyharness_run_id or str(invocation_id),
        runtime_revision=revision,
        runtime_observation_json=observation,
        runtime_observed_at=observed_at,
        expected_runtime_payload_digest=digest,
        expected_data_epoch=epoch,
        expected_target=target,
    )


def lost_proof_kwargs(
    delivery: WorkflowDeliverySnapshot,
    *,
    target: ExpectedDeliveryTarget = DEFAULT_TARGET,
) -> dict[str, object]:
    """Exact custody kwargs a prover reads off the row it observed."""

    assert delivery.runtime_payload_digest is not None
    assert delivery.anyharness_data_epoch is not None
    return dict(
        expected_runtime_revision=delivery.runtime_revision,
        expected_runtime_payload_digest=delivery.runtime_payload_digest,
        expected_data_epoch=delivery.anyharness_data_epoch,
        expected_target=target,
    )
