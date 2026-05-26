"""agent gateway bifrost router materialization

Revision ID: fa0b1c2d3e4f
Revises: e9f0a1b2c3d5
Create Date: 2026-05-25 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "fa0b1c2d3e4f"
down_revision: str | Sequence[str] | None = "e9f0a1b2c3d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {
        index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name)
    }


def _has_check_constraint(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return constraint_name in {
        constraint["name"]
        for constraint in sa.inspect(op.get_bind()).get_check_constraints(table_name)
    }


def _drop_index_once(table_name: str, index_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def _replace_check_constraint(table_name: str, constraint_name: str, condition: str) -> None:
    if _has_check_constraint(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_="check")
    if _has_table(table_name):
        op.create_check_constraint(constraint_name, table_name, condition)


def upgrade() -> None:
    _replace_check_constraint(
        "agent_gateway_provider_credential",
        "ck_agent_gateway_provider_credential_kind",
        (
            "provider_kind IN ('proliferate_bedrock_pool', 'anthropic_api_key', "
            "'openai_api_key', 'gemini_api_key', 'bedrock_assume_role', "
            "'openai_compatible')"
        ),
    )
    _replace_check_constraint(
        "agent_gateway_runtime_grant",
        "ck_agent_gateway_runtime_grant_protocol_facade",
        "protocol_facade IN ('anthropic', 'openai', 'genai')",
    )

    if not _has_table("agent_gateway_router_materialization"):
        op.create_table(
            "agent_gateway_router_materialization",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("router_kind", sa.String(length=32), nullable=False),
            sa.Column("router_object_kind", sa.String(length=32), nullable=False),
            sa.Column("object_scope", sa.String(length=32), nullable=False),
            sa.Column("policy_id", sa.UUID(), nullable=True),
            sa.Column("provider_credential_id", sa.UUID(), nullable=True),
            sa.Column("budget_subject_id", sa.UUID(), nullable=True),
            sa.Column("selection_id", sa.UUID(), nullable=True),
            sa.Column("sandbox_profile_id", sa.UUID(), nullable=True),
            sa.Column("target_id", sa.UUID(), nullable=True),
            sa.Column("cloud_sandbox_id", sa.UUID(), nullable=True),
            sa.Column("slot_generation", sa.Integer(), nullable=True),
            sa.Column("agent_kind", sa.String(length=32), nullable=True),
            sa.Column("protocol_facade", sa.String(length=32), nullable=True),
            sa.Column("router_object_id", sa.String(length=255), nullable=True),
            sa.Column("router_object_secret_ciphertext", sa.Text(), nullable=True),
            sa.Column(
                "router_object_secret_ciphertext_key_id",
                sa.String(length=64),
                nullable=True,
            ),
            sa.Column(
                "sync_status",
                sa.String(length=32),
                nullable=False,
                server_default="pending",
            ),
            sa.Column("sync_fingerprint", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
            sa.Column("last_reconciled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error_code", sa.String(length=128), nullable=True),
            sa.Column("last_error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "router_kind IN ('litellm_legacy', 'bifrost')",
                name="ck_agent_gateway_router_materialization_router_kind",
            ),
            sa.CheckConstraint(
                "router_object_kind IN ('provider_key', 'virtual_key')",
                name="ck_agent_gateway_router_materialization_object_kind",
            ),
            sa.CheckConstraint(
                "object_scope IN ('budget_subject', 'policy', 'runtime_selection')",
                name="ck_agent_gateway_router_materialization_object_scope",
            ),
            sa.CheckConstraint(
                "sync_status IN ('pending', 'synced', 'drifted', 'failed')",
                name="ck_agent_gateway_router_materialization_sync_status",
            ),
            sa.CheckConstraint(
                "status IN ('active', 'disabled', 'failed', 'revoked')",
                name="ck_agent_gateway_router_materialization_status",
            ),
            sa.ForeignKeyConstraint(
                ["budget_subject_id"],
                ["agent_gateway_budget_subject.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["cloud_sandbox_id"],
                ["cloud_sandbox.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["policy_id"],
                ["agent_gateway_policy.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["provider_credential_id"],
                ["agent_gateway_provider_credential.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["sandbox_profile_id"],
                ["sandbox_profile.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["selection_id"],
                ["sandbox_agent_auth_selection.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["target_id"],
                ["cloud_targets.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_agent_gateway_router_materialization_agent_kind",
            "agent_gateway_router_materialization",
            ["agent_kind"],
        )
        op.create_index(
            "ix_agent_gateway_router_materialization_budget_subject_id",
            "agent_gateway_router_materialization",
            ["budget_subject_id"],
        )
        op.create_index(
            "ix_agent_gateway_router_materialization_cloud_sandbox_id",
            "agent_gateway_router_materialization",
            ["cloud_sandbox_id"],
        )
        op.create_index(
            "ix_agent_gateway_router_materialization_object_id",
            "agent_gateway_router_materialization",
            ["router_kind", "router_object_id"],
        )
        op.create_index(
            "ix_agent_gateway_router_materialization_object_scope",
            "agent_gateway_router_materialization",
            ["object_scope"],
        )
        op.create_index(
            "ix_agent_gateway_router_materialization_policy_id",
            "agent_gateway_router_materialization",
            ["policy_id"],
        )
        op.create_index(
            "ix_agent_gateway_router_materialization_provider_credential_id",
            "agent_gateway_router_materialization",
            ["provider_credential_id"],
        )
        op.create_index(
            "ix_agent_gateway_router_materialization_router_kind",
            "agent_gateway_router_materialization",
            ["router_kind"],
        )
        op.create_index(
            "ix_agent_gateway_router_materialization_router_object_kind",
            "agent_gateway_router_materialization",
            ["router_object_kind"],
        )
        op.create_index(
            "ix_agent_gateway_router_materialization_sandbox_profile_id",
            "agent_gateway_router_materialization",
            ["sandbox_profile_id"],
        )
        op.create_index(
            "ix_agent_gateway_router_materialization_selection_id",
            "agent_gateway_router_materialization",
            ["selection_id"],
        )
        op.create_index(
            "ix_agent_gateway_router_materialization_status",
            "agent_gateway_router_materialization",
            ["status"],
        )
        op.create_index(
            "ix_agent_gateway_router_materialization_sync_status",
            "agent_gateway_router_materialization",
            ["sync_status"],
        )
        op.create_index(
            "ix_agent_gateway_router_materialization_target_id",
            "agent_gateway_router_materialization",
            ["target_id"],
        )
        op.create_index(
            "uq_agent_gateway_router_materialization_runtime",
            "agent_gateway_router_materialization",
            [
                "router_kind",
                "router_object_kind",
                "object_scope",
                "selection_id",
                "target_id",
                "cloud_sandbox_id",
                "slot_generation",
            ],
            unique=True,
            postgresql_where=sa.text(
                "object_scope = 'runtime_selection' AND status != 'revoked'"
            ),
        )
        op.create_index(
            "uq_agent_gateway_router_materialization_policy_object",
            "agent_gateway_router_materialization",
            ["router_kind", "router_object_kind", "object_scope", "policy_id"],
            unique=True,
            postgresql_where=sa.text("object_scope = 'policy' AND status != 'revoked'"),
        )
        op.create_index(
            "uq_agent_gateway_router_materialization_budget_object",
            "agent_gateway_router_materialization",
            ["router_kind", "router_object_kind", "object_scope", "budget_subject_id"],
            unique=True,
            postgresql_where=sa.text(
                "object_scope = 'budget_subject' AND status != 'revoked'"
            ),
        )

    if not _has_table("agent_gateway_llm_usage_event"):
        op.create_table(
            "agent_gateway_llm_usage_event",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("router_kind", sa.String(length=32), nullable=False),
            sa.Column("router_log_id", sa.String(length=255), nullable=False),
            sa.Column("router_virtual_key_id", sa.String(length=255), nullable=True),
            sa.Column("router_provider_key_id", sa.String(length=255), nullable=True),
            sa.Column("materialization_id", sa.UUID(), nullable=True),
            sa.Column("policy_id", sa.UUID(), nullable=True),
            sa.Column("budget_subject_id", sa.UUID(), nullable=True),
            sa.Column("owner_scope", sa.String(length=32), nullable=True),
            sa.Column("owner_user_id", sa.UUID(), nullable=True),
            sa.Column("organization_id", sa.UUID(), nullable=True),
            sa.Column("agent_kind", sa.String(length=32), nullable=True),
            sa.Column("protocol_facade", sa.String(length=32), nullable=True),
            sa.Column("provider", sa.String(length=64), nullable=True),
            sa.Column("model", sa.String(length=255), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=True),
            sa.Column("cost_usd", sa.String(length=64), nullable=False, server_default="0"),
            sa.Column("prompt_tokens", sa.Integer(), nullable=True),
            sa.Column("completion_tokens", sa.Integer(), nullable=True),
            sa.Column("total_tokens", sa.Integer(), nullable=True),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("raw_usage_json", sa.Text(), nullable=False, server_default="{}"),
            sa.ForeignKeyConstraint(
                ["budget_subject_id"],
                ["agent_gateway_budget_subject.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["materialization_id"],
                ["agent_gateway_router_materialization.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organization.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["owner_user_id"],
                ["user.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["policy_id"],
                ["agent_gateway_policy.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_agent_gateway_llm_usage_event_agent_kind",
            "agent_gateway_llm_usage_event",
            ["agent_kind"],
        )
        op.create_index(
            "ix_agent_gateway_llm_usage_event_budget_subject",
            "agent_gateway_llm_usage_event",
            ["budget_subject_id", "occurred_at"],
        )
        op.create_index(
            "ix_agent_gateway_llm_usage_event_budget_subject_id",
            "agent_gateway_llm_usage_event",
            ["budget_subject_id"],
        )
        op.create_index(
            "ix_agent_gateway_llm_usage_event_materialization_id",
            "agent_gateway_llm_usage_event",
            ["materialization_id"],
        )
        op.create_index(
            "ix_agent_gateway_llm_usage_event_organization_id",
            "agent_gateway_llm_usage_event",
            ["organization_id"],
        )
        op.create_index(
            "ix_agent_gateway_llm_usage_event_owner_user_id",
            "agent_gateway_llm_usage_event",
            ["owner_user_id"],
        )
        op.create_index(
            "ix_agent_gateway_llm_usage_event_policy_id",
            "agent_gateway_llm_usage_event",
            ["policy_id"],
        )
        op.create_index(
            "ix_agent_gateway_llm_usage_event_router_kind",
            "agent_gateway_llm_usage_event",
            ["router_kind"],
        )
        op.create_index(
            "ix_agent_gateway_llm_usage_event_router_virtual_key",
            "agent_gateway_llm_usage_event",
            ["router_kind", "router_virtual_key_id"],
        )
        op.create_index(
            "uq_agent_gateway_llm_usage_event_router_log",
            "agent_gateway_llm_usage_event",
            ["router_kind", "router_log_id"],
            unique=True,
        )

    if not _has_table("agent_gateway_usage_import_cursor"):
        op.create_table(
            "agent_gateway_usage_import_cursor",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("router_kind", sa.String(length=32), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_seen_router_log_id", sa.String(length=255), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_agent_gateway_usage_import_cursor_router_kind",
            "agent_gateway_usage_import_cursor",
            ["router_kind"],
        )
        op.create_index(
            "uq_agent_gateway_usage_import_cursor_router",
            "agent_gateway_usage_import_cursor",
            ["router_kind"],
            unique=True,
        )


def downgrade() -> None:
    if _has_table("agent_gateway_usage_import_cursor"):
        _drop_index_once(
            "agent_gateway_usage_import_cursor",
            "uq_agent_gateway_usage_import_cursor_router",
        )
        _drop_index_once(
            "agent_gateway_usage_import_cursor",
            "ix_agent_gateway_usage_import_cursor_router_kind",
        )
        op.drop_table("agent_gateway_usage_import_cursor")

    if _has_table("agent_gateway_llm_usage_event"):
        for index_name in (
            "uq_agent_gateway_llm_usage_event_router_log",
            "ix_agent_gateway_llm_usage_event_router_virtual_key",
            "ix_agent_gateway_llm_usage_event_router_kind",
            "ix_agent_gateway_llm_usage_event_policy_id",
            "ix_agent_gateway_llm_usage_event_owner_user_id",
            "ix_agent_gateway_llm_usage_event_organization_id",
            "ix_agent_gateway_llm_usage_event_materialization_id",
            "ix_agent_gateway_llm_usage_event_budget_subject_id",
            "ix_agent_gateway_llm_usage_event_budget_subject",
            "ix_agent_gateway_llm_usage_event_agent_kind",
        ):
            _drop_index_once("agent_gateway_llm_usage_event", index_name)
        op.drop_table("agent_gateway_llm_usage_event")

    if _has_table("agent_gateway_router_materialization"):
        for index_name in (
            "uq_agent_gateway_router_materialization_budget_object",
            "uq_agent_gateway_router_materialization_policy_object",
            "uq_agent_gateway_router_materialization_runtime",
            "ix_agent_gateway_router_materialization_target_id",
            "ix_agent_gateway_router_materialization_sync_status",
            "ix_agent_gateway_router_materialization_status",
            "ix_agent_gateway_router_materialization_selection_id",
            "ix_agent_gateway_router_materialization_sandbox_profile_id",
            "ix_agent_gateway_router_materialization_router_object_kind",
            "ix_agent_gateway_router_materialization_router_kind",
            "ix_agent_gateway_router_materialization_provider_credential_id",
            "ix_agent_gateway_router_materialization_policy_id",
            "ix_agent_gateway_router_materialization_object_scope",
            "ix_agent_gateway_router_materialization_object_id",
            "ix_agent_gateway_router_materialization_cloud_sandbox_id",
            "ix_agent_gateway_router_materialization_budget_subject_id",
            "ix_agent_gateway_router_materialization_agent_kind",
        ):
            _drop_index_once("agent_gateway_router_materialization", index_name)
        op.drop_table("agent_gateway_router_materialization")

    _replace_check_constraint(
        "agent_gateway_runtime_grant",
        "ck_agent_gateway_runtime_grant_protocol_facade",
        "protocol_facade IN ('anthropic', 'openai')",
    )
    _replace_check_constraint(
        "agent_gateway_provider_credential",
        "ck_agent_gateway_provider_credential_kind",
        (
            "provider_kind IN ('proliferate_bedrock_pool', 'anthropic_api_key', "
            "'openai_api_key', 'bedrock_assume_role', 'openai_compatible')"
        ),
    )
