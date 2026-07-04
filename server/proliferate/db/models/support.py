"""Support report ORM models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
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
        CheckConstraint(
            "kind IN ('bug','feature')",
            name="ck_support_report_kind",
        ),
        CheckConstraint(
            "tracker_status IN "
            "('none','pending','in_progress','partial','completed','failed_retryable',"
            "'failed_permanent','disabled')",
            name="ck_support_report_tracker_status",
        ),
        CheckConstraint(
            "github_status IN "
            "('none','pending','completed','failed_retryable','failed_permanent','disabled')",
            name="ck_support_report_github_status",
        ),
        CheckConstraint(
            "linear_status IN "
            "('none','pending','completed','failed_retryable','failed_permanent','disabled')",
            name="ck_support_report_linear_status",
        ),
        CheckConstraint(
            "crosslink_status IN "
            "('none','pending','completed','failed_retryable','failed_permanent','disabled')",
            name="ck_support_report_crosslink_status",
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
        Index("ix_support_report_tracker_due", "tracker_status", "tracker_next_attempt_at"),
        Index("ix_support_report_github_issue_id", "github_issue_id", unique=True),
        Index("ix_support_report_linear_issue_id", "linear_issue_id", unique=True),
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
    expected_uploads_json: Mapped[str] = mapped_column(Text, default="{}")
    public_content_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    kind: Mapped[str] = mapped_column(String(32), server_default="bug", default="bug")
    credit_consent: Mapped[bool] = mapped_column(Boolean, server_default="false", default=False)
    credit_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
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
    tracker_status: Mapped[str] = mapped_column(String(32), default="none")
    tracker_attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    tracker_next_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    tracker_locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    tracker_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    tracker_slack_notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    tracker_last_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    tracker_last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    github_status: Mapped[str] = mapped_column(String(32), default="none")
    github_issue_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    github_issue_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    github_issue_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    github_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    github_create_attempted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    linear_status: Mapped[str] = mapped_column(String(32), default="none")
    linear_issue_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    linear_issue_identifier: Mapped[str | None] = mapped_column(String(128), nullable=True)
    linear_issue_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    linear_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    linear_create_attempted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    crosslink_status: Mapped[str] = mapped_column(String(32), default="none")
    crosslink_synced_at: Mapped[datetime | None] = mapped_column(
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
