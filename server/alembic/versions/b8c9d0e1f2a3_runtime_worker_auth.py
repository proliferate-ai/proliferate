"""Runtime worker auth tables.

Adds the runtime worker identity, enrollment, and integration-gateway token
tables that back cloud-sandbox and desktop worker enrollment.

Revision ID: a1b2c3d4e5f6
Revises: f8b9c0d1e2f4
Create Date: 2026-07-01 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b8c9d0e1f2a3"
down_revision: str | None = "f8b9c0d1e2f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cloud_runtime_worker",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("runtime_kind", sa.String(length=32), nullable=False),
        sa.Column("cloud_sandbox_id", sa.Uuid(), nullable=True),
        sa.Column("desktop_install_id", sa.String(length=255), nullable=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("enrolled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "runtime_kind IN ('cloud_sandbox', 'desktop')",
            name="ck_cloud_runtime_worker_kind",
        ),
        sa.CheckConstraint(
            "status IN ('online', 'offline', 'revoked')",
            name="ck_cloud_runtime_worker_status",
        ),
        sa.CheckConstraint(
            "(runtime_kind = 'cloud_sandbox' AND cloud_sandbox_id IS NOT NULL "
            "AND desktop_install_id IS NULL) OR "
            "(runtime_kind = 'desktop' AND desktop_install_id IS NOT NULL "
            "AND cloud_sandbox_id IS NULL)",
            name="ck_cloud_runtime_worker_kind_identity",
        ),
        sa.UniqueConstraint("token_hash", name="uq_cloud_runtime_worker_token_hash"),
    )
    op.create_index(
        "ix_cloud_runtime_worker_owner_user_id", "cloud_runtime_worker", ["owner_user_id"]
    )
    op.create_index(
        "ix_cloud_runtime_worker_organization_id",
        "cloud_runtime_worker",
        ["organization_id"],
    )
    op.create_index(
        "ix_cloud_runtime_worker_cloud_sandbox_id",
        "cloud_runtime_worker",
        ["cloud_sandbox_id"],
    )
    op.create_index(
        "ix_cloud_runtime_worker_last_seen_at", "cloud_runtime_worker", ["last_seen_at"]
    )
    op.create_index(
        "ux_cloud_runtime_worker_active_sandbox",
        "cloud_runtime_worker",
        ["cloud_sandbox_id"],
        unique=True,
        postgresql_where=sa.text("status != 'revoked' AND cloud_sandbox_id IS NOT NULL"),
    )
    op.create_index(
        "ux_cloud_runtime_worker_active_desktop",
        "cloud_runtime_worker",
        ["owner_user_id", "desktop_install_id"],
        unique=True,
        postgresql_where=sa.text("status != 'revoked' AND desktop_install_id IS NOT NULL"),
    )

    op.create_table(
        "cloud_runtime_worker_enrollment",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("runtime_kind", sa.String(length=32), nullable=False),
        sa.Column("cloud_sandbox_id", sa.Uuid(), nullable=True),
        sa.Column("desktop_install_id", sa.String(length=255), nullable=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "runtime_kind IN ('cloud_sandbox', 'desktop')",
            name="ck_cloud_runtime_worker_enrollment_kind",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'consumed', 'expired', 'revoked')",
            name="ck_cloud_runtime_worker_enrollment_status",
        ),
        sa.UniqueConstraint("token_hash", name="uq_cloud_runtime_worker_enrollment_token_hash"),
    )
    op.create_index(
        "ix_cloud_runtime_worker_enrollment_owner_user_id",
        "cloud_runtime_worker_enrollment",
        ["owner_user_id"],
    )
    op.create_index(
        "ix_cloud_runtime_worker_enrollment_organization_id",
        "cloud_runtime_worker_enrollment",
        ["organization_id"],
    )
    op.create_index(
        "ix_cloud_runtime_worker_enrollment_cloud_sandbox_id",
        "cloud_runtime_worker_enrollment",
        ["cloud_sandbox_id"],
    )
    op.create_index(
        "ix_cloud_runtime_worker_enrollment_expires_at",
        "cloud_runtime_worker_enrollment",
        ["expires_at"],
    )

    op.create_table(
        "cloud_integration_gateway_token",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("runtime_worker_id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'revoked')",
            name="ck_cloud_integration_gateway_token_status",
        ),
        sa.UniqueConstraint("token_hash", name="uq_cloud_integration_gateway_token_token_hash"),
    )
    op.create_index(
        "ix_cloud_integration_gateway_token_runtime_worker_id",
        "cloud_integration_gateway_token",
        ["runtime_worker_id"],
    )
    op.create_index(
        "ix_cloud_integration_gateway_token_owner_user_id",
        "cloud_integration_gateway_token",
        ["owner_user_id"],
    )
    op.create_index(
        "ix_cloud_integration_gateway_token_organization_id",
        "cloud_integration_gateway_token",
        ["organization_id"],
    )
    op.create_index(
        "ux_cloud_integration_gateway_token_active_worker",
        "cloud_integration_gateway_token",
        ["runtime_worker_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )


def downgrade() -> None:
    op.drop_table("cloud_integration_gateway_token")
    op.drop_table("cloud_runtime_worker_enrollment")
    op.drop_table("cloud_runtime_worker")
