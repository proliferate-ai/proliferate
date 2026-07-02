"""organization instance marker for single-org mode

Revision ID: a1c2e3f4b5d6
Revises: e7a8b9c0d1e3
Create Date: 2026-07-02 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a1c2e3f4b5d6"
down_revision: str | Sequence[str] | None = "e7a8b9c0d1e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INSTANCE_ORG_INDEX = "ux_organization_instance"


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {column["name"] for column in _inspector().get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {index["name"] for index in _inspector().get_indexes(table_name)}


def upgrade() -> None:
    if not _has_table("organization"):
        return

    if not _has_column("organization", "is_instance"):
        op.add_column(
            "organization",
            sa.Column(
                "is_instance",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )

    # At most one organization may be the instance org. A partial unique index
    # keeps that invariant durable at the database, not just in application code.
    if not _has_index("organization", _INSTANCE_ORG_INDEX):
        op.create_index(
            _INSTANCE_ORG_INDEX,
            "organization",
            ["is_instance"],
            unique=True,
            postgresql_where=sa.text("is_instance"),
        )


def downgrade() -> None:
    if not _has_table("organization"):
        return

    if _has_index("organization", _INSTANCE_ORG_INDEX):
        op.drop_index(_INSTANCE_ORG_INDEX, table_name="organization")
    if _has_column("organization", "is_instance"):
        op.drop_column("organization", "is_instance")
