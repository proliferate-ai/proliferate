"""allow multiple auth identities per provider per user

Revision ID: f8a9b0c1d2e3
Revises: f7a8b9c0d1e2
Create Date: 2026-05-19 00:00:00.000000

"""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa

from alembic import op
from proliferate.utils.crypto import encrypt_text

# revision identifiers, used by Alembic.
revision: str = "f8a9b0c1d2e3"
down_revision: str | Sequence[str] | None = "f7a8b9c0d1e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LEGACY_GITHUB_OAUTH_SCOPES = ["repo", "user", "user:email"]


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint(
        "uq_auth_identity_user_provider",
        "auth_identity",
        type_="unique",
    )
    op.create_index(
        "ix_auth_identity_user_provider",
        "auth_identity",
        ["user_id", "provider"],
        unique=False,
    )
    _backfill_additional_oauth_accounts()


def _backfill_additional_oauth_accounts() -> None:
    bind = op.get_bind()
    now = datetime.now(UTC)
    rows = bind.execute(
        sa.text(
            """
            SELECT user_id, oauth_name, account_id, account_email, access_token,
                   refresh_token, expires_at
            FROM oauth_account
            WHERE oauth_name IN ('github', 'google')
            """
        )
    ).mappings()

    for row in rows:
        identity_id = bind.execute(
            sa.text(
                """
                SELECT id FROM auth_identity
                WHERE provider = :provider AND provider_subject = :provider_subject
                """
            ),
            {"provider": row["oauth_name"], "provider_subject": row["account_id"]},
        ).scalar_one_or_none()
        if identity_id is None:
            identity_id = uuid.uuid4()
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
    op.drop_index("ix_auth_identity_user_provider", table_name="auth_identity")
    op.create_unique_constraint(
        "uq_auth_identity_user_provider",
        "auth_identity",
        ["user_id", "provider"],
    )
