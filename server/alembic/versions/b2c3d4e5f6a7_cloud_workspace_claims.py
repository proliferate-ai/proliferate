"""Cloud workspace claims.

Revision ID: b2c3d4e5f6a7
Revises: c4e5f6a7b8d9
Create Date: 2026-05-20 12:30:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "c4e5f6a7b8d9"
branch_labels: str | None = None
depends_on: str | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {index["name"] for index in _inspector().get_indexes(table_name)}


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
) -> None:
    if _has_table(table_name) and not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=unique)


def upgrade() -> None:
    if not _has_table("cloud_workspace_claim"):
        op.create_table(
            "cloud_workspace_claim",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("cloud_workspace_id", sa.Uuid(), nullable=False),
            sa.Column("exposure_id", sa.Uuid(), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("anyharness_workspace_id", sa.Text(), nullable=True),
            sa.Column("cloud_session_id", sa.Uuid(), nullable=True),
            sa.Column("anyharness_session_id", sa.Text(), nullable=True),
            sa.Column("claimed_by_user_id", sa.Uuid(), nullable=True),
            sa.Column("source_kind", sa.String(length=32), nullable=False),
            sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "source_kind IN ('slack', 'automation', 'api', 'manual')",
                name="ck_cloud_workspace_claim_source_kind",
            ),
            sa.ForeignKeyConstraint(
                ["cloud_workspace_id"],
                ["cloud_workspace.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["exposure_id"],
                ["cloud_workspace_exposure.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organization.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["target_id"],
                ["cloud_targets.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["cloud_session_id"],
                ["cloud_sessions.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["claimed_by_user_id"],
                ["user.id"],
                ondelete="SET NULL",
            ),
            sa.UniqueConstraint("cloud_workspace_id", name="uq_cloud_workspace_claim_workspace"),
        )
    _create_index_once(
        "ix_cloud_workspace_claim_organization",
        "cloud_workspace_claim",
        ["organization_id"],
    )
    _create_index_once(
        "ix_cloud_workspace_claim_claimed_by",
        "cloud_workspace_claim",
        ["claimed_by_user_id"],
    )
    _create_index_once(
        "ix_cloud_workspace_claim_target",
        "cloud_workspace_claim",
        ["target_id"],
    )

    if not _has_table("cloud_workspace_claim_token"):
        op.create_table(
            "cloud_workspace_claim_token",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("claim_id", sa.Uuid(), nullable=False),
            sa.Column("token_jti_hash", sa.String(length=64), nullable=False),
            sa.Column("hash_key_id", sa.String(length=64), nullable=False),
            sa.Column("token_jti_prefix", sa.String(length=12), nullable=True),
            sa.Column("issued_to_user_id", sa.Uuid(), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("anyharness_workspace_id", sa.Text(), nullable=False),
            sa.Column("anyharness_session_id", sa.Text(), nullable=True),
            sa.Column("permissions", sa.String(length=32), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_reason", sa.Text(), nullable=True),
            sa.CheckConstraint(
                "status IN ('active', 'expired', 'revoked')",
                name="ck_cloud_workspace_claim_token_status",
            ),
            sa.ForeignKeyConstraint(
                ["claim_id"],
                ["cloud_workspace_claim.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["issued_to_user_id"],
                ["user.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["target_id"],
                ["cloud_targets.id"],
                ondelete="CASCADE",
            ),
            sa.UniqueConstraint(
                "token_jti_hash",
                name="uq_cloud_workspace_claim_token_jti_hash",
            ),
        )
    _create_index_once(
        "ix_cloud_workspace_claim_token_claim_status",
        "cloud_workspace_claim_token",
        ["claim_id", "status"],
    )
    _create_index_once(
        "ix_cloud_workspace_claim_token_target",
        "cloud_workspace_claim_token",
        ["target_id"],
    )
    _create_index_once(
        "ix_cloud_workspace_claim_token_issued_to",
        "cloud_workspace_claim_token",
        ["issued_to_user_id"],
    )
    _create_index_once(
        "ix_cloud_workspace_claim_token_expires",
        "cloud_workspace_claim_token",
        ["expires_at"],
    )


def downgrade() -> None:
    if _has_table("cloud_workspace_claim_token"):
        op.drop_table("cloud_workspace_claim_token")
    if _has_table("cloud_workspace_claim"):
        op.drop_table("cloud_workspace_claim")
