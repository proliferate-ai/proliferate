"""auth identity model

Revision ID: f7a8b9c0d1e2
Revises: f6a7b8c9d0e1, d5e6f7a8b9c0
Create Date: 2026-05-18 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
import json
import uuid

import sqlalchemy as sa

from alembic import op
from proliferate.utils.crypto import encrypt_text

# revision identifiers, used by Alembic.
revision: str = "f7a8b9c0d1e2"
down_revision: str | Sequence[str] | None = ("f6a7b8c9d0e1", "d5e6f7a8b9c0")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LEGACY_GITHUB_OAUTH_SCOPES = ["repo", "user", "user:email"]


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("auth_identity"):
        op.create_table(
            "auth_identity",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("user_id", sa.UUID(), nullable=False),
            sa.Column("provider", sa.String(length=32), nullable=False),
            sa.Column("provider_subject", sa.Text(), nullable=False),
            sa.Column("email", sa.Text(), nullable=True),
            sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("display_name", sa.Text(), nullable=True),
            sa.Column("avatar_url", sa.Text(), nullable=True),
            sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "provider",
                "provider_subject",
                name="uq_auth_identity_provider_subject",
            ),
            sa.UniqueConstraint("user_id", "provider", name="uq_auth_identity_user_provider"),
        )
        op.create_index("ix_auth_identity_user_id", "auth_identity", ["user_id"])

    if not _has_table("provider_grant"):
        op.create_table(
            "provider_grant",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("user_id", sa.UUID(), nullable=False),
            sa.Column("auth_identity_id", sa.UUID(), nullable=False),
            sa.Column("provider", sa.String(length=32), nullable=False),
            sa.Column("access_token_ciphertext", sa.Text(), nullable=True),
            sa.Column("refresh_token_ciphertext", sa.Text(), nullable=True),
            sa.Column("scopes_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="ready"),
            sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["auth_identity_id"], ["auth_identity.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "auth_identity_id",
                "provider",
                name="uq_provider_grant_identity_provider",
            ),
        )
        op.create_index(
            "ix_provider_grant_user_provider",
            "provider_grant",
            ["user_id", "provider"],
        )

    if not _has_table("auth_challenge"):
        op.create_table(
            "auth_challenge",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("provider", sa.String(length=32), nullable=False),
            sa.Column("surface", sa.String(length=32), nullable=False),
            sa.Column("purpose", sa.String(length=32), nullable=False),
            sa.Column("state_hash", sa.String(length=128), nullable=False),
            sa.Column("nonce_hash", sa.String(length=128), nullable=False),
            sa.Column("csrf_hash", sa.String(length=128), nullable=True),
            sa.Column("user_id", sa.UUID(), nullable=True),
            sa.Column("client_state", sa.String(length=256), nullable=False),
            sa.Column("code_challenge", sa.String(length=128), nullable=False),
            sa.Column("code_challenge_method", sa.String(length=10), nullable=False),
            sa.Column("redirect_uri", sa.Text(), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("state_hash", name="uq_auth_challenge_state_hash"),
        )
        op.create_index("ix_auth_challenge_state_hash", "auth_challenge", ["state_hash"])
        op.create_index("ix_auth_challenge_user_id", "auth_challenge", ["user_id"])

    _backfill_oauth_accounts()


def _backfill_oauth_accounts() -> None:
    bind = op.get_bind()
    now = datetime.now(UTC)
    rows = bind.execute(
        sa.text(
            """
            SELECT user_id, oauth_name, account_id, account_email, access_token, refresh_token, expires_at
            FROM oauth_account
            WHERE oauth_name IN ('github', 'google')
            """
        )
    ).mappings()

    for row in rows:
        identity_id = uuid.uuid4()
        existing = bind.execute(
            sa.text(
                """
                SELECT id FROM auth_identity
                WHERE provider = :provider AND provider_subject = :provider_subject
                """
            ),
            {"provider": row["oauth_name"], "provider_subject": row["account_id"]},
        ).scalar_one_or_none()
        if existing is not None:
            identity_id = existing
        else:
            user_provider_exists = bind.execute(
                sa.text(
                    """
                    SELECT 1 FROM auth_identity
                    WHERE user_id = :user_id AND provider = :provider
                    """
                ),
                {"user_id": row["user_id"], "provider": row["oauth_name"]},
            ).scalar_one_or_none()
            if user_provider_exists is not None:
                continue
            bind.execute(
                sa.text(
                    """
                    INSERT INTO auth_identity (
                        id, user_id, provider, provider_subject, email, email_verified,
                        linked_at, last_login_at, created_at, updated_at
                    )
                    VALUES (
                        :id, :user_id, :provider, :provider_subject, :email, true,
                        :now, :now, :now, :now
                    )
                    """
                ),
                {
                    "id": identity_id,
                    "user_id": row["user_id"],
                    "provider": row["oauth_name"],
                    "provider_subject": row["account_id"],
                    "email": row["account_email"],
                    "now": now,
                },
            )

        grant_exists = bind.execute(
            sa.text(
                """
                SELECT 1 FROM provider_grant
                WHERE auth_identity_id = :auth_identity_id AND provider = :provider
                """
            ),
            {"auth_identity_id": identity_id, "provider": row["oauth_name"]},
        ).scalar_one_or_none()
        if grant_exists is not None:
            continue
        scopes: list[str] = LEGACY_GITHUB_OAUTH_SCOPES if row["oauth_name"] == "github" else []
        expires_at = (
            datetime.fromtimestamp(row["expires_at"], tz=UTC)
            if row["expires_at"] is not None
            else None
        )
        status = "expired" if expires_at is not None and expires_at <= now else "ready"
        bind.execute(
            sa.text(
                """
                INSERT INTO provider_grant (
                    id, user_id, auth_identity_id, provider, access_token_ciphertext,
                    refresh_token_ciphertext, scopes_json, expires_at, status,
                    last_verified_at, created_at, updated_at
                )
                VALUES (
                    :id, :user_id, :auth_identity_id, :provider, :access_token_ciphertext,
                    :refresh_token_ciphertext, :scopes_json, :expires_at, :status,
                    :now, :now, :now
                )
                """
            ),
            {
                "id": uuid.uuid4(),
                "user_id": row["user_id"],
                "auth_identity_id": identity_id,
                "provider": row["oauth_name"],
                "access_token_ciphertext": (
                    encrypt_text(row["access_token"]) if row["access_token"] else None
                ),
                "refresh_token_ciphertext": (
                    encrypt_text(row["refresh_token"]) if row["refresh_token"] else None
                ),
                "scopes_json": json.dumps(scopes),
                "expires_at": expires_at,
                "status": status,
                "now": now,
            },
        )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_table("auth_challenge"):
        op.drop_index("ix_auth_challenge_user_id", table_name="auth_challenge")
        op.drop_index("ix_auth_challenge_state_hash", table_name="auth_challenge")
        op.drop_table("auth_challenge")
    if _has_table("provider_grant"):
        op.drop_index("ix_provider_grant_user_provider", table_name="provider_grant")
        op.drop_table("provider_grant")
    if _has_table("auth_identity"):
        op.drop_index("ix_auth_identity_user_id", table_name="auth_identity")
        op.drop_table("auth_identity")
