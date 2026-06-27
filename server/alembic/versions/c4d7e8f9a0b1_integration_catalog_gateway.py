"""integration catalog gateway

Revision ID: c4d7e8f9a0b1
Revises: c3f6a9b2d5e8
Create Date: 2026-06-27 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c4d7e8f9a0b1"
down_revision: str | Sequence[str] | None = "c3f6a9b2d5e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cloud_integration_definition",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("source_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("content_hash", sa.String(length=128), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("namespace", sa.String(length=128), nullable=False),
        sa.Column("provider_group", sa.String(length=128), nullable=True),
        sa.Column("transport", sa.String(length=32), nullable=False, server_default="http"),
        sa.Column(
            "implementation",
            sa.String(length=64),
            nullable=False,
            server_default="upstream_mcp",
        ),
        sa.Column("config_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column(
            "enabled_by_default", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("source IN ('seed', 'org_custom')", name="ck_cloud_integration_source"),
        sa.CheckConstraint("transport IN ('http')", name="ck_cloud_integration_transport"),
        sa.CheckConstraint(
            "implementation IN ('upstream_mcp', 'virtual_proliferate_mcp')",
            name="ck_cloud_integration_implementation",
        ),
        sa.CheckConstraint(
            "(source = 'seed' AND organization_id IS NULL) OR "
            "(source = 'org_custom' AND organization_id IS NOT NULL)",
            name="ck_cloud_integration_definition_source_scope",
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_cloud_integration_definition_seed_key",
        "cloud_integration_definition",
        ["key"],
        unique=True,
        postgresql_where=sa.text("source = 'seed'"),
    )
    op.create_index(
        "uq_cloud_integration_definition_org_key",
        "cloud_integration_definition",
        ["organization_id", "key"],
        unique=True,
        postgresql_where=sa.text("source = 'org_custom'"),
    )
    op.create_index(
        "ix_cloud_integration_definition_organization_id",
        "cloud_integration_definition",
        ["organization_id"],
    )
    op.create_index(
        "ix_cloud_integration_definition_namespace",
        "cloud_integration_definition",
        ["namespace"],
    )

    op.create_table(
        "cloud_integration_account",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("owner_scope", sa.String(length=32), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("definition_id", sa.Uuid(), nullable=False),
        sa.Column("auth_kind", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("settings_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("credential_ciphertext", sa.Text(), nullable=True),
        sa.Column("auth_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(length=128), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "("
            "owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL"
            ") OR ("
            "owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND owner_user_id IS NULL"
            ")",
            name="ck_cloud_integration_account_owner",
        ),
        sa.CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_cloud_integration_account_owner_scope",
        ),
        sa.CheckConstraint(
            "auth_kind IN ('oauth2', 'api_key', 'none')",
            name="ck_cloud_integration_account_auth_kind",
        ),
        sa.CheckConstraint(
            "status IN ('ready', 'setup_required', 'reauth_required', 'error', 'disabled')",
            name="ck_cloud_integration_account_status",
        ),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["definition_id"], ["cloud_integration_definition.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_cloud_integration_account_personal_definition",
        "cloud_integration_account",
        ["owner_user_id", "definition_id"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'personal'"),
    )
    op.create_index(
        "uq_cloud_integration_account_org_definition",
        "cloud_integration_account",
        ["organization_id", "definition_id"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'organization'"),
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
    op.create_index(
        "ix_cloud_integration_account_organization_id",
        "cloud_integration_account",
        ["organization_id"],
    )

    op.create_table(
        "cloud_integration_oauth_client",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("definition_id", sa.Uuid(), nullable=False),
        sa.Column("issuer", sa.Text(), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("resource", sa.Text(), nullable=True),
        sa.Column("client_strategy", sa.String(length=64), nullable=False),
        sa.Column("client_id", sa.Text(), nullable=False),
        sa.Column("client_secret_ciphertext", sa.Text(), nullable=True),
        sa.Column("registration_metadata_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("token_endpoint_auth_method", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "client_strategy IN ('dcr', 'client_metadata_document', 'static')",
            name="ck_cloud_integration_oauth_client_strategy",
        ),
        sa.ForeignKeyConstraint(
            ["definition_id"], ["cloud_integration_definition.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "definition_id",
            "issuer",
            "redirect_uri",
            "resource",
            name="uq_cloud_integration_oauth_client_definition_issuer",
        ),
    )
    op.create_index(
        "ix_cloud_integration_oauth_client_definition_id",
        "cloud_integration_oauth_client",
        ["definition_id"],
    )

    op.create_table(
        "cloud_integration_oauth_flow",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("state_hash", sa.String(length=128), nullable=False),
        sa.Column("code_verifier_ciphertext", sa.Text(), nullable=False),
        sa.Column("issuer", sa.Text(), nullable=True),
        sa.Column("resource", sa.Text(), nullable=True),
        sa.Column("client_id", sa.Text(), nullable=False),
        sa.Column("client_strategy", sa.String(length=64), nullable=False),
        sa.Column("token_endpoint", sa.Text(), nullable=True),
        sa.Column("requested_scopes", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("authorization_url", sa.Text(), nullable=False),
        sa.Column(
            "callback_surface", sa.String(length=32), nullable=False, server_default="desktop"
        ),
        sa.Column("final_surface", sa.String(length=32), nullable=False, server_default="desktop"),
        sa.Column("return_path", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_code", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "callback_surface IN ('desktop', 'web')",
            name="ck_cloud_integration_oauth_flow_callback_surface",
        ),
        sa.CheckConstraint(
            "final_surface IN ('desktop', 'web')",
            name="ck_cloud_integration_oauth_flow_final_surface",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"], ["cloud_integration_account.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_cloud_integration_oauth_flow_account_id",
        "cloud_integration_oauth_flow",
        ["account_id"],
    )
    op.create_index(
        "ix_cloud_integration_oauth_flow_state_hash",
        "cloud_integration_oauth_flow",
        ["state_hash"],
    )
    op.create_index(
        "ix_cloud_integration_oauth_flow_user_id", "cloud_integration_oauth_flow", ["user_id"]
    )

    op.create_table(
        "cloud_integration_tool_schema_cache",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("cache_key", sa.String(length=255), nullable=False),
        sa.Column("tools_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="stale"),
        sa.Column("refreshed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["account_id"], ["cloud_integration_account.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "cache_key", name="uq_cloud_integration_tool_cache_key"),
    )
    op.create_index(
        "ix_cloud_integration_tool_schema_cache_account_id",
        "cloud_integration_tool_schema_cache",
        ["account_id"],
    )
    op.create_index(
        "ix_cloud_integration_tool_schema_cache_status",
        "cloud_integration_tool_schema_cache",
        ["status"],
    )

    op.create_table(
        "cloud_integration_policy",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("definition_id", sa.Uuid(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["definition_id"], ["cloud_integration_definition.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "definition_id",
            name="uq_cloud_integration_policy_definition",
        ),
    )
    op.create_index(
        "ix_cloud_integration_policy_organization_id",
        "cloud_integration_policy",
        ["organization_id"],
    )
    op.create_index(
        "ix_cloud_integration_policy_definition_id", "cloud_integration_policy", ["definition_id"]
    )

    _backfill_from_old_mcp_tables()
    _drop_old_tables()


def downgrade() -> None:
    op.drop_table("cloud_integration_policy")
    op.drop_table("cloud_integration_tool_schema_cache")
    op.drop_table("cloud_integration_oauth_flow")
    op.drop_table("cloud_integration_oauth_client")
    op.drop_table("cloud_integration_account")
    op.drop_table("cloud_integration_definition")


def _backfill_from_old_mcp_tables() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("cloud_mcp_connection"):
        return
    bind.execute(
        sa.text(
            """
            INSERT INTO cloud_integration_definition (
                key,
                source,
                source_version,
                content_hash,
                display_name,
                namespace,
                transport,
                implementation,
                config_json,
                enabled_by_default,
                created_at,
                updated_at
            )
            SELECT DISTINCT
                c.catalog_entry_id,
                'seed',
                c.catalog_entry_version,
                'migrated:' || c.catalog_entry_id,
                c.catalog_entry_id,
                regexp_replace(lower(c.catalog_entry_id), '[^a-z0-9_]+', '_', 'g'),
                'http',
                'upstream_mcp',
                '{}',
                true,
                now(),
                now()
            FROM cloud_mcp_connection c
            ON CONFLICT DO NOTHING
            """
        )
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO cloud_integration_account (
                owner_scope,
                owner_user_id,
                organization_id,
                definition_id,
                auth_kind,
                status,
                settings_json,
                credential_ciphertext,
                auth_version,
                token_expires_at,
                last_error_code,
                enabled,
                created_at,
                updated_at
            )
            SELECT
                c.owner_scope,
                c.owner_user_id,
                c.organization_id,
                d.id,
                CASE
                  WHEN a.auth_kind = 'oauth' THEN 'oauth2'
                  WHEN a.auth_kind = 'secret' THEN 'api_key'
                  WHEN a.auth_kind IS NULL THEN 'none'
                  ELSE a.auth_kind
                END,
                CASE
                  WHEN c.enabled = false THEN 'disabled'
                  WHEN a.auth_status = 'ready' THEN 'ready'
                  WHEN a.auth_status = 'reauth_required' THEN 'reauth_required'
                  WHEN a.auth_status = 'error' THEN 'error'
                  ELSE 'setup_required'
                END,
                c.settings_json,
                a.payload_ciphertext,
                COALESCE(a.auth_version, 1),
                a.token_expires_at,
                a.last_error_code,
                c.enabled,
                c.created_at,
                c.updated_at
            FROM cloud_mcp_connection c
            JOIN cloud_integration_definition d
              ON d.key = c.catalog_entry_id AND d.source = 'seed'
            LEFT JOIN cloud_mcp_connection_auth a
              ON a.connection_db_id = c.id
            ON CONFLICT DO NOTHING
            """
        )
    )


def _drop_old_tables() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table in (
        "cloud_mcp_oauth_flow",
        "cloud_mcp_oauth_client",
        "cloud_mcp_connection_auth",
        "cloud_mcp_connection",
        "cloud_organization_integration_policy",
    ):
        if inspector.has_table(table):
            op.drop_table(table)
