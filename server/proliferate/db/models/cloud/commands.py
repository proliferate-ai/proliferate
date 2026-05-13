"""Cloud command ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudCommand(Base):
    __tablename__ = "cloud_command"
    __table_args__ = (
        UniqueConstraint("org_id", "idempotency_key", name="uq_cloud_command_idempotency"),
        CheckConstraint(
            "status IN ('queued', 'leased', 'delivered', 'accepted', "
            "'accepted_but_queued', 'rejected', 'expired', 'superseded', "
            "'failed_delivery')",
            name="ck_cloud_command_status",
        ),
        Index("ix_cloud_command_target_status_created", "target_id", "status", "created_at"),
        Index("ix_cloud_command_session_status_created", "session_id", "status", "created_at"),
        Index("ix_cloud_command_lease_expires", "lease_expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    idempotency_key: Mapped[str] = mapped_column(String(255))
    org_id: Mapped[uuid.UUID] = mapped_column(index=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    actor_kind: Mapped[str] = mapped_column(String(32))
    source: Mapped[str] = mapped_column(String(64))
    target_id: Mapped[uuid.UUID] = mapped_column(index=True)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    kind: Mapped[str] = mapped_column(String(64))
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    observed_event_seq: Mapped[int | None] = mapped_column(nullable=True)
    preconditions_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(32), default="queued")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    leased_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    authorization_context_json: Mapped[str] = mapped_column(Text, default="{}")
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudCommandLease(Base):
    __tablename__ = "cloud_command_lease"
    __table_args__ = (
        Index("ix_cloud_command_lease_command", "command_id"),
        Index("ix_cloud_command_lease_worker_expires", "worker_id", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    command_id: Mapped[uuid.UUID] = mapped_column(index=True)
    target_id: Mapped[uuid.UUID] = mapped_column(index=True)
    worker_id: Mapped[uuid.UUID] = mapped_column(index=True)
    leased_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
