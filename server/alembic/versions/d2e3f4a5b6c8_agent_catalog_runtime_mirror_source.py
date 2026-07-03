"""agent catalog runtime mirror source

P3 runtime catalog (codex/p3-catalog-contract.md §4): the runtime mirror
endpoint stores probe snapshots with ``source="runtime-mirror"``. Widen the
``agent_catalog_snapshot.source`` check constraint to admit that value
alongside the existing probe/seed/override sources.

Revision ID: d2e3f4a5b6c8
Revises: c9b8a7d6e5f4
Create Date: 2026-07-02 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d2e3f4a5b6c8"
down_revision: str | Sequence[str] | None = "c9b8a7d6e5f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent_catalog_snapshot"
_CONSTRAINT = "ck_agent_catalog_snapshot_source"
_OLD_CONDITION = "source IN ('probe', 'seed', 'override')"
_NEW_CONDITION = "source IN ('probe', 'seed', 'override', 'runtime-mirror')"


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_check_constraint(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return constraint_name in {
        constraint["name"] for constraint in _inspector().get_check_constraints(table_name)
    }


def upgrade() -> None:
    if not _has_table(_TABLE):
        return
    if _has_check_constraint(_TABLE, _CONSTRAINT):
        op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(_CONSTRAINT, _TABLE, _NEW_CONDITION)


def downgrade() -> None:
    if not _has_table(_TABLE):
        return
    if _has_check_constraint(_TABLE, _CONSTRAINT):
        op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(_CONSTRAINT, _TABLE, _OLD_CONDITION)
