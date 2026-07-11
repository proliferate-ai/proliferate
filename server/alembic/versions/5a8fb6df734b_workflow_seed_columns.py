"""workflow seed marker columns (track 1f)

Revision ID: d1e2f3a4b5c6
Revises: c5e7a9b1d3f0
Create Date: 2026-07-09 02:00:00.000000

Track 1f (seeded workflow definitions): ``owner_user_id`` /
``created_by_user_id`` become nullable on ``workflow`` (and
``created_by_user_id`` on ``workflow_version``) to allow code-defined seed
rows with no authoring user. A nullable ``is_seed`` boolean + nullable unique
``seed_slug`` string mark and key those rows (matched the same way
integrations' ``source='seed'`` + ``namespace`` works) — the most-reversible
approach given workflows have no existing "system owner" concept. Idempotent-
guarded like the stack.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5a8fb6df734b"
down_revision: str | Sequence[str] | None = "c5e7a9b1d3f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {col["name"] for col in inspector.get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return index_name in {idx["name"] for idx in inspector.get_indexes(table_name)}


def upgrade() -> None:
    if not _has_column("workflow", "is_seed"):
        op.add_column(
            "workflow",
            sa.Column(
                "is_seed", sa.Boolean(), nullable=False, server_default=sa.text("false")
            ),
        )
    if not _has_column("workflow", "seed_slug"):
        op.add_column(
            "workflow",
            sa.Column("seed_slug", sa.String(length=64), nullable=True),
        )
    if not _has_index("workflow", "uq_workflow_seed_slug"):
        op.create_unique_constraint("uq_workflow_seed_slug", "workflow", ["seed_slug"])
    if not _has_index("workflow", "ix_workflow_is_seed_active"):
        op.create_index(
            "ix_workflow_is_seed_active",
            "workflow",
            ["is_seed"],
            postgresql_where=sa.text("archived_at IS NULL"),
        )
    op.alter_column("workflow", "owner_user_id", existing_type=sa.Uuid(), nullable=True)
    op.alter_column("workflow", "created_by_user_id", existing_type=sa.Uuid(), nullable=True)
    op.alter_column(
        "workflow_version", "created_by_user_id", existing_type=sa.Uuid(), nullable=True
    )


def downgrade() -> None:
    op.alter_column(
        "workflow_version", "created_by_user_id", existing_type=sa.Uuid(), nullable=False
    )
    op.alter_column("workflow", "created_by_user_id", existing_type=sa.Uuid(), nullable=False)
    op.alter_column("workflow", "owner_user_id", existing_type=sa.Uuid(), nullable=False)
    if _has_index("workflow", "ix_workflow_is_seed_active"):
        op.drop_index("ix_workflow_is_seed_active", table_name="workflow")
    if _has_index("workflow", "uq_workflow_seed_slug"):
        op.drop_constraint("uq_workflow_seed_slug", "workflow", type_="unique")
    if _has_column("workflow", "seed_slug"):
        op.drop_column("workflow", "seed_slug")
    if _has_column("workflow", "is_seed"):
        op.drop_column("workflow", "is_seed")
