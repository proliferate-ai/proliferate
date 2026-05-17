"""Add cloud target runtime config revisions.

Revision ID: f7a8b9c0d1e2
Revises: d5e6f7a8b9c0
Create Date: 2026-05-16 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "f7a8b9c0d1e2"
down_revision: str | None = "d5e6f7a8b9c0"
branch_labels: str | None = None
depends_on: str | None = None

_OLD_COMMAND_KINDS = (
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

_NEW_COMMAND_KINDS = (
    "start_session",
    "configure_git_identity",
    "ensure_repo_checkout",
    "materialize_workspace",
    "materialize_environment",
    "materialize_environment_runtime_config",
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
        "cloud_target_runtime_config_revisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("target_config_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("revision_sequence", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(length=128), nullable=False),
        sa.Column("manifest_json", sa.Text(), nullable=False),
        sa.Column("warnings_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_config_id"], ["cloud_target_configs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_cloud_target_runtime_config_revisions_target_sequence",
        "cloud_target_runtime_config_revisions",
        ["target_id", "revision_sequence"],
    )
    op.create_index(
        "uq_cloud_target_runtime_config_revisions_content",
        "cloud_target_runtime_config_revisions",
        ["target_id", "content_hash"],
        unique=True,
    )
    op.create_table(
        "cloud_target_runtime_config_current",
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("revision_id", sa.Uuid(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["revision_id"], ["cloud_target_runtime_config_revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("target_id"),
    )
    op.create_table(
        "cloud_target_runtime_config_artifacts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("revision_id", sa.Uuid(), nullable=False),
        sa.Column("artifact_hash", sa.String(length=128), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["revision_id"], ["cloud_target_runtime_config_revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_cloud_target_runtime_config_artifacts_revision_hash",
        "cloud_target_runtime_config_artifacts",
        ["revision_id", "artifact_hash"],
        unique=True,
    )
    op.add_column(
        "cloud_target_configs",
        sa.Column("runtime_config_revision_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_cloud_target_configs_runtime_config_revision",
        "cloud_target_configs",
        "cloud_target_runtime_config_revisions",
        ["runtime_config_revision_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_cloud_target_configs_runtime_config_revision",
        "cloud_target_configs",
        type_="foreignkey",
    )
    op.drop_column("cloud_target_configs", "runtime_config_revision_id")
    op.drop_table("cloud_target_runtime_config_artifacts")
    op.drop_table("cloud_target_runtime_config_current")
    op.drop_table("cloud_target_runtime_config_revisions")
    _replace_command_kind_constraint(_OLD_COMMAND_KINDS)
