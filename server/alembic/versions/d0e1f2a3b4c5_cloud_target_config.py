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


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint("ck_cloud_commands_kind", "cloud_commands", type_="check")
    op.create_check_constraint(
        "ck_cloud_commands_kind",
        "cloud_commands",
        _in_constraint("kind", _NEW_COMMAND_KINDS),
    )

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
        sa.ForeignKeyConstraint(["last_command_id"], ["cloud_commands.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_cloud_target_configs_target_repo",
        "cloud_target_configs",
        ["target_id", "git_provider", "git_owner", "git_repo_name"],
        unique=True,
    )
    op.create_index(
        "ix_cloud_target_configs_target_id",
        "cloud_target_configs",
        ["target_id"],
        unique=False,
    )
    op.create_index(
        "ix_cloud_target_configs_user_id",
        "cloud_target_configs",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_cloud_target_configs_organization_id",
        "cloud_target_configs",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_cloud_target_configs_last_command",
        "cloud_target_configs",
        ["last_command_id"],
        unique=False,
    )
    op.create_index(
        "ix_cloud_target_configs_target_status",
        "cloud_target_configs",
        ["target_id", "materialization_status"],
        unique=False,
    )
    op.create_index(
        "ix_cloud_target_configs_user_repo",
        "cloud_target_configs",
        ["user_id", "git_owner", "git_repo_name"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM cloud_commands WHERE kind = 'materialize_environment'")
    op.drop_index("ix_cloud_target_configs_user_repo", table_name="cloud_target_configs")
    op.drop_index("ix_cloud_target_configs_target_status", table_name="cloud_target_configs")
    op.drop_index("ix_cloud_target_configs_last_command", table_name="cloud_target_configs")
    op.drop_index("ix_cloud_target_configs_organization_id", table_name="cloud_target_configs")
    op.drop_index("ix_cloud_target_configs_user_id", table_name="cloud_target_configs")
    op.drop_index("ix_cloud_target_configs_target_id", table_name="cloud_target_configs")
    op.drop_index("uq_cloud_target_configs_target_repo", table_name="cloud_target_configs")
    op.drop_table("cloud_target_configs")

    op.drop_constraint("ck_cloud_commands_kind", "cloud_commands", type_="check")
    op.create_check_constraint(
        "ck_cloud_commands_kind",
        "cloud_commands",
        _in_constraint("kind", _OLD_COMMAND_KINDS),
    )
