"""agent_auth slice 7: structured seat identity on agent_api_key

Data enabler 1 (delivery spec slice 7, Scope C): ``agent_api_key`` gains
nullable ``seat_email`` and ``seat_plan``. The mint flow already collects
both on the sheet and today folds them into the title; threading them into
their own columns lets rows show a seat's email and plan even after the
seat is renamed — structured fields, never title parsing.

No backfill, by ruling: seats minted before these columns keep NULLs and
render via the title fallback.

Downgrade drops the columns (data preservation is not a constraint; the
identity survives inside existing titles).

Revision ID: b3d5f7a9c1e2
Revises: a9f3c17b42d8
Create Date: 2026-08-27 10:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3d5f7a9c1e2"
down_revision: str | Sequence[str] | None = "a9f3c17b42d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent_api_key"


def upgrade() -> None:
    op.add_column(_TABLE, sa.Column("seat_email", sa.Text(), nullable=True))
    op.add_column(_TABLE, sa.Column("seat_plan", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column(_TABLE, "seat_plan")
    op.drop_column(_TABLE, "seat_email")
