"""support_report client_release_provided

Adds a capture-time flag recording whether the client PROVIDED a release value
with the report intent (regardless of whether it validated to a canonical
release). This lets SUPPORT_REPORT_REQUIRE_CLIENT_RELEASE enforce the contract
distinction: reject a NEW report whose client sent a malformed value, while a
legacy client that never sent the field completes normally and stays feedable
with a warning. Forward-only and back-compatible: existing rows default to
false (legacy-absent).

Revision ID: c4d5e6f7a8b0
Revises: b3c4d5e6f7a9
Create Date: 2026-07-13 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c4d5e6f7a8b0"
down_revision: str | Sequence[str] | None = "b3c4d5e6f7a9"
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
    if not _has_column("support_report", "client_release_provided"):
        op.add_column(
            "support_report",
            sa.Column(
                "client_release_provided",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )


def downgrade() -> None:
    if not _has_table("support_report"):
        return
    if _has_column("support_report", "client_release_provided"):
        op.drop_column("support_report", "client_release_provided")
