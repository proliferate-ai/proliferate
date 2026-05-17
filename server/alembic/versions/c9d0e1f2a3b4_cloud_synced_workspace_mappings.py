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


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=unique)


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def _drop_table_once(table_name: str) -> None:
    if _has_table(table_name):
        op.drop_table(table_name)


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("cloud_synced_workspaces"):
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
    _create_index_once(
        "ix_cloud_synced_workspaces_cloud_workspace",
        "cloud_synced_workspaces",
        ["cloud_workspace_id"],
    )
    _create_index_once(
        "ix_cloud_synced_workspaces_target_id",
        "cloud_synced_workspaces",
        ["target_id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    _drop_index_once("ix_cloud_synced_workspaces_target_id", "cloud_synced_workspaces")
    _drop_index_once(
        "ix_cloud_synced_workspaces_cloud_workspace",
        "cloud_synced_workspaces",
    )
    _drop_table_once("cloud_synced_workspaces")
