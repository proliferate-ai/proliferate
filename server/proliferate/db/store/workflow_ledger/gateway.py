"""Capability leases and gateway receipts (spec §7.1, §7.3).

WS3a freezes exact ``CapabilityRef``s per run+slot at StartRun; WS3c records
activation-keyed receipts. This module owns only the mechanical inserts/reads;
authorization and gate satisfaction are gateway/runtime logic.

``capability_key`` canonical format (WS3a-defined; the codec lives in
``server.cloud.workflows.domain.capabilities`` — ``build``/``parse``):

    integration_tool:<providerDefinitionId>:<providerRevision>:<toolName>
    function:<definitionId>:<semanticRevision>
    product_mcp:<definition>:<policyRevision>

Every non-``kind`` component is percent-quoted (``safe=""``) before joining on
``:`` so a colon inside a component (e.g. a timestamp-shaped ``providerRevision``,
which reuses the definition's ``updated_at``) round-trips unambiguously.
``inputSchemaHash`` is intentionally NOT in the key (it may be the explicit
``"unknown"`` sentinel until the tool-schema cache is warm); it is stored in its
own column for audit. The key makes ``(run_id, slot_id, capability_key)`` a single
clean uniqueness constraint regardless of which union arm is populated.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workflow_ledger import (
    WorkflowCapabilityLease,
    WorkflowGatewayReceipt,
)
from proliferate.db.store.workflow_ledger.records import (
    CapabilityLeaseRecord,
    GatewayReceiptRecord,
    record_capability,
    record_receipt,
)
from proliferate.utils.time import utcnow


async def insert_capability_lease(
    db: AsyncSession,
    *,
    run_id: UUID,
    slot_id: str,
    kind: str,
    capability_key: str,
    plan_hash: str | None = None,
    provider_definition_id: str | None = None,
    provider_revision: str | None = None,
    tool_name: str | None = None,
    input_schema_hash: str | None = None,
    function_definition_id: str | None = None,
    semantic_revision: int | None = None,
    product_mcp_definition: str | None = None,
    policy_revision: int | None = None,
) -> CapabilityLeaseRecord:
    row = WorkflowCapabilityLease(
        id=uuid4(),
        run_id=run_id,
        slot_id=slot_id,
        kind=kind,
        capability_key=capability_key,
        plan_hash=plan_hash,
        provider_definition_id=provider_definition_id,
        provider_revision=provider_revision,
        tool_name=tool_name,
        input_schema_hash=input_schema_hash,
        function_definition_id=function_definition_id,
        semantic_revision=semantic_revision,
        product_mcp_definition=product_mcp_definition,
        policy_revision=policy_revision,
        created_at=utcnow(),
    )
    db.add(row)
    await db.flush()
    return record_capability(row)


async def list_capability_leases(
    db: AsyncSession, *, run_id: UUID
) -> tuple[CapabilityLeaseRecord, ...]:
    rows = (
        (
            await db.execute(
                select(WorkflowCapabilityLease)
                .where(WorkflowCapabilityLease.run_id == run_id)
                .order_by(
                    WorkflowCapabilityLease.slot_id.asc(),
                    WorkflowCapabilityLease.capability_key.asc(),
                )
            )
        )
        .scalars()
        .all()
    )
    return tuple(record_capability(row) for row in rows)


# --- gateway receipts (spec §7.3; WS3c fills these) ---------------------------------


async def insert_gateway_receipt(
    db: AsyncSession,
    *,
    run_id: UUID,
    plan_hash: str,
    slot_id: str,
    session_id: str,
    step_key: str,
    attempt: int,
    activation_id: str,
    capability_kind: str,
    authorization_decision: str,
    outcome: str,
    turn_id: str | None = None,
    provider_definition_id: str | None = None,
    provider_revision: str | None = None,
    tool_name: str | None = None,
    input_schema_hash: str | None = None,
    function_definition_id: str | None = None,
    semantic_revision: int | None = None,
    completed_at: datetime | None = None,
) -> GatewayReceiptRecord:
    """Insert an activation-keyed receipt. Duplicate ``activation_id`` raises
    ``IntegrityError`` — the durable record already exists and the caller
    recovers it with ``get_gateway_receipt_by_activation``."""

    row = WorkflowGatewayReceipt(
        id=uuid4(),
        run_id=run_id,
        plan_hash=plan_hash,
        slot_id=slot_id,
        session_id=session_id,
        step_key=step_key,
        attempt=attempt,
        turn_id=turn_id,
        activation_id=activation_id,
        capability_kind=capability_kind,
        provider_definition_id=provider_definition_id,
        provider_revision=provider_revision,
        tool_name=tool_name,
        input_schema_hash=input_schema_hash,
        function_definition_id=function_definition_id,
        semantic_revision=semantic_revision,
        authorization_decision=authorization_decision,
        outcome=outcome,
        created_at=utcnow(),
        completed_at=completed_at,
    )
    db.add(row)
    await db.flush()
    return record_receipt(row)


async def get_gateway_receipt_by_activation(
    db: AsyncSession, *, activation_id: str
) -> GatewayReceiptRecord | None:
    row = (
        await db.execute(
            select(WorkflowGatewayReceipt).where(
                WorkflowGatewayReceipt.activation_id == activation_id
            )
        )
    ).scalar_one_or_none()
    return None if row is None else record_receipt(row)


async def list_gateway_receipts_for_step(
    db: AsyncSession, *, run_id: UUID, step_key: str, attempt: int
) -> tuple[GatewayReceiptRecord, ...]:
    rows = (
        (
            await db.execute(
                select(WorkflowGatewayReceipt)
                .where(
                    WorkflowGatewayReceipt.run_id == run_id,
                    WorkflowGatewayReceipt.step_key == step_key,
                    WorkflowGatewayReceipt.attempt == attempt,
                )
                .order_by(WorkflowGatewayReceipt.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(record_receipt(row) for row in rows)
