"""Durable one-time approval state for integration external actions."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudIntegrationActionApproval(Base):
    """One exact external action that may be approved and consumed once."""

    __tablename__ = "cloud_integration_action_approval"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'consumed', 'expired', 'revoked')",
            name="ck_cloud_integration_action_approval_status",
        ),
        Index(
            "ux_cloud_integration_action_approval_active_key",
            "idempotency_key",
            unique=True,
            postgresql_where=text("status IN ('pending', 'approved')"),
        ),
        Index(
            "ix_cloud_integration_action_approval_owner_status_created",
            "owner_user_id",
            "status",
            "created_at",
        ),
        Index(
            "ix_cloud_integration_action_approval_expires_at",
            "expires_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    # These are immutable audit snapshots, deliberately not foreign keys. A
    # referenced user/org/account/worker may later be deleted, but the exact
    # authority that was approved must never be rewritten or SET NULL.
    owner_user_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    integration_account_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    integration_account_auth_version: Mapped[int] = mapped_column(Integer, nullable=False)
    runtime_worker_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    gateway_session_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    workspace_id: Mapped[str] = mapped_column(String(255), nullable=False)
    anyharness_session_id: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_namespace: Mapped[str] = mapped_column(String(64))
    tool_name: Mapped[str] = mapped_column(String(255))
    payload_digest: Mapped[str] = mapped_column(String(64))
    binding_digest: Mapped[str] = mapped_column(String(64))
    idempotency_key: Mapped[str] = mapped_column(String(64))
    safe_action_summary: Mapped[str] = mapped_column(String(512))
    safe_account_label: Mapped[str] = mapped_column(String(255))
    safe_source_label: Mapped[str] = mapped_column(String(255))
    safe_target: Mapped[str | None] = mapped_column(String(255), nullable=True)
    safe_content_preview: Mapped[str | None] = mapped_column(String(512), nullable=True)
    safe_content_character_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=func.now(),
        onupdate=func.now(),
    )


class CloudIntegrationActionApprovalEvent(Base):
    """Append-only lifecycle evidence for an external-action approval."""

    __tablename__ = "cloud_integration_action_approval_event"
    __table_args__ = (
        CheckConstraint(
            "event_type IN "
            "('requested', 'approved', 'rejected', 'revoked', 'expired', 'consumed')",
            name="ck_cloud_integration_action_approval_event_type",
        ),
        CheckConstraint(
            "actor_type IN ('user', 'runtime_worker', 'system')",
            name="ck_cloud_integration_action_approval_event_actor_type",
        ),
        CheckConstraint(
            "(actor_type = 'user' AND actor_user_id IS NOT NULL "
            "AND actor_runtime_worker_id IS NULL) OR "
            "(actor_type = 'runtime_worker' AND actor_user_id IS NULL "
            "AND actor_runtime_worker_id IS NOT NULL) OR "
            "(actor_type = 'system' AND actor_user_id IS NULL "
            "AND actor_runtime_worker_id IS NULL)",
            name="ck_cloud_integration_action_approval_event_actor_shape",
        ),
        Index(
            "ix_cloud_integration_action_approval_event_approval_created",
            "approval_id",
            "created_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    approval_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_integration_action_approval.id")
    )
    event_type: Mapped[str] = mapped_column(String(32))
    from_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_status: Mapped[str] = mapped_column(String(32))
    actor_type: Mapped[str] = mapped_column(String(32))
    # Immutable actor snapshots for the same retention reason as the binding
    # columns on the approval row.
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    actor_runtime_worker_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    safe_action_summary: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=func.now(),
        onupdate=func.now(),
    )
