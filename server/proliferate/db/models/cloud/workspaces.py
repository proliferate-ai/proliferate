"""Cloud workspace ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow

# Placement-neutral backing kind for a lightweight cloud workspace row. A
# ``repository_worktree`` is bound to a real cloud repo environment and keeps the
# existing repository/branch behavior; a ``scratch`` workspace has no repository
# backing (managed Workflow runs), so it forbids a ``repo_environment_id``.
CLOUD_WORKSPACE_REPOSITORY_WORKTREE = "repository_worktree"
CLOUD_WORKSPACE_SCRATCH = "scratch"


class CloudWorkspace(Base):
    __tablename__ = "cloud_workspace"
    __table_args__ = (
        CheckConstraint(
            "workspace_kind IN ('repository_worktree', 'scratch')",
            name="ck_cloud_workspace_kind",
        ),
        # Repository worktrees require a real repo environment; scratch
        # workspaces forbid one (their API repo/repoEnvironmentId are null).
        CheckConstraint(
            "(workspace_kind = 'repository_worktree' AND repo_environment_id IS NOT NULL) "
            "OR (workspace_kind = 'scratch' AND repo_environment_id IS NULL)",
            name="ck_cloud_workspace_kind_repo_environment",
        ),
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
        # Repository branch uniqueness applies only to repository worktrees.
        Index(
            "ux_cloud_workspace_active_repo_environment_branch",
            "owner_user_id",
            "repo_environment_id",
            "git_branch",
            unique=True,
            postgresql_where=text(
                "archived_at IS NULL AND workspace_kind = 'repository_worktree'"
            ),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    workspace_kind: Mapped[str] = mapped_column(
        String(32),
        server_default=text("'repository_worktree'"),
        default=CLOUD_WORKSPACE_REPOSITORY_WORKTREE,
    )
    repo_environment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("repo_environment.id", ondelete="RESTRICT"),
        nullable=True,
    )
    display_name: Mapped[str] = mapped_column(String(255))
    git_branch: Mapped[str] = mapped_column(String(255))
    git_base_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    anyharness_workspace_id: Mapped[str | None] = mapped_column(
        String(255),
        index=True,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
