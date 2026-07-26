"""agent gateway enrollment key (per-harness scoped virtual keys, B2)

Adds ``agent_gateway_enrollment_key``, the child table of
``agent_gateway_enrollment`` that holds one access-group-scoped LiteLLM
virtual key per (enrollment, harness_kind) — model-gateway.md §Account model,
ruling R2 (agents-impl-plan.md). Backfill of existing single-unscoped-key
enrollments into per-harness keys happens via a sync pass (the backfill
worker naturally re-syncs any enrollment whose fingerprint no longer matches
its current per-harness-key state), not inline in this migration, to avoid a
migration-time dependency on the LiteLLM admin API being reachable.

Revision ID: 28adf1a9e376
Revises: 35fa0038d703
Create Date: 2026-07-26 03:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "28adf1a9e376"
down_revision: str | Sequence[str] | None = "35fa0038d703"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def upgrade() -> None:
    if not _has_table("agent_gateway_enrollment_key"):
        op.create_table(
            "agent_gateway_enrollment_key",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("enrollment_id", sa.Uuid(), nullable=False),
            sa.Column("harness_kind", sa.String(length=64), nullable=False),
            sa.Column("virtual_key_id", sa.String(length=255), nullable=True),
            sa.Column("virtual_key_ciphertext", sa.Text(), nullable=True),
            sa.Column(
                "virtual_key_ciphertext_key_id",
                sa.String(length=255),
                nullable=True,
            ),
            sa.Column("sync_fingerprint", sa.String(length=128), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(
                ["enrollment_id"],
                ["agent_gateway_enrollment.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "enrollment_id",
                "harness_kind",
                name="uq_agent_gateway_enrollment_key_scope",
            ),
        )
        op.create_index(
            "ix_agent_gateway_enrollment_key_enrollment_id",
            "agent_gateway_enrollment_key",
            ["enrollment_id"],
        )
        op.create_index(
            "ix_agent_gateway_enrollment_key_virtual_key_id",
            "agent_gateway_enrollment_key",
            ["virtual_key_id"],
        )
        op.create_index(
            "ux_agent_gateway_enrollment_key_active_scope",
            "agent_gateway_enrollment_key",
            ["enrollment_id", "harness_kind"],
            unique=True,
            postgresql_where=sa.text("revoked_at IS NULL"),
        )

    # Backfill: force every already-synced enrollment back through the sync
    # path so it mints its per-harness keys. `ensure_user_enrollment` /
    # `ensure_org_enrollment` short-circuit on `sync_status == 'synced'`, so
    # flipping already-synced, non-revoked rows to 'pending' is what makes the
    # backfill worker's `list_enrollments_needing_sync` (which selects
    # pending/failed rows) pick them up and re-run `_sync_enrollment` on its
    # next tick — the row's existing single parent key, budget, and team are
    # untouched in the meantime (`sync_status='pending'` alone doesn't disable
    # anything). This migration never calls the LiteLLM admin API itself.
    op.execute(
        "UPDATE agent_gateway_enrollment "
        "SET sync_status = 'pending', updated_at = now() "
        "WHERE sync_status = 'synced' AND revoked_at IS NULL"
    )


def downgrade() -> None:
    if _has_table("agent_gateway_enrollment_key"):
        op.drop_table("agent_gateway_enrollment_key")
