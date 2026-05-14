"""Cloud command ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.constants.cloud import (
    SUPPORTED_CLOUD_COMMAND_ACTOR_KINDS,
    SUPPORTED_CLOUD_COMMAND_KINDS,
    SUPPORTED_CLOUD_COMMAND_SOURCES,
    SUPPORTED_CLOUD_COMMAND_STATUSES,
)
from proliferate.db.models.base import Base, utcnow


class CloudCommand(Base):
    __tablename__ = "cloud_commands"
    __table_args__ = (
        CheckConstraint(
            f"kind IN {SUPPORTED_CLOUD_COMMAND_KINDS}",
            name="ck_cloud_commands_kind",
        ),
        CheckConstraint(
            f"status IN {SUPPORTED_CLOUD_COMMAND_STATUSES}",
            name="ck_cloud_commands_status",
        ),
        CheckConstraint(
            f"actor_kind IN {SUPPORTED_CLOUD_COMMAND_ACTOR_KINDS}",
            name="ck_cloud_commands_actor_kind",
        ),
        CheckConstraint(
            f"source IN {SUPPORTED_CLOUD_COMMAND_SOURCES}",
            name="ck_cloud_commands_source",
        ),
        Index(
            "uq_cloud_commands_idempotency_scope_key",
            "idempotency_scope",
            "idempotency_key",
            unique=True,
        ),
        Index("ix_cloud_commands_target_status_created", "target_id", "status", "created_at"),
        Index("ix_cloud_commands_session_status_created", "session_id", "status", "created_at"),
        Index("ix_cloud_commands_lease_expires_at", "lease_expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    idempotency_scope: Mapped[str] = mapped_column(String(255))
    idempotency_key: Mapped[str] = mapped_column(String(255))
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    actor_kind: Mapped[str] = mapped_column(String(32))
    source: Mapped[str] = mapped_column(String(32))
    workspace_id: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    kind: Mapped[str] = mapped_column(String(64), index=True)
    payload_json: Mapped[str] = mapped_column(Text)
    observed_event_seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    preconditions_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    authorization_context_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    lease_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    leased_by_worker_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workers.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
