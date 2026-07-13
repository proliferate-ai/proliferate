"""add_kind_and_credit_consent_to_support_report

Revision ID: ff9344886948
Revises: ab12cd34ef56
Create Date: 2026-07-03 20:44:56.289129

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "ff9344886948"
down_revision: str | Sequence[str] | None = "ab12cd34ef56"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)
    }


def upgrade() -> None:
    if _has_table("support_report"):
        if not _has_column("support_report", "kind"):
            op.add_column(
                "support_report",
                sa.Column(
                    "kind",
                    sa.String(length=32),
                    nullable=False,
                    server_default="bug",
                ),
            )
            op.create_check_constraint(
                "ck_support_report_kind",
                "support_report",
                "kind IN ('bug','feature')",
            )

        if not _has_column("support_report", "credit_consent"):
            op.add_column(
                "support_report",
                sa.Column(
                    "credit_consent",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                ),
            )

        if not _has_column("support_report", "credit_name"):
            op.add_column(
                "support_report",
                sa.Column(
                    "credit_name",
                    sa.String(length=200),
                    nullable=True,
                ),
            )


def downgrade() -> None:
    if _has_table("support_report"):
        if _has_column("support_report", "credit_name"):
            op.drop_column("support_report", "credit_name")
        if _has_column("support_report", "credit_consent"):
            op.drop_column("support_report", "credit_consent")
        if _has_column("support_report", "kind"):
            op.drop_constraint("ck_support_report_kind", "support_report", type_="check")
            op.drop_column("support_report", "kind")
