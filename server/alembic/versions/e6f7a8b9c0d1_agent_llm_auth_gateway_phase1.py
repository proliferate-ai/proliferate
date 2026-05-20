"""Add agent LLM auth gateway Phase 1 schema.

Revision ID: e6f7a8b9c0d1
Revises: f8a9b0c1d2e3
Create Date: 2026-05-17 12:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "e6f7a8b9c0d1"
down_revision: str | None = "f8a9b0c1d2e3"
branch_labels: str | None = None
depends_on: str | None = None

_AGENT_KINDS = ("claude", "codex", "opencode", "gemini")
_OWNER_SCOPES = ("system", "personal", "organization")
_PROFILE_OWNER_SCOPES = ("personal", "organization")
_CREDENTIAL_KINDS = ("managed_gateway", "synced_path")
_CREDENTIAL_STATUSES = ("pending", "ready", "needs_resync", "invalid", "revoked")
_SHARE_STATUSES = ("active", "revoked")
_POLICY_KINDS = ("proliferate_managed", "org_byok", "personal_byok")
_BUDGET_KINDS = ("proliferate_managed",)
_SYNC_STATUSES = ("pending", "synced", "drifted", "failed")
_POLICY_STATUSES = ("provisioning", "ready", "invalid", "revoked")
_BUDGET_STATUSES = ("ready", "exhausted", "invalid", "revoked")
_PROVIDER_KINDS = (
    "proliferate_bedrock_pool",
    "anthropic_api_key",
    "openai_api_key",
    "bedrock_assume_role",
    "openai_compatible",
)
_VALIDATION_STATUSES = ("unvalidated", "valid", "invalid")
_MATERIALIZATION_MODES = ("gateway_env", "synced_files")
_SELECTION_STATUSES = ("active", "needs_resync", "invalid")
_TARGET_STATE_STATUSES = ("pending", "materializing", "applied", "failed", "superseded")
_PROTOCOL_FACADES = ("anthropic", "openai")
_PROFILE_STATUSES = ("active", "archived")


def _in_constraint(column_name: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column_name} IN ({quoted})"


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


def _create_table_once(
    table_name: str,
    *columns: sa.SchemaItem,
    **kwargs: object,
) -> None:
    if not _has_table(table_name):
        op.create_table(table_name, *columns, **kwargs)


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    **kwargs: object,
) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns, **kwargs)


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def _drop_table_once(table_name: str) -> None:
    if _has_table(table_name):
        op.drop_table(table_name)


def upgrade() -> None:
    _create_table_once(
        "sandbox_profile",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_scope", sa.String(length=32), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("managed_target_id", sa.Uuid(), nullable=True),
        sa.Column("agent_auth_revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            _in_constraint("owner_scope", _PROFILE_OWNER_SCOPES),
            name="ck_sandbox_profile_owner_scope",
        ),
        sa.CheckConstraint(
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND owner_user_id IS NULL "
            "AND organization_id IS NOT NULL))",
            name="ck_sandbox_profile_owner_fields",
        ),
        sa.CheckConstraint(
            _in_constraint("status", _PROFILE_STATUSES), name="ck_sandbox_profile_status"
        ),
        sa.ForeignKeyConstraint(["managed_target_id"], ["cloud_targets.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_index_once(
        "uq_sandbox_profile_active_personal_user",
        "sandbox_profile",
        ["owner_user_id"],
        unique=True,
        postgresql_where=sa.text(
            "owner_scope = 'personal' AND deleted_at IS NULL AND status = 'active'"
        ),
    )
    _create_index_once(
        "uq_sandbox_profile_active_organization",
        "sandbox_profile",
        ["organization_id"],
        unique=True,
        postgresql_where=sa.text(
            "owner_scope = 'organization' AND deleted_at IS NULL AND status = 'active'"
        ),
    )
    _create_index_once("ix_sandbox_profile_owner_scope", "sandbox_profile", ["owner_scope"])
    _create_index_once("ix_sandbox_profile_owner_user_id", "sandbox_profile", ["owner_user_id"])
    _create_index_once(
        "ix_sandbox_profile_organization_id", "sandbox_profile", ["organization_id"]
    )
    _create_index_once(
        "ix_sandbox_profile_managed_target_id", "sandbox_profile", ["managed_target_id"]
    )
    _create_index_once("ix_sandbox_profile_status", "sandbox_profile", ["status"])

    _create_table_once(
        "sandbox_profile_agent_auth_revision",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("sandbox_profile_id", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=128), nullable=False),
        sa.Column("force_restart", sa.Boolean(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["sandbox_profile_id"], ["sandbox_profile.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_index_once(
        "uq_sandbox_profile_agent_auth_revision_profile_revision",
        "sandbox_profile_agent_auth_revision",
        ["sandbox_profile_id", "revision"],
        unique=True,
    )
    _create_index_once(
        "ix_sandbox_profile_agent_auth_revision_sandbox_profile_id",
        "sandbox_profile_agent_auth_revision",
        ["sandbox_profile_id"],
    )
    _create_index_once(
        "ix_sandbox_profile_agent_auth_revision_created_by_user_id",
        "sandbox_profile_agent_auth_revision",
        ["created_by_user_id"],
    )

    _create_table_once(
        "agent_auth_credential",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_scope", sa.String(length=32), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("agent_kind", sa.String(length=32), nullable=False),
        sa.Column("credential_kind", sa.String(length=32), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("redacted_summary_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("legacy_cloud_credential_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            _in_constraint("owner_scope", _OWNER_SCOPES),
            name="ck_agent_auth_credential_owner_scope",
        ),
        sa.CheckConstraint(
            "((owner_scope = 'system' AND owner_user_id IS NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND owner_user_id IS NULL "
            "AND organization_id IS NOT NULL))",
            name="ck_agent_auth_credential_owner_fields",
        ),
        sa.CheckConstraint(
            _in_constraint("agent_kind", _AGENT_KINDS), name="ck_agent_auth_credential_agent_kind"
        ),
        sa.CheckConstraint(
            _in_constraint("credential_kind", _CREDENTIAL_KINDS),
            name="ck_agent_auth_credential_kind",
        ),
        sa.CheckConstraint(
            _in_constraint("status", _CREDENTIAL_STATUSES), name="ck_agent_auth_credential_status"
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["legacy_cloud_credential_id"], ["cloud_credential.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("legacy_cloud_credential_id"),
    )
    _create_index_once(
        "ix_agent_auth_credential_agent_kind", "agent_auth_credential", ["agent_kind"]
    )
    _create_index_once(
        "ix_agent_auth_credential_credential_kind", "agent_auth_credential", ["credential_kind"]
    )
    _create_index_once("ix_agent_auth_credential_status", "agent_auth_credential", ["status"])
    _create_index_once(
        "ix_agent_auth_credential_owner_scope", "agent_auth_credential", ["owner_scope"]
    )
    _create_index_once(
        "ix_agent_auth_credential_owner_user_id", "agent_auth_credential", ["owner_user_id"]
    )
    _create_index_once(
        "ix_agent_auth_credential_organization_id", "agent_auth_credential", ["organization_id"]
    )
    _create_index_once(
        "ix_agent_auth_credential_created_by_user_id",
        "agent_auth_credential",
        ["created_by_user_id"],
    )
    _create_index_once(
        "ix_agent_auth_credential_owner_user_kind_status",
        "agent_auth_credential",
        ["owner_scope", "owner_user_id", "agent_kind", "status"],
    )
    _create_index_once(
        "ix_agent_auth_credential_org_kind_status",
        "agent_auth_credential",
        ["owner_scope", "organization_id", "agent_kind", "status"],
    )

    _create_table_once(
        "agent_auth_credential_share",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("credential_id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("share_scope", sa.String(length=32), nullable=False),
        sa.Column("shared_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("allowed_agent_kind", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by_user_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "share_scope = 'organization'", name="ck_agent_auth_credential_share_scope"
        ),
        sa.CheckConstraint(
            _in_constraint("status", _SHARE_STATUSES), name="ck_agent_auth_credential_share_status"
        ),
        sa.CheckConstraint(
            _in_constraint("allowed_agent_kind", _AGENT_KINDS),
            name="ck_agent_auth_credential_share_agent_kind",
        ),
        sa.ForeignKeyConstraint(
            ["credential_id"], ["agent_auth_credential.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["revoked_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["shared_by_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_index_once(
        "ix_agent_auth_credential_share_credential_id",
        "agent_auth_credential_share",
        ["credential_id"],
    )
    _create_index_once(
        "ix_agent_auth_credential_share_owner_user_id",
        "agent_auth_credential_share",
        ["owner_user_id"],
    )
    _create_index_once(
        "ix_agent_auth_credential_share_organization_id",
        "agent_auth_credential_share",
        ["organization_id"],
    )
    _create_index_once(
        "ix_agent_auth_credential_share_shared_by_user_id",
        "agent_auth_credential_share",
        ["shared_by_user_id"],
    )
    _create_index_once(
        "ix_agent_auth_credential_share_revoked_by_user_id",
        "agent_auth_credential_share",
        ["revoked_by_user_id"],
    )
    _create_index_once(
        "uq_agent_auth_active_share_credential_org",
        "agent_auth_credential_share",
        ["credential_id", "organization_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )
    _create_index_once(
        "ix_agent_auth_share_org_kind_status",
        "agent_auth_credential_share",
        ["organization_id", "allowed_agent_kind", "status"],
    )

    _create_table_once(
        "agent_gateway_budget_subject",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("budget_kind", sa.String(length=32), nullable=False),
        sa.Column("owner_scope", sa.String(length=32), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("litellm_team_id", sa.String(length=255), nullable=True),
        sa.Column("included_budget_usd", sa.String(length=64), nullable=False),
        sa.Column("budget_duration", sa.String(length=32), nullable=False),
        sa.Column("litellm_sync_status", sa.String(length=32), nullable=False),
        sa.Column("litellm_sync_fingerprint", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("last_provisioned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_litellm_reconciled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(length=128), nullable=True),
        sa.Column("last_error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            _in_constraint("budget_kind", _BUDGET_KINDS),
            name="ck_agent_gateway_budget_subject_kind",
        ),
        sa.CheckConstraint(
            "owner_scope = 'organization'", name="ck_agent_gateway_budget_subject_owner_scope"
        ),
        sa.CheckConstraint(
            "organization_id IS NOT NULL", name="ck_agent_gateway_budget_subject_org"
        ),
        sa.CheckConstraint(
            _in_constraint("litellm_sync_status", _SYNC_STATUSES),
            name="ck_agent_gateway_budget_subject_sync_status",
        ),
        sa.CheckConstraint(
            _in_constraint("status", _BUDGET_STATUSES),
            name="ck_agent_gateway_budget_subject_status",
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_index_once(
        "ix_agent_gateway_budget_subject_organization_id",
        "agent_gateway_budget_subject",
        ["organization_id"],
    )
    _create_index_once(
        "ix_agent_gateway_budget_subject_litellm_sync_status",
        "agent_gateway_budget_subject",
        ["litellm_sync_status"],
    )
    _create_index_once(
        "ix_agent_gateway_budget_subject_status", "agent_gateway_budget_subject", ["status"]
    )
    _create_index_once(
        "uq_agent_gateway_managed_budget_subject_org",
        "agent_gateway_budget_subject",
        ["organization_id"],
        unique=True,
        postgresql_where=sa.text("budget_kind = 'proliferate_managed' AND status != 'revoked'"),
    )

    _create_table_once(
        "agent_gateway_policy",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("credential_id", sa.Uuid(), nullable=False),
        sa.Column("policy_kind", sa.String(length=32), nullable=False),
        sa.Column("owner_scope", sa.String(length=32), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("budget_subject_id", sa.Uuid(), nullable=True),
        sa.Column("litellm_team_id", sa.String(length=255), nullable=True),
        sa.Column("litellm_virtual_key_id", sa.String(length=255), nullable=True),
        sa.Column("litellm_virtual_key_ciphertext", sa.Text(), nullable=True),
        sa.Column("litellm_virtual_key_ciphertext_key_id", sa.String(length=64), nullable=True),
        sa.Column("litellm_sync_status", sa.String(length=32), nullable=False),
        sa.Column("litellm_sync_fingerprint", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("last_provisioned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_litellm_reconciled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(length=128), nullable=True),
        sa.Column("last_error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            _in_constraint("policy_kind", _POLICY_KINDS), name="ck_agent_gateway_policy_kind"
        ),
        sa.CheckConstraint(
            _in_constraint("owner_scope", _OWNER_SCOPES),
            name="ck_agent_gateway_policy_owner_scope",
        ),
        sa.CheckConstraint(
            "((owner_scope = 'system' AND owner_user_id IS NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND owner_user_id IS NULL "
            "AND organization_id IS NOT NULL))",
            name="ck_agent_gateway_policy_owner_fields",
        ),
        sa.CheckConstraint(
            "((policy_kind = 'proliferate_managed' AND budget_subject_id IS NOT NULL) OR "
            "(policy_kind != 'proliferate_managed' AND budget_subject_id IS NULL))",
            name="ck_agent_gateway_policy_budget_subject",
        ),
        sa.CheckConstraint(
            _in_constraint("litellm_sync_status", _SYNC_STATUSES),
            name="ck_agent_gateway_policy_sync_status",
        ),
        sa.CheckConstraint(
            _in_constraint("status", _POLICY_STATUSES), name="ck_agent_gateway_policy_status"
        ),
        sa.ForeignKeyConstraint(
            ["budget_subject_id"], ["agent_gateway_budget_subject.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["credential_id"], ["agent_auth_credential.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_index_once(
        "uq_agent_gateway_policy_credential",
        "agent_gateway_policy",
        ["credential_id"],
        unique=True,
    )
    _create_index_once(
        "ix_agent_gateway_policy_credential_id", "agent_gateway_policy", ["credential_id"]
    )
    _create_index_once(
        "ix_agent_gateway_policy_policy_kind", "agent_gateway_policy", ["policy_kind"]
    )
    _create_index_once(
        "ix_agent_gateway_policy_owner_scope", "agent_gateway_policy", ["owner_scope"]
    )
    _create_index_once(
        "ix_agent_gateway_policy_owner_user_id", "agent_gateway_policy", ["owner_user_id"]
    )
    _create_index_once(
        "ix_agent_gateway_policy_organization_id", "agent_gateway_policy", ["organization_id"]
    )
    _create_index_once(
        "ix_agent_gateway_policy_budget_subject_id", "agent_gateway_policy", ["budget_subject_id"]
    )
    _create_index_once(
        "ix_agent_gateway_policy_litellm_sync_status",
        "agent_gateway_policy",
        ["litellm_sync_status"],
    )
    _create_index_once("ix_agent_gateway_policy_status", "agent_gateway_policy", ["status"])

    _create_table_once(
        "agent_gateway_provider_credential",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("policy_id", sa.Uuid(), nullable=False),
        sa.Column("provider_kind", sa.String(length=64), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.Column("payload_ciphertext_key_id", sa.String(length=64), nullable=False),
        sa.Column("redacted_summary_json", sa.Text(), nullable=False),
        sa.Column("validation_status", sa.String(length=32), nullable=False),
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("validation_error_code", sa.String(length=128), nullable=True),
        sa.Column("validation_error_message", sa.Text(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            _in_constraint("provider_kind", _PROVIDER_KINDS),
            name="ck_agent_gateway_provider_credential_kind",
        ),
        sa.CheckConstraint(
            _in_constraint("validation_status", _VALIDATION_STATUSES),
            name="ck_agent_gateway_provider_credential_validation_status",
        ),
        sa.ForeignKeyConstraint(["policy_id"], ["agent_gateway_policy.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_index_once(
        "uq_agent_gateway_provider_credential_policy",
        "agent_gateway_provider_credential",
        ["policy_id"],
        unique=True,
    )
    _create_index_once(
        "ix_agent_gateway_provider_credential_policy_id",
        "agent_gateway_provider_credential",
        ["policy_id"],
    )
    _create_index_once(
        "ix_agent_gateway_provider_credential_provider_kind",
        "agent_gateway_provider_credential",
        ["provider_kind"],
    )
    _create_index_once(
        "ix_agent_gateway_provider_credential_validation_status",
        "agent_gateway_provider_credential",
        ["validation_status"],
    )

    _create_table_once(
        "sandbox_agent_auth_selection",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("sandbox_profile_id", sa.Uuid(), nullable=False),
        sa.Column("owner_scope", sa.String(length=32), nullable=False),
        sa.Column("agent_kind", sa.String(length=32), nullable=False),
        sa.Column("credential_id", sa.Uuid(), nullable=False),
        sa.Column("credential_share_id", sa.Uuid(), nullable=True),
        sa.Column("materialization_mode", sa.String(length=32), nullable=False),
        sa.Column("selected_revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("last_error_code", sa.String(length=128), nullable=True),
        sa.Column("last_error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            _in_constraint("owner_scope", _PROFILE_OWNER_SCOPES),
            name="ck_sandbox_agent_auth_selection_owner_scope",
        ),
        sa.CheckConstraint(
            _in_constraint("agent_kind", _AGENT_KINDS),
            name="ck_sandbox_agent_auth_selection_agent_kind",
        ),
        sa.CheckConstraint(
            _in_constraint("materialization_mode", _MATERIALIZATION_MODES),
            name="ck_sandbox_agent_auth_selection_materialization_mode",
        ),
        sa.CheckConstraint(
            _in_constraint("status", _SELECTION_STATUSES),
            name="ck_sandbox_agent_auth_selection_status",
        ),
        sa.CheckConstraint(
            "selected_revision > 0", name="ck_sandbox_agent_auth_selection_revision_positive"
        ),
        sa.ForeignKeyConstraint(
            ["credential_id"], ["agent_auth_credential.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["credential_share_id"], ["agent_auth_credential_share.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["sandbox_profile_id"], ["sandbox_profile.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_index_once(
        "uq_sandbox_agent_auth_selection_profile_agent",
        "sandbox_agent_auth_selection",
        ["sandbox_profile_id", "agent_kind"],
        unique=True,
    )
    _create_index_once(
        "ix_sandbox_agent_auth_selection_sandbox_profile_id",
        "sandbox_agent_auth_selection",
        ["sandbox_profile_id"],
    )
    _create_index_once(
        "ix_sandbox_agent_auth_selection_credential_id",
        "sandbox_agent_auth_selection",
        ["credential_id"],
    )
    _create_index_once(
        "ix_sandbox_agent_auth_selection_credential_share_id",
        "sandbox_agent_auth_selection",
        ["credential_share_id"],
    )
    _create_index_once(
        "ix_sandbox_agent_auth_selection_owner_scope",
        "sandbox_agent_auth_selection",
        ["owner_scope"],
    )
    _create_index_once(
        "ix_sandbox_agent_auth_selection_agent_kind",
        "sandbox_agent_auth_selection",
        ["agent_kind"],
    )
    _create_index_once(
        "ix_sandbox_agent_auth_selection_status", "sandbox_agent_auth_selection", ["status"]
    )

    _create_table_once(
        "sandbox_profile_agent_auth_target_state",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("sandbox_profile_id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("desired_revision", sa.Integer(), nullable=False),
        sa.Column("applied_revision", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("force_restart_required", sa.Boolean(), nullable=False),
        sa.Column("last_command_id", sa.Uuid(), nullable=True),
        sa.Column("last_worker_id", sa.Uuid(), nullable=True),
        sa.Column("last_attempted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(length=128), nullable=True),
        sa.Column("last_error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            _in_constraint("status", _TARGET_STATE_STATUSES),
            name="ck_sandbox_profile_agent_auth_target_state_status",
        ),
        sa.CheckConstraint(
            "applied_revision IS NULL OR applied_revision <= desired_revision",
            name="ck_sandbox_profile_agent_auth_target_state_applied_lte_desired",
        ),
        sa.ForeignKeyConstraint(["last_command_id"], ["cloud_commands.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["last_worker_id"], ["cloud_workers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["sandbox_profile_id"], ["sandbox_profile.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_index_once(
        "uq_sandbox_profile_agent_auth_target_state_target_profile",
        "sandbox_profile_agent_auth_target_state",
        ["target_id", "sandbox_profile_id"],
        unique=True,
    )
    _create_index_once(
        "ix_sandbox_profile_agent_auth_target_state_sandbox_profile_id",
        "sandbox_profile_agent_auth_target_state",
        ["sandbox_profile_id"],
    )
    _create_index_once(
        "ix_sandbox_profile_agent_auth_target_state_target_id",
        "sandbox_profile_agent_auth_target_state",
        ["target_id"],
    )
    _create_index_once(
        "ix_sandbox_profile_agent_auth_target_state_last_command_id",
        "sandbox_profile_agent_auth_target_state",
        ["last_command_id"],
    )
    _create_index_once(
        "ix_sandbox_profile_agent_auth_target_state_last_worker_id",
        "sandbox_profile_agent_auth_target_state",
        ["last_worker_id"],
    )
    _create_index_once(
        "ix_sandbox_profile_agent_auth_target_state_status_revision",
        "sandbox_profile_agent_auth_target_state",
        ["target_id", "status", "desired_revision", "applied_revision"],
    )

    _create_table_once(
        "agent_gateway_runtime_grant",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("hash_key_id", sa.String(length=64), nullable=False),
        sa.Column("policy_id", sa.Uuid(), nullable=False),
        sa.Column("credential_id", sa.Uuid(), nullable=False),
        sa.Column("selection_id", sa.Uuid(), nullable=False),
        sa.Column("issued_profile_revision", sa.Integer(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("sandbox_profile_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("agent_kind", sa.String(length=32), nullable=False),
        sa.Column("protocol_facade", sa.String(length=32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            _in_constraint("agent_kind", _AGENT_KINDS),
            name="ck_agent_gateway_runtime_grant_agent_kind",
        ),
        sa.CheckConstraint(
            _in_constraint("protocol_facade", _PROTOCOL_FACADES),
            name="ck_agent_gateway_runtime_grant_protocol_facade",
        ),
        sa.ForeignKeyConstraint(
            ["credential_id"], ["agent_auth_credential.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["policy_id"], ["agent_gateway_policy.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["sandbox_profile_id"], ["sandbox_profile.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["selection_id"], ["sandbox_agent_auth_selection.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_index_once(
        "uq_agent_gateway_runtime_grant_token_hash",
        "agent_gateway_runtime_grant",
        ["token_hash"],
        unique=True,
    )
    _create_index_once(
        "ix_agent_gateway_runtime_grant_policy_id", "agent_gateway_runtime_grant", ["policy_id"]
    )
    _create_index_once(
        "ix_agent_gateway_runtime_grant_credential_id",
        "agent_gateway_runtime_grant",
        ["credential_id"],
    )
    _create_index_once(
        "ix_agent_gateway_runtime_grant_selection_id",
        "agent_gateway_runtime_grant",
        ["selection_id"],
    )
    _create_index_once(
        "ix_agent_gateway_runtime_grant_target_id", "agent_gateway_runtime_grant", ["target_id"]
    )
    _create_index_once(
        "ix_agent_gateway_runtime_grant_sandbox_profile_id",
        "agent_gateway_runtime_grant",
        ["sandbox_profile_id"],
    )
    _create_index_once(
        "ix_agent_gateway_runtime_grant_organization_id",
        "agent_gateway_runtime_grant",
        ["organization_id"],
    )
    _create_index_once(
        "ix_agent_gateway_runtime_grant_user_id", "agent_gateway_runtime_grant", ["user_id"]
    )
    _create_index_once(
        "ix_agent_gateway_runtime_grant_agent_kind", "agent_gateway_runtime_grant", ["agent_kind"]
    )
    _create_index_once(
        "ix_agent_gateway_runtime_grant_expires_at", "agent_gateway_runtime_grant", ["expires_at"]
    )
    _create_index_once(
        "ix_agent_gateway_runtime_grant_policy_revocation_expiry",
        "agent_gateway_runtime_grant",
        ["policy_id", "revoked_at", "expires_at"],
    )
    _create_index_once(
        "ix_agent_gateway_runtime_grant_target_profile_agent",
        "agent_gateway_runtime_grant",
        ["target_id", "sandbox_profile_id", "agent_kind"],
    )
    _create_index_once(
        "ix_agent_gateway_runtime_grant_selection_revision",
        "agent_gateway_runtime_grant",
        ["selection_id", "issued_profile_revision"],
    )

    _create_table_once(
        "agent_auth_audit_event",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("owner_scope", sa.String(length=32), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("credential_id", sa.Uuid(), nullable=True),
        sa.Column("sandbox_profile_id", sa.Uuid(), nullable=True),
        sa.Column("target_id", sa.Uuid(), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["credential_id"], ["agent_auth_credential.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["sandbox_profile_id"], ["sandbox_profile.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_index_once("ix_agent_auth_audit_event_action", "agent_auth_audit_event", ["action"])
    _create_index_once(
        "ix_agent_auth_audit_event_actor_user_id", "agent_auth_audit_event", ["actor_user_id"]
    )
    _create_index_once(
        "ix_agent_auth_audit_event_owner_scope", "agent_auth_audit_event", ["owner_scope"]
    )
    _create_index_once(
        "ix_agent_auth_audit_event_owner_user_id", "agent_auth_audit_event", ["owner_user_id"]
    )
    _create_index_once(
        "ix_agent_auth_audit_event_organization_id", "agent_auth_audit_event", ["organization_id"]
    )
    _create_index_once(
        "ix_agent_auth_audit_event_credential_id", "agent_auth_audit_event", ["credential_id"]
    )
    _create_index_once(
        "ix_agent_auth_audit_event_sandbox_profile_id",
        "agent_auth_audit_event",
        ["sandbox_profile_id"],
    )
    _create_index_once(
        "ix_agent_auth_audit_event_target_id", "agent_auth_audit_event", ["target_id"]
    )
    _create_index_once(
        "ix_agent_auth_audit_event_actor_created",
        "agent_auth_audit_event",
        ["actor_user_id", "created_at"],
    )
    _create_index_once(
        "ix_agent_auth_audit_event_org_created",
        "agent_auth_audit_event",
        ["organization_id", "created_at"],
    )
    _create_index_once(
        "ix_agent_auth_audit_event_credential_created",
        "agent_auth_audit_event",
        ["credential_id", "created_at"],
    )


def downgrade() -> None:
    _drop_index_once(
        "ix_agent_auth_audit_event_credential_created", table_name="agent_auth_audit_event"
    )
    _drop_index_once("ix_agent_auth_audit_event_org_created", table_name="agent_auth_audit_event")
    _drop_index_once(
        "ix_agent_auth_audit_event_actor_created", table_name="agent_auth_audit_event"
    )
    _drop_index_once("ix_agent_auth_audit_event_target_id", table_name="agent_auth_audit_event")
    _drop_index_once(
        "ix_agent_auth_audit_event_sandbox_profile_id", table_name="agent_auth_audit_event"
    )
    _drop_index_once(
        "ix_agent_auth_audit_event_credential_id", table_name="agent_auth_audit_event"
    )
    _drop_index_once(
        "ix_agent_auth_audit_event_organization_id", table_name="agent_auth_audit_event"
    )
    _drop_index_once(
        "ix_agent_auth_audit_event_owner_user_id", table_name="agent_auth_audit_event"
    )
    _drop_index_once("ix_agent_auth_audit_event_owner_scope", table_name="agent_auth_audit_event")
    _drop_index_once(
        "ix_agent_auth_audit_event_actor_user_id", table_name="agent_auth_audit_event"
    )
    _drop_index_once("ix_agent_auth_audit_event_action", table_name="agent_auth_audit_event")
    _drop_table_once("agent_auth_audit_event")

    _drop_index_once(
        "ix_agent_gateway_runtime_grant_selection_revision",
        table_name="agent_gateway_runtime_grant",
    )
    _drop_index_once(
        "ix_agent_gateway_runtime_grant_target_profile_agent",
        table_name="agent_gateway_runtime_grant",
    )
    _drop_index_once(
        "ix_agent_gateway_runtime_grant_policy_revocation_expiry",
        table_name="agent_gateway_runtime_grant",
    )
    _drop_index_once(
        "ix_agent_gateway_runtime_grant_expires_at", table_name="agent_gateway_runtime_grant"
    )
    _drop_index_once(
        "ix_agent_gateway_runtime_grant_agent_kind", table_name="agent_gateway_runtime_grant"
    )
    _drop_index_once(
        "ix_agent_gateway_runtime_grant_user_id", table_name="agent_gateway_runtime_grant"
    )
    _drop_index_once(
        "ix_agent_gateway_runtime_grant_organization_id", table_name="agent_gateway_runtime_grant"
    )
    _drop_index_once(
        "ix_agent_gateway_runtime_grant_sandbox_profile_id",
        table_name="agent_gateway_runtime_grant",
    )
    _drop_index_once(
        "ix_agent_gateway_runtime_grant_target_id", table_name="agent_gateway_runtime_grant"
    )
    _drop_index_once(
        "ix_agent_gateway_runtime_grant_selection_id", table_name="agent_gateway_runtime_grant"
    )
    _drop_index_once(
        "ix_agent_gateway_runtime_grant_credential_id", table_name="agent_gateway_runtime_grant"
    )
    _drop_index_once(
        "ix_agent_gateway_runtime_grant_policy_id", table_name="agent_gateway_runtime_grant"
    )
    _drop_index_once(
        "uq_agent_gateway_runtime_grant_token_hash", table_name="agent_gateway_runtime_grant"
    )
    _drop_table_once("agent_gateway_runtime_grant")

    _drop_index_once(
        "ix_sandbox_profile_agent_auth_target_state_status_revision",
        table_name="sandbox_profile_agent_auth_target_state",
    )
    _drop_index_once(
        "ix_sandbox_profile_agent_auth_target_state_last_worker_id",
        table_name="sandbox_profile_agent_auth_target_state",
    )
    _drop_index_once(
        "ix_sandbox_profile_agent_auth_target_state_last_command_id",
        table_name="sandbox_profile_agent_auth_target_state",
    )
    _drop_index_once(
        "ix_sandbox_profile_agent_auth_target_state_target_id",
        table_name="sandbox_profile_agent_auth_target_state",
    )
    _drop_index_once(
        "ix_sandbox_profile_agent_auth_target_state_sandbox_profile_id",
        table_name="sandbox_profile_agent_auth_target_state",
    )
    _drop_index_once(
        "uq_sandbox_profile_agent_auth_target_state_target_profile",
        table_name="sandbox_profile_agent_auth_target_state",
    )
    _drop_table_once("sandbox_profile_agent_auth_target_state")

    _drop_index_once(
        "ix_sandbox_agent_auth_selection_status", table_name="sandbox_agent_auth_selection"
    )
    _drop_index_once(
        "ix_sandbox_agent_auth_selection_agent_kind", table_name="sandbox_agent_auth_selection"
    )
    _drop_index_once(
        "ix_sandbox_agent_auth_selection_owner_scope", table_name="sandbox_agent_auth_selection"
    )
    _drop_index_once(
        "ix_sandbox_agent_auth_selection_credential_share_id",
        table_name="sandbox_agent_auth_selection",
    )
    _drop_index_once(
        "ix_sandbox_agent_auth_selection_credential_id", table_name="sandbox_agent_auth_selection"
    )
    _drop_index_once(
        "ix_sandbox_agent_auth_selection_sandbox_profile_id",
        table_name="sandbox_agent_auth_selection",
    )
    _drop_index_once(
        "uq_sandbox_agent_auth_selection_profile_agent", table_name="sandbox_agent_auth_selection"
    )
    _drop_table_once("sandbox_agent_auth_selection")

    _drop_index_once(
        "ix_agent_gateway_provider_credential_validation_status",
        table_name="agent_gateway_provider_credential",
    )
    _drop_index_once(
        "ix_agent_gateway_provider_credential_provider_kind",
        table_name="agent_gateway_provider_credential",
    )
    _drop_index_once(
        "ix_agent_gateway_provider_credential_policy_id",
        table_name="agent_gateway_provider_credential",
    )
    _drop_index_once(
        "uq_agent_gateway_provider_credential_policy",
        table_name="agent_gateway_provider_credential",
    )
    _drop_table_once("agent_gateway_provider_credential")

    _drop_index_once("ix_agent_gateway_policy_status", table_name="agent_gateway_policy")
    _drop_index_once(
        "ix_agent_gateway_policy_litellm_sync_status", table_name="agent_gateway_policy"
    )
    _drop_index_once(
        "ix_agent_gateway_policy_budget_subject_id", table_name="agent_gateway_policy"
    )
    _drop_index_once("ix_agent_gateway_policy_organization_id", table_name="agent_gateway_policy")
    _drop_index_once("ix_agent_gateway_policy_owner_user_id", table_name="agent_gateway_policy")
    _drop_index_once("ix_agent_gateway_policy_owner_scope", table_name="agent_gateway_policy")
    _drop_index_once("ix_agent_gateway_policy_policy_kind", table_name="agent_gateway_policy")
    _drop_index_once("ix_agent_gateway_policy_credential_id", table_name="agent_gateway_policy")
    _drop_index_once("uq_agent_gateway_policy_credential", table_name="agent_gateway_policy")
    _drop_table_once("agent_gateway_policy")

    _drop_index_once(
        "uq_agent_gateway_managed_budget_subject_org", table_name="agent_gateway_budget_subject"
    )
    _drop_index_once(
        "ix_agent_gateway_budget_subject_status", table_name="agent_gateway_budget_subject"
    )
    _drop_index_once(
        "ix_agent_gateway_budget_subject_litellm_sync_status",
        table_name="agent_gateway_budget_subject",
    )
    _drop_index_once(
        "ix_agent_gateway_budget_subject_organization_id",
        table_name="agent_gateway_budget_subject",
    )
    _drop_table_once("agent_gateway_budget_subject")

    _drop_index_once(
        "ix_agent_auth_share_org_kind_status", table_name="agent_auth_credential_share"
    )
    _drop_index_once(
        "uq_agent_auth_active_share_credential_org", table_name="agent_auth_credential_share"
    )
    _drop_index_once(
        "ix_agent_auth_credential_share_revoked_by_user_id",
        table_name="agent_auth_credential_share",
    )
    _drop_index_once(
        "ix_agent_auth_credential_share_shared_by_user_id",
        table_name="agent_auth_credential_share",
    )
    _drop_index_once(
        "ix_agent_auth_credential_share_organization_id", table_name="agent_auth_credential_share"
    )
    _drop_index_once(
        "ix_agent_auth_credential_share_owner_user_id", table_name="agent_auth_credential_share"
    )
    _drop_index_once(
        "ix_agent_auth_credential_share_credential_id", table_name="agent_auth_credential_share"
    )
    _drop_table_once("agent_auth_credential_share")

    _drop_index_once(
        "ix_agent_auth_credential_org_kind_status", table_name="agent_auth_credential"
    )
    _drop_index_once(
        "ix_agent_auth_credential_owner_user_kind_status", table_name="agent_auth_credential"
    )
    _drop_index_once(
        "ix_agent_auth_credential_created_by_user_id", table_name="agent_auth_credential"
    )
    _drop_index_once(
        "ix_agent_auth_credential_organization_id", table_name="agent_auth_credential"
    )
    _drop_index_once("ix_agent_auth_credential_owner_user_id", table_name="agent_auth_credential")
    _drop_index_once("ix_agent_auth_credential_owner_scope", table_name="agent_auth_credential")
    _drop_index_once("ix_agent_auth_credential_status", table_name="agent_auth_credential")
    _drop_index_once(
        "ix_agent_auth_credential_credential_kind", table_name="agent_auth_credential"
    )
    _drop_index_once("ix_agent_auth_credential_agent_kind", table_name="agent_auth_credential")
    _drop_table_once("agent_auth_credential")

    _drop_index_once(
        "ix_sandbox_profile_agent_auth_revision_created_by_user_id",
        table_name="sandbox_profile_agent_auth_revision",
    )
    _drop_index_once(
        "ix_sandbox_profile_agent_auth_revision_sandbox_profile_id",
        table_name="sandbox_profile_agent_auth_revision",
    )
    _drop_index_once(
        "uq_sandbox_profile_agent_auth_revision_profile_revision",
        table_name="sandbox_profile_agent_auth_revision",
    )
    _drop_table_once("sandbox_profile_agent_auth_revision")

    _drop_index_once("ix_sandbox_profile_status", table_name="sandbox_profile")
    _drop_index_once("ix_sandbox_profile_managed_target_id", table_name="sandbox_profile")
    _drop_index_once("ix_sandbox_profile_organization_id", table_name="sandbox_profile")
    _drop_index_once("ix_sandbox_profile_owner_user_id", table_name="sandbox_profile")
    _drop_index_once("ix_sandbox_profile_owner_scope", table_name="sandbox_profile")
    _drop_index_once("uq_sandbox_profile_active_organization", table_name="sandbox_profile")
    _drop_index_once("uq_sandbox_profile_active_personal_user", table_name="sandbox_profile")
    _drop_table_once("sandbox_profile")
