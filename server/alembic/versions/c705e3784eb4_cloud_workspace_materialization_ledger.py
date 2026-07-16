"""durable cloud workspace materialization ledger

Introduces ``cloud_workspace_materialization``: a target-scoped ledger that
records each runnable checkout (managed Cloud and/or local Desktop) of a product
``cloud_workspace`` separately, so a local worktree path or AnyHarness id is
never stored as global workspace identity.

Backfill (idempotent): every ``cloud_workspace`` that already carries a
top-level ``anyharness_workspace_id`` gets one ``managed_cloud`` materialization
in ``hydrated`` state, with ``cloud_sandbox_id`` resolved from the owner's active
personal sandbox when present (else NULL). Rows whose top-level id is NULL get
NO synthetic materialization — the existing interrupted-creation shape stays
``primaryMaterialization = null`` / ``materializations = []`` and keeps its
age-based 900-second materializing/error semantics. The top-level column is left
intact for backward compatibility.

MERGE NOTE (Workflow slice 5a, PR #1245, merged to main as 78ac087d9):
main added ``cloud_workspace.workspace_kind`` ('repository_worktree' | 'scratch')
and made ``cloud_workspace.repo_environment_id`` NULLABLE via migration
``c3a7b8d9e0f1`` whose down_revision is also ``6f545e279264`` (this migration's
parent). At merge time this revision MUST be re-parented onto ``c3a7b8d9e0f1``
(down_revision = "c3a7b8d9e0f1") to linearize the chain.

Scratch workspaces have no repository backing and must never receive a
repository materialization. The earlier claim that "scratch rows have no
managed-Cloud runtime id, so no extra guard is needed" was WRONG:
``create_scratch_cloud_workspace(..., anyharness_workspace_id=...)`` on main lets
a scratch row carry an AnyHarness id, so an ``anyharness_workspace_id IS NOT
NULL`` filter alone WOULD backfill scratch rows. The backfill below therefore
also requires ``repo_environment_id IS NOT NULL`` — the actual repo-identity
column, which is nullable only for scratch rows post-#1245. On this stack base
(41b4fa083, pre-#1245) ``repo_environment_id`` is still NOT NULL and
``workspace_kind`` does not exist, so that extra predicate is a no-op here; it
becomes the load-bearing scratch guard once #1245 merges. Gating on repo
identity (not on ``workspace_kind``, which is absent here) keeps this revision
correct whether it lands before or after #1245.

Revision ID: c705e3784eb4
Revises: 6f545e279264
Create Date: 2026-07-15 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c705e3784eb4"
down_revision: str | Sequence[str] | None = "6f545e279264"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "cloud_workspace_materialization",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("cloud_workspace_id", sa.Uuid(), nullable=False),
        sa.Column("target_kind", sa.String(length=32), nullable=False),
        sa.Column("cloud_sandbox_id", sa.Uuid(), nullable=True),
        sa.Column("desktop_install_id", sa.String(length=255), nullable=True),
        sa.Column("anyharness_workspace_id", sa.String(length=255), nullable=True),
        sa.Column("worktree_path", sa.Text(), nullable=True),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("expected_head_sha", sa.String(length=64), nullable=True),
        sa.Column("observed_head_sha", sa.String(length=64), nullable=True),
        sa.Column("observed_branch", sa.String(length=255), nullable=True),
        sa.Column("failure_code", sa.String(length=255), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("last_reported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("unlinked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["cloud_workspace_id"],
            ["cloud_workspace.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["cloud_sandbox_id"],
            ["cloud_sandbox.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "target_kind IN ('managed_cloud', 'local_desktop')",
            name="ck_cloud_workspace_materialization_target_kind",
        ),
        sa.CheckConstraint(
            "state IN ('pending', 'hydrating', 'hydrated', 'missing', 'inconsistent', 'failed')",
            name="ck_cloud_workspace_materialization_state",
        ),
        sa.CheckConstraint(
            "generation >= 1",
            name="ck_cloud_workspace_materialization_generation",
        ),
        sa.CheckConstraint(
            "(target_kind = 'managed_cloud' AND desktop_install_id IS NULL) OR "
            "(target_kind = 'local_desktop' AND desktop_install_id IS NOT NULL "
            "AND cloud_sandbox_id IS NULL)",
            name="ck_cloud_workspace_materialization_kind_fields",
        ),
    )
    op.create_index(
        "ix_cloud_workspace_materialization_cloud_workspace_id",
        "cloud_workspace_materialization",
        ["cloud_workspace_id"],
    )
    op.create_index(
        "ux_cloud_workspace_materialization_active_managed",
        "cloud_workspace_materialization",
        ["cloud_workspace_id"],
        unique=True,
        postgresql_where=sa.text("target_kind = 'managed_cloud' AND unlinked_at IS NULL"),
    )
    op.create_index(
        "ux_cloud_workspace_materialization_active_local",
        "cloud_workspace_materialization",
        ["cloud_workspace_id", "desktop_install_id"],
        unique=True,
        postgresql_where=sa.text("target_kind = 'local_desktop' AND unlinked_at IS NULL"),
    )
    op.create_index(
        "ux_cloud_workspace_materialization_active_sandbox_runtime",
        "cloud_workspace_materialization",
        ["cloud_sandbox_id", "anyharness_workspace_id"],
        unique=True,
        postgresql_where=sa.text(
            "cloud_sandbox_id IS NOT NULL AND anyharness_workspace_id IS NOT NULL "
            "AND unlinked_at IS NULL"
        ),
    )
    op.create_index(
        "ux_cloud_workspace_materialization_active_install_runtime",
        "cloud_workspace_materialization",
        ["desktop_install_id", "anyharness_workspace_id"],
        unique=True,
        postgresql_where=sa.text(
            "desktop_install_id IS NOT NULL AND anyharness_workspace_id IS NOT NULL "
            "AND unlinked_at IS NULL"
        ),
    )

    # Backfill: hydrate a managed_cloud materialization for every REPOSITORY
    # workspace that already recorded a top-level AnyHarness id. Resolve the
    # owner's active personal sandbox when present (implicit workspace<->sandbox
    # link today), else leave cloud_sandbox_id NULL. NULL-id workspaces get no
    # row. ``repo_environment_id IS NOT NULL`` excludes #1245 scratch rows (which
    # may carry an AnyHarness id but have no repository identity); it is a no-op
    # on this pre-#1245 base where the column is NOT NULL. Guarded by NOT EXISTS
    # so re-running is a no-op.
    op.execute(
        sa.text(
            """
            INSERT INTO cloud_workspace_materialization (
                id,
                cloud_workspace_id,
                target_kind,
                cloud_sandbox_id,
                desktop_install_id,
                anyharness_workspace_id,
                worktree_path,
                state,
                generation,
                expected_head_sha,
                observed_head_sha,
                observed_branch,
                failure_code,
                failure_detail,
                last_reported_at,
                unlinked_at,
                created_at,
                updated_at
            )
            SELECT
                gen_random_uuid(),
                w.id,
                'managed_cloud',
                (
                    SELECT s.id
                    FROM cloud_sandbox s
                    WHERE s.owner_user_id = w.owner_user_id
                      AND s.destroyed_at IS NULL
                    LIMIT 1
                ),
                NULL,
                w.anyharness_workspace_id,
                NULL,
                'hydrated',
                1,
                NULL,
                NULL,
                NULL,
                NULL,
                NULL,
                NULL,
                NULL,
                w.created_at,
                w.updated_at
            FROM cloud_workspace w
            WHERE w.anyharness_workspace_id IS NOT NULL
              AND w.repo_environment_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                FROM cloud_workspace_materialization m
                WHERE m.cloud_workspace_id = w.id
                  AND m.target_kind = 'managed_cloud'
                  AND m.unlinked_at IS NULL
              )
            """
        )
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        "ux_cloud_workspace_materialization_active_install_runtime",
        table_name="cloud_workspace_materialization",
    )
    op.drop_index(
        "ux_cloud_workspace_materialization_active_sandbox_runtime",
        table_name="cloud_workspace_materialization",
    )
    op.drop_index(
        "ux_cloud_workspace_materialization_active_local",
        table_name="cloud_workspace_materialization",
    )
    op.drop_index(
        "ux_cloud_workspace_materialization_active_managed",
        table_name="cloud_workspace_materialization",
    )
    op.drop_index(
        "ix_cloud_workspace_materialization_cloud_workspace_id",
        table_name="cloud_workspace_materialization",
    )
    op.drop_table("cloud_workspace_materialization")
