"""Cloud workspace ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudWorkspace(Base):
    __tablename__ = "cloud_workspace"
    __table_args__ = (
        Index(
            "ux_cloud_workspace_anyharness_workspace",
            "owner_user_id",
            "anyharness_workspace_id",
            unique=True,
            postgresql_where=text("archived_at IS NULL AND anyharness_workspace_id IS NOT NULL"),
        ),
        Index(
            "ix_cloud_workspace_repo_environment_id",
            "repo_environment_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    repo_environment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repo_environment.id", ondelete="RESTRICT"),
    )
    display_name: Mapped[str] = mapped_column(String(255))
    anyharness_workspace_id: Mapped[str] = mapped_column(String(255), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
