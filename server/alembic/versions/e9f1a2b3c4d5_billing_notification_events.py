"""Add billing notification events.

Revision ID: e9f1a2b3c4d5
Revises: e9f0a1b2c3d5
Create Date: 2026-05-24 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e9f1a2b3c4d5"
down_revision: str | Sequence[str] | None = "e9f0a1b2c3d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(table_name)


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    return any(
        index["name"] == index_name for index in sa.inspect(bind).get_indexes(table_name)
    )


def _create_index_if_missing(
    index_name: str,
    table_name: str,
    columns: list[str | sa.TextClause],
) -> None:
    if _has_table(table_name) and not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("billing_notification_event"):
        op.create_table(
            "billing_notification_event",
            sa.Column(
                "id",
                sa.UUID(),
                server_default=sa.text("gen_random_uuid()"),
                nullable=False,
            ),
            sa.Column("billing_subject_id", sa.UUID(), nullable=False),
            sa.Column("organization_id", sa.UUID(), nullable=True),
            sa.Column("user_id", sa.UUID(), nullable=True),
            sa.Column("kind", sa.String(length=64), nullable=False),
            sa.Column("severity", sa.String(length=32), nullable=False),
            sa.Column("source", sa.String(length=64), nullable=False),
            sa.Column("external_ref", sa.String(length=255), nullable=True),
            sa.Column("idempotency_key", sa.String(length=255), nullable=False),
            sa.Column(
                "payload_json",
                postgresql.JSONB(astext_type=sa.Text()),
                server_default=sa.text("'{}'::jsonb"),
                nullable=False,
            ),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.CheckConstraint(
                "kind IN ("
                "'invoice_paid', "
                "'invoice_payment_failed', "
                "'invoice_upcoming', "
                "'trial_ending', "
                "'subscription_updated', "
                "'subscription_deleted', "
                "'checkout_activated', "
                "'checkout_failed', "
                "'seat_adjustment_confirmed', "
                "'seat_adjustment_failed', "
                "'managed_llm_budget_exhausted', "
                "'managed_llm_budget_synced'"
                ")",
                name="ck_billing_notification_event_kind",
            ),
            sa.CheckConstraint(
                "severity IN ('info', 'warning', 'error')",
                name="ck_billing_notification_event_severity",
            ),
            sa.CheckConstraint(
                "source IN ('stripe', 'billing', 'seat_adjustment', 'agent_gateway', 'system')",
                name="ck_billing_notification_event_source",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "idempotency_key",
                name="uq_billing_notification_event_idempotency_key",
            ),
        )
    _create_index_if_missing(
        "ix_billing_notification_event_billing_subject_id",
        "billing_notification_event",
        ["billing_subject_id"],
    )
    _create_index_if_missing(
        "ix_billing_notification_event_organization_id",
        "billing_notification_event",
        ["organization_id"],
    )
    _create_index_if_missing(
        "ix_billing_notification_event_user_id",
        "billing_notification_event",
        ["user_id"],
    )
    _create_index_if_missing(
        "ix_billing_notification_event_subject_occurred_at",
        "billing_notification_event",
        ["billing_subject_id", sa.text("occurred_at DESC")],
    )
    _create_index_if_missing(
        "ix_billing_notification_event_org_occurred_at",
        "billing_notification_event",
        ["organization_id", sa.text("occurred_at DESC")],
    )
    _create_index_if_missing(
        "ix_billing_notification_event_source_external_ref",
        "billing_notification_event",
        ["source", "external_ref"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_table("billing_notification_event"):
        op.drop_table("billing_notification_event")
