"""WS2a workflow durable-ledger ORM models (persistence skeleton).

These are the target-contract control-plane tables from the workflows spec
(`specs/codebase/features/workflows.md` §7, §8, §10). They are ADD-ONLY: they
sit alongside the existing ``workflow_run`` / ``workflow_trigger_item`` /
``workflow_step_action`` tables and *nothing reads or writes them yet* except
WS2a's own tests. WS2b/2c/3/4/7 fill them behaviourally.

Each table carries the exact identity fields the shared WS1 golden fixtures
pin, so a fixture's identity shape stores here verbatim:

- ``ExecutionBinding`` / delivery identity (§5.2/§5.3) lives on ``workflow_run``.
- ``CapabilityRef`` tagged union (§7.1) -> ``workflow_capability_lease``.
- required-invocation activation identity (§7.3) -> ``workflow_activation``.
- gateway-call-receipt (§7.3) -> ``workflow_gateway_receipt``.
- workflow-control-command (§8.3) -> ``workflow_control_command``.
- observed-run (§5.4) mirror + CAS -> ``workflow_run.observed_*``.
- poll page items (§10.3) -> ``workflow_poll_inbox``.
- session leases (§8.2) -> ``workflow_session_lease``.
- deterministic actions (§7.4) -> ``workflow_action_effect``.

**Secrets never enter these rows** (§5.3): no bearer token, decrypted header,
cancellation/report fence, or materialization credential is persisted here. The
control-command fence and envelope credentials live only in the private
encrypted credential store, so e.g. ``workflow_control_command`` stores the
command's identity/kind/reason but never its ``cancellationFence``.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class WorkflowRunOutbox(Base):
    """Transactional outbox for workflow control-plane side effects (§6/§10.2).

    The run intent + its outbox row commit in one transaction; a relay then
    delivers each ``pending`` row after commit ("commit run intent and outbox
    before delivery"). ``next_attempt_at`` gates retries; the partial due-scan
    index is the relay's claim query.
    """

    __tablename__ = "workflow_run_outbox"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'delivering', 'delivered', 'failed')",
            name="ck_workflow_run_outbox_status",
        ),
        CheckConstraint(
            "run_id IS NOT NULL OR trigger_id IS NOT NULL",
            name="ck_workflow_run_outbox_subject",
        ),
        # The relay's due scan: pending rows whose backoff has elapsed, FIFO.
        Index(
            "ix_workflow_run_outbox_due",
            "next_attempt_at",
            "created_at",
            "id",
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_workflow_run_outbox_run_id", "run_id"),
        Index("ix_workflow_run_outbox_trigger_id", "trigger_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="CASCADE"), nullable=True
    )
    trigger_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workflow_trigger.id", ondelete="CASCADE"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(64))
    payload_json: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class WorkflowControlCommand(Base):
    """Durable control commands (cancel, ...) with ack fields (§8.3).

    The server records a durable cancel command when an executor claimed or a
    lease prepared; the executor stops work and acknowledges cleanup before
    ``cancelled_before_acceptance`` (or terminal cancellation) becomes true.

    Fields mirror the ``workflow-control-command-v1`` fixture EXCEPT the secret
    ``cancellationFence`` (a report/cancel credential), which is deliberately
    NOT persisted here (§5.3): it lives in the private credential store.
    """

    __tablename__ = "workflow_control_command"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('cancel')",
            name="ck_workflow_control_command_kind",
        ),
        CheckConstraint(
            "status IN ('pending', 'delivered', 'acknowledged', 'superseded')",
            name="ck_workflow_control_command_status",
        ),
        # The delivery relay's per-run scan for undelivered commands.
        Index(
            "ix_workflow_control_command_pending",
            "run_id",
            "created_at",
            postgresql_where=text("status IN ('pending', 'delivered')"),
        ),
        Index("ix_workflow_control_command_run_id", "run_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="CASCADE"),
    )
    kind: Mapped[str] = mapped_column(String(32), default="cancel")
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Delivery-identity echo so a command can be fenced to one generation (§8.3).
    plan_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    binding_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    execution_generation: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    ack_outcome: Mapped[str | None] = mapped_column(String(64), nullable=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class WorkflowCapabilityLease(Base):
    """Exact ``CapabilityRef`` frozen per run + slot at StartRun (§7.1).

    The tagged-union columns are all nullable; ``kind`` selects which set is
    populated (integration_tool | function | product_mcp). WS3a fills these at
    resolve time. ``capability_key`` is a caller-computed stable identity string
    for the ref (kind + its identity fields); it makes the per-(run, slot)
    uniqueness a single clean constraint regardless of which union arm is set.
    """

    __tablename__ = "workflow_capability_lease"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('integration_tool', 'function', 'product_mcp')",
            name="ck_workflow_capability_lease_kind",
        ),
        UniqueConstraint(
            "run_id",
            "slot_id",
            "capability_key",
            name="uq_workflow_capability_lease_run_slot_key",
        ),
        Index("ix_workflow_capability_lease_run_id", "run_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="CASCADE"),
    )
    # The resolved-plan slot UUID (string; slots are UUIDv7 in the plan).
    slot_id: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(32))
    # Stable identity for the ref within (run, slot) — WS3a computes it.
    capability_key: Mapped[str] = mapped_column(String(255))
    plan_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # integration_tool arm.
    provider_definition_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_revision: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tool_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    input_schema_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # function arm.
    function_definition_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    semantic_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # product_mcp arm.
    product_mcp_definition: Mapped[str | None] = mapped_column(String(64), nullable=True)
    policy_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WorkflowGatewayReceipt(Base):
    """Required-invocation gateway receipt (§7.3).

    The durable proof an agent completion gate is satisfied. ``activation_id`` is
    the non-agent-controlled activation identity and is globally unique (WS3c
    recovers a lost turn by activation identity and must never create a second).
    No secret arguments or headers are recorded.
    """

    __tablename__ = "workflow_gateway_receipt"
    __table_args__ = (
        CheckConstraint(
            "capability_kind IN ('integration_tool', 'function')",
            name="ck_workflow_gateway_receipt_capability_kind",
        ),
        CheckConstraint(
            "authorization_decision IN ('allow', 'deny')",
            name="ck_workflow_gateway_receipt_decision",
        ),
        CheckConstraint(
            "outcome IN ('success', 'denied', 'upstream_failed', 'output_invalid')",
            name="ck_workflow_gateway_receipt_outcome",
        ),
        UniqueConstraint("activation_id", name="uq_workflow_gateway_receipt_activation"),
        Index("ix_workflow_gateway_receipt_run_id", "run_id"),
        Index(
            "ix_workflow_gateway_receipt_run_step_attempt",
            "run_id",
            "step_key",
            "attempt",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="CASCADE"),
    )
    plan_hash: Mapped[str] = mapped_column(String(80))
    slot_id: Mapped[str] = mapped_column(String(64))
    session_id: Mapped[str] = mapped_column(String(255))
    step_key: Mapped[str] = mapped_column(String(255))
    attempt: Mapped[int] = mapped_column(Integer)
    turn_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    activation_id: Mapped[str] = mapped_column(String(255))
    capability_kind: Mapped[str] = mapped_column(String(32))
    # integration_tool arm.
    provider_definition_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_revision: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tool_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    input_schema_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # function arm.
    function_definition_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    semantic_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    authorization_decision: Mapped[str] = mapped_column(String(16))
    outcome: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WorkflowActivation(Base):
    """Runtime-registered required-invocation activation identity (§7.3, WS3c).

    Registered by the runtime over the authenticated control channel BEFORE the
    agent turn starts, so the gateway can later authenticate an inbound tool
    call's trusted activation context against a real, durably-recorded identity
    instead of anything the call itself asserts (only ``activation_id`` rides
    the call — every other field is looked up here). ``activation_id`` is
    globally unique and non-agent-controlled; registering the same
    ``activation_id`` twice with an IDENTICAL identity tuple is idempotent (the
    service layer returns the existing row), and a conflicting reuse under a
    different tuple is a typed error — this table's uniqueness is the backstop.
    """

    __tablename__ = "workflow_activation"
    __table_args__ = (
        UniqueConstraint("activation_id", name="uq_workflow_activation_id"),
        Index("ix_workflow_activation_run_id", "run_id"),
        Index(
            "ix_workflow_activation_run_step_attempt",
            "run_id",
            "step_key",
            "attempt",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="CASCADE"),
    )
    plan_hash: Mapped[str] = mapped_column(String(80))
    slot_id: Mapped[str] = mapped_column(String(64))
    session_id: Mapped[str] = mapped_column(String(255))
    step_key: Mapped[str] = mapped_column(String(255))
    attempt: Mapped[int] = mapped_column(Integer)
    activation_id: Mapped[str] = mapped_column(String(255))
    # The single capability (§7.1: "activates only that capability") this
    # activation names — the SAME ``capability_key`` codec as the frozen lease.
    capability_key: Mapped[str] = mapped_column(String(255))
    turn_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WorkflowPollInbox(Base):
    """Durable poll-item inbox (§10.3).

    ``(trigger_id, external_item_id)`` is the dedupe identity: an endpoint may
    replay pages, but an item is scheduled at most once per trigger. Poison
    items get explicit ``dead_letter`` state and are never silently sealed as if
    scheduled. ``run_id`` links the spawned run once scheduled.
    """

    __tablename__ = "workflow_poll_inbox"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'scheduled', 'duplicate', 'dead_letter')",
            name="ck_workflow_poll_inbox_status",
        ),
        UniqueConstraint(
            "trigger_id",
            "external_item_id",
            name="uq_workflow_poll_inbox_trigger_item",
        ),
        # The retry/dead-letter sweep: non-terminal items ordered by last touch.
        Index(
            "ix_workflow_poll_inbox_retry",
            "updated_at",
            postgresql_where=text("status = 'pending'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trigger_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_trigger.id", ondelete="CASCADE"),
    )
    # The item's stable external id (spec: non-empty, max 255 chars).
    external_item_id: Mapped[str] = mapped_column(String(255))
    payload_json: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class WorkflowSessionLease(Base):
    """Two-sided durable session lease (§8.2).

    Postgres is authoritative for reservation. The partial unique index enforces
    at most one *non-released* lease per ``session_id`` (blocking states:
    reserved, prepared, claimed, quiescing, orphaned). Only ``released`` may be
    rebound. ``generation`` is a monotonic fencing token and is deliberately NOT
    part of the uniqueness key (two generations must never both hold a session).
    """

    __tablename__ = "workflow_session_lease"
    __table_args__ = (
        CheckConstraint(
            "state IN ("
            "'available', 'reserved', 'prepared', 'claimed', 'quiescing', "
            "'released', 'orphaned')",
            name="ck_workflow_session_lease_state",
        ),
        # THE partial unique constraint (§8.2): one live lease per session.
        Index(
            "uq_workflow_session_lease_active",
            "session_id",
            unique=True,
            postgresql_where=text(
                "state IN ('reserved', 'prepared', 'claimed', 'quiescing', 'orphaned')"
            ),
        ),
        Index("ix_workflow_session_lease_run_id", "run_id"),
        Index("ix_workflow_session_lease_session_id", "session_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[str] = mapped_column(String(255))
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="CASCADE"),
    )
    # The resolved-plan slot the session serves (nullable for runtime-created).
    slot_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    state: Mapped[str] = mapped_column(String(32), default="reserved")
    generation: Mapped[int] = mapped_column(BigInteger, default=1)
    reserved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    prepared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class WorkflowActionEffect(Base):
    """Deterministic action effect with a stable identity (§7.4).

    ``(run_id, step_key, attempt)`` is unique: the transaction that inserts the
    row owns the action, and a lost runtime->server submission recovers the same
    identity rather than creating a second effect. ``status`` includes
    ``outcome_uncertain`` for a provider send whose acceptance cannot be proven
    and must never auto-resend. Provider-identity columns support reconciliation
    (e.g. Slack channel/message id for ``chat.postMessage`` readback).
    """

    __tablename__ = "workflow_action_effect"
    __table_args__ = (
        CheckConstraint(
            "action_kind IN ('slack_notify')",
            name="ck_workflow_action_effect_kind",
        ),
        CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed', 'outcome_uncertain')",
            name="ck_workflow_action_effect_status",
        ),
        UniqueConstraint(
            "run_id",
            "step_key",
            "attempt",
            name="uq_workflow_action_effect_identity",
        ),
        Index(
            "ix_workflow_action_effect_sweep",
            "updated_at",
            postgresql_where=text("status IN ('pending', 'running', 'failed')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="CASCADE"),
    )
    step_key: Mapped[str] = mapped_column(String(255))
    attempt: Mapped[int] = mapped_column(Integer)
    action_kind: Mapped[str] = mapped_column(String(32))
    payload_json: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    # Provider reconciliation identity (no secrets): e.g. Slack channel + ts.
    provider_operation_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
