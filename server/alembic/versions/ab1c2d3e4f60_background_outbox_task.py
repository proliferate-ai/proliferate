"""background outbox task

Revision ID: ab1c2d3e4f60
Revises: 9c0d1e2f3a4b
Create Date: 2026-06-05 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "ab1c2d3e4f60"
down_revision: str | Sequence[str] | None = "9c0d1e2f3a4b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {
        index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name)
    }


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
    postgresql_where: sa.TextClause | None = None,
) -> None:
    if _has_table(table_name) and not _has_index(table_name, index_name):
        op.create_index(
            index_name,
            table_name,
            columns,
            unique=unique,
            postgresql_where=postgresql_where,
        )


def upgrade() -> None:
    if not _has_table("background_outbox_task"):
        op.create_table(
            "background_outbox_task",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("task_name", sa.String(length=128), nullable=False),
            sa.Column("queue", sa.String(length=128), nullable=False),
            sa.Column(
                "args_json",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
            sa.Column(
                "kwargs_json",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'{}'::jsonb"),
            ),
            sa.Column("idempotency_key", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("publish_claim_id", sa.UUID(), nullable=True),
            sa.Column("locked_by", sa.String(length=128), nullable=True),
            sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("lock_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("published_task_id", sa.String(length=128), nullable=True),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error_code", sa.String(length=128), nullable=True),
            sa.Column("last_error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "status IN ('pending', 'publishing', 'published', 'failed')",
                name="ck_background_outbox_task_status",
            ),
            sa.PrimaryKeyConstraint("id"),
        )

    _create_index_once(
        "ix_background_outbox_task_due",
        "background_outbox_task",
        ["available_at", "created_at", "id"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    _create_index_once(
        "ix_background_outbox_task_expired_publish",
        "background_outbox_task",
        ["lock_expires_at"],
        postgresql_where=sa.text("status = 'publishing' AND lock_expires_at IS NOT NULL"),
    )
    _create_index_once(
        "ix_background_outbox_task_task_name",
        "background_outbox_task",
        ["task_name"],
    )
    _create_index_once(
        "ix_background_outbox_task_status",
        "background_outbox_task",
        ["status"],
    )
    _create_index_once(
        "ux_background_outbox_task_idempotency_key",
        "background_outbox_task",
        ["idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ux_background_outbox_task_idempotency_key",
        table_name="background_outbox_task",
    )
    op.drop_index("ix_background_outbox_task_status", table_name="background_outbox_task")
    op.drop_index("ix_background_outbox_task_task_name", table_name="background_outbox_task")
    op.drop_index(
        "ix_background_outbox_task_expired_publish",
        table_name="background_outbox_task",
    )
    op.drop_index("ix_background_outbox_task_due", table_name="background_outbox_task")
    op.drop_table("background_outbox_task")
