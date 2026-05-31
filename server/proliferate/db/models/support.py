"""Support report ORM models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class SupportReport(Base):
    __tablename__ = "support_report"
    __table_args__ = (
        CheckConstraint(
            "status IN ('created','uploading','completed','failed','abandoned')",
            name="ck_support_report_status",
        ),
        CheckConstraint(
            "cloud_diagnostics_status IN "
            "('not_applicable','pending','running','completed','failed','skipped')",
            name="ck_support_report_cloud_diagnostics_status",
        ),
        CheckConstraint(
            "source_surface IN ('desktop','web','mobile','cloud_api')",
            name="ck_support_report_source_surface",
        ),
        UniqueConstraint(
            "owner_user_id",
            "client_job_id",
            name="uq_support_report_owner_client_job",
        ),
        Index("ix_support_report_owner_user_id", "owner_user_id"),
        Index("ix_support_report_primary_tenant_id", "primary_tenant_id"),
        Index("ix_support_report_primary_organization_id", "primary_organization_id"),
        Index("ix_support_report_status_created_at", "status", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_job_id: Mapped[str] = mapped_column(String(128))
    owner_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    primary_organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="SET NULL"),
        nullable=True,
    )
    primary_tenant_id: Mapped[str] = mapped_column(String(128))
    tenant_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    status: Mapped[str] = mapped_column(String(32), default="created")
    s3_bucket: Mapped[str] = mapped_column(String(255))
    s3_prefix: Mapped[str] = mapped_column(Text)
    source_surface: Mapped[str] = mapped_column(String(32), default="desktop")
    source_context_json: Mapped[str] = mapped_column(Text, default="{}")
    workspace_refs_json: Mapped[str] = mapped_column(Text, default="[]")
    telemetry_refs_json: Mapped[str] = mapped_column(Text, default="{}")
    object_manifest_json: Mapped[str] = mapped_column(Text, default="{}")
    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    complete_request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    request_object_written_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    cloud_diagnostics_status: Mapped[str] = mapped_column(
        String(32),
        default="not_applicable",
    )
    cloud_diagnostics_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    cloud_diagnostics_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    cloud_diagnostics_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    slack_notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
