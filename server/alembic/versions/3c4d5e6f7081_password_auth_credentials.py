"""password auth credentials

Revision ID: 3c4d5e6f7081
Revises: 2b3c4d5e6f70
Create Date: 2026-05-30 17:30:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "3c4d5e6f7081"
down_revision: str | Sequence[str] | None = "2b3c4d5e6f70"
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


def _has_unique_constraint(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return constraint_name in {
        constraint["name"]
        for constraint in sa.inspect(op.get_bind()).get_unique_constraints(table_name)
    }


def upgrade() -> None:
    if not _has_column("user", "password_set_at"):
        op.add_column(
            "user",
            sa.Column("password_set_at", sa.DateTime(timezone=True), nullable=True),
        )

    if not _has_table("password_login_attempt"):
        op.create_table(
            "password_login_attempt",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("bucket_kind", sa.String(length=32), nullable=False),
            sa.Column("bucket_key", sa.String(length=128), nullable=False),
            sa.Column("failure_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("blocked_until", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "bucket_kind",
                "bucket_key",
                name="uq_password_login_attempt_bucket",
            ),
        )
    if not _has_index(
        "password_login_attempt",
        "ix_password_login_attempt_blocked_until",
    ):
        op.create_index(
            "ix_password_login_attempt_blocked_until",
            "password_login_attempt",
            ["blocked_until"],
        )


def downgrade() -> None:
    if _has_index("password_login_attempt", "ix_password_login_attempt_blocked_until"):
        op.drop_index(
            "ix_password_login_attempt_blocked_until",
            table_name="password_login_attempt",
        )
    if _has_unique_constraint(
        "password_login_attempt",
        "uq_password_login_attempt_bucket",
    ):
        op.drop_constraint(
            "uq_password_login_attempt_bucket",
            "password_login_attempt",
            type_="unique",
        )
    if _has_table("password_login_attempt"):
        op.drop_table("password_login_attempt")
    if _has_column("user", "password_set_at"):
        op.drop_column("user", "password_set_at")
