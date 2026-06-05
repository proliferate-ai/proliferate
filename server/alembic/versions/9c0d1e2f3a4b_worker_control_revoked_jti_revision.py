"""Add revoked-JTI revision to worker control state.

Revision ID: 9c0d1e2f3a4b
Revises: 8b9c0d1e2f3a
Create Date: 2026-06-05 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "9c0d1e2f3a4b"
down_revision: str | Sequence[str] | None = "8b9c0d1e2f3a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return _inspector().has_table(table_name)


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {column["name"] for column in _inspector().get_columns(table_name)}


def _add_column_once(table_name: str, column: sa.Column[object]) -> None:
    if _has_table(table_name) and not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def upgrade() -> None:
    _add_column_once(
        "cloud_worker_target_control_state",
        sa.Column(
            "revoked_jti_revision",
            sa.BigInteger(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    _add_column_once(
        "cloud_worker_target_control_state",
        sa.Column("revoked_jti_updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    if _has_column("cloud_worker_target_control_state", "revoked_jti_updated_at"):
        op.drop_column("cloud_worker_target_control_state", "revoked_jti_updated_at")
    if _has_column("cloud_worker_target_control_state", "revoked_jti_revision"):
        op.drop_column("cloud_worker_target_control_state", "revoked_jti_revision")
