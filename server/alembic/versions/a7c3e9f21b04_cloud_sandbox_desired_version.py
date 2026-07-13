"""cloud sandbox target-scoped desired version

Revision ID: a7c3e9f21b04
Revises: a2b3c4d5e6f8
Create Date: 2026-07-13 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "a7c3e9f21b04"
down_revision = "a2b3c4d5e6f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cloud_sandbox_desired_version",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("cloud_sandbox_id", sa.Uuid(), nullable=False),
        sa.Column("desired_anyharness_version", sa.String(length=64), nullable=True),
        sa.Column("desired_worker_version", sa.String(length=64), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["cloud_sandbox_id"],
            ["cloud_sandbox.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ux_cloud_sandbox_desired_version_sandbox",
        "cloud_sandbox_desired_version",
        ["cloud_sandbox_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ux_cloud_sandbox_desired_version_sandbox",
        table_name="cloud_sandbox_desired_version",
    )
    op.drop_table("cloud_sandbox_desired_version")
