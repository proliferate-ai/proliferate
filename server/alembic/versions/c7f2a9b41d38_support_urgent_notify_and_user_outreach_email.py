"""support urgent/notify_me flags and user outreach_email

Revision ID: c7f2a9b41d38
Revises: ff9344886948
Create Date: 2026-07-05 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c7f2a9b41d38"
down_revision: str | Sequence[str] | None = "ff9344886948"
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
        if not _has_column("support_report", "urgent"):
            op.add_column(
                "support_report",
                sa.Column(
                    "urgent",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                ),
            )
        if not _has_column("support_report", "notify_me"):
            op.add_column(
                "support_report",
                sa.Column(
                    "notify_me",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                ),
            )

    if _has_table("user") and not _has_column("user", "outreach_email"):
        op.add_column(
            "user",
            sa.Column(
                "outreach_email",
                sa.String(length=320),
                nullable=True,
            ),
        )


def downgrade() -> None:
    if _has_column("user", "outreach_email"):
        op.drop_column("user", "outreach_email")

    if _has_table("support_report"):
        if _has_column("support_report", "notify_me"):
            op.drop_column("support_report", "notify_me")
        if _has_column("support_report", "urgent"):
            op.drop_column("support_report", "urgent")
