"""Integration definition/policy/account/oauth/tool-cache tables.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-07-01 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d7f3a91c4b2e"
down_revision: str | None = "b8c9d0e1f2a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cloud_integration_definition",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("namespace", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("auth_kind", sa.String(length=32), nullable=False),
        sa.Column("oauth_client_mode", sa.String(length=32), nullable=True),
        sa.Column("config_json", sa.Text(), nullable=False),
        sa.Column("enabled_by_default", sa.Boolean(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "source IN ('seed', 'org_custom')",
            name="ck_cloud_integration_definition_source",
        ),
        sa.CheckConstraint(
            "auth_kind IN ('oauth2', 'api_key', 'none')",
            name="ck_cloud_integration_definition_auth_kind",
        ),
        sa.CheckConstraint(
            "(source = 'seed' AND organization_id IS NULL) OR "
            "(source = 'org_custom' AND organization_id IS NOT NULL)",
            name="ck_cloud_integration_definition_source_owner",
        ),
    )
    op.create_index(
        "ix_cloud_integration_definition_organization_id",
        "cloud_integration_definition",
        ["organization_id"],
    )
    op.create_index(
        "ux_cloud_integration_definition_seed_namespace",
        "cloud_integration_definition",
        ["namespace"],
        unique=True,
        postgresql_where=sa.text("source = 'seed'"),
    )
    op.create_index(
        "ux_cloud_integration_definition_org_namespace",
        "cloud_integration_definition",
        ["organization_id", "namespace"],
        unique=True,
        postgresql_where=sa.text("source = 'org_custom'"),
    )

    op.create_table(
        "cloud_integration_policy",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("definition_id", sa.Uuid(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "organization_id",
            "definition_id",
            name="uq_cloud_integration_policy_org_definition",
        ),
    )
    op.create_index(
        "ix_cloud_integration_policy_organization_id",
        "cloud_integration_policy",
        ["organization_id"],
    )
    op.create_index(
        "ix_cloud_integration_policy_definition_id",
        "cloud_integration_policy",
        ["definition_id"],
    )

    op.create_table(
        "cloud_integration_account",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("definition_id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("owner_scope", sa.String(length=32), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("auth_kind", sa.String(length=32), nullable=False),
        sa.Column("credential_ciphertext", sa.Text(), nullable=True),
        sa.Column("credential_format", sa.String(length=64), nullable=False),
        sa.Column("auth_version", sa.Integer(), nullable=False),
        sa.Column("settings_json", sa.Text(), nullable=False),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_cloud_integration_account_owner_scope",
        ),
        sa.CheckConstraint(
            "status IN ('setup_required', 'ready', 'error')",
            name="ck_cloud_integration_account_status",
        ),
        sa.CheckConstraint(
            "auth_kind IN ('oauth2', 'api_key', 'none')",
            name="ck_cloud_integration_account_auth_kind",
        ),
        sa.UniqueConstraint(
            "owner_user_id",
            "definition_id",
            name="uq_cloud_integration_account_owner_definition",
        ),
    )
    op.create_index(
        "ix_cloud_integration_account_definition_id",
        "cloud_integration_account",
        ["definition_id"],
    )
    op.create_index(
        "ix_cloud_integration_account_owner_user_id",
        "cloud_integration_account",
        ["owner_user_id"],
    )

    op.create_table(
        "cloud_integration_oauth_client",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("definition_id", sa.Uuid(), nullable=False),
        sa.Column("issuer", sa.Text(), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("resource", sa.Text(), nullable=True),
        sa.Column("client_id", sa.String(length=512), nullable=False),
        sa.Column("client_secret_ciphertext", sa.Text(), nullable=True),
        sa.Column("client_secret_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("token_endpoint_auth_method", sa.String(length=128), nullable=True),
        sa.Column("registration_client_uri", sa.Text(), nullable=True),
        sa.Column("registration_access_token_ciphertext", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "issuer",
            "redirect_uri",
            "definition_id",
            name="uq_cloud_integration_oauth_client_key",
        ),
    )
    op.create_index(
        "ix_cloud_integration_oauth_client_definition_id",
        "cloud_integration_oauth_client",
        ["definition_id"],
    )

    op.create_table(
        "cloud_integration_oauth_flow",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("definition_id", sa.Uuid(), nullable=False),
        sa.Column("state_hash", sa.String(length=128), nullable=False),
        sa.Column("code_verifier_ciphertext", sa.Text(), nullable=False),
        sa.Column("issuer", sa.Text(), nullable=True),
        sa.Column("resource", sa.Text(), nullable=True),
        sa.Column("client_id", sa.String(length=512), nullable=False),
        sa.Column("token_endpoint", sa.Text(), nullable=True),
        sa.Column("requested_scopes", sa.Text(), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("authorization_url", sa.Text(), nullable=False),
        sa.Column("callback_surface", sa.String(length=32), nullable=False),
        sa.Column("final_surface", sa.String(length=32), nullable=False),
        sa.Column("return_path", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_code", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "callback_surface IN ('desktop', 'web')",
            name="ck_cloud_integration_oauth_flow_callback_surface",
        ),
        sa.CheckConstraint(
            "final_surface IN ('desktop', 'web')",
            name="ck_cloud_integration_oauth_flow_final_surface",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'exchanging', 'completed', 'expired', 'cancelled', 'failed')",
            name="ck_cloud_integration_oauth_flow_status",
        ),
    )
    op.create_index(
        "ix_cloud_integration_oauth_flow_account_id",
        "cloud_integration_oauth_flow",
        ["account_id"],
    )
    op.create_index(
        "ix_cloud_integration_oauth_flow_owner_user_id",
        "cloud_integration_oauth_flow",
        ["owner_user_id"],
    )
    op.create_index(
        "ix_cloud_integration_oauth_flow_definition_id",
        "cloud_integration_oauth_flow",
        ["definition_id"],
    )
    op.create_index(
        "ix_cloud_integration_oauth_flow_state_hash",
        "cloud_integration_oauth_flow",
        ["state_hash"],
    )
    op.create_index(
        "ix_cloud_integration_oauth_flow_expires_at",
        "cloud_integration_oauth_flow",
        ["expires_at"],
    )

    op.create_table(
        "cloud_integration_tool_schema_cache",
        sa.Column("account_id", sa.Uuid(), primary_key=True),
        sa.Column("auth_version", sa.Integer(), nullable=False),
        sa.Column("tools_json", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('ready', 'stale', 'error')",
            name="ck_cloud_integration_tool_schema_cache_status",
        ),
    )


def downgrade() -> None:
    op.drop_table("cloud_integration_tool_schema_cache")
    op.drop_table("cloud_integration_oauth_flow")
    op.drop_table("cloud_integration_oauth_client")
    op.drop_table("cloud_integration_account")
    op.drop_table("cloud_integration_policy")
    op.drop_table("cloud_integration_definition")
