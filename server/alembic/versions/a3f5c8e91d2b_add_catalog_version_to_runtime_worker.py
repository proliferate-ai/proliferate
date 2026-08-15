"""add_catalog_version_to_runtime_worker

Revision ID: a3f5c8e91d2b
Revises: da8a01b4ad7a
Create Date: 2026-08-15 00:00:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a3f5c8e91d2b"
down_revision: str | Sequence[str] | None = "da8a01b4ad7a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)
    }


def upgrade() -> None:
    # Telemetry-only, additive column (Update Flow ADR, FR-1): the runtime
    # worker's last-observed agent catalog version, reported over heartbeat.
    # Never a desired-state field.
    if _has_table("cloud_runtime_worker") and not _has_column(
        "cloud_runtime_worker", "catalog_version"
    ):
        op.add_column(
            "cloud_runtime_worker",
            sa.Column("catalog_version", sa.String(length=64), nullable=True),
        )


def downgrade() -> None:
    if _has_table("cloud_runtime_worker") and _has_column(
        "cloud_runtime_worker", "catalog_version"
    ):
        op.drop_column("cloud_runtime_worker", "catalog_version")
