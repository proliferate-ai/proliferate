"""cloud MCP connections and workspace data key

Revision ID: b7e8f9a0c1d2
Revises: a1b2c3d4e5f6
Create Date: 2026-04-10 11:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7e8f9a0c1d2"
down_revision: str | Sequence[str] | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_column("cloud_workspace", "anyharness_data_key_ciphertext"):
        op.add_column(
            "cloud_workspace",
            sa.Column("anyharness_data_key_ciphertext", sa.Text(), nullable=True),
        )

    op.create_table(
        "cloud_mcp_connection",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("connection_id", sa.String(length=255), nullable=False),
        sa.Column("catalog_entry_id", sa.String(length=255), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.Column("payload_format", sa.String(length=32), nullable=False, server_default="json-v1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "connection_id"),
    )
    op.create_index(
        "ix_cloud_mcp_connection_user_id",
        "cloud_mcp_connection",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_cloud_mcp_connection_user_id", table_name="cloud_mcp_connection")
    op.drop_table("cloud_mcp_connection")
    if _has_column("cloud_workspace", "anyharness_data_key_ciphertext"):
        op.drop_column("cloud_workspace", "anyharness_data_key_ciphertext")
