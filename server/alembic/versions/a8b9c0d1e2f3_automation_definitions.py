"""automation definitions and scheduled run queue

Revision ID: a8b9c0d1e2f3
Revises: c2d3e4f5a6b7
Create Date: 2026-04-20 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8b9c0d1e2f3"
down_revision: str | Sequence[str] | None = "c2d3e4f5a6b7"
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
    if not _has_table("automation"):
        op.create_table(
            "automation",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("cloud_repo_config_id", sa.Uuid(), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("prompt", sa.Text(), nullable=False),
            sa.Column("schedule_rrule", sa.Text(), nullable=False),
            sa.Column("schedule_timezone", sa.String(length=64), nullable=False),
            sa.Column("schedule_summary", sa.String(length=255), nullable=False),
            sa.Column("execution_target", sa.String(length=32), nullable=False),
            sa.Column("agent_kind", sa.String(length=32), nullable=True),
            sa.Column("model_id", sa.String(length=255), nullable=True),
            sa.Column("mode_id", sa.String(length=255), nullable=True),
            sa.Column("reasoning_effort", sa.String(length=64), nullable=True),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_scheduled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "execution_target IN ('cloud', 'local')",
                name="ck_automation_execution_target",
            ),
            sa.CheckConstraint(
                "length(schedule_timezone) > 0 AND schedule_timezone NOT LIKE '% %'",
                name="ck_automation_schedule_timezone_shape",
            ),
            sa.ForeignKeyConstraint(
                ["cloud_repo_config_id"],
                ["cloud_repo_config.id"],
                ondelete="RESTRICT",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _has_index("automation", "ix_automation_user_id"):
        op.create_index("ix_automation_user_id", "automation", ["user_id"], unique=False)
    if not _has_index("automation", "ix_automation_cloud_repo_config_id"):
        op.create_index(
            "ix_automation_cloud_repo_config_id",
            "automation",
            ["cloud_repo_config_id"],
            unique=False,
        )
    if not _has_index("automation", "ix_automation_scheduler_due"):
        op.create_index(
            "ix_automation_scheduler_due",
            "automation",
            ["next_run_at"],
            unique=False,
            postgresql_where=sa.text("enabled = true AND next_run_at IS NOT NULL"),
        )

    if not _has_table("automation_run"):
        op.create_table(
            "automation_run",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("automation_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("trigger_kind", sa.String(length=32), nullable=False),
            sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
            sa.Column("execution_target", sa.String(length=32), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "trigger_kind IN ('scheduled', 'manual')",
                name="ck_automation_run_trigger_kind",
            ),
            sa.CheckConstraint(
                "execution_target IN ('cloud', 'local')",
                name="ck_automation_run_execution_target",
            ),
            # V1 queue states only; widen this constraint when executor states land.
            sa.CheckConstraint(
                "status IN ('queued', 'cancelled')",
                name="ck_automation_run_status",
            ),
            sa.CheckConstraint(
                "("
                "trigger_kind = 'scheduled' AND scheduled_for IS NOT NULL"
                ") OR ("
                "trigger_kind = 'manual' AND scheduled_for IS NULL"
                ")",
                name="ck_automation_run_trigger_scheduled_for",
            ),
            sa.ForeignKeyConstraint(["automation_id"], ["automation.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _has_index("automation_run", "ix_automation_run_user_id"):
        op.create_index("ix_automation_run_user_id", "automation_run", ["user_id"], unique=False)
    if not _has_index("automation_run", "ix_automation_run_automation_created"):
        op.create_index(
            "ix_automation_run_automation_created",
            "automation_run",
            ["automation_id", "created_at"],
            unique=False,
        )
    if not _has_index("automation_run", "uq_automation_run_scheduled_slot"):
        op.create_index(
            "uq_automation_run_scheduled_slot",
            "automation_run",
            ["automation_id", "scheduled_for"],
            unique=True,
            postgresql_where=sa.text("trigger_kind = 'scheduled'"),
        )


def downgrade() -> None:
    if _has_table("automation_run"):
        if _has_index("automation_run", "uq_automation_run_scheduled_slot"):
            op.drop_index("uq_automation_run_scheduled_slot", table_name="automation_run")
        if _has_index("automation_run", "ix_automation_run_automation_created"):
            op.drop_index("ix_automation_run_automation_created", table_name="automation_run")
        if _has_index("automation_run", "ix_automation_run_user_id"):
            op.drop_index("ix_automation_run_user_id", table_name="automation_run")
        op.drop_table("automation_run")
    if _has_table("automation"):
        if _has_index("automation", "ix_automation_scheduler_due"):
            op.drop_index("ix_automation_scheduler_due", table_name="automation")
        if _has_index("automation", "ix_automation_cloud_repo_config_id"):
            op.drop_index("ix_automation_cloud_repo_config_id", table_name="automation")
        if _has_index("automation", "ix_automation_user_id"):
            op.drop_index("ix_automation_user_id", table_name="automation")
        op.drop_table("automation")
