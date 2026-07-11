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
        # The seed reconciler's upsert-match query and the strip/picker's
        # "seeded defs" read.
        Index(
            "ix_workflow_is_seed_active",
            "is_seed",
            postgresql_where=text("archived_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Nullable to allow seeded rows (owner_user_id/created_by_user_id NULL, see
    # ``is_seed`` below): a seeded workflow has no user owner — it is
    # org-agnostic, code-defined, and reconciled at boot (track 1f).
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=True,
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Track 1f: seeded (code-defined, curated) workflow definitions reconciled
    # at boot, matched on ``seed_slug`` (like integrations' source='seed' +
    # namespace). Most-reversible marker approach: a nullable boolean + a
    # nullable unique slug, rather than inventing a "system owner" concept
    # that doesn't otherwise exist for workflows.
    is_seed: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    seed_slug: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
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
    # Nullable for seeded versions (no authoring user; see Workflow.is_seed).
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=True,
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
            "'claimable', "
            "'claimed', "
            "'delivered', "
            "'running', "
            "'waiting_approval', "
            "'completed', "
            "'failed', "
            "'cancelled', "
            "'missed'"
            ")",
            name="ck_workflow_run_status",
        ),
        # --- WS2a persistence skeleton: independent run state axes (spec §8.1). ---
        # These constrain only the ADD-ONLY axis columns below. They permit NULL so
        # every pre-feature/current-code run row (which never sets them) still
        # validates; the legacy ``status`` CHECK above is untouched.
        CheckConstraint(
            "desired_state IS NULL OR desired_state IN ('running', 'cancel_requested')",
            name="ck_workflow_run_desired_state",
        ),
        CheckConstraint(
            "delivery_state IS NULL OR delivery_state IN ("
            "'ready', 'claimed', 'materializing', 'delivered', 'acknowledged', "
            "'retryable_ready', 'terminal_delivery_failure')",
            name="ck_workflow_run_delivery_state",
        ),
        CheckConstraint(
            "observed_state IS NULL OR observed_state IN ("
            "'accepted', 'running', 'completed', 'failed', 'quiescing', 'cancelled', "
            "'waiting_action_result', 'waiting_credential_refresh')",
            name="ck_workflow_run_observed_state",
        ),
        CheckConstraint(
            "execution_health IS NULL OR execution_health IN ('healthy', 'suspect', 'orphaned')",
            name="ck_workflow_run_execution_health",
        ),
        CheckConstraint(
            "preaccept_cancel_state IS NULL OR preaccept_cancel_state IN ("
            "'none', 'cancelling_preaccept', 'cancelled_before_acceptance')",
            name="ck_workflow_run_preaccept_cancel_state",
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
        # Desktop-executor claim plane (2a). The claim poll scans an owner's
        # claimable + reclaimable-stale local runs; keep it partial so cloud runs
        # (and terminal history) never touch these indexes.
        Index(
            "ix_workflow_run_local_claimable",
            "executor_user_id",
            "created_at",
            postgresql_where=text("target_mode = 'local' AND status = 'claimable'"),
        ),
        Index(
            "ix_workflow_run_local_claim_expiry",
            "claim_expires_at",
            postgresql_where=text(
                "target_mode = 'local' AND status = 'claimed' AND claim_expires_at IS NOT NULL"
            ),
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
    # D15 take-over/cancel: the user who stopped the run (nullable — set only by an
    # explicit take-over/cancel). The audit answer to "why is this cancelled".
    stopped_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    # --- desktop-executor claim plane (track 2a; local scheduled runs only). ----
    # A local scheduled run is created ``claimable`` with these NULL; a desktop
    # executor's claim stamps them (mirrors the automations run claim row). Cloud
    # runs never set them. ``claim_id`` rotates on every (re)claim so a stale
    # executor's heartbeat/report against an old claim is rejected.
    executor_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    claim_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claim_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # --- WS2a persistence skeleton: independent run state axes (spec §8.1). -------
    # ADD-ONLY. The legacy ``status`` column above keeps driving all current code;
    # nothing reads/writes these axes yet except WS2a's own tests. WS2b/2c cut over
    # and *derive* the public status from these facts — status is never stored
    # twice, and ``orphaned`` (execution_health) never overwrites the last runtime
    # observation (observed_state/observed_snapshot_json).
    desired_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    delivery_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    observed_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    observed_quiescence_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    execution_health: Mapped[str | None] = mapped_column(String(32), nullable=True)
    preaccept_cancel_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Monotonic observation revision + the whole ``ObservedRun`` snapshot (spec
    # §5.4). WS2c accepts a snapshot only at exactly ``current + 1`` via an
    # optimistic ``UPDATE ... WHERE observed_revision IS NOT DISTINCT FROM :current``
    # (see ``workflow_ledger.cas_observed_snapshot``). Terminal snapshots are
    # immutable; late cost/audit reconciliation lands in a separate ledger, never here.
    observed_revision: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    observed_snapshot_json: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    # Immutable delivery identity fields (spec §5.2/§5.3): the full delivery
    # identity is ``(run_id, plan_hash, binding_hash, execution_generation)``.
    # ``plan_version`` is the resolved-plan schema version. ``execution_binding_json``
    # is the *redacted*, secret-free accepted ``ExecutionBinding`` — never a bearer.
    plan_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    binding_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    execution_generation: Mapped[int | None] = mapped_column(Integer, nullable=True)
    plan_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    execution_binding_json: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)


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
            "missed_run_policy IN ('run_latest', 'skip_all', 'replay_all')",
            name="ck_workflow_trigger_missed_run_policy",
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
        # D16: unattended triggers (schedule/poll) pin a repo — it is the authored
        # source of the derived warm workspace (target_workspace_id).
        CheckConstraint(
            "kind NOT IN ('schedule', 'poll') OR repo_full_name IS NOT NULL",
            name="ck_workflow_trigger_repo_full_name",
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
    # Missed-run policy (1c; schedule triggers): run_latest | skip_all | replay_all.
    # Governs how a catch-up tick treats occurrences that came due while the
    # scheduler was down (mental-model §4). Defaults to run_latest.
    missed_run_policy: Mapped[str] = mapped_column(
        String(16), default="run_latest", server_default=text("'run_latest'")
    )
    target_mode: Mapped[str] = mapped_column(String(32))
    # D16: the authored "where" for an unattended run — a "org/repo" pin. Required
    # for schedule/poll by ck_workflow_trigger_repo_full_name; target_workspace_id
    # is derived from it (the server owns the warm workspace).
    repo_full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Cloud workspace the scheduled run delivers into (required for personal_cloud).
    # D16: now DERIVED from repo_full_name — the server ensures a dedicated cloud
    # workspace for the pinned repo and stamps its id here; it is never authored
    # directly. CASCADE keeps the target-workspace NOT-NULL invariant true if a
    # workspace is ever hard-deleted (they are normally archived, not deleted).
    target_workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="CASCADE"),
        nullable=True,
    )
    # D16 schedule enable-gate: the preset input values (mock's ScheduleConfig
    # presets). A schedule trigger cannot be enabled until every required workflow
    # input has a preset here. For schedule triggers it mirrors args_json (the
    # fire-time args); it is the queryable enable-gate record.
    input_presets_json: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
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
    # WS2a: CAS fence for the opaque poll cursor (spec §10.3 — "compare-and-swap
    # the cursor only when every page item is durable"). The poll-apply
    # transaction reads (poll_cursor, poll_cursor_generation), then advances the
    # cursor only when the generation is unchanged, bumping it by one. ADD-ONLY:
    # nothing writes it until WS4b's poll worker.
    poll_cursor_generation: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
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
            "run_id",
            "step_key",
            "action_kind",
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


# Re-exported for existing importers; the classes moved to
# ``workflow_gateway_models.py`` in WS2a (size discipline, no behavior change).
from proliferate.db.models.cloud.workflow_gateway_models import (  # noqa: E402
    FunctionInvocationDefinition as FunctionInvocationDefinition,
)
from proliferate.db.models.cloud.workflow_gateway_models import (  # noqa: E402
    WorkflowRunGatewayToken as WorkflowRunGatewayToken,
)
