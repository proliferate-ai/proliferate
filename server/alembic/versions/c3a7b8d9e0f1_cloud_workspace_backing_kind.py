"""cloud workspace backing kind (repository_worktree | scratch)

Revision ID: c3a7b8d9e0f1
Revises: 6f545e279264
Create Date: 2026-07-15 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "c3a7b8d9e0f1"
down_revision = "6f545e279264"
branch_labels = None
depends_on = None

_BRANCH_INDEX = "ux_cloud_workspace_active_repo_environment_branch"


def upgrade() -> None:
    # Generalize the lightweight cloud workspace row with a placement-neutral
    # backing kind. Every existing row is a repository worktree; the NOT NULL
    # server default backfills them.
    op.add_column(
        "cloud_workspace",
        sa.Column(
            "workspace_kind",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'repository_worktree'"),
        ),
    )

    # Scratch workspaces have no repository backing.
    op.alter_column(
        "cloud_workspace",
        "repo_environment_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )

    op.create_check_constraint(
        "ck_cloud_workspace_kind",
        "cloud_workspace",
        "workspace_kind IN ('repository_worktree', 'scratch')",
    )
    op.create_check_constraint(
        "ck_cloud_workspace_kind_repo_environment",
        "cloud_workspace",
        "(workspace_kind = 'repository_worktree' AND repo_environment_id IS NOT NULL) "
        "OR (workspace_kind = 'scratch' AND repo_environment_id IS NULL)",
    )

    # Repository branch uniqueness applies only to repository worktrees.
    op.drop_index(_BRANCH_INDEX, table_name="cloud_workspace")
    op.create_index(
        _BRANCH_INDEX,
        "cloud_workspace",
        ["owner_user_id", "repo_environment_id", "git_branch"],
        unique=True,
        postgresql_where=sa.text("archived_at IS NULL AND workspace_kind = 'repository_worktree'"),
    )


def downgrade() -> None:
    op.drop_index(_BRANCH_INDEX, table_name="cloud_workspace")
    op.create_index(
        _BRANCH_INDEX,
        "cloud_workspace",
        ["owner_user_id", "repo_environment_id", "git_branch"],
        unique=True,
        postgresql_where=sa.text("archived_at IS NULL"),
    )

    op.drop_constraint(
        "ck_cloud_workspace_kind_repo_environment",
        "cloud_workspace",
        type_="check",
    )
    op.drop_constraint("ck_cloud_workspace_kind", "cloud_workspace", type_="check")

    op.alter_column(
        "cloud_workspace",
        "repo_environment_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
    op.drop_column("cloud_workspace", "workspace_kind")
