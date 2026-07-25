"""Typed records and row mappers for the WS2a workflow-ledger stores.

Pure data shapes: each ``*Record`` mirrors its ORM row one-to-one, and the
``record_*`` helpers are the only row->record mapping used across this package.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from proliferate.db.models.cloud.workflow_ledger import (
    WorkflowActionEffect,
    WorkflowCapabilityLease,
    WorkflowControlCommand,
    WorkflowGatewayReceipt,
    WorkflowOutboxResult,
    WorkflowPollInbox,
    WorkflowRunOutbox,
    WorkflowSessionLease,
)

# Lease states that block another reservation of the same session (§8.2).
SESSION_LEASE_BLOCKING_STATES: tuple[str, ...] = (
    "reserved",
    "prepared",
    "claimed",
    "quiescing",
    "orphaned",
)

ObservedCasResult = Literal[
    "applied",
    "retry_noop",
    "conflict",
    "stale_rejected",
    "future_rejected",
]

# Outcome of a fenced post-claim result CAS (heartbeat/complete/fail/reschedule/
# dead-letter/continuation). ``applied`` = the CAS matched and mutated the row;
# ``replayed`` = a same-identity retry after a lost commit returned the durable
# receipt (R2/R8); ``stale_rejected`` = the fence did not match (rowcount 0, zero
# side effects), never an exception (D5).
OutboxWriteOutcome = Literal["applied", "replayed", "stale_rejected", "denied"]


@dataclass(frozen=True)
class OutboxRecord:
    id: UUID
    subject_kind: str
    subject_id: str
    run_id: UUID | None
    trigger_id: UUID | None
    kind: str
    effect_key: str | None
    dedupe_key: str | None
    status: str
    attempt_count: int
    max_attempts: int
    next_attempt_at: datetime
    claim_id: UUID | None
    claim_generation: int
    claimed_by: str | None
    claimed_at: datetime | None
    claim_expires_at: datetime | None
    last_heartbeat_at: datetime | None
    last_failure_code: str | None
    diagnostic_id: UUID | None
    dead_lettered_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class OutboxResultRecord:
    id: UUID
    outbox_id: UUID
    claim_id: UUID
    claim_generation: int
    result_kind: str
    failure_code: str | None
    diagnostic_id: UUID | None
    effect_key: str | None
    continuation_outbox_id: UUID | None
    next_attempt_at: datetime | None
    created_at: datetime


@dataclass(frozen=True)
class OutboxWriteResult:
    """Typed outcome of a fenced result CAS with its durable receipt (D5/R8)."""

    outcome: OutboxWriteOutcome
    row: OutboxRecord | None
    receipt: OutboxResultRecord | None


@dataclass(frozen=True)
class ControlCommandRecord:
    id: UUID
    run_id: UUID
    kind: str
    reason: str | None
    plan_hash: str | None
    binding_hash: str | None
    execution_generation: int | None
    status: str
    ack_outcome: str | None
    issued_at: datetime
    delivered_at: datetime | None
    acknowledged_at: datetime | None


@dataclass(frozen=True)
class CapabilityLeaseRecord:
    id: UUID
    run_id: UUID
    slot_id: str
    kind: str
    capability_key: str
    plan_hash: str | None
    provider_definition_id: str | None
    provider_revision: str | None
    tool_name: str | None
    input_schema_hash: str | None
    function_definition_id: str | None
    semantic_revision: int | None
    product_mcp_definition: str | None
    policy_revision: int | None
    created_at: datetime


@dataclass(frozen=True)
class GatewayReceiptRecord:
    id: UUID
    run_id: UUID
    plan_hash: str
    slot_id: str
    session_id: str
    step_key: str
    attempt: int
    turn_id: str | None
    activation_id: str
    capability_kind: str
    provider_definition_id: str | None
    provider_revision: str | None
    tool_name: str | None
    input_schema_hash: str | None
    function_definition_id: str | None
    semantic_revision: int | None
    authorization_decision: str
    outcome: str
    created_at: datetime
    completed_at: datetime | None


@dataclass(frozen=True)
class PollInboxRecord:
    id: UUID
    trigger_id: UUID
    external_item_id: str
    payload_json: dict[str, object]
    status: str
    attempt_count: int
    last_error: str | None
    run_id: UUID | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class SessionLeaseRecord:
    id: UUID
    session_id: str
    run_id: UUID
    slot_id: str | None
    state: str
    generation: int
    reserved_at: datetime | None
    prepared_at: datetime | None
    claimed_at: datetime | None
    released_at: datetime | None


@dataclass(frozen=True)
class ActionEffectRecord:
    id: UUID
    run_id: UUID
    step_key: str
    attempt: int
    action_kind: str
    payload_json: dict[str, object]
    status: str
    provider_operation_id: str | None
    provider_message_id: str | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime


def record_outbox(row: WorkflowRunOutbox) -> OutboxRecord:
    return OutboxRecord(
        id=row.id,
        subject_kind=row.subject_kind,
        subject_id=row.subject_id,
        run_id=row.run_id,
        trigger_id=row.trigger_id,
        kind=row.kind,
        effect_key=row.effect_key,
        dedupe_key=row.dedupe_key,
        status=row.status,
        attempt_count=row.attempt_count,
        max_attempts=row.max_attempts,
        next_attempt_at=row.next_attempt_at,
        claim_id=row.claim_id,
        claim_generation=row.claim_generation,
        claimed_by=row.claimed_by,
        claimed_at=row.claimed_at,
        claim_expires_at=row.claim_expires_at,
        last_heartbeat_at=row.last_heartbeat_at,
        last_failure_code=row.last_failure_code,
        diagnostic_id=row.diagnostic_id,
        dead_lettered_at=row.dead_lettered_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def record_outbox_result(row: WorkflowOutboxResult) -> OutboxResultRecord:
    return OutboxResultRecord(
        id=row.id,
        outbox_id=row.outbox_id,
        claim_id=row.claim_id,
        claim_generation=row.claim_generation,
        result_kind=row.result_kind,
        failure_code=row.failure_code,
        diagnostic_id=row.diagnostic_id,
        effect_key=row.effect_key,
        continuation_outbox_id=row.continuation_outbox_id,
        next_attempt_at=row.next_attempt_at,
        created_at=row.created_at,
    )


def record_command(row: WorkflowControlCommand) -> ControlCommandRecord:
    return ControlCommandRecord(
        id=row.id,
        run_id=row.run_id,
        kind=row.kind,
        reason=row.reason,
        plan_hash=row.plan_hash,
        binding_hash=row.binding_hash,
        execution_generation=row.execution_generation,
        status=row.status,
        ack_outcome=row.ack_outcome,
        issued_at=row.issued_at,
        delivered_at=row.delivered_at,
        acknowledged_at=row.acknowledged_at,
    )


def record_lease(row: WorkflowSessionLease) -> SessionLeaseRecord:
    return SessionLeaseRecord(
        id=row.id,
        session_id=row.session_id,
        run_id=row.run_id,
        slot_id=row.slot_id,
        state=row.state,
        generation=row.generation,
        reserved_at=row.reserved_at,
        prepared_at=row.prepared_at,
        claimed_at=row.claimed_at,
        released_at=row.released_at,
    )


def record_capability(row: WorkflowCapabilityLease) -> CapabilityLeaseRecord:
    return CapabilityLeaseRecord(
        id=row.id,
        run_id=row.run_id,
        slot_id=row.slot_id,
        kind=row.kind,
        capability_key=row.capability_key,
        plan_hash=row.plan_hash,
        provider_definition_id=row.provider_definition_id,
        provider_revision=row.provider_revision,
        tool_name=row.tool_name,
        input_schema_hash=row.input_schema_hash,
        function_definition_id=row.function_definition_id,
        semantic_revision=row.semantic_revision,
        product_mcp_definition=row.product_mcp_definition,
        policy_revision=row.policy_revision,
        created_at=row.created_at,
    )


def record_receipt(row: WorkflowGatewayReceipt) -> GatewayReceiptRecord:
    return GatewayReceiptRecord(
        id=row.id,
        run_id=row.run_id,
        plan_hash=row.plan_hash,
        slot_id=row.slot_id,
        session_id=row.session_id,
        step_key=row.step_key,
        attempt=row.attempt,
        turn_id=row.turn_id,
        activation_id=row.activation_id,
        capability_kind=row.capability_kind,
        provider_definition_id=row.provider_definition_id,
        provider_revision=row.provider_revision,
        tool_name=row.tool_name,
        input_schema_hash=row.input_schema_hash,
        function_definition_id=row.function_definition_id,
        semantic_revision=row.semantic_revision,
        authorization_decision=row.authorization_decision,
        outcome=row.outcome,
        created_at=row.created_at,
        completed_at=row.completed_at,
    )


def record_inbox(row: WorkflowPollInbox) -> PollInboxRecord:
    return PollInboxRecord(
        id=row.id,
        trigger_id=row.trigger_id,
        external_item_id=row.external_item_id,
        payload_json=dict(row.payload_json or {}),
        status=row.status,
        attempt_count=row.attempt_count,
        last_error=row.last_error,
        run_id=row.run_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def record_effect(row: WorkflowActionEffect) -> ActionEffectRecord:
    return ActionEffectRecord(
        id=row.id,
        run_id=row.run_id,
        step_key=row.step_key,
        attempt=row.attempt,
        action_kind=row.action_kind,
        payload_json=dict(row.payload_json or {}),
        status=row.status,
        provider_operation_id=row.provider_operation_id,
        provider_message_id=row.provider_message_id,
        last_error=row.last_error,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
