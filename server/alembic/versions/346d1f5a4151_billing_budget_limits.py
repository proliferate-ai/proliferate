"""billing budget limits

Revision ID: 346d1f5a4151
Revises: bcc0459a6f11
Create Date: 2026-07-07 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "346d1f5a4151"
down_revision: str | Sequence[str] | None = "bcc0459a6f11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table("billing_budget_limit"):
        return
    op.create_table(
        "billing_budget_limit",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("window", sa.String(length=16), nullable=False),
        sa.Column("cap_value", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column(
            "enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('compute', 'llm')",
            name="ck_billing_budget_limit_kind",
        ),
        sa.CheckConstraint(
            "\"window\" IN ('day', 'month')",
            name="ck_billing_budget_limit_window",
        ),
        sa.CheckConstraint(
            "cap_value >= 0",
            name="ck_billing_budget_limit_cap_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organization.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "user_id",
            "kind",
            "window",
            name="uq_billing_budget_limit_scope",
        ),
    )
    op.create_index(
        op.f("ix_billing_budget_limit_organization_id"),
        "billing_budget_limit",
        ["organization_id"],
        unique=False,
    )


def downgrade() -> None:
    if not _has_table("billing_budget_limit"):
        return
    op.drop_index(
        op.f("ix_billing_budget_limit_organization_id"),
        table_name="billing_budget_limit",
    )
    op.drop_table("billing_budget_limit")
