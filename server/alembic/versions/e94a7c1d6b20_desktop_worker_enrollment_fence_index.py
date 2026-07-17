"""index desktop worker enrollment fencing lookups

Revision ID: e94a7c1d6b20
Revises: d816f4895fc5
Create Date: 2026-07-17 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e94a7c1d6b20"
down_revision: str | Sequence[str] | None = "d816f4895fc5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_cloud_runtime_worker_enrollment_desktop_fence",
        "cloud_runtime_worker_enrollment",
        ["desktop_install_id", "status", "created_at"],
        unique=False,
        postgresql_where=sa.text("runtime_kind = 'desktop' AND desktop_install_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_cloud_runtime_worker_enrollment_desktop_fence",
        table_name="cloud_runtime_worker_enrollment",
    )
