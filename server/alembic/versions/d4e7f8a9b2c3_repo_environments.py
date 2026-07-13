"""repo environments

Revision ID: d4e7f8a9b2c3
Revises: c3f6a9b2d5e8
Create Date: 2026-06-27 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d4e7f8a9b2c3"
down_revision: str | Sequence[str] | None = "c3f6a9b2d5e8"
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


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {column["name"] for column in _inspector().get_columns(table_name)}


def _has_foreign_key(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return constraint_name in {fk["name"] for fk in _inspector().get_foreign_keys(table_name)}


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


def _drop_foreign_key_once(table_name: str, constraint_name: str) -> None:
    if _has_foreign_key(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_="foreignkey")


def _replace_check_constraint(table_name: str, constraint_name: str, expression: str) -> None:
    op.execute(sa.text(f"ALTER TABLE {table_name} DROP CONSTRAINT IF EXISTS {constraint_name}"))
    op.create_check_constraint(constraint_name, table_name, expression)


def upgrade() -> None:
    if not _has_table("repo_config"):
        op.create_table(
            "repo_config",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("owner_scope", sa.String(length=32), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=True),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("git_provider", sa.String(length=32), nullable=False),
            sa.Column("git_owner", sa.String(length=255), nullable=False),
            sa.Column("git_repo_name", sa.String(length=255), nullable=False),
            sa.Column("legacy_cloud_repo_config_id", sa.Uuid(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "owner_scope IN ('personal', 'organization')",
                name="ck_repo_config_owner_scope",
            ),
            sa.CheckConstraint(
                "((owner_scope = 'personal' AND user_id IS NOT NULL "
                "AND organization_id IS NULL) OR "
                "(owner_scope = 'organization' AND organization_id IS NOT NULL "
                "AND user_id IS NULL))",
                name="ck_repo_config_owner_fields",
            ),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["legacy_cloud_repo_config_id"],
                ["cloud_repo_config.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "legacy_cloud_repo_config_id",
                name="uq_repo_config_legacy_cloud_repo_config_id",
            ),
        )

    _create_index_once("ix_repo_config_owner_scope", "repo_config", ["owner_scope"])
    _create_index_once("ix_repo_config_user_id", "repo_config", ["user_id"])
    _create_index_once("ix_repo_config_organization_id", "repo_config", ["organization_id"])
    _create_index_once(
        "ux_repo_config_personal_repo",
        "repo_config",
        ["user_id", "git_provider", "git_owner", "git_repo_name"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'personal' AND deleted_at IS NULL"),
    )
    _create_index_once(
        "ux_repo_config_organization_repo",
        "repo_config",
        ["organization_id", "git_provider", "git_owner", "git_repo_name"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'organization' AND deleted_at IS NULL"),
    )

    if not _has_table("repo_environment"):
        op.create_table(
            "repo_environment",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("repo_config_id", sa.Uuid(), nullable=False),
            sa.Column("environment_kind", sa.String(length=32), nullable=False),
            sa.Column("desktop_install_id", sa.String(length=255), nullable=True),
            sa.Column("local_path", sa.Text(), nullable=True),
            sa.Column("configured", sa.Boolean(), nullable=False),
            sa.Column("configured_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("default_branch", sa.String(length=255), nullable=True),
            sa.Column("setup_script", sa.Text(), nullable=False),
            sa.Column("setup_script_version", sa.Integer(), nullable=False),
            sa.Column("run_command", sa.Text(), nullable=False),
            sa.Column("config_version", sa.Integer(), nullable=False),
            sa.Column("legacy_cloud_repo_config_id", sa.Uuid(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "environment_kind IN ('local', 'cloud')",
                name="ck_repo_environment_kind",
            ),
            sa.CheckConstraint(
                "((environment_kind = 'local' AND local_path IS NOT NULL "
                "AND desktop_install_id IS NOT NULL) OR "
                "(environment_kind = 'cloud' AND local_path IS NULL))",
                name="ck_repo_environment_kind_fields",
            ),
            sa.ForeignKeyConstraint(["repo_config_id"], ["repo_config.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["legacy_cloud_repo_config_id"],
                ["cloud_repo_config.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "legacy_cloud_repo_config_id",
                name="uq_repo_environment_legacy_cloud_repo_config_id",
            ),
        )

    _create_index_once(
        "ix_repo_environment_repo_config_id", "repo_environment", ["repo_config_id"]
    )
    _create_index_once(
        "ix_repo_environment_environment_kind",
        "repo_environment",
        ["environment_kind"],
    )
    _create_index_once(
        "ux_repo_environment_cloud",
        "repo_environment",
        ["repo_config_id"],
        unique=True,
        postgresql_where=sa.text("environment_kind = 'cloud' AND deleted_at IS NULL"),
    )
    _create_index_once(
        "ux_repo_environment_local_path",
        "repo_environment",
        ["repo_config_id", "desktop_install_id", "local_path"],
        unique=True,
        postgresql_where=sa.text("environment_kind = 'local' AND deleted_at IS NULL"),
    )

    if _has_table("cloud_repo_config"):
        op.execute(
            sa.text(
                """
                INSERT INTO repo_config (
                    id, owner_scope, user_id, organization_id, git_provider,
                    git_owner, git_repo_name, legacy_cloud_repo_config_id,
                    created_at, updated_at, deleted_at
                )
                SELECT
                    id, owner_scope, user_id, organization_id, 'github',
                    git_owner, git_repo_name, id,
                    created_at, updated_at, NULL
                FROM cloud_repo_config
                ON CONFLICT DO NOTHING
                """
            )
        )
        op.execute(
            sa.text(
                """
                INSERT INTO repo_environment (
                    id, repo_config_id, environment_kind, desktop_install_id, local_path,
                    configured, configured_at, default_branch, setup_script,
                    setup_script_version, run_command, config_version,
                    legacy_cloud_repo_config_id, created_at, updated_at, deleted_at
                )
                SELECT
                    id, id, 'cloud', NULL, NULL,
                    configured, configured_at, default_branch, setup_script,
                    setup_script_version, run_command,
                    GREATEST(files_version, env_vars_version, setup_script_version, CASE WHEN configured THEN 1 ELSE 0 END),
                    id, created_at, updated_at, NULL
                FROM cloud_repo_config
                ON CONFLICT DO NOTHING
                """
            )
        )

    if _has_table("managed_sandbox_repo_materialization"):
        if not _has_column("managed_sandbox_repo_materialization", "repo_environment_id"):
            op.add_column(
                "managed_sandbox_repo_materialization",
                sa.Column("repo_environment_id", sa.Uuid(), nullable=True),
            )
        if not _has_foreign_key(
            "managed_sandbox_repo_materialization",
            "fk_managed_sandbox_repo_materialization_repo_environment_id",
        ):
            op.create_foreign_key(
                "fk_managed_sandbox_repo_materialization_repo_environment_id",
                "managed_sandbox_repo_materialization",
                "repo_environment",
                ["repo_environment_id"],
                ["id"],
                ondelete="CASCADE",
            )
        op.execute(
            sa.text(
                """
                UPDATE managed_sandbox_repo_materialization
                SET repo_environment_id = cloud_repo_config_id
                WHERE repo_environment_id IS NULL
                  AND cloud_repo_config_id IS NOT NULL
                """
            )
        )
        _create_index_once(
            "ix_managed_sandbox_repo_materialization_repo_environment_id",
            "managed_sandbox_repo_materialization",
            ["repo_environment_id"],
        )

    if _has_table("cloud_secret_set"):
        if not _has_column("cloud_secret_set", "repo_environment_id"):
            op.add_column(
                "cloud_secret_set",
                sa.Column("repo_environment_id", sa.Uuid(), nullable=True),
            )
        if not _has_foreign_key(
            "cloud_secret_set",
            "fk_cloud_secret_set_repo_environment_id",
        ):
            op.create_foreign_key(
                "fk_cloud_secret_set_repo_environment_id",
                "cloud_secret_set",
                "repo_environment",
                ["repo_environment_id"],
                ["id"],
                ondelete="CASCADE",
            )
        op.execute(
            sa.text(
                """
                UPDATE cloud_secret_set
                SET repo_environment_id = cloud_repo_config_id
                WHERE repo_environment_id IS NULL
                  AND cloud_repo_config_id IS NOT NULL
                """
            )
        )
        _create_index_once(
            "ix_cloud_secret_set_repo_environment_id",
            "cloud_secret_set",
            ["repo_environment_id"],
        )
        _create_index_once(
            "ux_cloud_secret_set_workspace_environment",
            "cloud_secret_set",
            ["repo_environment_id"],
            unique=True,
            postgresql_where=sa.text("scope_kind = 'workspace'"),
        )
        _drop_index_once("ux_cloud_secret_set_workspace", "cloud_secret_set")
        _replace_check_constraint(
            "cloud_secret_set",
            "ck_cloud_secret_set_scope_fields",
            "((scope_kind = 'personal' AND user_id IS NOT NULL "
            "AND organization_id IS NULL AND cloud_repo_config_id IS NULL "
            "AND repo_environment_id IS NULL) OR "
            "(scope_kind = 'organization' AND organization_id IS NOT NULL "
            "AND user_id IS NULL AND cloud_repo_config_id IS NULL "
            "AND repo_environment_id IS NULL) OR "
            "(scope_kind = 'workspace' AND repo_environment_id IS NOT NULL "
            "AND user_id IS NULL AND organization_id IS NULL))",
        )
        op.execute(
            sa.text(
                """
                UPDATE cloud_secret_set
                SET cloud_repo_config_id = NULL
                WHERE scope_kind = 'workspace'
                  AND repo_environment_id IS NOT NULL
                """
            )
        )

    if _has_table("managed_sandbox_secret_materialization"):
        if not _has_column("managed_sandbox_secret_materialization", "repo_environment_id"):
            op.add_column(
                "managed_sandbox_secret_materialization",
                sa.Column("repo_environment_id", sa.Uuid(), nullable=True),
            )
        if not _has_foreign_key(
            "managed_sandbox_secret_materialization",
            "fk_managed_sandbox_secret_materialization_repo_environment_id",
        ):
            op.create_foreign_key(
                "fk_managed_sandbox_secret_materialization_repo_environment_id",
                "managed_sandbox_secret_materialization",
                "repo_environment",
                ["repo_environment_id"],
                ["id"],
                ondelete="CASCADE",
            )
        op.execute(
            sa.text(
                """
                UPDATE managed_sandbox_secret_materialization
                SET repo_environment_id = cloud_repo_config_id
                WHERE repo_environment_id IS NULL
                  AND cloud_repo_config_id IS NOT NULL
                """
            )
        )
        _create_index_once(
            "ix_managed_sandbox_secret_materialization_repo_environment_id",
            "managed_sandbox_secret_materialization",
            ["repo_environment_id"],
        )
        _create_index_once(
            "ux_managed_sandbox_secret_materialization_workspace_environment",
            "managed_sandbox_secret_materialization",
            ["managed_sandbox_id", "repo_environment_id"],
            unique=True,
            postgresql_where=sa.text("materialization_kind = 'workspace'"),
        )
        _drop_index_once(
            "ux_managed_sandbox_secret_materialization_workspace",
            "managed_sandbox_secret_materialization",
        )
        _replace_check_constraint(
            "managed_sandbox_secret_materialization",
            "ck_managed_sandbox_secret_materialization_scope",
            "((materialization_kind = 'global' "
            "AND cloud_repo_config_id IS NULL "
            "AND repo_environment_id IS NULL) OR "
            "(materialization_kind = 'workspace' AND repo_environment_id IS NOT NULL))",
        )
        op.execute(
            sa.text(
                """
                UPDATE managed_sandbox_secret_materialization
                SET cloud_repo_config_id = NULL
                WHERE materialization_kind = 'workspace'
                  AND repo_environment_id IS NOT NULL
                """
            )
        )


def downgrade() -> None:
    if _has_table("managed_sandbox_secret_materialization") and _has_column(
        "managed_sandbox_secret_materialization",
        "repo_environment_id",
    ):
        op.execute(
            sa.text(
                """
                UPDATE managed_sandbox_secret_materialization
                SET cloud_repo_config_id = repo_environment_id
                WHERE materialization_kind = 'workspace'
                  AND cloud_repo_config_id IS NULL
                  AND repo_environment_id IS NOT NULL
                """
            )
        )
        _replace_check_constraint(
            "managed_sandbox_secret_materialization",
            "ck_managed_sandbox_secret_materialization_scope",
            "((materialization_kind = 'global' AND cloud_repo_config_id IS NULL) OR "
            "(materialization_kind = 'workspace' AND cloud_repo_config_id IS NOT NULL))",
        )
        _create_index_once(
            "ux_managed_sandbox_secret_materialization_workspace",
            "managed_sandbox_secret_materialization",
            ["managed_sandbox_id", "cloud_repo_config_id"],
            unique=True,
            postgresql_where=sa.text("materialization_kind = 'workspace'"),
        )
        _drop_index_once(
            "ux_managed_sandbox_secret_materialization_workspace_environment",
            "managed_sandbox_secret_materialization",
        )
        _drop_index_once(
            "ix_managed_sandbox_secret_materialization_repo_environment_id",
            "managed_sandbox_secret_materialization",
        )
        _drop_foreign_key_once(
            "managed_sandbox_secret_materialization",
            "fk_managed_sandbox_secret_materialization_repo_environment_id",
        )
        op.drop_column("managed_sandbox_secret_materialization", "repo_environment_id")
    if _has_table("cloud_secret_set") and _has_column("cloud_secret_set", "repo_environment_id"):
        op.execute(
            sa.text(
                """
                UPDATE cloud_secret_set
                SET cloud_repo_config_id = repo_environment_id
                WHERE scope_kind = 'workspace'
                  AND cloud_repo_config_id IS NULL
                  AND repo_environment_id IS NOT NULL
                """
            )
        )
        _replace_check_constraint(
            "cloud_secret_set",
            "ck_cloud_secret_set_scope_fields",
            "((scope_kind = 'personal' AND user_id IS NOT NULL "
            "AND organization_id IS NULL AND cloud_repo_config_id IS NULL) OR "
            "(scope_kind = 'organization' AND organization_id IS NOT NULL "
            "AND user_id IS NULL AND cloud_repo_config_id IS NULL) OR "
            "(scope_kind = 'workspace' AND cloud_repo_config_id IS NOT NULL "
            "AND user_id IS NULL AND organization_id IS NULL))",
        )
        _create_index_once(
            "ux_cloud_secret_set_workspace",
            "cloud_secret_set",
            ["cloud_repo_config_id"],
            unique=True,
            postgresql_where=sa.text("scope_kind = 'workspace'"),
        )
        _drop_index_once("ux_cloud_secret_set_workspace_environment", "cloud_secret_set")
        _drop_index_once("ix_cloud_secret_set_repo_environment_id", "cloud_secret_set")
        _drop_foreign_key_once("cloud_secret_set", "fk_cloud_secret_set_repo_environment_id")
        op.drop_column("cloud_secret_set", "repo_environment_id")
    if _has_table("managed_sandbox_repo_materialization") and _has_column(
        "managed_sandbox_repo_materialization",
        "repo_environment_id",
    ):
        _drop_index_once(
            "ix_managed_sandbox_repo_materialization_repo_environment_id",
            "managed_sandbox_repo_materialization",
        )
        _drop_foreign_key_once(
            "managed_sandbox_repo_materialization",
            "fk_managed_sandbox_repo_materialization_repo_environment_id",
        )
        op.drop_column("managed_sandbox_repo_materialization", "repo_environment_id")
    if _has_table("repo_environment"):
        op.drop_table("repo_environment")
    if _has_table("repo_config"):
        op.drop_table("repo_config")
