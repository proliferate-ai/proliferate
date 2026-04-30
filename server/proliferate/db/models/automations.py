"""Automation persistence models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class Automation(Base):
    __tablename__ = "automation"
    __table_args__ = (
        CheckConstraint(
            "execution_target IN ('cloud', 'local')",
            name="ck_automation_execution_target",
        ),
        CheckConstraint(
            "length(schedule_timezone) > 0 AND schedule_timezone NOT LIKE '% %'",
            name="ck_automation_schedule_timezone_shape",
        ),
        Index("ix_automation_user_id", "user_id"),
        Index("ix_automation_cloud_repo_config_id", "cloud_repo_config_id"),
        Index(
            "ix_automation_scheduler_due",
            "next_run_at",
            postgresql_where=text("enabled = true AND next_run_at IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=False)
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
    execution_target: Mapped[str] = mapped_column(String(32))
    agent_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mode_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reasoning_effort: Mapped[str | None] = mapped_column(String(64), nullable=True)
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
            "execution_target IN ('cloud', 'local')",
            name="ck_automation_run_execution_target",
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
        Index("ix_automation_run_user_id", "user_id"),
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
                "execution_target = 'cloud' "
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
                "execution_target = 'cloud' "
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
            "user_id",
            "git_provider_snapshot",
            "git_owner_snapshot",
            "git_repo_name_snapshot",
            "created_at",
            postgresql_where=text(
                "execution_target = 'local' "
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
                "execution_target = 'local' "
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
            postgresql_where=text(
                "status = 'dispatching' AND claim_expires_at IS NOT NULL"
            ),
        ),
        Index("ix_automation_run_cloud_workspace_id", "cloud_workspace_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    automation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("automation.id", ondelete="CASCADE"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(index=False)
    trigger_kind: Mapped[str] = mapped_column(String(32))
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    execution_target: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32))
    title_snapshot: Mapped[str] = mapped_column(String(255))
    prompt_snapshot: Mapped[str] = mapped_column(Text)
    git_provider_snapshot: Mapped[str] = mapped_column(String(32))
    git_owner_snapshot: Mapped[str] = mapped_column(String(255))
    git_repo_name_snapshot: Mapped[str] = mapped_column(String(255))
    cloud_repo_config_id_snapshot: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_repo_config.id", ondelete="RESTRICT"),
    )
    agent_kind_snapshot: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model_id_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mode_id_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reasoning_effort_snapshot: Mapped[str | None] = mapped_column(String(64), nullable=True)
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
