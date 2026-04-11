"""cloud workspace mobility records

Revision ID: c9d8e7f6a5b4
Revises: b7e8f9a0c1d2
Create Date: 2026-04-11 10:15:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9d8e7f6a5b4"
down_revision: str | Sequence[str] | None = "b7e8f9a0c1d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "cloud_workspace_mobility",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("git_provider", sa.String(length=32), nullable=False),
        sa.Column("git_owner", sa.String(length=255), nullable=False),
        sa.Column("git_repo_name", sa.String(length=255), nullable=False),
        sa.Column("git_branch", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("owner", sa.String(length=32), nullable=False),
        sa.Column("lifecycle_state", sa.String(length=32), nullable=False),
        sa.Column("status_detail", sa.String(length=255), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("cloud_workspace_id", sa.Uuid(), nullable=True),
        sa.Column("last_handoff_op_id", sa.Uuid(), nullable=True),
        sa.Column("cloud_lost_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cloud_lost_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["cloud_workspace_id"],
            ["cloud_workspace.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "git_provider",
            "git_owner",
            "git_repo_name",
            "git_branch",
        ),
    )
    op.create_index(
        "ix_cloud_workspace_mobility_user_id",
        "cloud_workspace_mobility",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_cloud_workspace_mobility_cloud_workspace_id",
        "cloud_workspace_mobility",
        ["cloud_workspace_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        "ix_cloud_workspace_mobility_cloud_workspace_id",
        table_name="cloud_workspace_mobility",
    )
    op.drop_index("ix_cloud_workspace_mobility_user_id", table_name="cloud_workspace_mobility")
    op.drop_table("cloud_workspace_mobility")
