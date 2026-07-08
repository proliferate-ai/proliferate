"""workflow_step_action table

Revision ID: c3a5e7f9d1b2
Revises: b2d4f6a8c0e1
Create Date: 2026-07-07 00:00:00.000000

Adds the step-actions ledger (PR A): server-observed step completions claim a
side effect exactly once via (run_id, step_key, action_kind) unique constraint.
The claim key is the structured step key "<node>.<lane>.<step>" (format v2, B5),
not a bare integer index.
A sweeper retries stale pending actions and transient failed actions; the
partial index on updated_at WHERE status IN ('pending', 'failed') powers that
scan.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3a5e7f9d1b2"
down_revision: str | Sequence[str] | None = "b2d4f6a8c0e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    if not _has_table("workflow_step_action"):
        op.create_table(
            "workflow_step_action",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("run_id", sa.Uuid(), nullable=False),
            sa.Column("step_key", sa.String(length=64), nullable=False),
            sa.Column("action_kind", sa.String(length=32), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
            sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("result_json", JSONB(), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint(
                "run_id", "step_key", "action_kind",
                name="uq_workflow_step_action_claim",
            ),
            sa.CheckConstraint(
                "action_kind IN ('slack_notify')",
                name="ck_workflow_step_action_kind",
            ),
            sa.CheckConstraint(
                "status IN ('pending', 'done', 'failed')",
                name="ck_workflow_step_action_status",
            ),
            sa.ForeignKeyConstraint(["run_id"], ["workflow_run.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _has_index("workflow_step_action", "ix_workflow_step_action_sweep"):
        op.create_index(
            "ix_workflow_step_action_sweep",
            "workflow_step_action",
            ["updated_at"],
            postgresql_where=sa.text("status IN ('pending', 'failed')"),
        )


def downgrade() -> None:
    if _has_table("workflow_step_action"):
        if _has_index("workflow_step_action", "ix_workflow_step_action_sweep"):
            op.drop_index("ix_workflow_step_action_sweep", table_name="workflow_step_action")
        op.drop_table("workflow_step_action")
