"""Add cloud target git identity materialization.

Revision ID: d5e6f7a8b9c0
Revises: d4e5f6a7b8c9
Create Date: 2026-05-14 23:30:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "d5e6f7a8b9c0"
down_revision: str | None = "d4e5f6a7b8c9"
branch_labels: str | None = None
depends_on: str | None = None

_OLD_COMMAND_KINDS = (
    "start_session",
    "materialize_workspace",
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

_NEW_COMMAND_KINDS = (
    "start_session",
    "configure_git_identity",
    "ensure_repo_checkout",
    "materialize_workspace",
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


def _replace_command_kind_constraint(values: tuple[str, ...]) -> None:
    op.drop_constraint("ck_cloud_commands_kind", "cloud_commands", type_="check")
    op.create_check_constraint(
        "ck_cloud_commands_kind",
        "cloud_commands",
        _in_constraint("kind", values),
    )


def upgrade() -> None:
    _replace_command_kind_constraint(_NEW_COMMAND_KINDS)
    op.create_table(
        "cloud_target_git_identities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("config_version", sa.Integer(), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.Column("summary_json", sa.Text(), nullable=False),
        sa.Column("materialization_status", sa.String(length=32), nullable=False),
        sa.Column("last_command_id", sa.Uuid(), nullable=True),
        sa.Column("last_materialized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(length=128), nullable=True),
        sa.Column("last_error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            _in_constraint("materialization_status", _TARGET_CONFIG_STATUSES),
            name="ck_cloud_target_git_identities_materialization_status",
        ),
        sa.ForeignKeyConstraint(["last_command_id"], ["cloud_commands.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_cloud_target_git_identities_target_provider",
        "cloud_target_git_identities",
        ["target_id", "provider"],
        unique=True,
    )
    op.create_index(
        "ix_cloud_target_git_identities_target_status",
        "cloud_target_git_identities",
        ["target_id", "materialization_status"],
    )
    op.create_index(
        "ix_cloud_target_git_identities_user_id",
        "cloud_target_git_identities",
        ["user_id"],
    )
    op.create_index(
        "ix_cloud_target_git_identities_last_command",
        "cloud_target_git_identities",
        ["last_command_id"],
    )


def downgrade() -> None:
    op.execute("DELETE FROM cloud_commands WHERE kind = 'configure_git_identity'")
    op.execute("DELETE FROM cloud_commands WHERE kind = 'ensure_repo_checkout'")
    op.drop_index(
        "ix_cloud_target_git_identities_last_command",
        table_name="cloud_target_git_identities",
    )
    op.drop_index(
        "ix_cloud_target_git_identities_user_id",
        table_name="cloud_target_git_identities",
    )
    op.drop_index(
        "ix_cloud_target_git_identities_target_status",
        table_name="cloud_target_git_identities",
    )
    op.drop_index(
        "uq_cloud_target_git_identities_target_provider",
        table_name="cloud_target_git_identities",
    )
    op.drop_table("cloud_target_git_identities")
    _replace_command_kind_constraint(_OLD_COMMAND_KINDS)
