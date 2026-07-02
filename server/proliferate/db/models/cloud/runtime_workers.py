"""Runtime worker identity, enrollment, and integration-gateway token models.

A runtime worker is the enrolled process (in a cloud sandbox or on a desktop
install) that authenticates back to Cloud. Enrollment mints a private
worker->Cloud bearer token plus a scoped integration-gateway token that
AnyHarness reads from a dotfile to reach the Cloud integration gateway.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudRuntimeWorker(Base):
    __tablename__ = "cloud_runtime_worker"
    __table_args__ = (
        CheckConstraint(
            "runtime_kind IN ('cloud_sandbox', 'desktop')",
            name="ck_cloud_runtime_worker_kind",
        ),
        CheckConstraint(
            "status IN ('online', 'offline', 'revoked')",
            name="ck_cloud_runtime_worker_status",
        ),
        CheckConstraint(
            "(runtime_kind = 'cloud_sandbox' AND cloud_sandbox_id IS NOT NULL "
            "AND desktop_install_id IS NULL) OR "
            "(runtime_kind = 'desktop' AND desktop_install_id IS NOT NULL "
            "AND cloud_sandbox_id IS NULL)",
            name="ck_cloud_runtime_worker_kind_identity",
        ),
        # At most one non-revoked worker per cloud sandbox.
        Index(
            "ux_cloud_runtime_worker_active_sandbox",
            "cloud_sandbox_id",
            unique=True,
            postgresql_where=("status != 'revoked' AND cloud_sandbox_id IS NOT NULL"),
        ),
        # At most one non-revoked worker per (owner, desktop install).
        Index(
            "ux_cloud_runtime_worker_active_desktop",
            "owner_user_id",
            "desktop_install_id",
            unique=True,
            postgresql_where=("status != 'revoked' AND desktop_install_id IS NOT NULL"),
        ),
        Index("ix_cloud_runtime_worker_last_seen_at", "last_seen_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    runtime_kind: Mapped[str] = mapped_column(String(32))
    cloud_sandbox_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    desktop_install_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="online")
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudRuntimeWorkerEnrollment(Base):
    __tablename__ = "cloud_runtime_worker_enrollment"
    __table_args__ = (
        CheckConstraint(
            "runtime_kind IN ('cloud_sandbox', 'desktop')",
            name="ck_cloud_runtime_worker_enrollment_kind",
        ),
        CheckConstraint(
            "status IN ('pending', 'consumed', 'expired', 'revoked')",
            name="ck_cloud_runtime_worker_enrollment_status",
        ),
        Index(
            "ix_cloud_runtime_worker_enrollment_expires_at",
            "expires_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    runtime_kind: Mapped[str] = mapped_column(String(32))
    cloud_sandbox_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    desktop_install_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    created_by_user_id: Mapped[uuid.UUID] = mapped_column()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudIntegrationGatewayToken(Base):
    __tablename__ = "cloud_integration_gateway_token"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'revoked')",
            name="ck_cloud_integration_gateway_token_status",
        ),
        # At most one active gateway token per worker.
        Index(
            "ux_cloud_integration_gateway_token_active_worker",
            "runtime_worker_id",
            unique=True,
            postgresql_where="status = 'active'",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    runtime_worker_id: Mapped[uuid.UUID] = mapped_column(index=True)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="active")
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
