"""Workspace move.

Adds the ``workspace_move`` table: the durable ledger for round-trip
workspace handoffs between runtimes (local desktop <-> cloud sandbox, ssh
joining later). See specs/tbd/workspace-migration-v2.md section 2.2. This is
a fresh table name -- the old mobility tables (cloud_workspace_mobility,
cloud_workspace_mobility_event, cloud_workspace_handoff_op,
cloud_workspace_move_cleanup_item) were dropped in f8b9c0d1e2f4 and are
barred by the schema-assertion must-not-exist list; do not reuse them.

Revision ID: 42530134293a
Revises: 9d9e27c9298b
Create Date: 2026-07-02 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "42530134293a"
down_revision: str | Sequence[str] | None = "9d9e27c9298b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workspace_move",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("repo_config_id", sa.Uuid(), nullable=False),
        sa.Column("branch", sa.String(length=255), nullable=False),
        sa.Column("source_kind", sa.String(length=16), nullable=False),
        sa.Column("destination_kind", sa.String(length=16), nullable=False),
        sa.Column(
            "source_ref",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "destination_ref",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("base_commit_sha", sa.String(length=64), nullable=False),
        sa.Column(
            "phase",
            sa.String(length=32),
            server_default=sa.text("'started'"),
            nullable=False,
        ),
        sa.Column(
            "canonical_side",
            sa.String(length=16),
            server_default=sa.text("'source'"),
            nullable=False,
        ),
        sa.Column("failure_code", sa.String(length=64), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cutover_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["repo_config_id"], ["repo_config.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "source_kind IN ('local', 'cloud', 'ssh')",
            name="ck_workspace_move_source_kind",
        ),
        sa.CheckConstraint(
            "destination_kind IN ('local', 'cloud', 'ssh')",
            name="ck_workspace_move_destination_kind",
        ),
        sa.CheckConstraint(
            "phase IN ('started', 'destination_ready', 'installed', 'cutover', "
            "'completed', 'failed')",
            name="ck_workspace_move_phase",
        ),
        sa.CheckConstraint(
            "canonical_side IN ('source', 'destination')",
            name="ck_workspace_move_canonical_side",
        ),
    )
    op.create_index(
        "ix_workspace_move_user_id",
        "workspace_move",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_workspace_move_repo_config_id",
        "workspace_move",
        ["repo_config_id"],
        unique=False,
    )
    op.create_index(
        "ux_workspace_move_active_identity",
        "workspace_move",
        ["user_id", "repo_config_id", "branch"],
        unique=True,
        postgresql_where=sa.text("phase NOT IN ('completed', 'failed')"),
    )
    op.create_index(
        "ux_workspace_move_user_idempotency_key",
        "workspace_move",
        ["user_id", "idempotency_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ux_workspace_move_user_idempotency_key", table_name="workspace_move")
    op.drop_index("ux_workspace_move_active_identity", table_name="workspace_move")
    op.drop_index("ix_workspace_move_repo_config_id", table_name="workspace_move")
    op.drop_index("ix_workspace_move_user_id", table_name="workspace_move")
    op.drop_table("workspace_move")
