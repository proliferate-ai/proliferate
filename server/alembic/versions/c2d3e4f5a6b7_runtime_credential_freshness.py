"""runtime credential freshness

Revision ID: c2d3e4f5a6b7
Revises: b3c4d5e6f7a8
Create Date: 2026-04-20 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c2d3e4f5a6b7"
down_revision: str | Sequence[str] | None = "b3c4d5e6f7a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "cloud_runtime_environment",
        sa.Column("credential_files_applied_revision", sa.Text(), nullable=True),
    )
    op.add_column(
        "cloud_runtime_environment",
        sa.Column("credential_files_applied_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "cloud_runtime_environment",
        sa.Column("credential_process_applied_revision", sa.Text(), nullable=True),
    )
    op.add_column(
        "cloud_runtime_environment",
        sa.Column("credential_process_applied_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "cloud_runtime_environment",
        sa.Column("credential_last_error", sa.Text(), nullable=True),
    )
    op.add_column(
        "cloud_runtime_environment",
        sa.Column("credential_last_error_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cloud_runtime_environment", "credential_last_error_at")
    op.drop_column("cloud_runtime_environment", "credential_last_error")
    op.drop_column("cloud_runtime_environment", "credential_process_applied_at")
    op.drop_column("cloud_runtime_environment", "credential_process_applied_revision")
    op.drop_column("cloud_runtime_environment", "credential_files_applied_at")
    op.drop_column("cloud_runtime_environment", "credential_files_applied_revision")
