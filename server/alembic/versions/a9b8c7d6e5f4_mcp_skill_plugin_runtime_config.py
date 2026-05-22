"""MCP skills plugins runtime config.

Revision ID: a9b8c7d6e5f4
Revises: f0a1b2c3d4e5
Create Date: 2026-05-20 13:30:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "a9b8c7d6e5f4"
down_revision: str | None = "f0a1b2c3d4e5"
branch_labels: str | None = None
depends_on: str | None = None

_PUBLIC_STATUSES = ("private", "public", "blocked", "stale", "revoked")


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)
    }


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {
        index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name)
    }


def _has_constraint(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    names = {constraint["name"] for constraint in inspector.get_check_constraints(table_name)}
    names.update(constraint["name"] for constraint in inspector.get_foreign_keys(table_name))
    names.update(constraint["name"] for constraint in inspector.get_unique_constraints(table_name))
    return constraint_name in names


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def _drop_constraint_once(table_name: str, constraint_name: str, type_: str) -> None:
    if _has_constraint(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_=type_)


def _add_column_once(table_name: str, column: sa.Column) -> None:
    if not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _drop_column_once(table_name: str, column_name: str) -> None:
    if _has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
    postgresql_where: sa.TextClause | None = None,
) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(
            index_name,
            table_name,
            columns,
            unique=unique,
            postgresql_where=postgresql_where,
        )


def _create_fk_once(
    constraint_name: str,
    table_name: str,
    referent_table: str,
    local_cols: list[str],
    remote_cols: list[str],
    *,
    ondelete: str,
) -> None:
    if not _has_constraint(table_name, constraint_name):
        op.create_foreign_key(
            constraint_name,
            table_name,
            referent_table,
            local_cols,
            remote_cols,
            ondelete=ondelete,
        )


def _in_constraint(column_name: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column_name} IN ({quoted})"


def upgrade() -> None:
    _upgrade_mcp_connection()
    _create_skill_configured_items()
    _create_plugin_configured_items()
    _create_runtime_config_tables()


def downgrade() -> None:
    raise RuntimeError(
        "Downgrade for MCP skills plugins runtime config is unsupported; restore from "
        "backup or migrate forward."
    )


def _upgrade_mcp_connection() -> None:
    _drop_constraint_once(
        "cloud_mcp_connection",
        "ck_cloud_mcp_connection_v1_user_id",
        "check",
    )
    _drop_constraint_once(
        "cloud_mcp_connection",
        "ck_cloud_mcp_connection_v1_org_id_null",
        "check",
    )
    _drop_constraint_once(
        "cloud_mcp_connection",
        "cloud_mcp_connection_user_id_connection_id_key",
        "unique",
    )
    _drop_index_once("ix_cloud_mcp_connection_user_id", "cloud_mcp_connection")
    _drop_index_once("ix_cloud_mcp_connection_org_id", "cloud_mcp_connection")

    if _has_column("cloud_mcp_connection", "user_id") and not _has_column(
        "cloud_mcp_connection",
        "owner_user_id",
    ):
        op.alter_column("cloud_mcp_connection", "user_id", new_column_name="owner_user_id")
    if _has_column("cloud_mcp_connection", "org_id") and not _has_column(
        "cloud_mcp_connection",
        "organization_id",
    ):
        op.alter_column("cloud_mcp_connection", "org_id", new_column_name="organization_id")

    _add_column_once(
        "cloud_mcp_connection",
        sa.Column("owner_scope", sa.String(length=32), nullable=True),
    )
    _add_column_once(
        "cloud_mcp_connection",
        sa.Column(
            "public_to_org",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    _add_column_once(
        "cloud_mcp_connection",
        sa.Column("public_organization_id", sa.Uuid(), nullable=True),
    )
    _add_column_once(
        "cloud_mcp_connection",
        sa.Column(
            "public_status",
            sa.String(length=32),
            nullable=False,
            server_default="private",
        ),
    )
    _add_column_once(
        "cloud_mcp_connection",
        sa.Column("public_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column_once(
        "cloud_mcp_connection",
        sa.Column("public_updated_by_user_id", sa.Uuid(), nullable=True),
    )

    op.execute(
        "UPDATE cloud_mcp_connection SET owner_scope = 'personal' WHERE owner_scope IS NULL"
    )
    op.alter_column("cloud_mcp_connection", "owner_scope", nullable=False)
    op.alter_column("cloud_mcp_connection", "owner_user_id", nullable=True)
    op.alter_column("cloud_mcp_connection", "organization_id", nullable=True)

    _create_fk_once(
        "cloud_mcp_connection_owner_user_id_fkey",
        "cloud_mcp_connection",
        "user",
        ["owner_user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    _create_fk_once(
        "cloud_mcp_connection_organization_id_fkey",
        "cloud_mcp_connection",
        "organization",
        ["organization_id"],
        ["id"],
        ondelete="CASCADE",
    )
    _create_fk_once(
        "cloud_mcp_connection_public_organization_id_fkey",
        "cloud_mcp_connection",
        "organization",
        ["public_organization_id"],
        ["id"],
        ondelete="SET NULL",
    )
    _create_fk_once(
        "cloud_mcp_connection_public_updated_by_user_id_fkey",
        "cloud_mcp_connection",
        "user",
        ["public_updated_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    _drop_constraint_once(
        "cloud_mcp_connection",
        "ck_cloud_mcp_connection_owner_fields",
        "check",
    )
    op.create_check_constraint(
        "ck_cloud_mcp_connection_owner_fields",
        "cloud_mcp_connection",
        "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
        "AND organization_id IS NULL) OR "
        "(owner_scope = 'organization' AND organization_id IS NOT NULL "
        "AND owner_user_id IS NULL))",
    )
    _drop_constraint_once("cloud_mcp_connection", "ck_cloud_mcp_connection_public", "check")
    op.create_check_constraint(
        "ck_cloud_mcp_connection_public",
        "cloud_mcp_connection",
        "((public_to_org = false AND public_organization_id IS NULL) OR "
        "(public_to_org = true AND public_organization_id IS NOT NULL))",
    )
    _drop_constraint_once(
        "cloud_mcp_connection",
        "ck_cloud_mcp_connection_owner_scope",
        "check",
    )
    op.create_check_constraint(
        "ck_cloud_mcp_connection_owner_scope",
        "cloud_mcp_connection",
        "owner_scope IN ('personal', 'organization')",
    )
    _drop_constraint_once(
        "cloud_mcp_connection",
        "ck_cloud_mcp_connection_public_status",
        "check",
    )
    op.create_check_constraint(
        "ck_cloud_mcp_connection_public_status",
        "cloud_mcp_connection",
        _in_constraint("public_status", _PUBLIC_STATUSES),
    )
    _create_index_once(
        "ix_cloud_mcp_connection_owner_user_id",
        "cloud_mcp_connection",
        ["owner_user_id"],
    )
    _create_index_once(
        "ix_cloud_mcp_connection_organization_id",
        "cloud_mcp_connection",
        ["organization_id"],
    )
    _create_index_once(
        "ix_cloud_mcp_connection_public_organization_id",
        "cloud_mcp_connection",
        ["public_organization_id"],
    )
    _create_index_once(
        "uq_cloud_mcp_connection_personal_connection_id",
        "cloud_mcp_connection",
        ["owner_user_id", "connection_id"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'personal'"),
    )
    _create_index_once(
        "uq_cloud_mcp_connection_organization_connection_id",
        "cloud_mcp_connection",
        ["organization_id", "connection_id"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'organization'"),
    )
    if _has_column("cloud_mcp_connection", "payload_ciphertext") and _has_column(
        "cloud_mcp_connection",
        "payload_format",
    ):
        op.execute(
            """
            INSERT INTO cloud_mcp_connection_auth (
                id,
                connection_db_id,
                auth_kind,
                auth_status,
                payload_ciphertext,
                payload_format,
                auth_version,
                token_expires_at,
                last_error_code,
                created_at,
                updated_at
            )
            SELECT
                gen_random_uuid(),
                connection.id,
                'secret',
                'ready',
                connection.payload_ciphertext,
                connection.payload_format,
                1,
                NULL,
                NULL,
                now(),
                now()
            FROM cloud_mcp_connection AS connection
            WHERE connection.payload_ciphertext IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM cloud_mcp_connection_auth AS auth
                  WHERE auth.connection_db_id = connection.id
              )
            """
        )
    _drop_column_once("cloud_mcp_connection", "payload_ciphertext")
    _drop_column_once("cloud_mcp_connection", "payload_format")


def _owner_public_columns() -> list[sa.Column]:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_scope", sa.String(length=32), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "public_to_org",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("public_organization_id", sa.Uuid(), nullable=True),
        sa.Column(
            "public_status",
            sa.String(length=32),
            nullable=False,
            server_default="private",
        ),
        sa.Column("public_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("public_updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("config_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    ]


def _owner_public_constraints(prefix: str) -> list[sa.Constraint]:
    return [
        sa.CheckConstraint(
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND owner_user_id IS NULL))",
            name=f"ck_{prefix}_owner_fields",
        ),
        sa.CheckConstraint(
            "((public_to_org = false AND public_organization_id IS NULL) OR "
            "(public_to_org = true AND public_organization_id IS NOT NULL))",
            name=f"ck_{prefix}_public",
        ),
        sa.CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name=f"ck_{prefix}_owner_scope",
        ),
        sa.CheckConstraint(
            _in_constraint("public_status", _PUBLIC_STATUSES),
            name=f"ck_{prefix}_public_status",
        ),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["public_organization_id"],
            ["organization.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["public_updated_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    ]


def _create_skill_configured_items() -> None:
    if not _has_table("cloud_skill_configured_item"):
        op.create_table(
            "cloud_skill_configured_item",
            *_owner_public_columns(),
            sa.Column("skill_source_kind", sa.String(length=32), nullable=False),
            sa.Column("skill_id", sa.String(length=255), nullable=False),
            sa.Column("skill_version", sa.String(length=128), nullable=True),
            sa.Column(
                "plugin_id",
                sa.String(length=255),
                nullable=False,
                server_default="",
            ),
            sa.Column("plugin_version", sa.String(length=128), nullable=True),
            sa.Column("user_skill_payload_ref", sa.Text(), nullable=True),
            sa.Column("source_snapshot_json", sa.Text(), nullable=True),
            sa.CheckConstraint(
                "skill_source_kind IN ('catalog', 'plugin', 'user')",
                name="ck_skill_configured_source_kind",
            ),
            *_owner_public_constraints("skill_configured"),
        )
    _create_index_once(
        "uq_skill_configured_personal_source_skill_plugin",
        "cloud_skill_configured_item",
        ["owner_user_id", "skill_source_kind", "skill_id", "plugin_id"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'personal'"),
    )
    _create_index_once(
        "uq_skill_configured_org_source_skill_plugin",
        "cloud_skill_configured_item",
        ["organization_id", "skill_source_kind", "skill_id", "plugin_id"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'organization'"),
    )


def _create_plugin_configured_items() -> None:
    if not _has_table("cloud_plugin_configured_item"):
        op.create_table(
            "cloud_plugin_configured_item",
            *_owner_public_columns(),
            sa.Column("plugin_id", sa.String(length=255), nullable=False),
            sa.Column("plugin_version", sa.String(length=128), nullable=True),
            *_owner_public_constraints("plugin_configured"),
        )
    _create_index_once(
        "uq_plugin_configured_personal_plugin",
        "cloud_plugin_configured_item",
        ["owner_user_id", "plugin_id"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'personal'"),
    )
    _create_index_once(
        "uq_plugin_configured_org_plugin",
        "cloud_plugin_configured_item",
        ["organization_id", "plugin_id"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'organization'"),
    )


def _create_runtime_config_tables() -> None:
    if not _has_table("sandbox_profile_runtime_config_revision"):
        op.create_table(
            "sandbox_profile_runtime_config_revision",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("sandbox_profile_id", sa.Uuid(), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("content_hash", sa.String(length=128), nullable=False),
            sa.Column("manifest_json", sa.Text(), nullable=False),
            sa.Column("warnings_json", sa.Text(), nullable=True),
            sa.Column("source", sa.String(length=32), nullable=False, server_default="server"),
            sa.Column("generated_by_user_id", sa.Uuid(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["sandbox_profile_id"],
                ["sandbox_profile.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(["generated_by_user_id"], ["user.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "sandbox_profile_id",
                "sequence",
                name="uq_runtime_config_revision_profile_sequence",
            ),
            sa.UniqueConstraint(
                "sandbox_profile_id",
                "content_hash",
                name="uq_runtime_config_revision_profile_hash",
            ),
        )
    _create_index_once(
        "ix_runtime_config_revision_profile_created",
        "sandbox_profile_runtime_config_revision",
        ["sandbox_profile_id", "created_at"],
    )
    if not _has_table("sandbox_profile_runtime_config_current"):
        op.create_table(
            "sandbox_profile_runtime_config_current",
            sa.Column("sandbox_profile_id", sa.Uuid(), nullable=False),
            sa.Column("current_sequence", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("current_revision_id", sa.Uuid(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["sandbox_profile_id"],
                ["sandbox_profile.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["current_revision_id"],
                ["sandbox_profile_runtime_config_revision.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("sandbox_profile_id"),
        )
    if not _has_table("sandbox_profile_runtime_config_artifact"):
        op.create_table(
            "sandbox_profile_runtime_config_artifact",
            sa.Column("revision_id", sa.Uuid(), nullable=False),
            sa.Column("artifact_hash", sa.String(length=128), nullable=False),
            sa.Column("content_type", sa.String(length=255), nullable=False),
            sa.Column("byte_size", sa.Integer(), nullable=False),
            sa.Column("payload_ciphertext", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["revision_id"],
                ["sandbox_profile_runtime_config_revision.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("revision_id", "artifact_hash"),
        )
