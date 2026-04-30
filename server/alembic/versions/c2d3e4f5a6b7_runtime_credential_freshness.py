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


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    columns: list[sa.Column] = [
        sa.Column("credential_files_applied_revision", sa.Text(), nullable=True),
        sa.Column("credential_files_applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("credential_process_applied_revision", sa.Text(), nullable=True),
        sa.Column("credential_process_applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("credential_last_error", sa.Text(), nullable=True),
        sa.Column("credential_last_error_at", sa.DateTime(timezone=True), nullable=True),
    ]
    for column in columns:
        if not _has_column("cloud_runtime_environment", column.name):
            op.add_column("cloud_runtime_environment", column)


def downgrade() -> None:
    for column_name in (
        "credential_last_error_at",
        "credential_last_error",
        "credential_process_applied_at",
        "credential_process_applied_revision",
        "credential_files_applied_at",
        "credential_files_applied_revision",
    ):
        if _has_column("cloud_runtime_environment", column_name):
            op.drop_column("cloud_runtime_environment", column_name)
