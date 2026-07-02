"""agent auth route selection slot

Adds the slot composition axis to agent_auth_route_selection (PR 13, spec
section 3.3 slot semantics): single-source harnesses keep exactly one
slot='primary' row; OpenCode composes one row per slot (gateway + direct
provider keys). The unique scope widens from (user, harness, surface) to
(user, harness, surface, slot). No data migration is needed (no users).

Revision ID: e5f6a7b8c9d0
Revises: a9c0d1e2f3b4
Create Date: 2026-07-01 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: str | Sequence[str] | None = "a9c0d1e2f3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent_auth_route_selection"
_UNIQUE = "uq_agent_auth_route_selection_scope"


def upgrade() -> None:
    op.add_column(
        _TABLE,
        sa.Column(
            "slot",
            sa.String(length=32),
            nullable=False,
            server_default="primary",
        ),
    )
    op.drop_constraint(_UNIQUE, _TABLE, type_="unique")
    op.create_unique_constraint(
        _UNIQUE,
        _TABLE,
        ["user_id", "harness_kind", "surface", "slot"],
    )


def downgrade() -> None:
    op.drop_constraint(_UNIQUE, _TABLE, type_="unique")
    # Collapse any multi-slot scopes so the narrower unique key can be
    # restored (keep the primary/gateway row, else an arbitrary one).
    op.execute(
        sa.text(
            f"""
            DELETE FROM {_TABLE} keep
            WHERE keep.id NOT IN (
                SELECT DISTINCT ON (user_id, harness_kind, surface) id
                FROM {_TABLE}
                ORDER BY user_id, harness_kind, surface,
                         (slot IN ('primary', 'gateway')) DESC,
                         created_at
            )
            """
        )
    )
    op.drop_column(_TABLE, "slot")
    op.create_unique_constraint(
        _UNIQUE,
        _TABLE,
        ["user_id", "harness_kind", "surface"],
    )
