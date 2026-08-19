"""add integration admission and bounded revocation schema

Revision ID: b32d45e67f89
Revises: a21c34d56e78
Create Date: 2026-08-19 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b32d45e67f89"
down_revision: str | Sequence[str] | None = "a21c34d56e78"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "cloud_integration_oauth_flow",
        sa.Column("revocation_endpoint", sa.Text(), nullable=True),
    )
    op.create_table(
        "cloud_integration_revocation_job",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("definition_id", sa.Uuid(), nullable=False),
        sa.Column("provider_namespace", sa.String(length=64), nullable=False),
        sa.Column("provider_client_id", sa.Uuid(), nullable=True),
        sa.Column("credential_ciphertext", sa.Text(), nullable=True),
        sa.Column("credential_format", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error_code", sa.String(length=64), nullable=True),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'succeeded', 'unsupported', 'exhausted')",
            name="ck_cloud_integration_revocation_job_status",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name="ck_cloud_integration_revocation_job_attempt_count",
        ),
        sa.CheckConstraint(
            "(status IN ('pending', 'running') AND credential_ciphertext IS NOT NULL "
            "AND completed_at IS NULL) OR "
            "(status IN ('succeeded', 'unsupported', 'exhausted') "
            "AND credential_ciphertext IS NULL AND completed_at IS NOT NULL)",
            name="ck_cloud_integration_revocation_job_secret_lifecycle",
        ),
    )
    op.create_index(
        "ix_cloud_integration_revocation_job_status_deadline",
        "cloud_integration_revocation_job",
        ["status", "deadline_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_cloud_integration_revocation_job_status_deadline",
        table_name="cloud_integration_revocation_job",
    )
    op.drop_table("cloud_integration_revocation_job")
    op.drop_column("cloud_integration_oauth_flow", "revocation_endpoint")
