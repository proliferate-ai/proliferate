"""sso connections and identities

Revision ID: b5c6d7e8f9a0
Revises: b4c5d6e7f8a9
Create Date: 2026-06-24 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b5c6d7e8f9a0"
down_revision: str | Sequence[str] | None = "b4c5d6e7f8a9"
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


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def upgrade() -> None:
    if not _has_table("sso_connection"):
        op.create_table(
            "sso_connection",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("scope", sa.String(length=32), nullable=False),
            sa.Column("organization_id", sa.UUID(), nullable=True),
            sa.Column("protocol", sa.String(length=16), nullable=False),
            sa.Column("status", sa.String(length=32), server_default="draft", nullable=False),
            sa.Column("display_name", sa.String(length=255), nullable=False),
            sa.Column(
                "login_policy",
                sa.String(length=32),
                server_default="optional",
                nullable=False,
            ),
            sa.Column(
                "jit_policy",
                sa.String(length=32),
                server_default="disabled",
                nullable=False,
            ),
            sa.Column(
                "default_role",
                sa.String(length=32),
                server_default="member",
                nullable=False,
            ),
            sa.Column("allowed_domains_json", sa.Text(), server_default="[]", nullable=False),
            sa.Column("oidc_issuer_url", sa.Text(), nullable=True),
            sa.Column("oidc_discovery_url", sa.Text(), nullable=True),
            sa.Column("oidc_authorization_endpoint", sa.Text(), nullable=True),
            sa.Column("oidc_token_endpoint", sa.Text(), nullable=True),
            sa.Column("oidc_jwks_uri", sa.Text(), nullable=True),
            sa.Column("oidc_userinfo_endpoint", sa.Text(), nullable=True),
            sa.Column("oidc_client_id", sa.Text(), nullable=True),
            sa.Column("oidc_client_secret_ciphertext", sa.Text(), nullable=True),
            sa.Column(
                "oidc_scopes_json",
                sa.Text(),
                server_default='["openid","email","profile"]',
                nullable=False,
            ),
            sa.Column(
                "oidc_token_endpoint_auth_method",
                sa.String(length=64),
                server_default="client_secret_basic",
                nullable=False,
            ),
            sa.Column("saml_idp_metadata_url", sa.Text(), nullable=True),
            sa.Column("saml_idp_metadata_xml_ciphertext", sa.Text(), nullable=True),
            sa.Column("saml_idp_entity_id", sa.Text(), nullable=True),
            sa.Column("saml_sso_url", sa.Text(), nullable=True),
            sa.Column("saml_x509_cert_ciphertext", sa.Text(), nullable=True),
            sa.Column("saml_email_attribute", sa.String(length=255), nullable=True),
            sa.Column("created_by_user_id", sa.UUID(), nullable=True),
            sa.Column("updated_by_user_id", sa.UUID(), nullable=True),
            sa.Column("tested_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "scope IN ('deployment', 'organization')",
                name="ck_sso_connection_scope",
            ),
            sa.CheckConstraint(
                "protocol IN ('oidc', 'saml')",
                name="ck_sso_connection_protocol",
            ),
            sa.CheckConstraint(
                "status IN ('draft', 'enabled', 'disabled')",
                name="ck_sso_connection_status",
            ),
            sa.CheckConstraint(
                "login_policy IN ('optional', 'required')",
                name="ck_sso_connection_login_policy",
            ),
            sa.CheckConstraint(
                "jit_policy IN ('disabled', 'existing_user', 'create_member')",
                name="ck_sso_connection_jit_policy",
            ),
            sa.CheckConstraint(
                "default_role IN ('owner', 'admin', 'member')",
                name="ck_sso_connection_default_role",
            ),
            sa.CheckConstraint(
                "((scope = 'organization' AND organization_id IS NOT NULL) OR "
                "(scope = 'deployment' AND organization_id IS NULL))",
                name="ck_sso_connection_scope_organization",
            ),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organization.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["created_by_user_id"],
                ["user.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["updated_by_user_id"],
                ["user.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _has_index("sso_connection", "ix_sso_connection_organization_status"):
        op.create_index(
            "ix_sso_connection_organization_status",
            "sso_connection",
            ["organization_id", "status"],
        )
    if not _has_index("sso_connection", "ix_sso_connection_scope_status"):
        op.create_index(
            "ix_sso_connection_scope_status",
            "sso_connection",
            ["scope", "status"],
        )

    if not _has_table("sso_challenge"):
        op.create_table(
            "sso_challenge",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("scope", sa.String(length=32), nullable=False),
            sa.Column("connection_id", sa.UUID(), nullable=True),
            sa.Column("connection_key", sa.String(length=255), nullable=False),
            sa.Column("organization_id", sa.UUID(), nullable=True),
            sa.Column("protocol", sa.String(length=16), nullable=False),
            sa.Column("surface", sa.String(length=32), nullable=False),
            sa.Column("purpose", sa.String(length=32), nullable=False),
            sa.Column("state_hash", sa.String(length=128), nullable=False),
            sa.Column("nonce_hash", sa.String(length=128), nullable=False),
            sa.Column("user_id", sa.UUID(), nullable=True),
            sa.Column("client_state", sa.String(length=256), nullable=False),
            sa.Column("code_challenge", sa.String(length=128), nullable=False),
            sa.Column("code_challenge_method", sa.String(length=10), nullable=False),
            sa.Column("redirect_uri", sa.Text(), nullable=False),
            sa.Column("login_hint", sa.String(length=320), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "scope IN ('deployment', 'organization')",
                name="ck_sso_challenge_scope",
            ),
            sa.CheckConstraint(
                "protocol IN ('oidc', 'saml')",
                name="ck_sso_challenge_protocol",
            ),
            sa.ForeignKeyConstraint(
                ["connection_id"],
                ["sso_connection.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organization.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("state_hash", name="uq_sso_challenge_state_hash"),
        )
    if not _has_index("sso_challenge", "ix_sso_challenge_state_hash"):
        op.create_index("ix_sso_challenge_state_hash", "sso_challenge", ["state_hash"])
    if not _has_index("sso_challenge", "ix_sso_challenge_connection_key"):
        op.create_index("ix_sso_challenge_connection_key", "sso_challenge", ["connection_key"])
    if not _has_index("sso_challenge", "ix_sso_challenge_organization_id"):
        op.create_index("ix_sso_challenge_organization_id", "sso_challenge", ["organization_id"])

    if not _has_table("sso_identity"):
        op.create_table(
            "sso_identity",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("user_id", sa.UUID(), nullable=False),
            sa.Column("organization_id", sa.UUID(), nullable=True),
            sa.Column("connection_id", sa.UUID(), nullable=True),
            sa.Column("connection_key", sa.String(length=255), nullable=False),
            sa.Column("protocol", sa.String(length=16), nullable=False),
            sa.Column("provider_subject", sa.Text(), nullable=False),
            sa.Column("email", sa.Text(), nullable=True),
            sa.Column("email_verified", sa.Boolean(), nullable=False),
            sa.Column("display_name", sa.Text(), nullable=True),
            sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "protocol IN ('oidc', 'saml')",
                name="ck_sso_identity_protocol",
            ),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organization.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["connection_id"],
                ["sso_connection.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "connection_key",
                "provider_subject",
                name="uq_sso_identity_connection_subject",
            ),
        )
    if not _has_index("sso_identity", "ix_sso_identity_user_id"):
        op.create_index("ix_sso_identity_user_id", "sso_identity", ["user_id"])
    if not _has_index("sso_identity", "ix_sso_identity_organization_id"):
        op.create_index("ix_sso_identity_organization_id", "sso_identity", ["organization_id"])
    if not _has_index("sso_identity", "ix_sso_identity_connection_id"):
        op.create_index("ix_sso_identity_connection_id", "sso_identity", ["connection_id"])


def downgrade() -> None:
    _drop_index_once("ix_sso_identity_connection_id", "sso_identity")
    _drop_index_once("ix_sso_identity_organization_id", "sso_identity")
    _drop_index_once("ix_sso_identity_user_id", "sso_identity")
    if _has_table("sso_identity"):
        op.drop_table("sso_identity")

    _drop_index_once("ix_sso_challenge_organization_id", "sso_challenge")
    _drop_index_once("ix_sso_challenge_connection_key", "sso_challenge")
    _drop_index_once("ix_sso_challenge_state_hash", "sso_challenge")
    if _has_table("sso_challenge"):
        op.drop_table("sso_challenge")

    _drop_index_once("ix_sso_connection_scope_status", "sso_connection")
    _drop_index_once("ix_sso_connection_organization_status", "sso_connection")
    if _has_table("sso_connection"):
        op.drop_table("sso_connection")
