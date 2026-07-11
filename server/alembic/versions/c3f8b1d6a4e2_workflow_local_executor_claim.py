"""workflow desktop-executor claim plane (track 2a; lifts L15)

Revision ID: c3f8b1d6a4e2
Revises: a1c9e5d7b3f2
Create Date: 2026-07-09 12:00:00.000000

Track 2a (desktop executor + local scheduling) ports the automations claim
machinery to workflow runs. A server-created *local* scheduled run is born
``claimable`` and waits for a desktop executor to claim it (``claimed`` with a
heartbeat), execute it, and relay ``running`` -> terminal through the existing
/status path.

1. Widen the ``workflow_run.status`` CHECK to admit ``claimable`` + ``claimed``.
2. Add the claim columns (mirrors the automations run claim row): ``executor_id``,
   ``claim_id``, ``claimed_at``, ``claim_expires_at``, ``last_heartbeat_at``.
3. Two partial indexes: the owner's claimable-run scan (the 10s claim poll) and
   the stale-``claimed`` reclaim scan.

Chains onto ``a1c9e5d7b3f2`` (track 1c missed-run policy; single head). Column
adds + CHECK rewrite are idempotent-guarded like the rest of the stack so a re-run
is a genuine no-op.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3f8b1d6a4e2"
down_revision: str | Sequence[str] | None = "a1c9e5d7b3f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_RUN_STATUS_CK = "ck_workflow_run_status"
_RUN_STATUS_WITHOUT_CLAIM = (
    "status IN ("
    "'pending_delivery', 'delivered', 'running', 'waiting_approval', "
    "'completed', 'failed', 'cancelled', 'missed'"
    ")"
)
_RUN_STATUS_WITH_CLAIM = (
    "status IN ("
    "'pending_delivery', 'claimable', 'claimed', 'delivered', 'running', "
    "'waiting_approval', 'completed', 'failed', 'cancelled', 'missed'"
    ")"
)

_CLAIMABLE_INDEX = "ix_workflow_run_local_claimable"
_CLAIM_EXPIRY_INDEX = "ix_workflow_run_local_claim_expiry"

_CLAIM_COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("executor_id", sa.String(length=255)),
    ("claim_id", sa.Uuid()),
    ("claimed_at", sa.DateTime(timezone=True)),
    ("claim_expires_at", sa.DateTime(timezone=True)),
    ("last_heartbeat_at", sa.DateTime(timezone=True)),
)


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {col["name"] for col in inspector.get_columns(table_name)}


def _has_constraint(table_name: str, constraint_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    names = {ck["name"] for ck in inspector.get_check_constraints(table_name)}
    return constraint_name in names


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return index_name in {ix["name"] for ix in inspector.get_indexes(table_name)}


def _run_status_check_admits_claim() -> bool:
    inspector = sa.inspect(op.get_bind())
    for ck in inspector.get_check_constraints("workflow_run"):
        if ck["name"] == _RUN_STATUS_CK:
            return "'claimable'" in (ck.get("sqltext") or "")
    return False


def upgrade() -> None:
    for name, column_type in _CLAIM_COLUMNS:
        if not _has_column("workflow_run", name):
            op.add_column("workflow_run", sa.Column(name, column_type, nullable=True))

    if not _run_status_check_admits_claim():
        if _has_constraint("workflow_run", _RUN_STATUS_CK):
            op.drop_constraint(_RUN_STATUS_CK, "workflow_run", type_="check")
        op.create_check_constraint(_RUN_STATUS_CK, "workflow_run", _RUN_STATUS_WITH_CLAIM)

    if not _has_index("workflow_run", _CLAIMABLE_INDEX):
        op.create_index(
            _CLAIMABLE_INDEX,
            "workflow_run",
            ["executor_user_id", "created_at"],
            postgresql_where=sa.text("target_mode = 'local' AND status = 'claimable'"),
        )
    if not _has_index("workflow_run", _CLAIM_EXPIRY_INDEX):
        op.create_index(
            _CLAIM_EXPIRY_INDEX,
            "workflow_run",
            ["claim_expires_at"],
            postgresql_where=sa.text(
                "target_mode = 'local' AND status = 'claimed' "
                "AND claim_expires_at IS NOT NULL"
            ),
        )


def downgrade() -> None:
    if _has_index("workflow_run", _CLAIM_EXPIRY_INDEX):
        op.drop_index(_CLAIM_EXPIRY_INDEX, table_name="workflow_run")
    if _has_index("workflow_run", _CLAIMABLE_INDEX):
        op.drop_index(_CLAIMABLE_INDEX, table_name="workflow_run")

    op.drop_constraint(_RUN_STATUS_CK, "workflow_run", type_="check")
    op.create_check_constraint(_RUN_STATUS_CK, "workflow_run", _RUN_STATUS_WITHOUT_CLAIM)

    for name, _column_type in reversed(_CLAIM_COLUMNS):
        if _has_column("workflow_run", name):
            op.drop_column("workflow_run", name)
