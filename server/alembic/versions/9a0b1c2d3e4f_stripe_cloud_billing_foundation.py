"""stripe cloud billing foundation

Revision ID: 9a0b1c2d3e4f
Revises: f5a6b7c8d9e0
Create Date: 2026-04-19 01:00:00.000000

"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9a0b1c2d3e4f"
down_revision: str | Sequence[str] | None = "f5a6b7c8d9e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=unique)


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_column("billing_subject", "stripe_customer_id"):
        op.add_column(
            "billing_subject",
            sa.Column("stripe_customer_id", sa.String(length=255), nullable=True),
        )
    if not _has_column("billing_subject", "overage_enabled"):
        op.add_column(
            "billing_subject",
            sa.Column(
                "overage_enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )
    _create_index_once(
        "ix_billing_subject_stripe_customer_id",
        "billing_subject",
        ["stripe_customer_id"],
        unique=True,
    )

    if not _has_column("billing_grant", "remaining_seconds"):
        op.add_column(
            "billing_grant",
            sa.Column(
                "remaining_seconds",
                sa.Float(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )
        op.execute(
            sa.text(
                """
                UPDATE billing_grant
                SET remaining_seconds = GREATEST(hours_granted * 3600.0, 0.0)
                """
            )
        )

    if not _has_table("billing_subscription"):
        op.create_table(
            "billing_subscription",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("billing_subject_id", sa.Uuid(), nullable=False),
            sa.Column("stripe_subscription_id", sa.String(length=255), nullable=False),
            sa.Column("stripe_customer_id", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=64), nullable=False),
            sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False),
            sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
            sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cloud_monthly_price_id", sa.String(length=255), nullable=True),
            sa.Column("overage_price_id", sa.String(length=255), nullable=True),
            sa.Column("monthly_subscription_item_id", sa.String(length=255), nullable=True),
            sa.Column("metered_subscription_item_id", sa.String(length=255), nullable=True),
            sa.Column("latest_invoice_id", sa.String(length=255), nullable=True),
            sa.Column("latest_invoice_status", sa.String(length=64), nullable=True),
            sa.Column("hosted_invoice_url", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("stripe_subscription_id"),
        )
    _create_index_once(
        "ix_billing_subscription_billing_subject_id",
        "billing_subscription",
        ["billing_subject_id"],
    )
    _create_index_once(
        "ix_billing_subscription_stripe_customer_id",
        "billing_subscription",
        ["stripe_customer_id"],
    )
    _create_index_once("ix_billing_subscription_status", "billing_subscription", ["status"])

    if not _has_table("billing_grant_consumption"):
        op.create_table(
            "billing_grant_consumption",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("billing_subject_id", sa.Uuid(), nullable=False),
            sa.Column("billing_grant_id", sa.Uuid(), nullable=False),
            sa.Column("usage_segment_id", sa.Uuid(), nullable=False),
            sa.Column("accounted_from", sa.DateTime(timezone=True), nullable=False),
            sa.Column("accounted_until", sa.DateTime(timezone=True), nullable=False),
            sa.Column("seconds", sa.Float(), nullable=False),
            sa.Column("source", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once(
        "ix_billing_grant_consumption_billing_subject_id",
        "billing_grant_consumption",
        ["billing_subject_id"],
    )
    _create_index_once(
        "ix_billing_grant_consumption_billing_grant_id",
        "billing_grant_consumption",
        ["billing_grant_id"],
    )
    _create_index_once(
        "ix_billing_grant_consumption_usage_segment_id",
        "billing_grant_consumption",
        ["usage_segment_id"],
    )

    if not _has_table("billing_usage_cursor"):
        op.create_table(
            "billing_usage_cursor",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("billing_subject_id", sa.Uuid(), nullable=False),
            sa.Column("usage_segment_id", sa.Uuid(), nullable=False),
            sa.Column("accounted_until", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("usage_segment_id"),
        )
    _create_index_once(
        "ix_billing_usage_cursor_billing_subject_id",
        "billing_usage_cursor",
        ["billing_subject_id"],
    )
    _create_index_once(
        "ix_billing_usage_cursor_usage_segment_id",
        "billing_usage_cursor",
        ["usage_segment_id"],
    )
    if _has_table("usage_segment"):
        bind = op.get_bind()
        existing_cursor_segment_ids = {
            row[0]
            for row in bind.execute(sa.text("SELECT usage_segment_id FROM billing_usage_cursor"))
        }
        cursor_rows = [
            {
                "id": uuid.uuid4(),
                "billing_subject_id": row.billing_subject_id,
                "usage_segment_id": row.id,
                "accounted_until": row.accounted_until,
                "created_at": row.cutover_at,
                "updated_at": row.cutover_at,
            }
            for row in bind.execute(
                sa.text(
                    """
                    SELECT
                        id,
                        billing_subject_id,
                        COALESCE(ended_at, now()) AS accounted_until,
                        now() AS cutover_at
                    FROM usage_segment
                    WHERE is_billable IS TRUE
                    """
                )
            )
            if row.id not in existing_cursor_segment_ids
        ]
        if cursor_rows:
            op.bulk_insert(
                sa.table(
                    "billing_usage_cursor",
                    sa.column("id", sa.Uuid()),
                    sa.column("billing_subject_id", sa.Uuid()),
                    sa.column("usage_segment_id", sa.Uuid()),
                    sa.column("accounted_until", sa.DateTime(timezone=True)),
                    sa.column("created_at", sa.DateTime(timezone=True)),
                    sa.column("updated_at", sa.DateTime(timezone=True)),
                ),
                cursor_rows,
            )

    if not _has_table("billing_usage_export"):
        op.create_table(
            "billing_usage_export",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("billing_subject_id", sa.Uuid(), nullable=False),
            sa.Column("billing_subscription_id", sa.Uuid(), nullable=True),
            sa.Column("usage_segment_id", sa.Uuid(), nullable=False),
            sa.Column("period_start", sa.DateTime(timezone=True), nullable=True),
            sa.Column("period_end", sa.DateTime(timezone=True), nullable=True),
            sa.Column("accounted_from", sa.DateTime(timezone=True), nullable=False),
            sa.Column("accounted_until", sa.DateTime(timezone=True), nullable=False),
            sa.Column("quantity_seconds", sa.Float(), nullable=False),
            sa.Column("idempotency_key", sa.String(length=255), nullable=False),
            sa.Column("stripe_meter_event_identifier", sa.String(length=255), nullable=True),
            sa.Column("status", sa.String(length=64), nullable=False),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("idempotency_key"),
        )
    _create_index_once(
        "ix_billing_usage_export_billing_subject_id",
        "billing_usage_export",
        ["billing_subject_id"],
    )
    _create_index_once(
        "ix_billing_usage_export_billing_subscription_id",
        "billing_usage_export",
        ["billing_subscription_id"],
    )
    _create_index_once(
        "ix_billing_usage_export_usage_segment_id",
        "billing_usage_export",
        ["usage_segment_id"],
    )
    _create_index_once("ix_billing_usage_export_status", "billing_usage_export", ["status"])

    if _has_table("sandbox_event_receipt") and not _has_table("webhook_event_receipt"):
        op.rename_table("sandbox_event_receipt", "webhook_event_receipt")
    if _has_table("webhook_event_receipt"):
        bind = op.get_bind()
        bind.execute(
            sa.text(
                """
                ALTER TABLE webhook_event_receipt
                DROP CONSTRAINT IF EXISTS sandbox_event_receipt_event_id_key
                """
            )
        )
        bind.execute(
            sa.text(
                """
                ALTER TABLE webhook_event_receipt
                DROP CONSTRAINT IF EXISTS webhook_event_receipt_event_id_key
                """
            )
        )
        if not _has_column("webhook_event_receipt", "status"):
            op.add_column(
                "webhook_event_receipt",
                sa.Column(
                    "status",
                    sa.String(length=32),
                    nullable=False,
                    server_default="processed",
                ),
            )
        if not _has_column("webhook_event_receipt", "attempt_count"):
            op.add_column(
                "webhook_event_receipt",
                sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="1"),
            )
        if not _has_column("webhook_event_receipt", "processing_lease_expires_at"):
            op.add_column(
                "webhook_event_receipt",
                sa.Column(
                    "processing_lease_expires_at",
                    sa.DateTime(timezone=True),
                    nullable=True,
                ),
            )
        if not _has_column("webhook_event_receipt", "last_error"):
            op.add_column(
                "webhook_event_receipt",
                sa.Column("last_error", sa.Text(), nullable=True),
            )
        if not _has_column("webhook_event_receipt", "processed_at"):
            op.add_column(
                "webhook_event_receipt",
                sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
            )
        if not _has_column("webhook_event_receipt", "updated_at"):
            op.add_column(
                "webhook_event_receipt",
                sa.Column(
                    "updated_at",
                    sa.DateTime(timezone=True),
                    nullable=False,
                    server_default=sa.text("now()"),
                ),
            )
        _create_index_once(
            "ix_webhook_event_receipt_status",
            "webhook_event_receipt",
            ["status"],
        )
        _create_index_once(
            "uq_webhook_event_receipt_provider_event_id",
            "webhook_event_receipt",
            ["provider", "event_id"],
            unique=True,
        )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_table("webhook_event_receipt"):
        if _has_index("webhook_event_receipt", "uq_webhook_event_receipt_provider_event_id"):
            op.drop_index(
                "uq_webhook_event_receipt_provider_event_id",
                table_name="webhook_event_receipt",
            )
        if _has_index("webhook_event_receipt", "ix_webhook_event_receipt_status"):
            op.drop_index("ix_webhook_event_receipt_status", table_name="webhook_event_receipt")
        for column_name in (
            "updated_at",
            "processed_at",
            "last_error",
            "processing_lease_expires_at",
            "attempt_count",
            "status",
        ):
            if _has_column("webhook_event_receipt", column_name):
                op.drop_column("webhook_event_receipt", column_name)
        if not _has_table("sandbox_event_receipt"):
            op.rename_table("webhook_event_receipt", "sandbox_event_receipt")
            op.create_unique_constraint(
                "sandbox_event_receipt_event_id_key",
                "sandbox_event_receipt",
                ["event_id"],
            )

    op.drop_index("ix_billing_usage_export_status", table_name="billing_usage_export")
    op.drop_index("ix_billing_usage_export_usage_segment_id", table_name="billing_usage_export")
    op.drop_index(
        "ix_billing_usage_export_billing_subscription_id",
        table_name="billing_usage_export",
    )
    op.drop_index(
        "ix_billing_usage_export_billing_subject_id",
        table_name="billing_usage_export",
    )
    op.drop_table("billing_usage_export")

    op.drop_index("ix_billing_usage_cursor_usage_segment_id", table_name="billing_usage_cursor")
    op.drop_index(
        "ix_billing_usage_cursor_billing_subject_id",
        table_name="billing_usage_cursor",
    )
    op.drop_table("billing_usage_cursor")

    op.drop_index(
        "ix_billing_grant_consumption_usage_segment_id",
        table_name="billing_grant_consumption",
    )
    op.drop_index(
        "ix_billing_grant_consumption_billing_grant_id",
        table_name="billing_grant_consumption",
    )
    op.drop_index(
        "ix_billing_grant_consumption_billing_subject_id",
        table_name="billing_grant_consumption",
    )
    op.drop_table("billing_grant_consumption")

    op.drop_index("ix_billing_subscription_status", table_name="billing_subscription")
    op.drop_index(
        "ix_billing_subscription_stripe_customer_id",
        table_name="billing_subscription",
    )
    op.drop_index(
        "ix_billing_subscription_billing_subject_id",
        table_name="billing_subscription",
    )
    op.drop_table("billing_subscription")

    if _has_column("billing_grant", "remaining_seconds"):
        op.drop_column("billing_grant", "remaining_seconds")

    op.drop_index("ix_billing_subject_stripe_customer_id", table_name="billing_subject")
    if _has_column("billing_subject", "overage_enabled"):
        op.drop_column("billing_subject", "overage_enabled")
    if _has_column("billing_subject", "stripe_customer_id"):
        op.drop_column("billing_subject", "stripe_customer_id")
