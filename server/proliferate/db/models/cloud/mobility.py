"""Cloud workspace mobility ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudWorkspaceMobility(Base):
    __tablename__ = "cloud_workspace_mobility"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "git_provider",
            "git_owner",
            "git_repo_name",
            "git_branch",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)

    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    git_provider: Mapped[str] = mapped_column(String(32))
    git_owner: Mapped[str] = mapped_column(String(255))
    git_repo_name: Mapped[str] = mapped_column(String(255))
    git_branch: Mapped[str] = mapped_column(String(255))

    owner: Mapped[str] = mapped_column(String(32))
    lifecycle_state: Mapped[str] = mapped_column(String(32))
    status_detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    cloud_workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    active_handoff_op_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    last_handoff_op_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    cloud_lost_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cloud_lost_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudWorkspaceHandoffOp(Base):
    __tablename__ = "cloud_workspace_handoff_op"
    __table_args__ = (
        CheckConstraint(
            "canonical_side IN ('source', 'destination')",
            name="ck_cloud_workspace_handoff_canonical_side",
        ),
        CheckConstraint(
            "canonical_side != 'destination' OR phase IN "
            "('cutover_committed', 'cleanup_pending', 'completed', "
            "'repair_required', 'cleanup_failed')",
            name="ck_cloud_workspace_handoff_destination_phase",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    mobility_workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_workspace_mobility.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)

    direction: Mapped[str] = mapped_column(String(32))
    source_owner: Mapped[str] = mapped_column(String(32))
    target_owner: Mapped[str] = mapped_column(String(32))
    phase: Mapped[str] = mapped_column(String(32))
    canonical_side: Mapped[str] = mapped_column(
        String(32),
        default="source",
        server_default=text("'source'"),
    )

    requested_branch: Mapped[str] = mapped_column(String(255))
    requested_base_sha: Mapped[str | None] = mapped_column(String(255), nullable=True)
    exclude_paths_json: Mapped[str] = mapped_column(Text, default="[]")
    failure_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    failure_detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cleanup_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudWorkspaceMoveCleanupItem(Base):
    __tablename__ = "cloud_workspace_move_cleanup_item"
    __table_args__ = (
        CheckConstraint(
            "item_kind IN ('anyharness_workspace', 'cloud_workspace', "
            "'cloud_exposure', 'cloud_session_projection', "
            "'cloud_transcript_projection', 'worker_projection_cursor')",
            name="ck_cloud_workspace_move_cleanup_item_kind",
        ),
        CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed', 'failed')",
            name="ck_cloud_workspace_move_cleanup_item_status",
        ),
        Index(
            "ix_cloud_workspace_move_cleanup_item_handoff_status",
            "handoff_op_id",
            "status",
        ),
        Index(
            "ix_cloud_workspace_move_cleanup_item_due",
            "next_attempt_at",
            postgresql_where=text("status IN ('pending', 'failed')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    handoff_op_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_workspace_handoff_op.id", ondelete="CASCADE"),
        index=True,
    )

    item_kind: Mapped[str] = mapped_column(String(64))
    target_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_targets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    anyharness_workspace_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    object_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)

    status: Mapped[str] = mapped_column(String(32), default="pending", server_default="pending")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
