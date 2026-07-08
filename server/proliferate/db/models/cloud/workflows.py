"""Workflow control-plane ORM models.

The server is the source of truth for workflow *programs* (definitions + immutable
versions) and the durable *run ledger*. It never interprets steps: ``StartRun``
resolves an immutable version into a self-contained ``resolved_plan_json`` payload
which a local/cloud anyharness executes. See goals-and-workflows-v1 spec 3.2.

Executor identity always equals the workflow owner in v1 (no "Run as"); the column
exists so team/service-account executors arrive later without a migration.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class Workflow(Base):
    __tablename__ = "workflow"
    __table_args__ = (
        Index("ix_workflow_owner_user_id", "owner_user_id"),
        Index("ix_workflow_created_by_user_id", "created_by_user_id"),
        Index("ix_workflow_current_version_id", "current_version_id"),
        # One indexed query for the free-plan cap and the home list: the owner's
        # non-archived workflows.
        Index(
            "ix_workflow_owner_active",
            "owner_user_id",
            postgresql_where=text("archived_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Nullable + no DB-level FK constraint: the pointer is set immediately after the
    # first version row is inserted (the two tables reference each other). The app
    # keeps it consistent; a hard FK would deadlock the create ordering.
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class WorkflowVersion(Base):
    """Immutable, append-only snapshot of a workflow's definition."""

    __tablename__ = "workflow_version"
    __table_args__ = (
        UniqueConstraint("workflow_id", "version_n", name="uq_workflow_version_workflow_n"),
        Index("ix_workflow_version_workflow_id", "workflow_id"),
        Index("ix_workflow_version_created_by_user_id", "created_by_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow.id", ondelete="CASCADE"),
    )
    version_n: Mapped[int] = mapped_column(Integer)
    definition_json: Mapped[dict[str, object]] = mapped_column(JSONB)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WorkflowRun(Base):
    """Durable run ledger. The run id is the delivery idempotency key."""

    __tablename__ = "workflow_run"
    __table_args__ = (
        CheckConstraint(
            "trigger_kind IN ('manual', 'schedule', 'poll', 'chat', 'agent', 'api')",
            name="ck_workflow_run_trigger_kind",
        ),
        CheckConstraint(
            "target_mode IN ('local', 'personal_cloud')",
            name="ck_workflow_run_target_mode",
        ),
        CheckConstraint(
            "status IN ("
            "'pending_delivery', "
            "'delivered', "
            "'running', "
            "'waiting_approval', "
            "'completed', "
            "'failed', "
            "'cancelled'"
            ")",
            name="ck_workflow_run_status",
        ),
        Index("ix_workflow_run_workflow_created", "workflow_id", "created_at"),
        Index("ix_workflow_run_executor_user_id", "executor_user_id"),
        Index("ix_workflow_run_workflow_version_id", "workflow_version_id"),
        Index(
            "ix_workflow_run_pending_delivery",
            "created_at",
            postgresql_where=text("status = 'pending_delivery'"),
        ),
        # Scheduler-lane indexes (W5). Concurrency + FIFO-delivery scans hit runs
        # by their originating trigger; keep them partial so manual/chat runs
        # (trigger_id IS NULL) never touch these indexes.
        Index(
            "ix_workflow_run_trigger_id",
            "trigger_id",
            "created_at",
            postgresql_where=text("trigger_id IS NOT NULL"),
        ),
        # One scheduled run per (trigger, slot): the scheduler advances the trigger
        # under a row lock, but this is the hard DB guarantee against a double-fire.
        Index(
            "uq_workflow_run_trigger_slot",
            "trigger_id",
            "scheduled_for",
            unique=True,
            postgresql_where=text("trigger_id IS NOT NULL AND scheduled_for IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow.id", ondelete="CASCADE"),
    )
    workflow_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_version.id", ondelete="RESTRICT"),
    )
    trigger_kind: Mapped[str] = mapped_column(String(32))
    # Set only for runs a trigger produced (scheduled runs today). Null for
    # manual/chat/agent runs. SET NULL on trigger delete keeps run history intact.
    trigger_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workflow_trigger.id", ondelete="SET NULL"),
        nullable=True,
    )
    # The trigger occurrence (RRULE slot) this run fires for — the dedup + FIFO key.
    scheduled_for: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    # Always equals the workflow owner in v1 (no "Run as"); kept for future
    # team/service-account executors.
    executor_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    args_json: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict)
    target_mode: Mapped[str] = mapped_column(String(32))
    # The full self-contained payload handed to anyharness. Args are eagerly
    # interpolated; step-output references stay late-bound for the runtime.
    resolved_plan_json: Mapped[dict[str, object]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(32))
    step_cursor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Per-step public outputs summary reported by the runtime (exit codes, PR urls).
    step_outputs_json: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    anyharness_workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    anyharness_session_ids: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    cost_tokens: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WorkflowTrigger(Base):
    """A trigger fires a workflow: it pins target + schedule + concurrency, then
    calls the *same* ``StartRun`` as every other trigger source (spec 3.5).

    It owns no execution — no interpreter, no special path — only *when* and
    *where* a run starts and *with which* argument values. The ``kind`` vocabulary
    is intentionally open (webhook/api arrive later); v1 persists ``schedule``.
    """

    __tablename__ = "workflow_trigger"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('schedule', 'poll')",
            name="ck_workflow_trigger_kind",
        ),
        CheckConstraint(
            "concurrency_policy IN ('skip', 'queue')",
            name="ck_workflow_trigger_concurrency_policy",
        ),
        CheckConstraint(
            "target_mode IN ('local', 'personal_cloud')",
            name="ck_workflow_trigger_target_mode",
        ),
        # StartRun's own rule, pinned at the trigger: a cloud target names a
        # workspace; a local target must not.
        CheckConstraint(
            "(target_mode = 'personal_cloud' AND target_workspace_id IS NOT NULL) "
            "OR (target_mode = 'local' AND target_workspace_id IS NULL)",
            name="ck_workflow_trigger_target_workspace",
        ),
        # A schedule trigger must carry a complete, cursor-able schedule.
        CheckConstraint(
            "kind <> 'schedule' OR ("
            "schedule_rrule IS NOT NULL "
            "AND schedule_timezone IS NOT NULL "
            "AND next_run_at IS NOT NULL"
            ")",
            name="ck_workflow_trigger_schedule_fields",
        ),
        # A poll trigger must carry a complete poll config (endpoint + interval).
        CheckConstraint(
            "kind <> 'poll' OR (poll_url IS NOT NULL AND poll_interval_secs IS NOT NULL)",
            name="ck_workflow_trigger_poll_fields",
        ),
        Index("ix_workflow_trigger_workflow_id", "workflow_id"),
        Index("ix_workflow_trigger_target_workspace_id", "target_workspace_id"),
        # The scheduler's due scan: enabled schedule triggers whose slot has passed.
        Index(
            "ix_workflow_trigger_scheduler_due",
            "next_run_at",
            postgresql_where=text(
                "enabled = true AND kind = 'schedule' AND next_run_at IS NOT NULL"
            ),
        ),
        # The poller's due scan: enabled poll triggers (due = last_poll_at NULL, or
        # last_poll_at + interval <= now, evaluated in the claim query).
        Index(
            "ix_workflow_trigger_poller_due",
            "last_poll_at",
            postgresql_where=text("enabled = true AND kind = 'poll'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow.id", ondelete="CASCADE"),
    )
    kind: Mapped[str] = mapped_column(String(32), default="schedule")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Concurrency + target are pinned on the trigger, not per-run: two schedule
    # triggers on one workflow may target different workspaces and run in parallel.
    concurrency_policy: Mapped[str] = mapped_column(String(16))
    target_mode: Mapped[str] = mapped_column(String(32))
    # Cloud workspace the scheduled run delivers into (required for personal_cloud).
    # CASCADE keeps the target-workspace NOT-NULL invariant true if a workspace is
    # ever hard-deleted (they are normally archived, not deleted).
    target_workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="CASCADE"),
        nullable=True,
    )
    # Schedule cursor (reuses the automations RRULE house rules). Nullable at the
    # column level so future non-schedule kinds fit; the CHECK ties them to kind.
    schedule_rrule: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Trusted invariant: the service validates this as an IANA timezone before write.
    schedule_timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    schedule_summary: Mapped[str | None] = mapped_column(String(255), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_scheduled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    # Skip-tick surfacing (concurrency skip, or a StartRun error at fire time).
    last_skipped_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_skip_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # The argument values a fired run runs with, validated against the workflow's
    # arg schema (same coercion as a manual StartRun) at create/update. For poll
    # triggers these are static defaults, merged under the per-item mapped args.
    args_json: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict)
    # --- poll trigger config (kind == 'poll'; spec 4.2/4.3). -------------------
    # The conforming endpoint (GET /poll?cursor=&limit=), the header NAME the auth
    # value rides on, and the Fernet-encrypted header VALUE (house crypto helpers;
    # the plaintext secret is never stored and never echoed back on reads).
    poll_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    poll_auth_header: Mapped[str | None] = mapped_column(String(255), nullable=True)
    poll_auth_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    poll_interval_secs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # JSON Schema each item's ``data`` must validate against before it spawns a
    # run. Fully DERIVED from the workflow's declared inputs (D17) — there is no
    # authoring surface; the poller uses it unchanged for per-item validation.
    poll_item_schema_json: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    # Opaque, server-issued cursor: Proliferate stores and echoes it, never reads it.
    poll_cursor: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_poll_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Trigger-error surface (HTTP failure, malformed page). Cleared on a clean poll.
    last_poll_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class WorkflowTriggerItem(Base):
    """At-most-one spawn per (trigger, item id). The PK is the dedup guarantee.

    The Proliferate half of the at-least-once poll story (spec 4.3/4.4): the
    endpoint may replay items, but the composite primary key means an item id
    spawns a run at most once per trigger. Doubles as the trigger-error surface —
    schema-invalid items are recorded ``invalid`` (never silently dropped, never
    fed to an agent malformed), and StartRun failures are recorded ``error``.
    """

    __tablename__ = "workflow_trigger_item"
    __table_args__ = (
        CheckConstraint(
            "status IN ('spawned', 'invalid', 'error')",
            name="ck_workflow_trigger_item_status",
        ),
    )

    trigger_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_trigger.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # The poll item's ``id`` — the endpoint's stable, unique idempotency key.
    item_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    # The run this item spawned (SET NULL keeps item history if the run is deleted).
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(16))
    # Schema-validation / mapping / StartRun failure detail for non-spawned items.
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WorkflowStepAction(Base):
    """Server-side actions claimed off observed step completions.

    An action performs the side effect of a step the runtime already executed;
    it never decides or causes what executes next (L19).

    The (run_id, step_key, action_kind) unique constraint IS the claim: the
    transaction that inserts the row owns the action. status walks
    pending -> done | failed; a sweeper retries stale 'pending' rows (an owner
    that crashed before performing) and transient 'failed' rows (below the
    attempt cap).

    Honest guarantee: the ledger gives *exactly-once claim*. Action execution is
    *at-least-once completion* via the sweeper. A crash inside the action window
    (after the Slack POST succeeded, before status='done' committed) can
    duplicate a send -- the same guarantee class as every non-transactional
    external side effect.
    """

    __tablename__ = "workflow_step_action"
    __table_args__ = (
        UniqueConstraint(
            "run_id", "step_key", "action_kind",
            name="uq_workflow_step_action_claim",
        ),
        CheckConstraint(
            "action_kind IN ('slack_notify')",
            name="ck_workflow_step_action_kind",
        ),
        CheckConstraint(
            "status IN ('pending', 'done', 'failed')",
            name="ck_workflow_step_action_status",
        ),
        Index(
            "ix_workflow_step_action_sweep",
            "updated_at",
            postgresql_where=text("status IN ('pending', 'failed')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="CASCADE"),
    )
    # B5 (D2): the structured step key "<node>.<lane>.<step>" — the step's stable
    # identity across the format (bare integer indices are gone).
    step_key: Mapped[str] = mapped_column(String(64))
    action_kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    result_json: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class WorkflowRunGatewayToken(Base):
    """The per-run integration-gateway credential (PR E / OPEN-3(a), L16).

    Every run mints exactly one of these at StartRun — even a run whose plan needs
    no integration tools (``scope_json`` is then an empty list, which is legal and
    NEVER conflated with an unscoped worker token). Its plaintext rides inside the
    run's ``resolved_plan_json.gateway`` block to the sandbox; only the hash is
    stored (hashed exactly like the worker token, under its own HMAC domain).

    The token is the run-report credential too: the runtime pings
    ``/runs/{run_id}/ping`` with it. Identity is proven by the credential, so a
    request's run attribution is not a claim — ``workflow_run_id`` IS the run.

    ``scope_json`` is the frozen function grant (the definition's ``functions[]``,
    resolved), narrowed at delivery to the intersection with the delivering
    worker's allowlist (L25 layer 2 ⊆ layer 1). ``status`` walks
    active -> expired (terminal run status) | revoked.
    """

    __tablename__ = "cloud_workflow_run_gateway_token"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'expired', 'revoked')",
            name="ck_cloud_workflow_run_gateway_token_status",
        ),
        Index("ix_cloud_workflow_run_gateway_token_run_id", "workflow_run_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workflow_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="CASCADE"),
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # The resolved function grant: ``[{"provider": str, "tools": [str, ...]}, ...]``.
    # NOT NULL — an empty list means "no tools granted", distinct from a worker
    # token's NULL "unscoped" (L25).
    scope_json: Mapped[list[dict[str, object]]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(16), default="active")
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
