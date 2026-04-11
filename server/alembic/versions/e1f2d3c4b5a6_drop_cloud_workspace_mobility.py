"""drop cloud workspace mobility

Revision ID: e1f2d3c4b5a6
Revises: c9d8e7f6a5b4
Create Date: 2026-04-11 18:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1f2d3c4b5a6"
down_revision: str | Sequence[str] | None = "c9d8e7f6a5b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in set(inspector.get_table_names())


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    """Upgrade schema."""
    if _has_table("cloud_workspace_handoff_op"):
        if _has_index(
            "cloud_workspace_handoff_op",
            "ix_cloud_workspace_handoff_op_user_id",
        ):
            op.drop_index(
                "ix_cloud_workspace_handoff_op_user_id",
                table_name="cloud_workspace_handoff_op",
            )
        if _has_index(
            "cloud_workspace_handoff_op",
            "ix_cloud_workspace_handoff_op_mobility_workspace_id",
        ):
            op.drop_index(
                "ix_cloud_workspace_handoff_op_mobility_workspace_id",
                table_name="cloud_workspace_handoff_op",
            )
        op.drop_table("cloud_workspace_handoff_op")

    if not _has_table("cloud_workspace_mobility"):
        return

    op.drop_index(
        "ix_cloud_workspace_mobility_cloud_workspace_id",
        table_name="cloud_workspace_mobility",
    )
    op.drop_index("ix_cloud_workspace_mobility_user_id", table_name="cloud_workspace_mobility")
    op.drop_table("cloud_workspace_mobility")


def downgrade() -> None:
    """Downgrade schema."""
    if _has_table("cloud_workspace_mobility"):
        return

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
