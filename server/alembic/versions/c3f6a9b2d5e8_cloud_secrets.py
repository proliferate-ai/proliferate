"""cloud secrets

Revision ID: c3f6a9b2d5e8
Revises: c3f6a9b2d4e8
Create Date: 2026-06-26 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c3f6a9b2d5e8"
down_revision: str | Sequence[str] | None = "c3f6a9b2d4e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {index["name"] for index in _inspector().get_indexes(table_name)}


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


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def upgrade() -> None:
    if not _has_table("cloud_secret_set"):
        op.create_table(
            "cloud_secret_set",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("scope_kind", sa.String(length=32), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=True),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("cloud_repo_config_id", sa.Uuid(), nullable=True),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
            sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "scope_kind IN ('personal', 'organization', 'workspace')",
                name="ck_cloud_secret_set_scope_kind",
            ),
            sa.CheckConstraint(
                "((scope_kind = 'personal' AND user_id IS NOT NULL "
                "AND organization_id IS NULL AND cloud_repo_config_id IS NULL) OR "
                "(scope_kind = 'organization' AND organization_id IS NOT NULL "
                "AND user_id IS NULL AND cloud_repo_config_id IS NULL) OR "
                "(scope_kind = 'workspace' AND cloud_repo_config_id IS NOT NULL "
                "AND user_id IS NULL AND organization_id IS NULL))",
                name="ck_cloud_secret_set_scope_fields",
            ),
            sa.ForeignKeyConstraint(
                ["cloud_repo_config_id"],
                ["cloud_repo_config.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["updated_by_user_id"], ["user.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_cloud_secret_set_scope_kind", "cloud_secret_set", ["scope_kind"])
    _create_index_once("ix_cloud_secret_set_user_id", "cloud_secret_set", ["user_id"])
    _create_index_once(
        "ix_cloud_secret_set_organization_id",
        "cloud_secret_set",
        ["organization_id"],
    )
    _create_index_once(
        "ix_cloud_secret_set_cloud_repo_config_id",
        "cloud_secret_set",
        ["cloud_repo_config_id"],
    )
    _create_index_once(
        "ux_cloud_secret_set_personal",
        "cloud_secret_set",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("scope_kind = 'personal'"),
    )
    _create_index_once(
        "ux_cloud_secret_set_organization",
        "cloud_secret_set",
        ["organization_id"],
        unique=True,
        postgresql_where=sa.text("scope_kind = 'organization'"),
    )
    _create_index_once(
        "ux_cloud_secret_set_workspace",
        "cloud_secret_set",
        ["cloud_repo_config_id"],
        unique=True,
        postgresql_where=sa.text("scope_kind = 'workspace'"),
    )

    if not _has_table("cloud_secret_env_var"):
        op.create_table(
            "cloud_secret_env_var",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("secret_set_id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("value_ciphertext", sa.Text(), nullable=False),
            sa.Column("value_sha256", sa.String(length=64), nullable=False),
            sa.Column("byte_size", sa.BigInteger(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["secret_set_id"],
                ["cloud_secret_set.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("secret_set_id", "name"),
        )
    _create_index_once(
        "ix_cloud_secret_env_var_secret_set_id",
        "cloud_secret_env_var",
        ["secret_set_id"],
    )

    if not _has_table("cloud_secret_file"):
        op.create_table(
            "cloud_secret_file",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("secret_set_id", sa.Uuid(), nullable=False),
            sa.Column("path", sa.Text(), nullable=False),
            sa.Column("content_ciphertext", sa.Text(), nullable=False),
            sa.Column("content_sha256", sa.String(length=64), nullable=False),
            sa.Column("byte_size", sa.BigInteger(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["secret_set_id"],
                ["cloud_secret_set.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("secret_set_id", "path"),
        )
    _create_index_once(
        "ix_cloud_secret_file_secret_set_id",
        "cloud_secret_file",
        ["secret_set_id"],
    )

    if not _has_table("managed_sandbox_secret_materialization"):
        op.create_table(
            "managed_sandbox_secret_materialization",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("managed_sandbox_id", sa.Uuid(), nullable=False),
            sa.Column("materialization_kind", sa.String(length=32), nullable=False),
            sa.Column("cloud_secret_set_id", sa.Uuid(), nullable=True),
            sa.Column("cloud_repo_config_id", sa.Uuid(), nullable=True),
            sa.Column("sandbox_generation", sa.Integer(), nullable=False),
            sa.Column("applied_version", sa.Integer(), nullable=False),
            sa.Column("applied_versions_json", sa.Text(), nullable=True),
            sa.Column("applied_manifest_json", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("materialized_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "materialization_kind IN ('global', 'workspace')",
                name="ck_managed_sandbox_secret_materialization_kind",
            ),
            sa.CheckConstraint(
                "status IN ('pending', 'running', 'ready', 'error')",
                name="ck_managed_sandbox_secret_materialization_status",
            ),
            sa.CheckConstraint(
                "((materialization_kind = 'global' AND cloud_repo_config_id IS NULL) OR "
                "(materialization_kind = 'workspace' AND cloud_repo_config_id IS NOT NULL))",
                name="ck_managed_sandbox_secret_materialization_scope",
            ),
            sa.ForeignKeyConstraint(
                ["cloud_repo_config_id"],
                ["cloud_repo_config.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["cloud_secret_set_id"],
                ["cloud_secret_set.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["managed_sandbox_id"],
                ["managed_sandbox.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once(
        "ix_managed_sandbox_secret_materialization_cloud_repo_config_id",
        "managed_sandbox_secret_materialization",
        ["cloud_repo_config_id"],
    )
    _create_index_once(
        "ix_managed_sandbox_secret_materialization_cloud_secret_set_id",
        "managed_sandbox_secret_materialization",
        ["cloud_secret_set_id"],
    )
    _create_index_once(
        "ix_managed_sandbox_secret_materialization_managed_sandbox_id",
        "managed_sandbox_secret_materialization",
        ["managed_sandbox_id"],
    )
    _create_index_once(
        "ix_managed_sandbox_secret_materialization_materialization_kind",
        "managed_sandbox_secret_materialization",
        ["materialization_kind"],
    )
    _create_index_once(
        "ix_managed_sandbox_secret_materialization_status",
        "managed_sandbox_secret_materialization",
        ["managed_sandbox_id", "status"],
    )
    _create_index_once(
        "ux_managed_sandbox_secret_materialization_global",
        "managed_sandbox_secret_materialization",
        ["managed_sandbox_id"],
        unique=True,
        postgresql_where=sa.text("materialization_kind = 'global'"),
    )
    _create_index_once(
        "ux_managed_sandbox_secret_materialization_workspace",
        "managed_sandbox_secret_materialization",
        ["managed_sandbox_id", "cloud_repo_config_id"],
        unique=True,
        postgresql_where=sa.text("materialization_kind = 'workspace'"),
    )


def downgrade() -> None:
    if _has_table("managed_sandbox_secret_materialization"):
        _drop_index_once(
            "ux_managed_sandbox_secret_materialization_workspace",
            "managed_sandbox_secret_materialization",
        )
        _drop_index_once(
            "ux_managed_sandbox_secret_materialization_global",
            "managed_sandbox_secret_materialization",
        )
        _drop_index_once(
            "ix_managed_sandbox_secret_materialization_status",
            "managed_sandbox_secret_materialization",
        )
        _drop_index_once(
            "ix_managed_sandbox_secret_materialization_materialization_kind",
            "managed_sandbox_secret_materialization",
        )
        _drop_index_once(
            "ix_managed_sandbox_secret_materialization_managed_sandbox_id",
            "managed_sandbox_secret_materialization",
        )
        _drop_index_once(
            "ix_managed_sandbox_secret_materialization_cloud_secret_set_id",
            "managed_sandbox_secret_materialization",
        )
        _drop_index_once(
            "ix_managed_sandbox_secret_materialization_cloud_repo_config_id",
            "managed_sandbox_secret_materialization",
        )
        op.drop_table("managed_sandbox_secret_materialization")
    if _has_table("cloud_secret_file"):
        _drop_index_once("ix_cloud_secret_file_secret_set_id", "cloud_secret_file")
        op.drop_table("cloud_secret_file")
    if _has_table("cloud_secret_env_var"):
        _drop_index_once("ix_cloud_secret_env_var_secret_set_id", "cloud_secret_env_var")
        op.drop_table("cloud_secret_env_var")
    if _has_table("cloud_secret_set"):
        _drop_index_once("ux_cloud_secret_set_workspace", "cloud_secret_set")
        _drop_index_once("ux_cloud_secret_set_organization", "cloud_secret_set")
        _drop_index_once("ux_cloud_secret_set_personal", "cloud_secret_set")
        _drop_index_once("ix_cloud_secret_set_cloud_repo_config_id", "cloud_secret_set")
        _drop_index_once("ix_cloud_secret_set_organization_id", "cloud_secret_set")
        _drop_index_once("ix_cloud_secret_set_user_id", "cloud_secret_set")
        _drop_index_once("ix_cloud_secret_set_scope_kind", "cloud_secret_set")
        op.drop_table("cloud_secret_set")
