"""Cloud worktree policy ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudWorktreeRetentionPolicy(Base):
    __tablename__ = "cloud_worktree_retention_policy"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_cloud_worktree_retention_policy_user_id"),
        CheckConstraint(
            "max_materialized_worktrees_per_repo >= 10 "
            "AND max_materialized_worktrees_per_repo <= 100",
            name="ck_cloud_worktree_retention_policy_limit",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    max_materialized_worktrees_per_repo: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
