"""cloud materialization state

Revision ID: e6a7b8c9d0e2
Revises: e5f6a7b8c9d1
Create Date: 2026-06-30 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "e6a7b8c9d0e2"
down_revision = "e5f6a7b8c9d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cloud_repo_environment_materialization",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("cloud_sandbox_id", sa.Uuid(), nullable=False),
        sa.Column("repo_environment_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=7), nullable=False),
        sa.Column(
            "applied_repo_environment_updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column("applied_manifest_json", sa.Text(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("materialized_at", sa.DateTime(timezone=True), nullable=True),
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
            "status IN ('pending', 'running', 'ready', 'error')",
            name="ck_cloud_repo_environment_materialization_status",
        ),
        sa.ForeignKeyConstraint(
            ["cloud_sandbox_id"],
            ["cloud_sandbox.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["repo_environment_id"],
            ["repo_environment.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_cloud_repo_environment_materialization_cloud_sandbox_id",
        "cloud_repo_environment_materialization",
        ["cloud_sandbox_id"],
        unique=False,
    )
    op.create_index(
        "ix_cloud_repo_environment_materialization_repo_environment_id",
        "cloud_repo_environment_materialization",
        ["repo_environment_id"],
        unique=False,
    )
    op.create_index(
        "ix_cloud_repo_environment_materialization_status",
        "cloud_repo_environment_materialization",
        ["cloud_sandbox_id", "status"],
        unique=False,
    )
    op.create_index(
        "ux_cloud_repo_environment_materialization",
        "cloud_repo_environment_materialization",
        ["cloud_sandbox_id", "repo_environment_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ux_cloud_repo_environment_materialization",
        table_name="cloud_repo_environment_materialization",
    )
    op.drop_index(
        "ix_cloud_repo_environment_materialization_status",
        table_name="cloud_repo_environment_materialization",
    )
    op.drop_index(
        "ix_cloud_repo_environment_materialization_repo_environment_id",
        table_name="cloud_repo_environment_materialization",
    )
    op.drop_index(
        "ix_cloud_repo_environment_materialization_cloud_sandbox_id",
        table_name="cloud_repo_environment_materialization",
    )
    op.drop_table("cloud_repo_environment_materialization")
