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
            "trigger_kind IN ('manual', 'schedule', 'chat', 'agent', 'api')",
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
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow.id", ondelete="CASCADE"),
    )
    workflow_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_version.id", ondelete="RESTRICT"),
    )
    trigger_kind: Mapped[str] = mapped_column(String(32))
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
