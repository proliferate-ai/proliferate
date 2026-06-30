"""managed sandbox stack

Revision ID: c1d4e7f8a9b2
Revises: b8f2c6d7e9a0
Create Date: 2026-06-24 15:30:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c1d4e7f8a9b2"
down_revision: str | Sequence[str] | None = "b8f2c6d7e9a0"
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


def upgrade() -> None:
    if not _has_table("managed_sandbox"):
        op.create_table(
            "managed_sandbox",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("owner_scope", sa.String(length=32), nullable=False),
            sa.Column("owner_user_id", sa.Uuid(), nullable=True),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
            sa.Column("billing_subject_id", sa.Uuid(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("e2b_sandbox_id", sa.String(length=255), nullable=True),
            sa.Column("e2b_template_ref", sa.Text(), nullable=False),
            sa.Column("anyharness_base_url", sa.Text(), nullable=True),
            sa.Column("anyharness_bearer_token_ciphertext", sa.Text(), nullable=True),
            sa.Column("anyharness_data_key_ciphertext", sa.Text(), nullable=True),
            sa.Column("runtime_generation", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_health_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("destroyed_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "owner_scope IN ('personal', 'organization')",
                name="ck_managed_sandbox_owner_scope",
            ),
            sa.CheckConstraint(
                "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
                "AND organization_id IS NULL) OR "
                "(owner_scope = 'organization' AND organization_id IS NOT NULL "
                "AND owner_user_id IS NULL))",
                name="ck_managed_sandbox_owner_fields",
            ),
            sa.CheckConstraint(
                "status IN ('creating', 'starting', 'ready', 'paused', 'error', "
                "'destroying', 'destroyed')",
                name="ck_managed_sandbox_status",
            ),
            sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["billing_subject_id"],
                ["billing_subject.id"],
                ondelete="RESTRICT",
            ),
            sa.UniqueConstraint("e2b_sandbox_id", name="uq_managed_sandbox_e2b_sandbox_id"),
        )

    _create_index_once("ix_managed_sandbox_owner_scope", "managed_sandbox", ["owner_scope"])
    _create_index_once(
        "ix_managed_sandbox_owner_user_id",
        "managed_sandbox",
        ["owner_user_id"],
    )
    _create_index_once(
        "ix_managed_sandbox_organization_id",
        "managed_sandbox",
        ["organization_id"],
    )
    _create_index_once(
        "ix_managed_sandbox_created_by_user_id",
        "managed_sandbox",
        ["created_by_user_id"],
    )
    _create_index_once(
        "ix_managed_sandbox_billing_subject_id",
        "managed_sandbox",
        ["billing_subject_id"],
    )
    _create_index_once("ix_managed_sandbox_status", "managed_sandbox", ["status"])
    _create_index_once(
        "ix_managed_sandbox_owner_status",
        "managed_sandbox",
        ["owner_scope", "status"],
    )
    _create_index_once(
        "ux_managed_sandbox_personal_active",
        "managed_sandbox",
        ["owner_user_id"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'personal' AND destroyed_at IS NULL"),
    )
    _create_index_once(
        "ux_managed_sandbox_organization_active",
        "managed_sandbox",
        ["organization_id"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'organization' AND destroyed_at IS NULL"),
    )

    if not _has_table("managed_sandbox_repo_materialization"):
        op.create_table(
            "managed_sandbox_repo_materialization",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("managed_sandbox_id", sa.Uuid(), nullable=False),
            sa.Column("cloud_repo_config_id", sa.Uuid(), nullable=False),
            sa.Column("sandbox_generation", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("repo_path", sa.Text(), nullable=False),
            sa.Column("anyharness_repo_root_id", sa.Text(), nullable=True),
            sa.Column("anyharness_workspace_id", sa.Text(), nullable=True),
            sa.Column("applied_files_version", sa.Integer(), nullable=False),
            sa.Column("applied_setup_script_version", sa.Integer(), nullable=False),
            sa.Column("applied_env_vars_version", sa.Integer(), nullable=False),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("last_attempted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("materialized_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "status IN ('pending', 'running', 'ready', 'error', 'disabled')",
                name="ck_managed_sandbox_repo_materialization_status",
            ),
            sa.ForeignKeyConstraint(
                ["managed_sandbox_id"],
                ["managed_sandbox.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["cloud_repo_config_id"],
                ["cloud_repo_config.id"],
                ondelete="CASCADE",
            ),
        )

    _create_index_once(
        "ix_managed_sandbox_repo_materialization_managed_sandbox_id",
        "managed_sandbox_repo_materialization",
        ["managed_sandbox_id"],
    )
    _create_index_once(
        "ix_managed_sandbox_repo_materialization_cloud_repo_config_id",
        "managed_sandbox_repo_materialization",
        ["cloud_repo_config_id"],
    )
    _create_index_once(
        "ux_managed_sandbox_repo_materialization_repo",
        "managed_sandbox_repo_materialization",
        ["managed_sandbox_id", "cloud_repo_config_id"],
        unique=True,
    )
    _create_index_once(
        "ix_managed_sandbox_repo_materialization_status",
        "managed_sandbox_repo_materialization",
        ["managed_sandbox_id", "status"],
    )


def downgrade() -> None:
    if _has_table("managed_sandbox_repo_materialization"):
        op.drop_table("managed_sandbox_repo_materialization")
    if _has_table("managed_sandbox"):
        op.drop_table("managed_sandbox")
