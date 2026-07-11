"""workflow poll trigger columns + workflow_trigger_item table

Revision ID: f1c3d5b7a9e2
Revises: c3a5e7f9d1b2
Create Date: 2026-07-07 01:00:00.000000

Adds the poll-trigger primitive (PR B; spec 4.2/4.3). ``workflow_trigger`` gains
poll-only columns (endpoint, encrypted auth header value, interval, item schema
derived from the workflow inputs, opaque cursor, last-poll bookkeeping); its
``kind`` CHECK widens to
('schedule', 'poll') and a completeness CHECK ties the poll columns to the kind.
A partial index powers the poller's due scan. A new ``workflow_trigger_item``
table is the per-trigger seen-set: the composite PK (trigger_id, item_id) makes a
spawn at-most-once per item id. Finally ``workflow_run.trigger_kind`` widens to
include 'poll' (poll-fired runs carry trigger_kind='poll').
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1c3d5b7a9e2"
down_revision: str | Sequence[str] | None = "c3a5e7f9d1b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_check(table_name: str, constraint_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return constraint_name in {
        constraint["name"] for constraint in inspector.get_check_constraints(table_name)
    }


def _replace_check(table_name: str, constraint_name: str, condition: str) -> None:
    if _has_check(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_="check")
    op.create_check_constraint(constraint_name, table_name, condition)


_POLL_COLUMNS = (
    ("poll_url", sa.Text()),
    ("poll_auth_header", sa.String(length=255)),
    ("poll_auth_ciphertext", sa.Text()),
    ("poll_interval_secs", sa.Integer()),
    ("poll_item_schema_json", JSONB()),
    ("poll_cursor", sa.Text()),
    ("last_poll_at", sa.DateTime(timezone=True)),
    ("last_poll_error", sa.Text()),
)


def upgrade() -> None:
    # workflow_trigger poll columns (all nullable — tied to kind by the CHECK).
    for name, column_type in _POLL_COLUMNS:
        if not _has_column("workflow_trigger", name):
            op.add_column("workflow_trigger", sa.Column(name, column_type, nullable=True))

    # Widen the kind vocabulary and add the poll-fields completeness CHECK.
    _replace_check("workflow_trigger", "ck_workflow_trigger_kind", "kind IN ('schedule', 'poll')")
    if not _has_check("workflow_trigger", "ck_workflow_trigger_poll_fields"):
        op.create_check_constraint(
            "ck_workflow_trigger_poll_fields",
            "workflow_trigger",
            "kind <> 'poll' OR (poll_url IS NOT NULL AND poll_interval_secs IS NOT NULL)",
        )

    if not _has_index("workflow_trigger", "ix_workflow_trigger_poller_due"):
        op.create_index(
            "ix_workflow_trigger_poller_due",
            "workflow_trigger",
            ["last_poll_at"],
            postgresql_where=sa.text("enabled = true AND kind = 'poll'"),
        )

    # The per-trigger seen-set: PK (trigger_id, item_id) is the dedup guarantee.
    if not _has_table("workflow_trigger_item"):
        op.create_table(
            "workflow_trigger_item",
            sa.Column("trigger_id", sa.Uuid(), nullable=False),
            sa.Column("item_id", sa.String(length=255), nullable=False),
            sa.Column("run_id", sa.Uuid(), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "status IN ('spawned', 'invalid', 'error')",
                name="ck_workflow_trigger_item_status",
            ),
            sa.ForeignKeyConstraint(
                ["trigger_id"], ["workflow_trigger.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["run_id"], ["workflow_run.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("trigger_id", "item_id"),
        )

    # Poll-fired runs carry trigger_kind='poll'.
    _replace_check(
        "workflow_run",
        "ck_workflow_run_trigger_kind",
        "trigger_kind IN ('manual', 'schedule', 'poll', 'chat', 'agent', 'api')",
    )


def downgrade() -> None:
    _replace_check(
        "workflow_run",
        "ck_workflow_run_trigger_kind",
        "trigger_kind IN ('manual', 'schedule', 'chat', 'agent', 'api')",
    )

    if _has_table("workflow_trigger_item"):
        op.drop_table("workflow_trigger_item")

    if _has_index("workflow_trigger", "ix_workflow_trigger_poller_due"):
        op.drop_index("ix_workflow_trigger_poller_due", table_name="workflow_trigger")

    if _has_check("workflow_trigger", "ck_workflow_trigger_poll_fields"):
        op.drop_constraint("ck_workflow_trigger_poll_fields", "workflow_trigger", type_="check")
    _replace_check("workflow_trigger", "ck_workflow_trigger_kind", "kind IN ('schedule')")

    for name, _column_type in _POLL_COLUMNS:
        if _has_column("workflow_trigger", name):
            op.drop_column("workflow_trigger", name)
