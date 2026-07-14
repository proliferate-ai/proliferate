"""llm credit grants

Adds the LLM credit grant ledger in PR 8 of the agent-auth migration: grants are
the credit side, imported ``agent_llm_usage_event`` rows are the debit side, and
remaining credit = sum(grants) - sum(usage). Also adds ``budget_status`` to
``agent_gateway_enrollment`` so exhaustion can suspend a virtual key without
overloading ``sync_status``.

Revision ID: b8d1e2f3a4c5
Revises: a9c0d1e2f3b4
Create Date: 2026-07-01 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b8d1e2f3a4c5"
down_revision: str | Sequence[str] | None = "a9c0d1e2f3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    return any(column["name"] == column_name for column in _inspector().get_columns(table_name))


def upgrade() -> None:
    if not _has_table("llm_credit_grant"):
        op.create_table(
            "llm_credit_grant",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("billing_subject_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=True),
            sa.Column("source", sa.String(length=32), nullable=False),
            sa.Column("amount_usd", sa.Numeric(12, 4), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("source_ref", sa.String(length=255), nullable=True),
            sa.CheckConstraint(
                "source IN ('free_signup', 'topup', 'admin')",
                name="ck_llm_credit_grant_source",
            ),
            sa.CheckConstraint(
                "amount_usd >= 0",
                name="ck_llm_credit_grant_amount_non_negative",
            ),
            sa.ForeignKeyConstraint(
                ["billing_subject_id"],
                ["billing_subject.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("source_ref", name="uq_llm_credit_grant_source_ref"),
        )
        op.create_index(
            "ix_llm_credit_grant_billing_subject_id",
            "llm_credit_grant",
            ["billing_subject_id"],
        )
        op.create_index("ix_llm_credit_grant_user_id", "llm_credit_grant", ["user_id"])

    if not _has_column("agent_gateway_enrollment", "budget_status"):
        op.add_column(
            "agent_gateway_enrollment",
            sa.Column(
                "budget_status",
                sa.String(length=16),
                nullable=False,
                server_default=sa.text("'ok'"),
            ),
        )
        op.create_check_constraint(
            "ck_agent_gateway_enrollment_budget_status",
            "agent_gateway_enrollment",
            "budget_status IN ('ok', 'exhausted')",
        )


def downgrade() -> None:
    if _has_column("agent_gateway_enrollment", "budget_status"):
        op.drop_constraint(
            "ck_agent_gateway_enrollment_budget_status",
            "agent_gateway_enrollment",
            type_="check",
        )
        op.drop_column("agent_gateway_enrollment", "budget_status")
    if _has_table("llm_credit_grant"):
        op.drop_table("llm_credit_grant")
