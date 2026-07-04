"""Add organization sandbox profile support to cloud_sandbox.

Adds owner_scope and organization_id columns so cloud sandboxes can be owned
by organizations (shared team sandboxes) in addition to personal users.

Revision ID: bb68e6f07040
Revises: ff9344886948
Create Date: 2026-07-04 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "bb68e6f07040"
down_revision: str | Sequence[str] | None = "ff9344886948"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.engine.reflection.Inspector:
    return sa.inspect(op.get_bind())


def _has_column(table_name: str, column_name: str) -> bool:
    if table_name not in _inspector().get_table_names():
        return False
    return column_name in {column["name"] for column in _inspector().get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    if table_name not in _inspector().get_table_names():
        return False
    return index_name in {index["name"] for index in _inspector().get_indexes(table_name)}


def upgrade() -> None:
    if not _has_column("cloud_sandbox", "owner_scope"):
        op.add_column(
            "cloud_sandbox",
            sa.Column("owner_scope", sa.String(length=32), nullable=True),
        )
    if not _has_column("cloud_sandbox", "organization_id"):
        op.add_column(
            "cloud_sandbox",
            sa.Column("organization_id", sa.Uuid(), nullable=True),
        )
    if not _has_column("cloud_sandbox", "created_by_user_id"):
        op.add_column(
            "cloud_sandbox",
            sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        )
    if not _has_column("cloud_sandbox", "billing_subject_id"):
        op.add_column(
            "cloud_sandbox",
            sa.Column("billing_subject_id", sa.Uuid(), nullable=True),
        )
    if not _has_column("cloud_sandbox", "display_name"):
        op.add_column(
            "cloud_sandbox",
            sa.Column("display_name", sa.Text(), nullable=True),
        )

    # Backfill existing rows as personal scope
    op.execute(
        "UPDATE cloud_sandbox SET owner_scope = 'personal' WHERE owner_scope IS NULL"
    )
    op.alter_column("cloud_sandbox", "owner_scope", nullable=False)

    # Make owner_user_id nullable for org-owned sandboxes
    op.alter_column("cloud_sandbox", "owner_user_id", nullable=True)

    # Add FK for organization_id
    op.create_foreign_key(
        "cloud_sandbox_organization_id_fkey",
        "cloud_sandbox",
        "organization",
        ["organization_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "cloud_sandbox_created_by_user_id_fkey",
        "cloud_sandbox",
        "user",
        ["created_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "cloud_sandbox_billing_subject_id_fkey",
        "cloud_sandbox",
        "billing_subject",
        ["billing_subject_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    # Check constraint: owner_scope field coherence
    op.create_check_constraint(
        "ck_cloud_sandbox_owner_scope",
        "cloud_sandbox",
        "owner_scope IN ('personal', 'organization')",
    )
    op.create_check_constraint(
        "ck_cloud_sandbox_owner_fields",
        "cloud_sandbox",
        "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
        "AND organization_id IS NULL) OR "
        "(owner_scope = 'organization' AND organization_id IS NOT NULL))",
    )

    # Unique index: one active org sandbox per (organization, display_name)
    if not _has_index("cloud_sandbox", "ux_cloud_sandbox_org_active"):
        op.create_index(
            "ux_cloud_sandbox_org_active",
            "cloud_sandbox",
            ["organization_id", "display_name"],
            unique=True,
            postgresql_where=sa.text(
                "owner_scope = 'organization' AND destroyed_at IS NULL"
            ),
        )
    op.create_index(
        "ix_cloud_sandbox_organization_id",
        "cloud_sandbox",
        ["organization_id"],
        postgresql_where=sa.text("organization_id IS NOT NULL"),
    )


def downgrade() -> None:
    raise RuntimeError(
        "Downgrade for org sandbox profiles is unsupported; restore from backup."
    )
