"""cloud worktree retention policy

Revision ID: c3d4e5f6a7b8
Revises: b1c2d3e4f5a6
Create Date: 2026-05-04 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6a7b8"
down_revision: str | Sequence[str] | None = "b1c2d3e4f5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    return bool(
        bind.execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = current_schema() AND table_name = :table_name)"
            ),
            {"table_name": table_name},
        ).scalar()
    )


def _has_index(index_name: str) -> bool:
    bind = op.get_bind()
    return bool(
        bind.execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM pg_indexes "
                "WHERE schemaname = current_schema() AND indexname = :index_name)"
            ),
            {"index_name": index_name},
        ).scalar()
    )


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("cloud_worktree_retention_policy"):
        op.create_table(
            "cloud_worktree_retention_policy",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("max_materialized_worktrees_per_repo", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "max_materialized_worktrees_per_repo >= 10 "
                "AND max_materialized_worktrees_per_repo <= 100",
                name="ck_cloud_worktree_retention_policy_limit",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", name="uq_cloud_worktree_retention_policy_user_id"),
        )
    if not _has_index(op.f("ix_cloud_worktree_retention_policy_user_id")):
        op.create_index(
            op.f("ix_cloud_worktree_retention_policy_user_id"),
            "cloud_worktree_retention_policy",
            ["user_id"],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        op.f("ix_cloud_worktree_retention_policy_user_id"),
        table_name="cloud_worktree_retention_policy",
    )
    op.drop_table("cloud_worktree_retention_policy")
