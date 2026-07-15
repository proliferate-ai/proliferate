"""enrollment budget_status limit_reached

Revision ID: 7c2ab9f4d0e1
Revises: 346d1f5a4151
Create Date: 2026-07-07 00:00:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "7c2ab9f4d0e1"
down_revision: str | Sequence[str] | None = "346d1f5a4151"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CONSTRAINT = "ck_agent_gateway_enrollment_budget_status"
_TABLE = "agent_gateway_enrollment"


def upgrade() -> None:
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(
        _CONSTRAINT,
        _TABLE,
        "budget_status IN ('ok', 'exhausted', 'limit_reached')",
    )


def downgrade() -> None:
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(
        _CONSTRAINT,
        _TABLE,
        "budget_status IN ('ok', 'exhausted')",
    )
