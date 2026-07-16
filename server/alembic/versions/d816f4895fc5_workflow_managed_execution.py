"""managed workflow execution custody and projection

Revision ID: d816f4895fc5
Revises: c705e3784eb4
Create Date: 2026-07-16 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d816f4895fc5"
down_revision: str | Sequence[str] | None = "c705e3784eb4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workflow_managed_execution",
        sa.Column("invocation_id", sa.Uuid(), nullable=False),
        sa.Column("delivery_status", sa.String(length=32), nullable=False),
        sa.Column("delivery_checkpoint", sa.String(length=32), nullable=False),
        sa.Column("desired_state", sa.String(length=32), nullable=False),
        sa.Column("target_plan_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("target_cloud_sandbox_id", sa.Uuid(), nullable=True),
        sa.Column("target_execution_store_id", sa.String(length=255), nullable=True),
        sa.Column("target_workspace_id", sa.String(length=255), nullable=True),
        sa.Column("cloud_workspace_id", sa.Uuid(), nullable=True),
        sa.Column("execution_status", sa.String(length=32), nullable=True),
        sa.Column("latest_state_version", sa.BigInteger(), nullable=True),
        sa.Column("latest_projection_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("latest_observed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("freshness_basis", sa.String(length=32), nullable=False),
        sa.Column("delivery_generation", sa.BigInteger(), nullable=False),
        sa.Column("observation_generation", sa.BigInteger(), nullable=False),
        sa.Column("cancel_generation", sa.BigInteger(), nullable=False),
        sa.Column("delivery_attempt_count", sa.Integer(), nullable=False),
        sa.Column("consecutive_unchanged_count", sa.Integer(), nullable=False),
        sa.Column("last_delivery_error_code", sa.String(length=128), nullable=True),
        sa.Column("last_observation_error_code", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "delivery_status IN ('prepared', 'queued', 'delivering', 'accepted', "
            "'delivery_failed', 'delivery_cancelled')",
            name="ck_workflow_managed_execution_delivery_status",
        ),
        sa.CheckConstraint(
            "delivery_checkpoint IN ('none', 'target_plan_frozen', 'target_bound', "
            "'workspace_put_started', 'workspace_ready', 'run_put_started', 'accepted')",
            name="ck_workflow_managed_execution_delivery_checkpoint",
        ),
        sa.CheckConstraint(
            "desired_state IN ('active', 'cancelled')",
            name="ck_workflow_managed_execution_desired_state",
        ),
        sa.CheckConstraint(
            "execution_status IS NULL OR execution_status IN "
            "('accepted', 'running', 'completed', 'failed', 'cancelled', 'interrupted')",
            name="ck_workflow_managed_execution_execution_status",
        ),
        sa.CheckConstraint(
            "freshness_basis IN ('pending', 'live', 'unreachable', 'target_lost')",
            name="ck_workflow_managed_execution_freshness_basis",
        ),
        sa.CheckConstraint(
            "delivery_generation >= 1 AND observation_generation >= 0 "
            "AND cancel_generation >= 0 AND delivery_attempt_count >= 0 "
            "AND consecutive_unchanged_count >= 0",
            name="ck_workflow_managed_execution_counters",
        ),
        sa.ForeignKeyConstraint(
            ["invocation_id"], ["workflow_invocation.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("invocation_id"),
    )
    op.create_index(
        "ix_workflow_managed_execution_delivery",
        "workflow_managed_execution",
        ["delivery_status", "updated_at"],
    )
    op.create_index(
        "ix_workflow_managed_execution_observation",
        "workflow_managed_execution",
        ["execution_status", "latest_observed_at"],
    )
    op.create_index(
        "ix_workflow_managed_execution_cancellation",
        "workflow_managed_execution",
        ["desired_state", "updated_at"],
    )
    op.execute(
        """
        INSERT INTO workflow_managed_execution (
          invocation_id, delivery_status, delivery_checkpoint, desired_state,
          freshness_basis, delivery_generation, observation_generation,
          cancel_generation, delivery_attempt_count, consecutive_unchanged_count,
          created_at, updated_at
        )
        SELECT id, 'prepared', 'none', 'active', 'pending', 1, 0, 0, 0, 0,
               created_at, updated_at
        FROM workflow_invocation
        ON CONFLICT (invocation_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("workflow_managed_execution")
