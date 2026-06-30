"""Add GitHub App authorization and installation cache.

Revision ID: c3f6a9b2d4e8
Revises: c2e5f8a1b4d7
Create Date: 2026-06-26 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "c3f6a9b2d4e8"
down_revision: str | None = "c2e5f8a1b4d7"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "github_app_authorizations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("github_user_id", sa.String(length=64), nullable=False),
        sa.Column("github_login", sa.String(length=255), nullable=False),
        sa.Column("access_token_ciphertext", sa.Text(), nullable=True),
        sa.Column("refresh_token_ciphertext", sa.Text(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refresh_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("permissions_json", sa.Text(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('ready', 'expired', 'revoked', 'needs_reauth')",
            name="ck_github_app_authorizations_status",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ux_github_app_authorizations_user_active",
        "github_app_authorizations",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status != 'revoked'"),
    )
    op.create_index(
        "ix_github_app_authorizations_github_user",
        "github_app_authorizations",
        ["github_user_id"],
    )
    op.create_index(
        "ix_github_app_authorizations_user_id",
        "github_app_authorizations",
        ["user_id"],
    )

    op.create_table(
        "github_app_installations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("github_installation_id", sa.String(length=64), nullable=False),
        sa.Column("account_login", sa.String(length=255), nullable=False),
        sa.Column("account_type", sa.String(length=32), nullable=False),
        sa.Column("repository_selection", sa.String(length=32), nullable=False),
        sa.Column("permissions_json", sa.Text(), nullable=True),
        sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ux_github_app_installations_external",
        "github_app_installations",
        ["github_installation_id"],
        unique=True,
    )
    op.create_index(
        "ix_github_app_installations_account",
        "github_app_installations",
        ["account_login", "account_type"],
    )

    op.create_table(
        "github_app_installation_repositories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("github_app_installation_id", sa.Uuid(), nullable=False),
        sa.Column("owner", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("github_repository_id", sa.String(length=64), nullable=False),
        sa.Column("private", sa.Boolean(), nullable=False),
        sa.Column("default_branch", sa.String(length=255), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["github_app_installation_id"],
            ["github_app_installations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ux_github_app_installation_repositories_repo",
        "github_app_installation_repositories",
        ["github_app_installation_id", "owner", "name"],
        unique=True,
    )
    op.create_index(
        "ix_github_app_installation_repositories_owner_name",
        "github_app_installation_repositories",
        ["owner", "name"],
    )
    op.create_index(
        "ix_github_app_installation_repositories_installation",
        "github_app_installation_repositories",
        ["github_app_installation_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_github_app_installation_repositories_installation",
        table_name="github_app_installation_repositories",
    )
    op.drop_index(
        "ix_github_app_installation_repositories_owner_name",
        table_name="github_app_installation_repositories",
    )
    op.drop_index(
        "ux_github_app_installation_repositories_repo",
        table_name="github_app_installation_repositories",
    )
    op.drop_table("github_app_installation_repositories")
    op.drop_index("ix_github_app_installations_account", table_name="github_app_installations")
    op.drop_index("ux_github_app_installations_external", table_name="github_app_installations")
    op.drop_table("github_app_installations")
    op.drop_index("ix_github_app_authorizations_user_id", table_name="github_app_authorizations")
    op.drop_index(
        "ix_github_app_authorizations_github_user",
        table_name="github_app_authorizations",
    )
    op.drop_index(
        "ux_github_app_authorizations_user_active",
        table_name="github_app_authorizations",
    )
    op.drop_table("github_app_authorizations")
