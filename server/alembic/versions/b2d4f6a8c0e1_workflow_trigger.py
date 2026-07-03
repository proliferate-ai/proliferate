"""workflow_trigger table + workflow_run scheduler columns

Revision ID: b2d4f6a8c0e1
Revises: e4f7a2b9c6d1
Create Date: 2026-07-03 02:00:00.000000

Adds the schedule-trigger substrate (spec 3.5): a ``workflow_trigger`` table that
pins target + schedule + concurrency and funnels to the same StartRun, plus two
nullable columns on ``workflow_run`` (``trigger_id`` + ``scheduled_for``) that link
a scheduled run back to the trigger occurrence that produced it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2d4f6a8c0e1"
down_revision: str | Sequence[str] | None = "e4f7a2b9c6d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not _has_table("workflow_trigger"):
        op.create_table(
            "workflow_trigger",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("workflow_id", sa.Uuid(), nullable=False),
            sa.Column("kind", sa.String(length=32), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("concurrency_policy", sa.String(length=16), nullable=False),
            sa.Column("target_mode", sa.String(length=32), nullable=False),
            sa.Column("target_workspace_id", sa.Uuid(), nullable=True),
            sa.Column("schedule_rrule", sa.Text(), nullable=True),
            sa.Column("schedule_timezone", sa.String(length=64), nullable=True),
            sa.Column("schedule_summary", sa.String(length=255), nullable=True),
            sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_scheduled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_skipped_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_skip_reason", sa.String(length=255), nullable=True),
            sa.Column("args_json", JSONB(), nullable=False),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "kind IN ('schedule')",
                name="ck_workflow_trigger_kind",
            ),
            sa.CheckConstraint(
                "concurrency_policy IN ('skip', 'queue')",
                name="ck_workflow_trigger_concurrency_policy",
            ),
            sa.CheckConstraint(
                "target_mode IN ('local', 'personal_cloud')",
                name="ck_workflow_trigger_target_mode",
            ),
            sa.CheckConstraint(
                "(target_mode = 'personal_cloud' AND target_workspace_id IS NOT NULL) "
                "OR (target_mode = 'local' AND target_workspace_id IS NULL)",
                name="ck_workflow_trigger_target_workspace",
            ),
            sa.CheckConstraint(
                "kind <> 'schedule' OR ("
                "schedule_rrule IS NOT NULL "
                "AND schedule_timezone IS NOT NULL "
                "AND next_run_at IS NOT NULL"
                ")",
                name="ck_workflow_trigger_schedule_fields",
            ),
            sa.ForeignKeyConstraint(["workflow_id"], ["workflow.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["target_workspace_id"], ["cloud_workspace.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _has_index("workflow_trigger", "ix_workflow_trigger_workflow_id"):
        op.create_index("ix_workflow_trigger_workflow_id", "workflow_trigger", ["workflow_id"])
    if not _has_index("workflow_trigger", "ix_workflow_trigger_target_workspace_id"):
        op.create_index(
            "ix_workflow_trigger_target_workspace_id",
            "workflow_trigger",
            ["target_workspace_id"],
        )
    if not _has_index("workflow_trigger", "ix_workflow_trigger_scheduler_due"):
        op.create_index(
            "ix_workflow_trigger_scheduler_due",
            "workflow_trigger",
            ["next_run_at"],
            postgresql_where=sa.text(
                "enabled = true AND kind = 'schedule' AND next_run_at IS NOT NULL"
            ),
        )

    # workflow_run scheduler columns (added after the trigger table so the FK
    # target exists).
    if not _has_column("workflow_run", "trigger_id"):
        op.add_column("workflow_run", sa.Column("trigger_id", sa.Uuid(), nullable=True))
        op.create_foreign_key(
            "fk_workflow_run_trigger_id",
            "workflow_run",
            "workflow_trigger",
            ["trigger_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if not _has_column("workflow_run", "scheduled_for"):
        op.add_column(
            "workflow_run",
            sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_index("workflow_run", "ix_workflow_run_trigger_id"):
        op.create_index(
            "ix_workflow_run_trigger_id",
            "workflow_run",
            ["trigger_id", "created_at"],
            postgresql_where=sa.text("trigger_id IS NOT NULL"),
        )
    if not _has_index("workflow_run", "uq_workflow_run_trigger_slot"):
        op.create_index(
            "uq_workflow_run_trigger_slot",
            "workflow_run",
            ["trigger_id", "scheduled_for"],
            unique=True,
            postgresql_where=sa.text("trigger_id IS NOT NULL AND scheduled_for IS NOT NULL"),
        )


def downgrade() -> None:
    if _has_table("workflow_run"):
        for index_name in ("uq_workflow_run_trigger_slot", "ix_workflow_run_trigger_id"):
            if _has_index("workflow_run", index_name):
                op.drop_index(index_name, table_name="workflow_run")
        if _has_column("workflow_run", "trigger_id"):
            op.drop_constraint("fk_workflow_run_trigger_id", "workflow_run", type_="foreignkey")
            op.drop_column("workflow_run", "trigger_id")
        if _has_column("workflow_run", "scheduled_for"):
            op.drop_column("workflow_run", "scheduled_for")

    if _has_table("workflow_trigger"):
        for index_name in (
            "ix_workflow_trigger_scheduler_due",
            "ix_workflow_trigger_target_workspace_id",
            "ix_workflow_trigger_workflow_id",
        ):
            if _has_index("workflow_trigger", index_name):
                op.drop_index(index_name, table_name="workflow_trigger")
        op.drop_table("workflow_trigger")
