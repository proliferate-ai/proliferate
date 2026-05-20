"""cloud target config

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-05-14 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d0e1f2a3b4c5"
down_revision: str | Sequence[str] | None = "c9d0e1f2a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_COMMAND_KINDS = (
    "start_session",
    "resume_session",
    "send_prompt",
    "resolve_interaction",
    "update_session_config",
    "cancel_turn",
    "close_session",
    "cancel_session",
    "stop_workspace",
    "hibernate_workspace",
    "resume_workspace",
    "prune_workspace",
    "extend_workspace_ttl",
    "sync_existing_workspace",
)

_NEW_COMMAND_KINDS = (
    "start_session",
    "materialize_environment",
    "resume_session",
    "send_prompt",
    "resolve_interaction",
    "update_session_config",
    "cancel_turn",
    "close_session",
    "cancel_session",
    "stop_workspace",
    "hibernate_workspace",
    "resume_workspace",
    "prune_workspace",
    "extend_workspace_ttl",
    "sync_existing_workspace",
)

_TARGET_CONFIG_STATUSES = (
    "pending",
    "queued",
    "materializing",
    "applied",
    "failed",
)


def _in_constraint(column_name: str, values: tuple[str, ...]) -> str:
    return f"{column_name} IN {values}"


def _has_check_constraint(table_name: str, constraint_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return constraint_name in {
        constraint["name"] for constraint in inspector.get_check_constraints(table_name)
    }


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


def _replace_command_kind_constraint(values: tuple[str, ...]) -> None:
    if _has_check_constraint("cloud_commands", "ck_cloud_commands_kind"):
        op.drop_constraint("ck_cloud_commands_kind", "cloud_commands", type_="check")
    op.create_check_constraint(
        "ck_cloud_commands_kind",
        "cloud_commands",
        _in_constraint("kind", values),
    )


def upgrade() -> None:
    """Upgrade schema."""
    _replace_command_kind_constraint(_NEW_COMMAND_KINDS)

    if not _has_table("cloud_target_configs"):
        op.create_table(
            "cloud_target_configs",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("git_provider", sa.String(length=32), nullable=False),
            sa.Column("git_owner", sa.String(length=255), nullable=False),
            sa.Column("git_repo_name", sa.String(length=255), nullable=False),
            sa.Column("workspace_root", sa.Text(), nullable=False),
            sa.Column("config_version", sa.Integer(), nullable=False),
            sa.Column("payload_ciphertext", sa.Text(), nullable=False),
            sa.Column("summary_json", sa.Text(), nullable=False),
            sa.Column("env_vars_version", sa.Integer(), nullable=False),
            sa.Column("files_version", sa.Integer(), nullable=False),
            sa.Column("credential_snapshot_version", sa.Integer(), nullable=False),
            sa.Column("mcp_materialization_version", sa.Integer(), nullable=False),
            sa.Column("materialization_status", sa.String(length=32), nullable=False),
            sa.Column("last_command_id", sa.Uuid(), nullable=True),
            sa.Column("last_materialized_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error_code", sa.String(length=128), nullable=True),
            sa.Column("last_error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                _in_constraint("materialization_status", _TARGET_CONFIG_STATUSES),
                name="ck_cloud_target_configs_materialization_status",
            ),
            sa.ForeignKeyConstraint(
                ["last_command_id"], ["cloud_commands.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once(
        "uq_cloud_target_configs_target_repo",
        "cloud_target_configs",
        ["target_id", "git_provider", "git_owner", "git_repo_name"],
        unique=True,
    )
    _create_index_once(
        "ix_cloud_target_configs_target_id",
        "cloud_target_configs",
        ["target_id"],
    )
    _create_index_once(
        "ix_cloud_target_configs_user_id",
        "cloud_target_configs",
        ["user_id"],
    )
    _create_index_once(
        "ix_cloud_target_configs_organization_id",
        "cloud_target_configs",
        ["organization_id"],
    )
    _create_index_once(
        "ix_cloud_target_configs_last_command",
        "cloud_target_configs",
        ["last_command_id"],
    )
    _create_index_once(
        "ix_cloud_target_configs_target_status",
        "cloud_target_configs",
        ["target_id", "materialization_status"],
    )
    _create_index_once(
        "ix_cloud_target_configs_user_repo",
        "cloud_target_configs",
        ["user_id", "git_owner", "git_repo_name"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM cloud_commands WHERE kind = 'materialize_environment'")
    _drop_index_once("ix_cloud_target_configs_user_repo", "cloud_target_configs")
    _drop_index_once("ix_cloud_target_configs_target_status", "cloud_target_configs")
    _drop_index_once("ix_cloud_target_configs_last_command", "cloud_target_configs")
    _drop_index_once("ix_cloud_target_configs_organization_id", "cloud_target_configs")
    _drop_index_once("ix_cloud_target_configs_user_id", "cloud_target_configs")
    _drop_index_once("ix_cloud_target_configs_target_id", "cloud_target_configs")
    _drop_index_once("uq_cloud_target_configs_target_repo", "cloud_target_configs")
    _drop_table_once("cloud_target_configs")

    _replace_command_kind_constraint(_OLD_COMMAND_KINDS)
