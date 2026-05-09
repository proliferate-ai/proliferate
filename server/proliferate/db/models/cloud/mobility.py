"""Cloud workspace mobility ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
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
