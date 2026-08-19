"""add integration authorization-attempt and revision schema

Revision ID: a21c34d56e78
Revises: e7f1a3c9d20b
Create Date: 2026-08-19 00:00:00.000000

This is an additive compatibility migration. Existing account and OAuth-flow
behavior continues to use ``auth_version`` and ``account_id`` until later
lifecycle slices adopt the new records.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a21c34d56e78"
down_revision: str | Sequence[str] | None = "e7f1a3c9d20b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> tuple[sa.Column, sa.Column]:
    return (
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def upgrade() -> None:
    op.create_table(
        "cloud_integration_definition_security_revision",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("definition_id", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("auth_kind", sa.String(length=32), nullable=False),
        sa.Column("oauth_client_mode", sa.String(length=32), nullable=True),
        sa.Column("config_json", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "revision > 0",
            name="ck_cloud_integration_definition_security_revision_positive",
        ),
        sa.CheckConstraint(
            "auth_kind IN ('oauth2', 'api_key', 'none')",
            name="ck_cloud_integration_definition_security_revision_auth_kind",
        ),
        sa.ForeignKeyConstraint(
            ["definition_id"],
            ["cloud_integration_definition.id"],
            name="fk_cloud_integration_definition_security_revision_definition",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "definition_id",
            "revision",
            name="uq_cloud_integration_definition_security_revision",
        ),
    )
    op.create_index(
        "ix_cloud_integration_definition_security_revision_definition_id",
        "cloud_integration_definition_security_revision",
        ["definition_id"],
    )
    op.execute(
        sa.text(
            """
            INSERT INTO cloud_integration_definition_security_revision (
                id, definition_id, revision, auth_kind, oauth_client_mode,
                config_json, created_at
            )
            SELECT gen_random_uuid(), id, 1, auth_kind, oauth_client_mode,
                   config_json, created_at
            FROM cloud_integration_definition
            """
        )
    )

    op.add_column(
        "cloud_integration_oauth_client",
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "cloud_integration_oauth_client",
        sa.Column(
            "lifecycle_state",
            sa.String(length=32),
            server_default="active",
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_cloud_integration_oauth_client_revision_positive",
        "cloud_integration_oauth_client",
        "revision > 0",
    )
    op.create_check_constraint(
        "ck_cloud_integration_oauth_client_lifecycle_state",
        "cloud_integration_oauth_client",
        "lifecycle_state IN ('candidate', 'active', 'retiring', 'retired')",
    )
    op.drop_constraint(
        "uq_cloud_integration_oauth_client_key",
        "cloud_integration_oauth_client",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_cloud_integration_oauth_client_revision",
        "cloud_integration_oauth_client",
        ["issuer", "redirect_uri", "definition_id", "revision"],
    )
    op.create_index(
        "ux_cloud_integration_oauth_client_active",
        "cloud_integration_oauth_client",
        ["issuer", "redirect_uri", "definition_id"],
        unique=True,
        postgresql_where=sa.text("lifecycle_state = 'active'"),
    )

    op.add_column(
        "cloud_integration_account",
        sa.Column("grant_version", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "cloud_integration_account",
        sa.Column("credential_version", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "cloud_integration_account",
        sa.Column("definition_security_revision_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "cloud_integration_account",
        sa.Column("provider_client_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "cloud_integration_account",
        sa.Column("credential_audience", sa.Text(), nullable=True),
    )
    op.add_column(
        "cloud_integration_account",
        sa.Column("effective_scopes_json", sa.Text(), nullable=True),
    )
    op.execute(
        sa.text(
            """
            UPDATE cloud_integration_account
            SET grant_version = auth_version,
                credential_version = auth_version
            """
        )
    )
    op.create_foreign_key(
        "fk_cloud_integration_account_definition_security_revision",
        "cloud_integration_account",
        "cloud_integration_definition_security_revision",
        ["definition_security_revision_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_cloud_integration_account_provider_client",
        "cloud_integration_account",
        "cloud_integration_oauth_client",
        ["provider_client_id"],
        ["id"],
    )

    op.create_table(
        "cloud_integration_authorization_attempt",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("definition_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("method", sa.String(length=32), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="active", nullable=False),
        sa.Column("starting_grant_version", sa.Integer(), nullable=True),
        sa.Column("starting_credential_version", sa.Integer(), nullable=True),
        sa.Column("definition_security_revision_id", sa.Uuid(), nullable=False),
        sa.Column("provider_client_id", sa.Uuid(), nullable=True),
        sa.Column("credential_audience", sa.Text(), nullable=False),
        sa.Column("settings_json", sa.Text(), server_default="{}", nullable=False),
        sa.Column("requested_scopes_json", sa.Text(), server_default="[]", nullable=False),
        sa.Column("effective_scopes_json", sa.Text(), nullable=True),
        sa.Column("staged_credential_ciphertext", sa.Text(), nullable=True),
        sa.Column("staged_credential_format", sa.String(length=64), nullable=True),
        sa.Column("failure_code", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "purpose IN ('connect', 'reauthorize', 'rotate')",
            name="ck_cloud_integration_authorization_attempt_purpose",
        ),
        sa.CheckConstraint(
            "method IN ('oauth2', 'api_key', 'none')",
            name="ck_cloud_integration_authorization_attempt_method",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'exchanging', 'validating', 'succeeded', "
            "'failed', 'cancelled', 'expired', 'superseded')",
            name="ck_cloud_integration_authorization_attempt_status",
        ),
        sa.CheckConstraint(
            "generation > 0",
            name="ck_cloud_integration_authorization_attempt_generation_positive",
        ),
        sa.CheckConstraint(
            "starting_grant_version IS NULL OR starting_grant_version > 0",
            name="ck_cloud_int_auth_attempt_grant_version_positive",
        ),
        sa.CheckConstraint(
            "starting_credential_version IS NULL OR starting_credential_version > 0",
            name="ck_cloud_int_auth_attempt_credential_version_positive",
        ),
        sa.CheckConstraint(
            "(staged_credential_ciphertext IS NULL) = (staged_credential_format IS NULL)",
            name="ck_cloud_integration_authorization_attempt_staged_pair",
        ),
        sa.CheckConstraint(
            "btrim(credential_audience) <> ''",
            name="ck_cloud_integration_authorization_attempt_audience",
        ),
        sa.CheckConstraint(
            "(purpose = 'connect' AND account_id IS NULL "
            "AND starting_grant_version IS NULL "
            "AND starting_credential_version IS NULL) OR "
            "(purpose IN ('reauthorize', 'rotate') AND account_id IS NOT NULL "
            "AND starting_grant_version IS NOT NULL "
            "AND starting_credential_version IS NOT NULL)",
            name="ck_cloud_int_auth_attempt_starting_connection",
        ),
        sa.CheckConstraint(
            "(status IN ('active', 'exchanging', 'validating') AND closed_at IS NULL) OR "
            "(status IN ('succeeded', 'failed', 'cancelled', 'expired', 'superseded') "
            "AND closed_at IS NOT NULL)",
            name="ck_cloud_int_auth_attempt_terminal_time",
        ),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["definition_id"], ["cloud_integration_definition.id"]),
        sa.ForeignKeyConstraint(
            ["account_id"], ["cloud_integration_account.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["definition_security_revision_id"],
            ["cloud_integration_definition_security_revision.id"],
        ),
        sa.ForeignKeyConstraint(["provider_client_id"], ["cloud_integration_oauth_client.id"]),
        sa.UniqueConstraint(
            "owner_user_id",
            "definition_id",
            "generation",
            name="uq_cloud_integration_authorization_attempt_generation",
        ),
    )
    op.create_index(
        "ix_cloud_integration_authorization_attempt_owner_user_id",
        "cloud_integration_authorization_attempt",
        ["owner_user_id"],
    )
    op.create_index(
        "ix_cloud_integration_authorization_attempt_definition_id",
        "cloud_integration_authorization_attempt",
        ["definition_id"],
    )
    op.create_index(
        "ix_cloud_integration_authorization_attempt_account_id",
        "cloud_integration_authorization_attempt",
        ["account_id"],
    )
    op.create_index(
        "ix_cloud_integration_authorization_attempt_expires_at",
        "cloud_integration_authorization_attempt",
        ["expires_at"],
    )
    op.create_index(
        "ux_cloud_integration_authorization_attempt_nonterminal",
        "cloud_integration_authorization_attempt",
        ["owner_user_id", "definition_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('active', 'exchanging', 'validating')"),
    )

    op.add_column(
        "cloud_integration_oauth_flow",
        sa.Column("attempt_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_cloud_integration_oauth_flow_attempt",
        "cloud_integration_oauth_flow",
        "cloud_integration_authorization_attempt",
        ["attempt_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_cloud_integration_oauth_flow_attempt_id",
        "cloud_integration_oauth_flow",
        ["attempt_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_cloud_integration_oauth_flow_attempt_id",
        table_name="cloud_integration_oauth_flow",
    )
    op.drop_constraint(
        "fk_cloud_integration_oauth_flow_attempt",
        "cloud_integration_oauth_flow",
        type_="foreignkey",
    )
    op.drop_column("cloud_integration_oauth_flow", "attempt_id")

    op.drop_table("cloud_integration_authorization_attempt")

    op.drop_constraint(
        "fk_cloud_integration_account_provider_client",
        "cloud_integration_account",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_cloud_integration_account_definition_security_revision",
        "cloud_integration_account",
        type_="foreignkey",
    )
    op.drop_column("cloud_integration_account", "effective_scopes_json")
    op.drop_column("cloud_integration_account", "credential_audience")
    op.drop_column("cloud_integration_account", "provider_client_id")
    op.drop_column("cloud_integration_account", "definition_security_revision_id")
    op.drop_column("cloud_integration_account", "credential_version")
    op.drop_column("cloud_integration_account", "grant_version")

    op.drop_index(
        "ux_cloud_integration_oauth_client_active",
        table_name="cloud_integration_oauth_client",
    )
    op.drop_constraint(
        "uq_cloud_integration_oauth_client_revision",
        "cloud_integration_oauth_client",
        type_="unique",
    )
    # The old schema can hold only one client per key. Prefer the active
    # revision, otherwise the highest revision, before restoring that shape.
    op.execute(
        sa.text(
            """
            DELETE FROM cloud_integration_oauth_client
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           row_number() OVER (
                               PARTITION BY issuer, redirect_uri, definition_id
                               ORDER BY (lifecycle_state = 'active') DESC, revision DESC
                           ) AS ordinal
                    FROM cloud_integration_oauth_client
                ) ranked
                WHERE ordinal > 1
            )
            """
        )
    )
    op.create_unique_constraint(
        "uq_cloud_integration_oauth_client_key",
        "cloud_integration_oauth_client",
        ["issuer", "redirect_uri", "definition_id"],
    )
    op.drop_constraint(
        "ck_cloud_integration_oauth_client_lifecycle_state",
        "cloud_integration_oauth_client",
        type_="check",
    )
    op.drop_constraint(
        "ck_cloud_integration_oauth_client_revision_positive",
        "cloud_integration_oauth_client",
        type_="check",
    )
    op.drop_column("cloud_integration_oauth_client", "lifecycle_state")
    op.drop_column("cloud_integration_oauth_client", "revision")

    op.drop_table("cloud_integration_definition_security_revision")
