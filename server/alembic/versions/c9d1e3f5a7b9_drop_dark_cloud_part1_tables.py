"""Drop the zero-consumer dark cloud tables (cull A-b part 1).

Removes the tables behind the dark systems deleted in the cull sweep's
first slice: agent run configs and the worktree retention policy. No data
is preserved; these
surfaces were gated off in production and had no live consumers. CASCADE
also removes inbound foreign keys from still-standing tables (the
automation table's RESTRICT references drop with their owner in a later
slice).

Revision ID: c9d1e3f5a7b9
Revises: d7e8f9a0b1c2
Create Date: 2026-08-25 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "c9d1e3f5a7b9"
down_revision: str | None = "d7e8f9a0b1c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DROPPED_TABLES = (
    "cloud_agent_run_config_default",
    "cloud_agent_run_config",
    "cloud_worktree_retention_policy",
)


def upgrade() -> None:
    for table in DROPPED_TABLES:
        op.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')


def downgrade() -> None:
    raise NotImplementedError("Dark cloud part-1 tables are gone for good.")
