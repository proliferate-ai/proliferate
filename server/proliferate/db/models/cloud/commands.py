"""Cloud command queue ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudCommand(Base):
    __tablename__ = "cloud_commands"
    __table_args__ = (
        Index("uq_cloud_commands_org_idempotency_key", "org_id", "idempotency_key", unique=True),
        Index("ix_cloud_commands_target_status_created", "target_id", "status", "created_at"),
        Index("ix_cloud_commands_session_status_created", "session_id", "status", "created_at"),
        Index(
            "ix_cloud_commands_lease_expires_queued",
            "lease_expires_at",
            postgresql_where=text("status = 'leased'"),
        ),
        CheckConstraint(
            "actor_kind IN ('user', 'automation', 'slack', 'api_key', 'system')",
            name="ck_cloud_commands_actor_kind",
        ),
        CheckConstraint(
            "source IN ('web', 'mobile', 'slack', 'api', 'automation', 'desktop_cloud_view')",
            name="ck_cloud_commands_source",
        ),
        CheckConstraint(
            "kind IN ("
            "'start_session', 'send_prompt', 'resolve_interaction', "
            "'update_session_config', 'cancel_turn', 'cancel_session', "
            "'stop_workspace', 'hibernate_workspace', 'resume_workspace', "
            "'prune_workspace', 'extend_workspace_ttl', 'sync_existing_workspace'"
            ")",
            name="ck_cloud_commands_kind",
        ),
        CheckConstraint(
            "status IN ("
            "'queued', 'leased', 'delivered', 'accepted', 'accepted_but_queued', "
            "'rejected', 'expired', 'superseded', 'failed_delivery'"
            ")",
            name="ck_cloud_commands_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    idempotency_key: Mapped[str] = mapped_column(String(255))
    org_id: Mapped[uuid.UUID] = mapped_column(index=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    actor_kind: Mapped[str] = mapped_column(String(32))
    source: Mapped[str] = mapped_column(String(32))
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    session_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    kind: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    observed_event_seq: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    preconditions: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    status: Mapped[str] = mapped_column(String(32), default="queued")
    authorization_context: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    error_code: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    leased_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CloudCommandLease(Base):
    __tablename__ = "cloud_command_leases"
    __table_args__ = (
        Index("ix_cloud_command_leases_command", "command_id"),
        Index("ix_cloud_command_leases_worker_status", "worker_id", "status"),
        Index("ix_cloud_command_leases_expires", "expires_at"),
        CheckConstraint(
            "status IN ('active', 'completed', 'expired', 'released')",
            name="ck_cloud_command_leases_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    command_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_commands.id", ondelete="CASCADE"),
        index=True,
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    worker_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_workers.id", ondelete="CASCADE"),
        index=True,
    )
    status: Mapped[str] = mapped_column(String(32), default="active")
    attempt: Mapped[int] = mapped_column(default=1)
    leased_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
