"""billing truth: seat_pool credit source + flat org overage cap default

Two ruled billing-truth changes (RULED 2026-07-14):

1. Adds the per-seat managed-LLM allocation ("seat_pool") to the
   ``llm_credit_grant.source`` check constraint. The $5/seat contribution is
   granted into the shared org LLM pool each paid period and expires at period
   end (reset on renewal), distinct from the never-expiring top-up grants.
2. Overage exposure is now a flat $50/org/month cap (not per-seat). The
   ``billing_subject.overage_cap_cents_per_seat`` column is reinterpreted as
   the org-level cap value; its default moves from the old per-seat $20 (2000)
   to $50 (5000). Existing rows still at the old per-seat default are migrated
   to the new flat default (pre-launch; the old value was never an explicit
   org cap).

Revision ID: f3d7a1b9c2e5
Revises: e7f8a9b0c1d3
Create Date: 2026-07-15 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f3d7a1b9c2e5"
down_revision: str | Sequence[str] | None = "e7f8a9b0c1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CONSTRAINT = "ck_llm_credit_grant_source"
_TABLE = "llm_credit_grant"
_SUBJECT_TABLE = "billing_subject"
_CAP_COLUMN = "overage_cap_cents_per_seat"
_OLD_CAP_DEFAULT = 2000
_NEW_CAP_DEFAULT = 5000


def upgrade() -> None:
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(
        _CONSTRAINT,
        _TABLE,
        "source IN ('free_signup', 'topup', 'admin', 'seat_pool')",
    )

    op.alter_column(
        _SUBJECT_TABLE,
        _CAP_COLUMN,
        server_default=sa.text(str(_NEW_CAP_DEFAULT)),
    )
    op.execute(
        sa.text(
            f"UPDATE {_SUBJECT_TABLE} SET {_CAP_COLUMN} = :new "
            f"WHERE {_CAP_COLUMN} = :old"
        ).bindparams(new=_NEW_CAP_DEFAULT, old=_OLD_CAP_DEFAULT)
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            f"UPDATE {_SUBJECT_TABLE} SET {_CAP_COLUMN} = :old "
            f"WHERE {_CAP_COLUMN} = :new"
        ).bindparams(new=_NEW_CAP_DEFAULT, old=_OLD_CAP_DEFAULT)
    )
    op.alter_column(
        _SUBJECT_TABLE,
        _CAP_COLUMN,
        server_default=sa.text(str(_OLD_CAP_DEFAULT)),
    )

    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(
        _CONSTRAINT,
        _TABLE,
        "source IN ('free_signup', 'topup', 'admin')",
    )
