"""agent_auth slice 4: the seat_usage_sample table (meters)

Flow 5's soft signal (agent_auth spec §2 + §3): the usage probe writes one
row per one-token probe of an active seat; the settings meters read the
latest row per seat. **Advisory only, never a launch gate** — no launch-path
reader exists, enforced by an import-scan test.

- New table ``seat_usage_sample`` per spec §2's DDL: bigserial PK,
  ``api_key_id → agent_api_key``, nullable observation columns (a
  ``probe_failed`` row records that no trustworthy observation exists), the
  status CHECK, plus a binding_window CHECK pinning the DDL's commented
  vocabulary (five_hour | seven_day). Beyond the spec DDL, performance only: ON DELETE CASCADE on
  the FK (vault rows cascade with their user, so samples must ride along or
  user deletion trips the FK) and one (api_key_id, sampled_at) index — the
  latest-per-seat read and the writer's 30-day prune both walk it.

Downgrade drops the table (data preservation is not a constraint; samples
are 30-day-transient probe observations).

Revision ID: a9f3c17b42d8
Revises: d9e4b7a2c6f1
Create Date: 2026-08-26 22:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a9f3c17b42d8"
down_revision: str | Sequence[str] | None = "d9e4b7a2c6f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "seat_usage_sample"
_INDEX = "ix_seat_usage_sample_key_sampled"


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("api_key_id", sa.Uuid(), nullable=False),
        sa.Column("sampled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("util_5h", sa.REAL(), nullable=True),
        sa.Column("util_7d", sa.REAL(), nullable=True),
        sa.Column("reset_5h", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reset_7d", sa.DateTime(timezone=True), nullable=True),
        sa.Column("binding_window", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "status IN ('allowed', 'limited', 'probe_failed')",
            name="ck_seat_usage_sample_status",
        ),
        sa.CheckConstraint(
            "binding_window IS NULL OR binding_window IN ('five_hour', 'seven_day')",
            name="ck_seat_usage_sample_binding_window",
        ),
        sa.ForeignKeyConstraint(
            ["api_key_id"],
            ["agent_api_key.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(_INDEX, _TABLE, ["api_key_id", "sampled_at"])


def downgrade() -> None:
    op.drop_index(_INDEX, table_name=_TABLE)
    op.drop_table(_TABLE)
