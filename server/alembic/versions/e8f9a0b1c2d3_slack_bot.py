"""Slack bot cloud entrypoint.

Revision ID: e8f9a0b1c2d3
Revises: d6e7f8a9b0c1
Create Date: 2026-05-21 12:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "e8f9a0b1c2d3"
down_revision: str | None = "d6e7f8a9b0c1"
branch_labels: str | None = None
depends_on: str | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {column["name"] for column in _inspector().get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {index["name"] for index in _inspector().get_indexes(table_name)}


def _has_unique_constraint(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return constraint_name in {
        constraint["name"] for constraint in _inspector().get_unique_constraints(table_name)
    }


def _has_check_constraint(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return constraint_name in {
        constraint["name"] for constraint in _inspector().get_check_constraints(table_name)
    }


def _add_column_once(table_name: str, column: sa.Column) -> None:
    if _has_table(table_name) and not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
    postgresql_where: sa.TextClause | None = None,
) -> None:
    if _has_table(table_name) and not _has_index(table_name, index_name):
        op.create_index(
            index_name,
            table_name,
            columns,
            unique=unique,
            postgresql_where=postgresql_where,
        )


def _drop_table_once(table_name: str) -> None:
    if _has_table(table_name):
        op.drop_table(table_name)


def _upgrade_cloud_repo_config() -> None:
    _add_column_once(
        "cloud_repo_config",
        sa.Column(
            "owner_scope",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'personal'"),
        ),
    )
    _add_column_once(
        "cloud_repo_config",
        sa.Column("organization_id", sa.Uuid(), nullable=True),
    )
    if _has_column("cloud_repo_config", "user_id"):
        op.alter_column(
            "cloud_repo_config",
            "user_id",
            existing_type=sa.Uuid(),
            nullable=True,
        )
    for constraint_name in {
        "cloud_repo_config_user_id_git_owner_git_repo_name_key",
        "uq_cloud_repo_config_user_repo",
    }:
        if _has_unique_constraint("cloud_repo_config", constraint_name):
            op.drop_constraint(constraint_name, "cloud_repo_config", type_="unique")
    _create_index_once(
        "ix_cloud_repo_config_organization_id",
        "cloud_repo_config",
        ["organization_id"],
    )
    _create_index_once(
        "ux_cloud_repo_config_personal_repo",
        "cloud_repo_config",
        ["user_id", "git_owner", "git_repo_name"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'personal'"),
    )
    _create_index_once(
        "ux_cloud_repo_config_organization_repo",
        "cloud_repo_config",
        ["organization_id", "git_owner", "git_repo_name"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'organization'"),
    )
    if _has_table("cloud_repo_config") and not _has_check_constraint(
        "cloud_repo_config", "ck_cloud_repo_config_owner_scope"
    ):
        op.create_check_constraint(
            "ck_cloud_repo_config_owner_scope",
            "cloud_repo_config",
            "owner_scope IN ('personal', 'organization')",
        )
    if _has_table("cloud_repo_config") and not _has_check_constraint(
        "cloud_repo_config", "ck_cloud_repo_config_owner_fields"
    ):
        op.create_check_constraint(
            "ck_cloud_repo_config_owner_fields",
            "cloud_repo_config",
            "((owner_scope = 'personal' AND user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND user_id IS NULL))",
        )


def _create_slack_tables() -> None:
    if not _has_table("slack_workspace_connection"):
        op.create_table(
            "slack_workspace_connection",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=False),
            sa.Column("slack_team_id", sa.String(length=255), nullable=False),
            sa.Column("slack_team_name", sa.Text(), nullable=False),
            sa.Column("slack_bot_user_id", sa.String(length=255), nullable=False),
            sa.Column("bot_token_ciphertext", sa.Text(), nullable=False),
            sa.Column("bot_token_ciphertext_key_id", sa.String(length=255), nullable=False),
            sa.Column("bot_scopes", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=32), server_default="'active'", nullable=False),
            sa.Column("installed_by_user_id", sa.Uuid(), nullable=False),
            sa.Column("installed_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_validated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "status IN ('active', 'reauth_required', 'revoked')",
                name="ck_slack_workspace_connection_status",
            ),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["installed_by_user_id"], ["user.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("slack_team_id", name="uq_slack_workspace_connection_team"),
        )
    _create_index_once(
        "ix_slack_workspace_connection_organization_id",
        "slack_workspace_connection",
        ["organization_id"],
    )
    _create_index_once(
        "ix_slack_workspace_connection_installed_by_user_id",
        "slack_workspace_connection",
        ["installed_by_user_id"],
    )
    _create_index_once(
        "ux_slack_workspace_connection_active_org",
        "slack_workspace_connection",
        ["organization_id"],
        unique=True,
        postgresql_where=sa.text("status != 'revoked'"),
    )

    if not _has_table("slack_bot_config"):
        op.create_table(
            "slack_bot_config",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=False),
            sa.Column("slack_workspace_connection_id", sa.Uuid(), nullable=False),
            sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("repo_mode", sa.String(length=32), server_default="'auto'", nullable=False),
            sa.Column("fixed_cloud_repo_config_id", sa.Uuid(), nullable=True),
            sa.Column("allowed_cloud_repo_config_ids", sa.Text(), nullable=True),
            sa.Column("default_agent_kind", sa.String(length=32), nullable=True),
            sa.Column("default_agent_run_config_id", sa.Uuid(), nullable=True),
            sa.Column("allowed_slack_channel_ids", sa.Text(), nullable=True),
            sa.Column("ack_message_template", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "repo_mode IN ('fixed', 'auto')",
                name="ck_slack_bot_config_repo_mode",
            ),
            sa.CheckConstraint(
                "repo_mode != 'fixed' OR fixed_cloud_repo_config_id IS NOT NULL",
                name="ck_slack_bot_config_fixed_repo_present",
            ),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["slack_workspace_connection_id"],
                ["slack_workspace_connection.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["fixed_cloud_repo_config_id"],
                ["cloud_repo_config.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["default_agent_run_config_id"],
                ["cloud_agent_run_config.id"],
                ondelete="SET NULL",
            ),
            sa.UniqueConstraint("organization_id", name="uq_slack_bot_config_organization"),
        )
    _create_index_once(
        "ix_slack_bot_config_organization_id",
        "slack_bot_config",
        ["organization_id"],
    )
    _create_index_once(
        "ix_slack_bot_config_slack_workspace_connection_id",
        "slack_bot_config",
        ["slack_workspace_connection_id"],
    )
    _create_index_once(
        "ix_slack_bot_config_default_agent_run_config_id",
        "slack_bot_config",
        ["default_agent_run_config_id"],
    )

    if not _has_table("slack_thread_work"):
        op.create_table(
            "slack_thread_work",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=False),
            sa.Column("slack_team_id", sa.String(length=255), nullable=False),
            sa.Column("slack_channel_id", sa.String(length=255), nullable=False),
            sa.Column("slack_thread_ts", sa.String(length=255), nullable=False),
            sa.Column("cloud_workspace_id", sa.Uuid(), nullable=False),
            sa.Column("cloud_session_id", sa.String(length=255), nullable=True),
            sa.Column("cloud_workspace_exposure_id", sa.Uuid(), nullable=True),
            sa.Column("cloud_session_projection_id", sa.Uuid(), nullable=True),
            sa.Column("root_message_ts", sa.String(length=255), nullable=False),
            sa.Column("bot_ack_message_ts", sa.String(length=255), nullable=True),
            sa.Column("initial_repo_id", sa.Uuid(), nullable=False),
            sa.Column(
                "agent_run_config_snapshot_json",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=True,
            ),
            sa.Column("status", sa.String(length=32), server_default="'active'", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "status IN ('active', 'archived')",
                name="ck_slack_thread_work_status",
            ),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["cloud_workspace_id"],
                ["cloud_workspace.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["cloud_workspace_exposure_id"],
                ["cloud_workspace_exposure.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["cloud_session_projection_id"],
                ["cloud_sessions.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["initial_repo_id"],
                ["cloud_repo_config.id"],
                ondelete="RESTRICT",
            ),
            sa.UniqueConstraint(
                "slack_team_id",
                "slack_channel_id",
                "slack_thread_ts",
                name="uq_slack_thread_work_thread",
            ),
        )
    _create_index_once(
        "ix_slack_thread_work_organization_id",
        "slack_thread_work",
        ["organization_id"],
    )
    _create_index_once(
        "ix_slack_thread_work_cloud_workspace",
        "slack_thread_work",
        ["cloud_workspace_id"],
    )
    _create_index_once(
        "ix_slack_thread_work_cloud_session",
        "slack_thread_work",
        ["cloud_session_id"],
    )

    if not _has_table("slack_event_envelope_seen"):
        op.create_table(
            "slack_event_envelope_seen",
            sa.Column("slack_event_id", sa.String(length=255), primary_key=True, nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        )
    _create_index_once(
        "ix_slack_event_envelope_seen_organization_id",
        "slack_event_envelope_seen",
        ["organization_id"],
    )

    if not _has_table("slack_inbound_event_job"):
        op.create_table(
            "slack_inbound_event_job",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("slack_event_id", sa.String(length=255), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("slack_team_id", sa.String(length=255), nullable=True),
            sa.Column("event_type", sa.String(length=128), nullable=False),
            sa.Column(
                "payload_json",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
            ),
            sa.Column("status", sa.String(length=32), server_default="'queued'", nullable=False),
            sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
            sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_error_code", sa.String(length=128), nullable=True),
            sa.Column("last_error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "status IN ('queued', 'processing', 'completed', 'failed')",
                name="ck_slack_inbound_event_job_status",
            ),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        )
    _create_index_once(
        "ix_slack_inbound_event_job_slack_event_id",
        "slack_inbound_event_job",
        ["slack_event_id"],
    )
    _create_index_once(
        "ix_slack_inbound_event_job_organization_id",
        "slack_inbound_event_job",
        ["organization_id"],
    )
    _create_index_once(
        "ix_slack_inbound_event_job_status",
        "slack_inbound_event_job",
        ["status", "next_attempt_at"],
    )

    if not _has_table("slack_outbound_message_queue"):
        op.create_table(
            "slack_outbound_message_queue",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=False),
            sa.Column("slack_workspace_connection_id", sa.Uuid(), nullable=False),
            sa.Column("slack_team_id", sa.String(length=255), nullable=False),
            sa.Column("slack_channel_id", sa.String(length=255), nullable=False),
            sa.Column("slack_thread_ts", sa.String(length=255), nullable=True),
            sa.Column(
                "blocks_json",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
            ),
            sa.Column("fallback_text", sa.Text(), nullable=False),
            sa.Column("source", sa.String(length=32), nullable=False),
            sa.Column("source_event_id", sa.String(length=255), nullable=True),
            sa.Column("status", sa.String(length=32), server_default="'queued'", nullable=False),
            sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
            sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_error_code", sa.String(length=128), nullable=True),
            sa.Column("last_error_message", sa.Text(), nullable=True),
            sa.Column("sent_message_ts", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "status IN ('queued', 'sending', 'sent', 'failed', 'dropped')",
                name="ck_slack_outbound_status",
            ),
            sa.CheckConstraint(
                "source IN ('ack', 'turn', 'interaction', 'done', 'failed', 'admin')",
                name="ck_slack_outbound_source",
            ),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["slack_workspace_connection_id"],
                ["slack_workspace_connection.id"],
                ondelete="CASCADE",
            ),
        )
    _create_index_once(
        "ix_slack_outbound_message_queue_organization_id",
        "slack_outbound_message_queue",
        ["organization_id"],
    )
    _create_index_once(
        "ix_slack_outbound_message_queue_slack_workspace_connection_id",
        "slack_outbound_message_queue",
        ["slack_workspace_connection_id"],
    )
    _create_index_once(
        "ix_slack_outbound_message_queue_status",
        "slack_outbound_message_queue",
        ["status", "next_attempt_at"],
    )
    _create_index_once(
        "ux_slack_outbound_message_source_event",
        "slack_outbound_message_queue",
        ["slack_workspace_connection_id", "source_event_id"],
        unique=True,
        postgresql_where=sa.text("source_event_id IS NOT NULL"),
    )

    if not _has_table("cloud_repo_routing_profile"):
        op.create_table(
            "cloud_repo_routing_profile",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("cloud_repo_config_id", sa.Uuid(), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=False),
            sa.Column("display_name", sa.Text(), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("readme_summary", sa.Text(), nullable=True),
            sa.Column("languages_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column("topics_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column("cached_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["cloud_repo_config_id"],
                ["cloud_repo_config.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.UniqueConstraint(
                "cloud_repo_config_id",
                name="uq_cloud_repo_routing_profile_repo",
            ),
        )
    _create_index_once(
        "ix_cloud_repo_routing_profile_cloud_repo_config_id",
        "cloud_repo_routing_profile",
        ["cloud_repo_config_id"],
    )
    _create_index_once(
        "ix_cloud_repo_routing_profile_organization_id",
        "cloud_repo_routing_profile",
        ["organization_id"],
    )


def upgrade() -> None:
    _upgrade_cloud_repo_config()
    _create_slack_tables()


def downgrade() -> None:
    _drop_table_once("cloud_repo_routing_profile")
    _drop_table_once("slack_outbound_message_queue")
    _drop_table_once("slack_inbound_event_job")
    _drop_table_once("slack_event_envelope_seen")
    _drop_table_once("slack_thread_work")
    _drop_table_once("slack_bot_config")
    _drop_table_once("slack_workspace_connection")
