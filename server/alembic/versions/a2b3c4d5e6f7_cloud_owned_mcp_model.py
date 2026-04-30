"""cloud-owned MCP model

Revision ID: a2b3c4d5e6f7
Revises: 9a0b1c2d3e4f
Create Date: 2026-04-20 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a2b3c4d5e6f7"
down_revision: str | Sequence[str] | None = "9a0b1c2d3e4f"
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


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_column("cloud_mcp_connection", "org_id"):
        op.add_column("cloud_mcp_connection", sa.Column("org_id", sa.Uuid(), nullable=True))
    if not _has_index("cloud_mcp_connection", "ix_cloud_mcp_connection_org_id"):
        op.create_index(
            "ix_cloud_mcp_connection_org_id",
            "cloud_mcp_connection",
            ["org_id"],
            unique=False,
        )
    if not _has_column("cloud_mcp_connection", "catalog_entry_version"):
        op.add_column(
            "cloud_mcp_connection",
            sa.Column("catalog_entry_version", sa.Integer(), nullable=False, server_default="1"),
        )
    if not _has_column("cloud_mcp_connection", "server_name"):
        op.add_column(
            "cloud_mcp_connection",
            sa.Column("server_name", sa.String(length=255), nullable=False, server_default=""),
        )
    if not _has_column("cloud_mcp_connection", "enabled"):
        op.add_column(
            "cloud_mcp_connection",
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        )
    if not _has_column("cloud_mcp_connection", "settings_json"):
        op.add_column(
            "cloud_mcp_connection",
            sa.Column("settings_json", sa.Text(), nullable=False, server_default="{}"),
        )
    if not _has_column("cloud_mcp_connection", "config_version"):
        op.add_column(
            "cloud_mcp_connection",
            sa.Column("config_version", sa.Integer(), nullable=False, server_default="1"),
        )

    op.alter_column("cloud_mcp_connection", "payload_ciphertext", nullable=True)
    if not _has_check_constraint(
        "cloud_mcp_connection",
        "ck_cloud_mcp_connection_v1_user_id",
    ):
        op.create_check_constraint(
            "ck_cloud_mcp_connection_v1_user_id",
            "cloud_mcp_connection",
            "user_id IS NOT NULL",
        )
    if not _has_check_constraint(
        "cloud_mcp_connection",
        "ck_cloud_mcp_connection_v1_org_id_null",
    ):
        op.create_check_constraint(
            "ck_cloud_mcp_connection_v1_org_id_null",
            "cloud_mcp_connection",
            "org_id IS NULL",
        )

    if not _has_table("cloud_mcp_connection_auth"):
        op.create_table(
            "cloud_mcp_connection_auth",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("connection_db_id", sa.Uuid(), nullable=False),
            sa.Column("auth_kind", sa.String(length=32), nullable=False),
            sa.Column("auth_status", sa.String(length=32), nullable=False),
            sa.Column("payload_ciphertext", sa.Text(), nullable=True),
            sa.Column(
                "payload_format",
                sa.String(length=64),
                nullable=False,
                server_default="json-v1",
            ),
            sa.Column("auth_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error_code", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["connection_db_id"],
                ["cloud_mcp_connection.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("connection_db_id"),
        )
    if not _has_index(
        "cloud_mcp_connection_auth",
        "ix_cloud_mcp_connection_auth_connection_db_id",
    ):
        op.create_index(
            "ix_cloud_mcp_connection_auth_connection_db_id",
            "cloud_mcp_connection_auth",
            ["connection_db_id"],
            unique=False,
        )

    if not _has_table("cloud_mcp_oauth_flow"):
        op.create_table(
            "cloud_mcp_oauth_flow",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("connection_db_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("state_hash", sa.String(length=128), nullable=False),
            sa.Column("code_verifier_ciphertext", sa.Text(), nullable=False),
            sa.Column("issuer", sa.Text(), nullable=True),
            sa.Column("resource", sa.Text(), nullable=True),
            sa.Column("client_id", sa.String(length=512), nullable=False),
            sa.Column("token_endpoint", sa.Text(), nullable=True),
            sa.Column("requested_scopes", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("redirect_uri", sa.Text(), nullable=False),
            sa.Column("authorization_url", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("failure_code", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["connection_db_id"],
                ["cloud_mcp_connection.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    for index_name, columns in (
        ("ix_cloud_mcp_oauth_flow_connection_db_id", ["connection_db_id"]),
        ("ix_cloud_mcp_oauth_flow_expires_at", ["expires_at"]),
        ("ix_cloud_mcp_oauth_flow_state_hash", ["state_hash"]),
        ("ix_cloud_mcp_oauth_flow_user_id", ["user_id"]),
    ):
        if not _has_index("cloud_mcp_oauth_flow", index_name):
            op.create_index(index_name, "cloud_mcp_oauth_flow", columns, unique=False)

    if not _has_table("cloud_mcp_oauth_client"):
        op.create_table(
            "cloud_mcp_oauth_client",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("issuer", sa.Text(), nullable=False),
            sa.Column("redirect_uri", sa.Text(), nullable=False),
            sa.Column("catalog_entry_id", sa.String(length=255), nullable=False),
            sa.Column("resource", sa.Text(), nullable=True),
            sa.Column("client_id", sa.String(length=512), nullable=False),
            sa.Column("client_secret_ciphertext", sa.Text(), nullable=True),
            sa.Column("client_secret_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("token_endpoint_auth_method", sa.String(length=128), nullable=True),
            sa.Column("registration_client_uri", sa.Text(), nullable=True),
            sa.Column("registration_access_token_ciphertext", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("issuer", "redirect_uri", "catalog_entry_id"),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("cloud_mcp_oauth_client")
    op.drop_index("ix_cloud_mcp_oauth_flow_user_id", table_name="cloud_mcp_oauth_flow")
    op.drop_index("ix_cloud_mcp_oauth_flow_state_hash", table_name="cloud_mcp_oauth_flow")
    op.drop_index("ix_cloud_mcp_oauth_flow_expires_at", table_name="cloud_mcp_oauth_flow")
    op.drop_index("ix_cloud_mcp_oauth_flow_connection_db_id", table_name="cloud_mcp_oauth_flow")
    op.drop_table("cloud_mcp_oauth_flow")
    op.drop_index(
        "ix_cloud_mcp_connection_auth_connection_db_id",
        table_name="cloud_mcp_connection_auth",
    )
    op.drop_table("cloud_mcp_connection_auth")
    op.drop_constraint(
        "ck_cloud_mcp_connection_v1_org_id_null",
        "cloud_mcp_connection",
        type_="check",
    )
    op.drop_constraint(
        "ck_cloud_mcp_connection_v1_user_id",
        "cloud_mcp_connection",
        type_="check",
    )
    op.alter_column("cloud_mcp_connection", "payload_ciphertext", nullable=False)
    for column_name in (
        "config_version",
        "settings_json",
        "enabled",
        "server_name",
        "catalog_entry_version",
    ):
        if _has_column("cloud_mcp_connection", column_name):
            op.drop_column("cloud_mcp_connection", column_name)
    if _has_column("cloud_mcp_connection", "org_id"):
        op.drop_index("ix_cloud_mcp_connection_org_id", table_name="cloud_mcp_connection")
        op.drop_column("cloud_mcp_connection", "org_id")
