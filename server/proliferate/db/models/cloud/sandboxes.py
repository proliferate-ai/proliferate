"""Cloud sandbox ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudSandbox(Base):
    __tablename__ = "cloud_sandbox"
    __table_args__ = (
        CheckConstraint(
            "lifecycle_on_timeout IN ('pause', 'kill')",
            name="ck_cloud_sandbox_lifecycle_on_timeout",
        ),
        CheckConstraint(
            "(sandbox_profile_id IS NULL AND target_id IS NULL AND slot_generation IS NULL) OR "
            "(sandbox_profile_id IS NOT NULL AND target_id IS NOT NULL "
            "AND billing_subject_id IS NOT NULL AND slot_generation IS NOT NULL)",
            name="ck_cloud_sandbox_managed_slot_identity",
        ),
        Index(
            "ux_cloud_sandbox_active_slot_per_profile_target",
            "sandbox_profile_id",
            "target_id",
            unique=True,
            postgresql_where=text(
                "superseded_at IS NULL "
                "AND status IN ('creating','running','paused','blocked')"
            ),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    runtime_environment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_runtime_environment.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    # Compatibility-only during migration away from workspace-owned sandboxes.
    cloud_workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    sandbox_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sandbox_profile.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    target_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    billing_subject_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("billing_subject.id", ondelete="RESTRICT"),
        index=True,
        nullable=True,
    )
    slot_generation: Mapped[int | None] = mapped_column(Integer, nullable=True)
    superseded_by_sandbox_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_sandbox.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    provider: Mapped[str] = mapped_column(String(32))
    external_sandbox_id: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(32))
    template_version: Mapped[str] = mapped_column(String(64))
    last_provider_event_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_provider_event_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    lifecycle_on_timeout: Mapped[str] = mapped_column(String(32), default="pause")
    lifecycle_auto_resume: Mapped[bool] = mapped_column(default=True)
    provider_timeout_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    blocked_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
