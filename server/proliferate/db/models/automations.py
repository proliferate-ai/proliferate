"""Automation persistence models."""

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
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class Automation(Base):
    __tablename__ = "automation"
    __table_args__ = (
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_automation_owner_scope",
        ),
        CheckConstraint(
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND owner_user_id IS NULL))",
            name="ck_automation_owner_fields",
        ),
        CheckConstraint(
            "target_mode IN ('local', 'personal_cloud', 'shared_cloud')",
            name="ck_automation_target_mode",
        ),
        CheckConstraint(
            "((owner_scope = 'personal' AND target_mode IN ('local', 'personal_cloud')) "
            "OR (owner_scope = 'organization' AND target_mode = 'shared_cloud'))",
            name="ck_automation_target_mode_owner",
        ),
        CheckConstraint(
            "length(schedule_timezone) > 0 AND schedule_timezone NOT LIKE '% %'",
            name="ck_automation_schedule_timezone_shape",
        ),
        Index("ix_automation_owner_user_id", "owner_user_id"),
        Index("ix_automation_organization_id", "organization_id"),
        Index("ix_automation_created_by_user_id", "created_by_user_id"),
        Index("ix_automation_cloud_repo_config_id", "cloud_repo_config_id"),
        Index("ix_automation_cloud_agent_run_config_id", "cloud_agent_run_config_id"),
        Index(
            "ix_automation_scheduler_due",
            "next_run_at",
            postgresql_where=text("enabled = true AND next_run_at IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_scope: Mapped[str] = mapped_column(String(32))
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=True,
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    cloud_repo_config_id: Mapped[uuid.UUID] = mapped_column(
        # Repo-config deletes must reject or explicitly clean up automations before deletion.
        ForeignKey("cloud_repo_config.id", ondelete="RESTRICT"),
        index=False,
    )
    title: Mapped[str] = mapped_column(String(255))
    prompt: Mapped[str] = mapped_column(Text)
    schedule_rrule: Mapped[str] = mapped_column(Text)
    # Trusted invariant: service validates this as an IANA timezone before write.
    schedule_timezone: Mapped[str] = mapped_column(String(64))
    schedule_summary: Mapped[str] = mapped_column(String(255))
    target_mode: Mapped[str] = mapped_column(String(32))
    cloud_agent_run_config_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_agent_run_config.id", ondelete="RESTRICT"),
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_scheduled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class AutomationRun(Base):
    __tablename__ = "automation_run"
    __table_args__ = (
        CheckConstraint(
            "trigger_kind IN ('scheduled', 'manual')",
            name="ck_automation_run_trigger_kind",
        ),
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_automation_run_owner_scope",
        ),
        CheckConstraint(
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND owner_user_id IS NULL))",
            name="ck_automation_run_owner_fields",
        ),
        CheckConstraint(
            "target_mode IN ('local', 'personal_cloud', 'shared_cloud')",
            name="ck_automation_run_target_mode",
        ),
        CheckConstraint(
            "status IN ("
            "'queued', "
            "'claimed', "
            "'creating_workspace', "
            "'provisioning_workspace', "
            "'creating_session', "
            "'dispatching', "
            "'dispatched', "
            "'failed', "
            "'cancelled'"
            ")",
            name="ck_automation_run_status",
        ),
        CheckConstraint(
            "("
            "trigger_kind = 'scheduled' AND scheduled_for IS NOT NULL"
            ") OR ("
            "trigger_kind = 'manual' AND scheduled_for IS NULL"
            ")",
            name="ck_automation_run_trigger_scheduled_for",
        ),
        Index("ix_automation_run_owner_user_id", "owner_user_id"),
        Index("ix_automation_run_organization_id", "organization_id"),
        Index("ix_automation_run_created_by_user_id", "created_by_user_id"),
        Index(
            "ix_automation_run_automation_created",
            "automation_id",
            "created_at",
        ),
        Index(
            "uq_automation_run_scheduled_slot",
            "automation_id",
            "scheduled_for",
            unique=True,
            postgresql_where=text("trigger_kind = 'scheduled'"),
        ),
        Index(
            "ix_automation_run_cloud_claimable",
            "created_at",
            postgresql_where=text(
                "target_mode IN ('personal_cloud', 'shared_cloud') "
                "AND status IN ("
                "'queued', "
                "'claimed', "
                "'creating_workspace', "
                "'provisioning_workspace', "
                "'creating_session'"
                ")"
            ),
        ),
        Index(
            "ix_automation_run_cloud_claim_expiry",
            "claim_expires_at",
            postgresql_where=text(
                "target_mode IN ('personal_cloud', 'shared_cloud') "
                "AND status IN ("
                "'claimed', "
                "'creating_workspace', "
                "'provisioning_workspace', "
                "'creating_session', "
                "'dispatching'"
                ") "
                "AND claim_expires_at IS NOT NULL"
            ),
        ),
        Index(
            "ix_automation_run_local_claimable",
            "owner_user_id",
            "git_provider_snapshot",
            "git_owner_snapshot",
            "git_repo_name_snapshot",
            "created_at",
            postgresql_where=text(
                "target_mode = 'local' "
                "AND status IN ("
                "'queued', "
                "'claimed', "
                "'creating_workspace', "
                "'provisioning_workspace', "
                "'creating_session'"
                ")"
            ),
        ),
        Index(
            "ix_automation_run_local_claim_expiry",
            "claim_expires_at",
            postgresql_where=text(
                "target_mode = 'local' "
                "AND status IN ("
                "'claimed', "
                "'creating_workspace', "
                "'provisioning_workspace', "
                "'creating_session', "
                "'dispatching'"
                ") "
                "AND claim_expires_at IS NOT NULL"
            ),
        ),
        Index(
            "ix_automation_run_dispatching_expiry",
            "claim_expires_at",
            postgresql_where=text("status = 'dispatching' AND claim_expires_at IS NOT NULL"),
        ),
        Index("ix_automation_run_cloud_workspace_id", "cloud_workspace_id"),
        Index("ix_automation_run_cloud_target_id_snapshot", "cloud_target_id_snapshot"),
        Index("ix_automation_run_sandbox_profile_id", "sandbox_profile_id"),
        Index("ix_automation_run_cloud_workspace_exposure_id", "cloud_workspace_exposure_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    automation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("automation.id", ondelete="CASCADE"),
    )
    owner_scope: Mapped[str] = mapped_column(String(32))
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=True,
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    trigger_kind: Mapped[str] = mapped_column(String(32))
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    target_mode: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32))
    title_snapshot: Mapped[str] = mapped_column(String(255))
    prompt_snapshot: Mapped[str] = mapped_column(Text)
    git_provider_snapshot: Mapped[str] = mapped_column(String(32))
    git_owner_snapshot: Mapped[str] = mapped_column(String(255))
    git_repo_name_snapshot: Mapped[str] = mapped_column(String(255))
    cloud_repo_config_id_snapshot: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_repo_config.id", ondelete="RESTRICT"),
    )
    cloud_target_id_snapshot: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="SET NULL"),
        nullable=True,
    )
    cloud_target_kind_snapshot: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sandbox_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sandbox_profile.id", ondelete="SET NULL"),
        nullable=True,
    )
    cloud_workspace_exposure_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workspace_exposure.id", ondelete="SET NULL"),
        nullable=True,
    )
    agent_run_config_snapshot_json: Mapped[dict[str, object] | None] = mapped_column(
        JSONB,
        nullable=True,
    )
    cascade_attempt: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    last_cascade_command_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    last_cascade_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    executor_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    executor_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    claim_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claim_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    cloud_workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="SET NULL"),
        nullable=True,
    )
    anyharness_workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    anyharness_session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dispatch_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
