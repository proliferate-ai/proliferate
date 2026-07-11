"""workflow entities: workflow, workflow_version, workflow_run

Revision ID: e4f7a2b9c6d1
Revises: a2b3c4d5e6f8
Create Date: 2026-07-03 00:00:00.000000

Gate C reconciliation: re-chained off the workflows/v1 fork branchpoint
(c9b8a7d6e5f4) onto main's head (a2b3c4d5e6f8) so the merged tree has a single
linear alembic head. c9b8a7d6e5f4 remains an ancestor of a2b3c4d5e6f8, so no
migration is skipped.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4f7a2b9c6d1"
down_revision: str | Sequence[str] | None = "a2b3c4d5e6f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    if not _has_table("workflow"):
        op.create_table(
            "workflow",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("owner_user_id", sa.Uuid(), nullable=False),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("current_version_id", sa.Uuid(), nullable=True),
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _has_index("workflow", "ix_workflow_owner_user_id"):
        op.create_index("ix_workflow_owner_user_id", "workflow", ["owner_user_id"])
    if not _has_index("workflow", "ix_workflow_created_by_user_id"):
        op.create_index("ix_workflow_created_by_user_id", "workflow", ["created_by_user_id"])
    if not _has_index("workflow", "ix_workflow_current_version_id"):
        op.create_index("ix_workflow_current_version_id", "workflow", ["current_version_id"])
    if not _has_index("workflow", "ix_workflow_owner_active"):
        op.create_index(
            "ix_workflow_owner_active",
            "workflow",
            ["owner_user_id"],
            postgresql_where=sa.text("archived_at IS NULL"),
        )

    if not _has_table("workflow_version"):
        op.create_table(
            "workflow_version",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("workflow_id", sa.Uuid(), nullable=False),
            sa.Column("version_n", sa.Integer(), nullable=False),
            sa.Column("definition_json", JSONB(), nullable=False),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["workflow_id"], ["workflow.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("workflow_id", "version_n", name="uq_workflow_version_workflow_n"),
        )
    if not _has_index("workflow_version", "ix_workflow_version_workflow_id"):
        op.create_index("ix_workflow_version_workflow_id", "workflow_version", ["workflow_id"])
    if not _has_index("workflow_version", "ix_workflow_version_created_by_user_id"):
        op.create_index(
            "ix_workflow_version_created_by_user_id",
            "workflow_version",
            ["created_by_user_id"],
        )

    if not _has_table("workflow_run"):
        op.create_table(
            "workflow_run",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("workflow_id", sa.Uuid(), nullable=False),
            sa.Column("workflow_version_id", sa.Uuid(), nullable=False),
            sa.Column("trigger_kind", sa.String(length=32), nullable=False),
            sa.Column("executor_user_id", sa.Uuid(), nullable=False),
            sa.Column("args_json", JSONB(), nullable=False),
            sa.Column("target_mode", sa.String(length=32), nullable=False),
            sa.Column("resolved_plan_json", JSONB(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("step_cursor", sa.Integer(), nullable=True),
            sa.Column("step_outputs_json", JSONB(), nullable=True),
            sa.Column("anyharness_workspace_id", sa.String(length=255), nullable=True),
            sa.Column("anyharness_session_ids", JSONB(), nullable=True),
            sa.Column("error_code", sa.String(length=64), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("cost_usd", sa.Numeric(precision=12, scale=6), nullable=True),
            sa.Column("cost_tokens", sa.BigInteger(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "trigger_kind IN ('manual', 'schedule', 'chat', 'agent', 'api')",
                name="ck_workflow_run_trigger_kind",
            ),
            sa.CheckConstraint(
                "target_mode IN ('local', 'personal_cloud')",
                name="ck_workflow_run_target_mode",
            ),
            sa.CheckConstraint(
                "status IN ("
                "'pending_delivery', "
                "'delivered', "
                "'running', "
                "'waiting_approval', "
                "'completed', "
                "'failed', "
                "'cancelled'"
                ")",
                name="ck_workflow_run_status",
            ),
            sa.ForeignKeyConstraint(["workflow_id"], ["workflow.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["workflow_version_id"], ["workflow_version.id"], ondelete="RESTRICT"
            ),
            sa.ForeignKeyConstraint(["executor_user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _has_index("workflow_run", "ix_workflow_run_workflow_created"):
        op.create_index(
            "ix_workflow_run_workflow_created",
            "workflow_run",
            ["workflow_id", "created_at"],
        )
    if not _has_index("workflow_run", "ix_workflow_run_executor_user_id"):
        op.create_index("ix_workflow_run_executor_user_id", "workflow_run", ["executor_user_id"])
    if not _has_index("workflow_run", "ix_workflow_run_workflow_version_id"):
        op.create_index(
            "ix_workflow_run_workflow_version_id",
            "workflow_run",
            ["workflow_version_id"],
        )
    if not _has_index("workflow_run", "ix_workflow_run_pending_delivery"):
        op.create_index(
            "ix_workflow_run_pending_delivery",
            "workflow_run",
            ["created_at"],
            postgresql_where=sa.text("status = 'pending_delivery'"),
        )


def downgrade() -> None:
    if _has_table("workflow_run"):
        for index_name in (
            "ix_workflow_run_pending_delivery",
            "ix_workflow_run_workflow_version_id",
            "ix_workflow_run_executor_user_id",
            "ix_workflow_run_workflow_created",
        ):
            if _has_index("workflow_run", index_name):
                op.drop_index(index_name, table_name="workflow_run")
        op.drop_table("workflow_run")
    if _has_table("workflow_version"):
        for index_name in (
            "ix_workflow_version_created_by_user_id",
            "ix_workflow_version_workflow_id",
        ):
            if _has_index("workflow_version", index_name):
                op.drop_index(index_name, table_name="workflow_version")
        op.drop_table("workflow_version")
    if _has_table("workflow"):
        for index_name in (
            "ix_workflow_owner_active",
            "ix_workflow_current_version_id",
            "ix_workflow_created_by_user_id",
            "ix_workflow_owner_user_id",
        ):
            if _has_index("workflow", index_name):
                op.drop_index(index_name, table_name="workflow")
        op.drop_table("workflow")
