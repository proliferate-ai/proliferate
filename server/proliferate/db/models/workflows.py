"""Workflow definition persistence models."""

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
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class WorkflowDefinition(Base):
    __tablename__ = "workflow_definition"
    __table_args__ = (
        CheckConstraint(
            "schema_version = 1",
            name="ck_workflow_definition_schema_version",
        ),
        CheckConstraint(
            "revision >= 1",
            name="ck_workflow_definition_revision",
        ),
        Index(
            "ix_workflow_definition_user_updated",
            "user_id",
            "updated_at",
            "id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_workflow_definition_default_repo_config_id",
            "default_repo_config_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(
        Text,
        default="",
        server_default=text("''"),
    )
    schema_version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default=text("1"),
    )
    revision: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default=text("1"),
    )
    validated_catalog_version: Mapped[str] = mapped_column(String(128))
    default_repo_config_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("repo_config.id", ondelete="SET NULL"),
        nullable=True,
    )
    inputs_json: Mapped[list[dict[str, object]]] = mapped_column(
        JSONB,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    stages_json: Mapped[list[dict[str, object]]] = mapped_column(
        JSONB,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WorkflowInvocation(Base):
    __tablename__ = "workflow_invocation"
    __table_args__ = (
        CheckConstraint(
            "schema_version = 1",
            name="ck_workflow_invocation_schema_version",
        ),
        Index("ix_workflow_invocation_user_created", "user_id", "created_at", "id"),
        Index("ix_workflow_invocation_definition", "workflow_definition_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    workflow_definition_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    definition_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    title_snapshot: Mapped[str] = mapped_column(String(255), nullable=False)
    description_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    schema_version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default=text("1"),
    )
    creation_request_json: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    invocation_json: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=text("now()"),
        onupdate=utcnow,
    )


class WorkflowManagedExecution(Base):
    """Mutable managed-runtime custody and projection for one invocation."""

    __tablename__ = "workflow_managed_execution"
    __table_args__ = (
        CheckConstraint(
            "delivery_status IN ('prepared', 'queued', 'delivering', 'accepted', "
            "'delivery_failed', 'delivery_cancelled')",
            name="ck_workflow_managed_execution_delivery_status",
        ),
        CheckConstraint(
            "delivery_checkpoint IN ('none', 'target_plan_frozen', 'target_bound', "
            "'workspace_put_started', 'workspace_ready', 'run_put_started', 'accepted')",
            name="ck_workflow_managed_execution_delivery_checkpoint",
        ),
        CheckConstraint(
            "desired_state IN ('active', 'cancelled')",
            name="ck_workflow_managed_execution_desired_state",
        ),
        CheckConstraint(
            "desired_state = 'active' OR cancel_requested_at IS NOT NULL",
            name="ck_workflow_managed_execution_cancel_requested_at",
        ),
        CheckConstraint(
            "execution_status IS NULL OR execution_status IN "
            "('accepted', 'running', 'completed', 'failed', 'cancelled', 'interrupted')",
            name="ck_workflow_managed_execution_execution_status",
        ),
        CheckConstraint(
            "freshness_basis IN ('pending', 'live', 'unreachable', 'target_lost')",
            name="ck_workflow_managed_execution_freshness_basis",
        ),
        CheckConstraint(
            "delivery_generation >= 1 AND observation_generation >= 0 "
            "AND cancel_generation >= 0 AND delivery_attempt_count >= 0 "
            "AND consecutive_unchanged_count >= 0",
            name="ck_workflow_managed_execution_counters",
        ),
        Index(
            "ix_workflow_managed_execution_delivery",
            "delivery_status",
            "updated_at",
        ),
        Index(
            "ix_workflow_managed_execution_observation",
            "execution_status",
            "latest_observed_at",
        ),
        Index(
            "ix_workflow_managed_execution_cancellation",
            "desired_state",
            "cancel_requested_at",
        ),
    )

    invocation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_invocation.id", ondelete="CASCADE"),
        primary_key=True,
    )
    delivery_status: Mapped[str] = mapped_column(String(32), default="prepared")
    delivery_checkpoint: Mapped[str] = mapped_column(String(32), default="none")
    desired_state: Mapped[str] = mapped_column(String(32), default="active")
    target_plan_json: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    target_cloud_sandbox_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    target_execution_store_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    target_workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cloud_workspace_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    execution_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    latest_state_version: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    latest_projection_json: Mapped[dict[str, object] | None] = mapped_column(
        JSONB,
        nullable=True,
    )
    latest_observed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    freshness_basis: Mapped[str] = mapped_column(String(32), default="pending")
    delivery_generation: Mapped[int] = mapped_column(BigInteger, default=1)
    observation_generation: Mapped[int] = mapped_column(BigInteger, default=0)
    cancel_generation: Mapped[int] = mapped_column(BigInteger, default=0)
    delivery_attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    consecutive_unchanged_count: Mapped[int] = mapped_column(Integer, default=0)
    last_delivery_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_observation_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=text("now()"),
        onupdate=utcnow,
    )
    accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
