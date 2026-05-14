"""cloud synced workspace mappings

Revision ID: c9d0e1f2a3b4
Revises: c8d9e0f1a2b3
Create Date: 2026-05-14 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9d0e1f2a3b4"
down_revision: str | Sequence[str] | None = "c8d9e0f1a2b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "cloud_synced_workspaces",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("cloud_workspace_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["cloud_workspace_id"], ["cloud_workspace.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "target_id",
            "workspace_id",
            name="uq_cloud_synced_workspaces_target_workspace",
        ),
    )
    op.create_index(
        "ix_cloud_synced_workspaces_cloud_workspace",
        "cloud_synced_workspaces",
        ["cloud_workspace_id"],
        unique=False,
    )
    op.create_index(
        "ix_cloud_synced_workspaces_target_id",
        "cloud_synced_workspaces",
        ["target_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_cloud_synced_workspaces_target_id", table_name="cloud_synced_workspaces")
    op.drop_index(
        "ix_cloud_synced_workspaces_cloud_workspace",
        table_name="cloud_synced_workspaces",
    )
    op.drop_table("cloud_synced_workspaces")
