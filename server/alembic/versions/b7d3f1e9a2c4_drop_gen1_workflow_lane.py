"""drop the gen-1 workflow lane: managed execution table and schema-v1 rows

Deletes the gen-1 (schema_version 1) workflow lane's persistence:

- drops ``workflow_managed_execution`` (the managed-delivery custody and
  projection row, one per gen-1 invocation);
- deletes ``workflow_invocation`` rows with ``schema_version = 1`` (frozen
  gen-1 invocations; their managed rows die with the table drop);
- deletes ``workflow_definition`` rows with ``schema_version = 1`` (the
  legacy delete-only definitions the gen-2 surface listed).

The row deletions are one-way: downgrade recreates the
``workflow_managed_execution`` table structure (empty) but cannot restore
deleted v1 rows. Take a production snapshot immediately before deploying
this revision — restoring gen-1 data afterward is a restore-from-snapshot
operation, not an alembic downgrade.

Revision ID: b7d3f1e9a2c4
Revises: e7a9c2d41f56
Create Date: 2026-08-25 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b7d3f1e9a2c4"
down_revision: str | Sequence[str] | None = "e7a9c2d41f56"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("workflow_managed_execution")
    op.execute("DELETE FROM workflow_invocation WHERE schema_version = 1")
    op.execute("DELETE FROM workflow_definition WHERE schema_version = 1")


def downgrade() -> None:
    # Structure only: deleted v1 rows are unrecoverable without a snapshot.
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
        sa.Column(
            "latest_projection_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("latest_observed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("freshness_basis", sa.String(length=32), nullable=False),
        sa.Column("delivery_generation", sa.BigInteger(), nullable=False),
        sa.Column("observation_generation", sa.BigInteger(), nullable=False),
        sa.Column("cancel_generation", sa.BigInteger(), nullable=False),
        sa.Column("delivery_attempt_count", sa.Integer(), nullable=False),
        sa.Column("consecutive_unchanged_count", sa.Integer(), nullable=False),
        sa.Column("last_delivery_error_code", sa.String(length=128), nullable=True),
        sa.Column("last_observation_error_code", sa.String(length=128), nullable=True),
        sa.Column("cancel_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
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
            "desired_state = 'active' OR cancel_requested_at IS NOT NULL",
            name="ck_workflow_managed_execution_cancel_requested_at",
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
        sa.ForeignKeyConstraint(["invocation_id"], ["workflow_invocation.id"], ondelete="CASCADE"),
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
        ["desired_state", "cancel_requested_at"],
    )
