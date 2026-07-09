"""workflow missed-run policy + missed run status (track 1c scheduling)

Revision ID: a1c9e5d7b3f2
Revises: f1a9c7e3b2d5
Create Date: 2026-07-09 03:00:00.000000

Track 1c (scheduling policy), the RULED missed-run model (mental-model §4):

1. ``workflow_trigger.missed_run_policy`` — a per-trigger enum
   ``run_latest | skip_all | replay_all`` (default ``run_latest``) deciding how a
   catch-up tick treats occurrences that came due while the scheduler was down.
2. A new terminal ``missed`` value on the ``workflow_run.status`` CHECK — an
   honest history row for a slot that was recorded-not-fired (an older slot under
   run_latest, or every slot under skip_all). No sandbox launch, no delivery.

Chains onto the workflows/v1 head ``f1a9c7e3b2d5`` (track 1b, single head). The column add
is idempotent-guarded like the stack; the CHECK rewrites are guarded on the value
set already permitting ``missed`` so a re-run is a no-op.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c9e5d7b3f2"
down_revision: str | Sequence[str] | None = "f1a9c7e3b2d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_RUN_STATUS_CK = "ck_workflow_run_status"
_RUN_STATUS_WITHOUT_MISSED = (
    "status IN ("
    "'pending_delivery', 'delivered', 'running', 'waiting_approval', "
    "'completed', 'failed', 'cancelled'"
    ")"
)
_RUN_STATUS_WITH_MISSED = (
    "status IN ("
    "'pending_delivery', 'delivered', 'running', 'waiting_approval', "
    "'completed', 'failed', 'cancelled', 'missed'"
    ")"
)
_POLICY_CK = "ck_workflow_trigger_missed_run_policy"
_POLICY_CK_BODY = "missed_run_policy IN ('run_latest', 'skip_all', 'replay_all')"


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {col["name"] for col in inspector.get_columns(table_name)}


def _has_constraint(table_name: str, constraint_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    names = {ck["name"] for ck in inspector.get_check_constraints(table_name)}
    return constraint_name in names


def _run_status_check_admits_missed() -> bool:
    """True when the run-status CHECK already permits the ``missed`` value — used to
    make the CHECK rewrite a genuine no-op on re-run (see module docstring)."""
    inspector = sa.inspect(op.get_bind())
    for ck in inspector.get_check_constraints("workflow_run"):
        if ck["name"] == _RUN_STATUS_CK:
            return "'missed'" in (ck.get("sqltext") or "")
    return False


def upgrade() -> None:
    if not _has_column("workflow_trigger", "missed_run_policy"):
        op.add_column(
            "workflow_trigger",
            sa.Column(
                "missed_run_policy",
                sa.String(length=16),
                nullable=False,
                server_default=sa.text("'run_latest'"),
            ),
        )
    if not _has_constraint("workflow_trigger", _POLICY_CK):
        op.create_check_constraint(_POLICY_CK, "workflow_trigger", _POLICY_CK_BODY)

    # Widen the run-status CHECK to admit the new terminal ``missed`` value.
    # Guarded so a re-run is a genuine no-op (the docstring's claim): only rewrite
    # when the current CHECK does not already permit ``missed``.
    if not _run_status_check_admits_missed():
        if _has_constraint("workflow_run", _RUN_STATUS_CK):
            op.drop_constraint(_RUN_STATUS_CK, "workflow_run", type_="check")
        op.create_check_constraint(_RUN_STATUS_CK, "workflow_run", _RUN_STATUS_WITH_MISSED)


def downgrade() -> None:
    op.drop_constraint(_RUN_STATUS_CK, "workflow_run", type_="check")
    op.create_check_constraint(_RUN_STATUS_CK, "workflow_run", _RUN_STATUS_WITHOUT_MISSED)
    if _has_constraint("workflow_trigger", _POLICY_CK):
        op.drop_constraint(_POLICY_CK, "workflow_trigger", type_="check")
    if _has_column("workflow_trigger", "missed_run_policy"):
        op.drop_column("workflow_trigger", "missed_run_policy")
