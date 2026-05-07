"""custom MCP definitions

Revision ID: c3d4e5f6a7b8
Revises: b1c2d3e4f5a6
Create Date: 2026-05-03 05:40:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6a7b8"
down_revision: str | Sequence[str] | None = "b1c2d3e4f5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _has_check_constraint(table_name: str, constraint_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return constraint_name in {
        constraint["name"] for constraint in inspector.get_check_constraints(table_name)
    }


def _has_foreign_key(table_name: str, constraint_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return constraint_name in {
        constraint["name"] for constraint in inspector.get_foreign_keys(table_name)
    }


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("cloud_mcp_custom_definition"):
        op.create_table(
            "cloud_mcp_custom_definition",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("definition_id", sa.String(length=255), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("transport", sa.String(length=32), nullable=False),
            sa.Column("auth_kind", sa.String(length=32), nullable=False),
            sa.Column("availability", sa.String(length=32), nullable=False),
            sa.Column("template_json", sa.Text(), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "user_id IS NOT NULL",
                name="ck_cloud_mcp_custom_definition_v1_user_id",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "definition_id"),
        )
    for index_name, columns in (
        ("ix_cloud_mcp_custom_definition_user_id", ["user_id"]),
    ):
        if not _has_index("cloud_mcp_custom_definition", index_name):
            op.create_index(index_name, "cloud_mcp_custom_definition", columns, unique=False)

    if not _has_column("cloud_mcp_connection", "custom_definition_id"):
        op.add_column(
            "cloud_mcp_connection",
            sa.Column("custom_definition_id", sa.Uuid(), nullable=True),
        )
    if not _has_index("cloud_mcp_connection", "ix_cloud_mcp_connection_custom_definition_id"):
        op.create_index(
            "ix_cloud_mcp_connection_custom_definition_id",
            "cloud_mcp_connection",
            ["custom_definition_id"],
            unique=False,
        )
    if not _has_foreign_key(
        "cloud_mcp_connection",
        "fk_cloud_mcp_connection_custom_definition_id",
    ):
        op.create_foreign_key(
            "fk_cloud_mcp_connection_custom_definition_id",
            "cloud_mcp_connection",
            "cloud_mcp_custom_definition",
            ["custom_definition_id"],
            ["id"],
            ondelete="RESTRICT",
        )
    op.alter_column("cloud_mcp_connection", "catalog_entry_id", nullable=True)
    if not _has_check_constraint(
        "cloud_mcp_connection",
        "ck_cloud_mcp_connection_v1_exactly_one_target",
    ):
        op.create_check_constraint(
            "ck_cloud_mcp_connection_v1_exactly_one_target",
            "cloud_mcp_connection",
            "(catalog_entry_id IS NOT NULL AND custom_definition_id IS NULL) "
            "OR (catalog_entry_id IS NULL AND custom_definition_id IS NOT NULL)",
        )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_check_constraint(
        "cloud_mcp_connection",
        "ck_cloud_mcp_connection_v1_exactly_one_target",
    ):
        op.drop_constraint(
            "ck_cloud_mcp_connection_v1_exactly_one_target",
            "cloud_mcp_connection",
            type_="check",
        )
    op.alter_column("cloud_mcp_connection", "catalog_entry_id", nullable=False)
    if _has_foreign_key(
        "cloud_mcp_connection",
        "fk_cloud_mcp_connection_custom_definition_id",
    ):
        op.drop_constraint(
            "fk_cloud_mcp_connection_custom_definition_id",
            "cloud_mcp_connection",
            type_="foreignkey",
        )
    if _has_index("cloud_mcp_connection", "ix_cloud_mcp_connection_custom_definition_id"):
        op.drop_index(
            "ix_cloud_mcp_connection_custom_definition_id",
            table_name="cloud_mcp_connection",
        )
    if _has_column("cloud_mcp_connection", "custom_definition_id"):
        op.drop_column("cloud_mcp_connection", "custom_definition_id")
    if _has_table("cloud_mcp_custom_definition"):
        op.drop_index(
            "ix_cloud_mcp_custom_definition_user_id",
            table_name="cloud_mcp_custom_definition",
        )
        op.drop_table("cloud_mcp_custom_definition")
