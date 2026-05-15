"""Add automation cloud target snapshots.

Revision ID: d4e5f6a7b8c9
Revises: d3e4f5a6b7c8
Create Date: 2026-05-14 20:20:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: str | None = "d3e4f5a6b7c8"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "automation",
        sa.Column("cloud_target_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "automation",
        sa.Column("cloud_target_kind_snapshot", sa.String(length=32), nullable=True),
    )
    op.create_foreign_key(
        "fk_automation_cloud_target_id_cloud_targets",
        "automation",
        "cloud_targets",
        ["cloud_target_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_automation_cloud_target_id", "automation", ["cloud_target_id"])

    op.add_column(
        "automation_run",
        sa.Column("cloud_target_id_snapshot", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "automation_run",
        sa.Column("cloud_target_kind_snapshot", sa.String(length=32), nullable=True),
    )
    op.create_foreign_key(
        "fk_automation_run_cloud_target_id_snapshot_cloud_targets",
        "automation_run",
        "cloud_targets",
        ["cloud_target_id_snapshot"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_automation_run_cloud_target_id_snapshot",
        "automation_run",
        ["cloud_target_id_snapshot"],
    )


def downgrade() -> None:
    op.drop_index("ix_automation_run_cloud_target_id_snapshot", table_name="automation_run")
    op.drop_constraint(
        "fk_automation_run_cloud_target_id_snapshot_cloud_targets",
        "automation_run",
        type_="foreignkey",
    )
    op.drop_column("automation_run", "cloud_target_kind_snapshot")
    op.drop_column("automation_run", "cloud_target_id_snapshot")

    op.drop_index("ix_automation_cloud_target_id", table_name="automation")
    op.drop_constraint(
        "fk_automation_cloud_target_id_cloud_targets",
        "automation",
        type_="foreignkey",
    )
    op.drop_column("automation", "cloud_target_kind_snapshot")
    op.drop_column("automation", "cloud_target_id")
