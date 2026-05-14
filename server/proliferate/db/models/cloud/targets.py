"""Cloud compute target and worker ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.constants.cloud import (
    SUPPORTED_CLOUD_TARGET_ENROLLMENT_STATUSES,
    SUPPORTED_CLOUD_TARGET_KINDS,
    SUPPORTED_CLOUD_TARGET_STATUSES,
    SUPPORTED_CLOUD_WORKER_STATUSES,
)
from proliferate.db.models.base import Base, utcnow


class CloudTarget(Base):
    __tablename__ = "cloud_targets"
    __table_args__ = (
        CheckConstraint(
            f"kind IN {SUPPORTED_CLOUD_TARGET_KINDS}",
            name="ck_cloud_targets_kind",
        ),
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_cloud_targets_owner_scope",
        ),
        CheckConstraint(
            f"status IN {SUPPORTED_CLOUD_TARGET_STATUSES}",
            name="ck_cloud_targets_status",
        ),
        Index("ix_cloud_targets_owner_user_status", "owner_user_id", "status"),
        Index("ix_cloud_targets_organization_status", "organization_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    display_name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="enrolling", index=True)
    owner_scope: Mapped[str] = mapped_column(String(32), default="personal")
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    default_workspace_root: Mapped[str | None] = mapped_column(Text, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudWorker(Base):
    __tablename__ = "cloud_workers"
    __table_args__ = (
        CheckConstraint(
            f"status IN {SUPPORTED_CLOUD_WORKER_STATUSES}",
            name="ck_cloud_workers_status",
        ),
        Index("ix_cloud_workers_target_status", "target_id", "status"),
        Index("ix_cloud_workers_last_seen_at", "last_seen_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    machine_fingerprint: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hostname: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="online", index=True)
    worker_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    anyharness_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    supervisor_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudTargetEnrollment(Base):
    __tablename__ = "cloud_target_enrollments"
    __table_args__ = (
        CheckConstraint(
            f"status IN {SUPPORTED_CLOUD_TARGET_ENROLLMENT_STATUSES}",
            name="ck_cloud_target_enrollments_status",
        ),
        Index("ix_cloud_target_enrollments_target_status", "target_id", "status"),
        Index("ix_cloud_target_enrollments_expires_at", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudTargetInventory(Base):
    __tablename__ = "cloud_target_inventory"

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        primary_key=True,
    )
    worker_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workers.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    os: Mapped[str | None] = mapped_column(String(64), nullable=True)
    arch: Mapped[str | None] = mapped_column(String(64), nullable=True)
    distro: Mapped[str | None] = mapped_column(String(128), nullable=True)
    shell: Mapped[str | None] = mapped_column(String(255), nullable=True)
    git_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    node_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    python_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    browser_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    capabilities_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    providers_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    mcp_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CloudTargetStatus(Base):
    __tablename__ = "cloud_target_status"

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        primary_key=True,
    )
    worker_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workers.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(32), default="enrolling", index=True)
    status_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
