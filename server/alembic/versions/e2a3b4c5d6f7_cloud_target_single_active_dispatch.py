"""cloud target single active desktop dispatch

Backs the enrollment reuse rule with a real invariant: at most one active
personal ``desktop_dispatch`` target per user. The reuse path in
``create_target_enrollment`` was a plain check-then-insert, so concurrent
enrollments (Desktop double-submit, retries) could each insert a row — the
extra row was never reused or rotated but stayed visible and selectable as
an agent-auth scope. Duplicates are archived down to the oldest row (the one
the reuse path deterministically picked) before the partial unique index is
created; the service recovers from the index's IntegrityError by taking the
reuse branch.

Revision ID: e2a3b4c5d6f7
Revises: d4c5b6a79801
Create Date: 2026-07-02 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e2a3b4c5d6f7"
down_revision: str | Sequence[str] | None = "d4c5b6a79801"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "cloud_targets"
_INDEX = "uq_cloud_targets_personal_desktop_dispatch_active"
_ACTIVE_DISPATCH = "owner_scope = 'personal' AND kind = 'desktop_dispatch' AND archived_at IS NULL"


def upgrade() -> None:
    op.execute(
        sa.text(
            f"""
            UPDATE {_TABLE}
            SET archived_at = NOW(), status = 'archived'
            WHERE {_ACTIVE_DISPATCH}
              AND id NOT IN (
                SELECT DISTINCT ON (owner_user_id) id
                FROM {_TABLE}
                WHERE {_ACTIVE_DISPATCH}
                ORDER BY owner_user_id, created_at, id
              )
            """
        )
    )
    op.create_index(
        _INDEX,
        _TABLE,
        ["owner_user_id"],
        unique=True,
        postgresql_where=sa.text(_ACTIVE_DISPATCH),
    )


def downgrade() -> None:
    op.drop_index(_INDEX, table_name=_TABLE)
