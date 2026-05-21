"""Mobility v2 cleanup items and canonical side.

Revision ID: a0b1c2d3e4f5
Revises: f9a0b1c2d3e4
Create Date: 2026-05-21 12:30:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a0b1c2d3e4f5"
down_revision: str | Sequence[str] | None = "f9a0b1c2d3e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "cloud_workspace_handoff_op",
        sa.Column(
            "canonical_side",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'source'"),
        ),
    )
    op.execute(
        """
        UPDATE cloud_workspace_handoff_op
        SET canonical_side = 'destination',
            phase = CASE
                WHEN cleanup_completed_at IS NOT NULL THEN 'completed'
                WHEN phase IN (
                    'cutover_committed',
                    'cleanup_pending',
                    'completed',
                    'repair_required',
                    'cleanup_failed'
                ) THEN phase
                ELSE 'cleanup_pending'
            END
        WHERE finalized_at IS NOT NULL
           OR cleanup_completed_at IS NOT NULL
           OR phase IN (
                'cutover_committed',
                'cleanup_pending',
                'completed',
                'repair_required',
                'cleanup_failed'
           )
        """
    )
    op.create_check_constraint(
        "ck_cloud_workspace_handoff_canonical_side",
        "cloud_workspace_handoff_op",
        "canonical_side IN ('source', 'destination')",
    )
    op.create_check_constraint(
        "ck_cloud_workspace_handoff_destination_phase",
        "cloud_workspace_handoff_op",
        "canonical_side != 'destination' OR phase IN "
        "('cutover_committed', 'cleanup_pending', 'completed', "
        "'repair_required', 'cleanup_failed')",
    )
    op.execute(
        "UPDATE cloud_workspace_mobility SET owner = 'personal_cloud' WHERE owner = 'cloud'"
    )
    op.execute(
        "UPDATE cloud_workspace_handoff_op SET source_owner = 'personal_cloud' "
        "WHERE source_owner = 'cloud'"
    )
    op.execute(
        "UPDATE cloud_workspace_handoff_op SET target_owner = 'personal_cloud' "
        "WHERE target_owner = 'cloud'"
    )

    op.create_table(
        "cloud_workspace_move_cleanup_item",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("handoff_op_id", sa.UUID(), nullable=False),
        sa.Column("item_kind", sa.String(length=64), nullable=False),
        sa.Column("target_id", sa.UUID(), nullable=True),
        sa.Column("anyharness_workspace_id", sa.Text(), nullable=True),
        sa.Column("object_id", sa.UUID(), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="pending", nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("error_code", sa.String(length=128), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "item_kind IN ('anyharness_workspace', 'cloud_workspace', "
            "'cloud_exposure', 'cloud_session_projection', "
            "'cloud_transcript_projection', 'worker_projection_cursor')",
            name="ck_cloud_workspace_move_cleanup_item_kind",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed', 'failed')",
            name="ck_cloud_workspace_move_cleanup_item_status",
        ),
        sa.ForeignKeyConstraint(
            ["handoff_op_id"],
            ["cloud_workspace_handoff_op.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_cloud_workspace_move_cleanup_item_handoff_op_id",
        "cloud_workspace_move_cleanup_item",
        ["handoff_op_id"],
    )
    op.create_index(
        "ix_cloud_workspace_move_cleanup_item_target_id",
        "cloud_workspace_move_cleanup_item",
        ["target_id"],
    )
    op.create_index(
        "ix_cloud_workspace_move_cleanup_item_object_id",
        "cloud_workspace_move_cleanup_item",
        ["object_id"],
    )
    op.create_index(
        "ix_cloud_workspace_move_cleanup_item_handoff_status",
        "cloud_workspace_move_cleanup_item",
        ["handoff_op_id", "status"],
    )
    op.create_index(
        "ix_cloud_workspace_move_cleanup_item_due",
        "cloud_workspace_move_cleanup_item",
        ["next_attempt_at"],
        postgresql_where=sa.text("status IN ('pending', 'failed')"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        "ix_cloud_workspace_move_cleanup_item_due",
        table_name="cloud_workspace_move_cleanup_item",
    )
    op.drop_index(
        "ix_cloud_workspace_move_cleanup_item_handoff_status",
        table_name="cloud_workspace_move_cleanup_item",
    )
    op.drop_index(
        "ix_cloud_workspace_move_cleanup_item_object_id",
        table_name="cloud_workspace_move_cleanup_item",
    )
    op.drop_index(
        "ix_cloud_workspace_move_cleanup_item_target_id",
        table_name="cloud_workspace_move_cleanup_item",
    )
    op.drop_index(
        "ix_cloud_workspace_move_cleanup_item_handoff_op_id",
        table_name="cloud_workspace_move_cleanup_item",
    )
    op.drop_table("cloud_workspace_move_cleanup_item")
    op.execute(
        "UPDATE cloud_workspace_mobility SET owner = 'cloud' WHERE owner = 'personal_cloud'"
    )
    op.execute(
        "UPDATE cloud_workspace_handoff_op SET source_owner = 'cloud' "
        "WHERE source_owner = 'personal_cloud'"
    )
    op.execute(
        "UPDATE cloud_workspace_handoff_op SET target_owner = 'cloud' "
        "WHERE target_owner = 'personal_cloud'"
    )
    op.drop_constraint(
        "ck_cloud_workspace_handoff_destination_phase",
        "cloud_workspace_handoff_op",
        type_="check",
    )
    op.drop_constraint(
        "ck_cloud_workspace_handoff_canonical_side",
        "cloud_workspace_handoff_op",
        type_="check",
    )
    op.drop_column("cloud_workspace_handoff_op", "canonical_side")
