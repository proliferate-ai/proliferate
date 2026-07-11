"""workflow run stopped_by_user_id (D15 take-over / cancel)

Revision ID: a7b9c1d3e5f7
Revises: d2f4a6c8e0b1
Create Date: 2026-07-09 00:00:00.000000

PR F (session plane, D15): the audit answer to "why is this run cancelled" —
the user who took over / cancelled it. Nullable (set only by an explicit
take-over), FK user with ON DELETE SET NULL so an audit trail survives user
deletion. Idempotent-guarded like the rest of the stack.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7b9c1d3e5f7"
down_revision: str | Sequence[str] | None = "d2f4a6c8e0b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {col["name"] for col in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not _has_column("workflow_run", "stopped_by_user_id"):
        op.add_column(
            "workflow_run",
            sa.Column("stopped_by_user_id", sa.Uuid(), nullable=True),
        )
        op.create_foreign_key(
            "fk_workflow_run_stopped_by_user_id",
            "workflow_run",
            "user",
            ["stopped_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    if _has_column("workflow_run", "stopped_by_user_id"):
        op.drop_constraint(
            "fk_workflow_run_stopped_by_user_id", "workflow_run", type_="foreignkey"
        )
        op.drop_column("workflow_run", "stopped_by_user_id")
