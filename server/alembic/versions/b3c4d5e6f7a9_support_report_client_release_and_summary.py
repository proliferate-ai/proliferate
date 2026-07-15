"""support_report client_release_id and tracker_summary

Adds the immutable client release identifier and the server-produced scrubbed
tracker summary to ``support_report``. Both are forward-only, nullable, and
back-compatible: legacy rows keep NULL values and remain feedable with a
visible warning through the private completed-report feed.

Revision ID: b3c4d5e6f7a9
Revises: a2b3c4d5e6f8
Create Date: 2026-07-13 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b3c4d5e6f7a9"
down_revision: str | Sequence[str] | None = "a2b3c4d5e6f8"
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
    if not _has_table("support_report"):
        return
    if not _has_column("support_report", "client_release_id"):
        op.add_column(
            "support_report",
            sa.Column("client_release_id", sa.String(length=255), nullable=True),
        )
    if not _has_column("support_report", "tracker_summary"):
        op.add_column(
            "support_report",
            sa.Column("tracker_summary", sa.String(length=240), nullable=True),
        )


def downgrade() -> None:
    if not _has_table("support_report"):
        return
    if _has_column("support_report", "tracker_summary"):
        op.drop_column("support_report", "tracker_summary")
    if _has_column("support_report", "client_release_id"):
        op.drop_column("support_report", "client_release_id")
