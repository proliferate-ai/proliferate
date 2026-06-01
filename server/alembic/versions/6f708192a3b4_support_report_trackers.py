"""support report tracker lifecycle

Revision ID: 6f708192a3b4
Revises: 5e6f708192a3
Create Date: 2026-06-01 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "6f708192a3b4"
down_revision: str | Sequence[str] | None = "5e6f708192a3"
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


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {
        index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name)
    }


def _has_constraint(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    names = {constraint["name"] for constraint in inspector.get_check_constraints(table_name)}
    names.update(
        constraint["name"]
        for constraint in inspector.get_unique_constraints(table_name)
        if constraint.get("name")
    )
    return constraint_name in names


def upgrade() -> None:
    if not _has_table("support_report"):
        return

    _add_column_once(
        "expected_uploads_json",
        sa.Column("expected_uploads_json", sa.Text(), nullable=False, server_default="{}"),
    )
    _add_column_once(
        "public_content_consent",
        sa.Column(
            "public_content_consent",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    _add_column_once(
        "tracker_status",
        sa.Column("tracker_status", sa.String(length=32), nullable=False, server_default="none"),
    )
    _add_column_once(
        "tracker_attempt_count",
        sa.Column("tracker_attempt_count", sa.Integer(), nullable=False, server_default="0"),
    )
    _add_column_once(
        "tracker_next_attempt_at",
        sa.Column("tracker_next_attempt_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column_once(
        "tracker_locked_until",
        sa.Column("tracker_locked_until", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column_once(
        "tracker_synced_at",
        sa.Column("tracker_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column_once(
        "tracker_slack_notified_at",
        sa.Column("tracker_slack_notified_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column_once(
        "tracker_last_error_code",
        sa.Column("tracker_last_error_code", sa.String(length=128), nullable=True),
    )
    _add_column_once(
        "tracker_last_error_message",
        sa.Column("tracker_last_error_message", sa.Text(), nullable=True),
    )
    _add_column_once(
        "github_status",
        sa.Column("github_status", sa.String(length=32), nullable=False, server_default="none"),
    )
    _add_column_once(
        "github_issue_id",
        sa.Column("github_issue_id", sa.String(length=128), nullable=True),
    )
    _add_column_once(
        "github_issue_number",
        sa.Column("github_issue_number", sa.Integer(), nullable=True),
    )
    _add_column_once(
        "github_issue_url",
        sa.Column("github_issue_url", sa.Text(), nullable=True),
    )
    _add_column_once(
        "github_synced_at",
        sa.Column("github_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column_once(
        "github_create_attempted_at",
        sa.Column("github_create_attempted_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column_once(
        "linear_status",
        sa.Column("linear_status", sa.String(length=32), nullable=False, server_default="none"),
    )
    _add_column_once(
        "linear_issue_id",
        sa.Column("linear_issue_id", sa.String(length=128), nullable=True),
    )
    _add_column_once(
        "linear_issue_identifier",
        sa.Column("linear_issue_identifier", sa.String(length=128), nullable=True),
    )
    _add_column_once(
        "linear_issue_url",
        sa.Column("linear_issue_url", sa.Text(), nullable=True),
    )
    _add_column_once(
        "linear_synced_at",
        sa.Column("linear_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column_once(
        "linear_create_attempted_at",
        sa.Column("linear_create_attempted_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column_once(
        "crosslink_status",
        sa.Column(
            "crosslink_status",
            sa.String(length=32),
            nullable=False,
            server_default="none",
        ),
    )
    _add_column_once(
        "crosslink_synced_at",
        sa.Column("crosslink_synced_at", sa.DateTime(timezone=True), nullable=True),
    )

    _create_check_once(
        "ck_support_report_tracker_status",
        "tracker_status IN "
        "('none','pending','in_progress','partial','completed','failed_retryable',"
        "'failed_permanent','disabled')",
    )
    _create_check_once(
        "ck_support_report_github_status",
        "github_status IN "
        "('none','pending','completed','failed_retryable','failed_permanent','disabled')",
    )
    _create_check_once(
        "ck_support_report_linear_status",
        "linear_status IN "
        "('none','pending','completed','failed_retryable','failed_permanent','disabled')",
    )
    _create_check_once(
        "ck_support_report_crosslink_status",
        "crosslink_status IN "
        "('none','pending','completed','failed_retryable','failed_permanent','disabled')",
    )
    _create_index_once(
        "ix_support_report_tracker_due",
        "support_report",
        ["tracker_status", "tracker_next_attempt_at"],
    )
    _create_index_once(
        "ix_support_report_github_issue_id",
        "support_report",
        ["github_issue_id"],
        unique=True,
    )
    _create_index_once(
        "ix_support_report_linear_issue_id",
        "support_report",
        ["linear_issue_id"],
        unique=True,
    )


def downgrade() -> None:
    if not _has_table("support_report"):
        return

    _drop_index_once("ix_support_report_linear_issue_id", "support_report")
    _drop_index_once("ix_support_report_github_issue_id", "support_report")
    _drop_index_once("ix_support_report_tracker_due", "support_report")
    _drop_constraint_once("ck_support_report_crosslink_status", "support_report")
    _drop_constraint_once("ck_support_report_linear_status", "support_report")
    _drop_constraint_once("ck_support_report_github_status", "support_report")
    _drop_constraint_once("ck_support_report_tracker_status", "support_report")

    for column_name in (
        "crosslink_synced_at",
        "crosslink_status",
        "linear_create_attempted_at",
        "linear_synced_at",
        "linear_issue_url",
        "linear_issue_identifier",
        "linear_issue_id",
        "linear_status",
        "github_create_attempted_at",
        "github_synced_at",
        "github_issue_url",
        "github_issue_number",
        "github_issue_id",
        "github_status",
        "tracker_last_error_message",
        "tracker_last_error_code",
        "tracker_slack_notified_at",
        "tracker_synced_at",
        "tracker_locked_until",
        "tracker_next_attempt_at",
        "tracker_attempt_count",
        "tracker_status",
        "public_content_consent",
        "expected_uploads_json",
    ):
        _drop_column_once(column_name)


def _add_column_once(column_name: str, column: sa.Column[object]) -> None:
    if not _has_column("support_report", column_name):
        op.add_column("support_report", column)


def _drop_column_once(column_name: str) -> None:
    if _has_column("support_report", column_name):
        op.drop_column("support_report", column_name)


def _create_check_once(constraint_name: str, condition: str) -> None:
    if not _has_constraint("support_report", constraint_name):
        op.create_check_constraint(constraint_name, "support_report", condition)


def _drop_constraint_once(constraint_name: str, table_name: str) -> None:
    if _has_constraint(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name=table_name, type_="check")


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=unique)


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)
