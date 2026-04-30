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
            # V1 queue states only; widen this constraint when executor states land.
            "status IN ('queued', 'cancelled')",
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
    # Reserved for executor PRs that introduce cancellation/error writers.
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
