"""legacy initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-03-24 17:52:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from fastapi_users_db_sqlalchemy.generics import GUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "user",
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", GUID(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("hashed_password", sa.String(length=1024), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("is_superuser", sa.Boolean(), nullable=False),
        sa.Column("is_verified", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_email", "user", ["email"], unique=True)

    op.create_table(
        "oauth_account",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("user_id", GUID(), nullable=False),
        sa.Column("oauth_name", sa.String(length=100), nullable=False),
        sa.Column("access_token", sa.String(length=1024), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=True),
        sa.Column("refresh_token", sa.String(length=1024), nullable=True),
        sa.Column("account_id", sa.String(length=320), nullable=False),
        sa.Column("account_email", sa.String(length=320), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="cascade"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_oauth_account_account_id", "oauth_account", ["account_id"], unique=False)
    op.create_index("ix_oauth_account_oauth_name", "oauth_account", ["oauth_name"], unique=False)

    op.create_table(
        "desktop_auth_code",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("code_challenge", sa.String(length=128), nullable=False),
        sa.Column("code_challenge_method", sa.String(length=10), nullable=False),
        sa.Column("state", sa.String(length=128), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_desktop_auth_code_code", "desktop_auth_code", ["code"], unique=True)

    op.create_table(
        "cloud_workspace",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("git_provider", sa.String(length=32), nullable=False),
        sa.Column("git_owner", sa.String(length=255), nullable=False),
        sa.Column("git_repo_name", sa.String(length=255), nullable=False),
        sa.Column("git_branch", sa.String(length=255), nullable=False),
        sa.Column("git_base_branch", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("status_detail", sa.String(length=255), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("template_version", sa.String(length=64), nullable=False),
        sa.Column("runtime_generation", sa.Integer(), nullable=False),
        sa.Column("active_sandbox_id", sa.Uuid(), nullable=True),
        sa.Column("runtime_url", sa.Text(), nullable=True),
        sa.Column("runtime_token_ciphertext", sa.Text(), nullable=True),
        sa.Column("anyharness_workspace_id", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cloud_workspace_user_id", "cloud_workspace", ["user_id"], unique=False)

    op.create_table(
        "cloud_sandbox",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("cloud_workspace_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("external_sandbox_id", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("template_version", sa.String(length=64), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("external_sandbox_id"),
    )
    op.create_index(
        "ix_cloud_sandbox_cloud_workspace_id",
        "cloud_sandbox",
        ["cloud_workspace_id"],
        unique=False,
    )

    op.create_table(
        "cloud_credential",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("auth_mode", sa.String(length=16), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.Column("payload_format", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cloud_credential_user_id", "cloud_credential", ["user_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_cloud_credential_user_id", table_name="cloud_credential")
    op.drop_table("cloud_credential")

    op.drop_index("ix_cloud_sandbox_cloud_workspace_id", table_name="cloud_sandbox")
    op.drop_table("cloud_sandbox")

    op.drop_index("ix_cloud_workspace_user_id", table_name="cloud_workspace")
    op.drop_table("cloud_workspace")

    op.drop_index("ix_desktop_auth_code_code", table_name="desktop_auth_code")
    op.drop_table("desktop_auth_code")

    op.drop_index("ix_oauth_account_oauth_name", table_name="oauth_account")
    op.drop_index("ix_oauth_account_account_id", table_name="oauth_account")
    op.drop_table("oauth_account")

    op.drop_index("ix_user_email", table_name="user")
    op.drop_table("user")
