"""reintroduce cloud workspace mobility

Revision ID: f4e5d6c7b8a9
Revises: e1f2d3c4b5a6
Create Date: 2026-04-11 21:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f4e5d6c7b8a9"
down_revision: str | Sequence[str] | None = "e1f2d3c4b5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "cloud_workspace_mobility",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("git_provider", sa.String(length=32), nullable=False),
        sa.Column("git_owner", sa.String(length=255), nullable=False),
        sa.Column("git_repo_name", sa.String(length=255), nullable=False),
        sa.Column("git_branch", sa.String(length=255), nullable=False),
        sa.Column("owner", sa.String(length=32), nullable=False),
        sa.Column("lifecycle_state", sa.String(length=32), nullable=False),
        sa.Column("status_detail", sa.String(length=255), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("cloud_workspace_id", sa.Uuid(), nullable=True),
        sa.Column("active_handoff_op_id", sa.Uuid(), nullable=True),
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

    op.create_table(
        "cloud_workspace_handoff_op",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mobility_workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("direction", sa.String(length=32), nullable=False),
        sa.Column("source_owner", sa.String(length=32), nullable=False),
        sa.Column("target_owner", sa.String(length=32), nullable=False),
        sa.Column("phase", sa.String(length=32), nullable=False),
        sa.Column("requested_branch", sa.String(length=255), nullable=False),
        sa.Column("requested_base_sha", sa.String(length=255), nullable=True),
        sa.Column("exclude_paths_json", sa.Text(), nullable=False),
        sa.Column("failure_code", sa.String(length=64), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cleanup_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["mobility_workspace_id"],
            ["cloud_workspace_mobility.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_cloud_workspace_handoff_op_mobility_workspace_id",
        "cloud_workspace_handoff_op",
        ["mobility_workspace_id"],
        unique=False,
    )
    op.create_index(
        "ix_cloud_workspace_handoff_op_user_id",
        "cloud_workspace_handoff_op",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        "ix_cloud_workspace_handoff_op_user_id",
        table_name="cloud_workspace_handoff_op",
    )
    op.drop_index(
        "ix_cloud_workspace_handoff_op_mobility_workspace_id",
        table_name="cloud_workspace_handoff_op",
    )
    op.drop_table("cloud_workspace_handoff_op")
    op.drop_index(
        "ix_cloud_workspace_mobility_cloud_workspace_id",
        table_name="cloud_workspace_mobility",
    )
    op.drop_index(
        "ix_cloud_workspace_mobility_user_id",
        table_name="cloud_workspace_mobility",
    )
    op.drop_table("cloud_workspace_mobility")
