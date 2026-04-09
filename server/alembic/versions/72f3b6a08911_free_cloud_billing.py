"""free cloud billing

Revision ID: 72f3b6a08911
Revises: 995b21c04264
Create Date: 2026-04-03 13:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "72f3b6a08911"
down_revision: str | Sequence[str] | None = "995b21c04264"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        "cloud_sandbox",
        "external_sandbox_id",
        existing_type=sa.String(length=255),
        nullable=True,
    )
    op.add_column(
        "cloud_sandbox",
        sa.Column("last_provider_event_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "cloud_sandbox",
        sa.Column("last_provider_event_kind", sa.String(length=64), nullable=True),
    )

    op.create_table(
        "billing_entitlement",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("effective_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_billing_entitlement_user_id",
        "billing_entitlement",
        ["user_id"],
        unique=False,
    )

    op.create_table(
        "usage_segment",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("sandbox_id", sa.Uuid(), nullable=False),
        sa.Column("external_sandbox_id", sa.String(length=255), nullable=True),
        sa.Column("sandbox_execution_id", sa.String(length=255), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_billable", sa.Boolean(), nullable=False),
        sa.Column("opened_by", sa.String(length=64), nullable=False),
        sa.Column("closed_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_usage_segment_user_id", "usage_segment", ["user_id"], unique=False)
    op.create_index(
        "ix_usage_segment_workspace_id",
        "usage_segment",
        ["workspace_id"],
        unique=False,
    )
    op.create_index("ix_usage_segment_sandbox_id", "usage_segment", ["sandbox_id"], unique=False)
    op.create_index(
        "ix_usage_segment_external_sandbox_id",
        "usage_segment",
        ["external_sandbox_id"],
        unique=False,
    )
    op.create_index(
        "ix_usage_segment_open_sandbox_id",
        "usage_segment",
        ["sandbox_id"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )

    op.create_table(
        "sandbox_event_receipt",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.String(length=255), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("external_sandbox_id", sa.String(length=255), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id"),
    )

    op.execute(
        sa.text("UPDATE billing_grant SET grant_type = 'free_included' WHERE grant_type = 'trial'")
    )

    op.drop_index("ix_usage_ledger_workspace_id", table_name="usage_ledger")
    op.drop_index("ix_usage_ledger_user_id", table_name="usage_ledger")
    op.drop_table("usage_ledger")

    op.drop_index("ix_billing_subscription_user_id", table_name="billing_subscription")
    op.drop_table("billing_subscription")

    op.drop_index("ix_billing_account_user_id", table_name="billing_account")
    op.drop_table("billing_account")


def downgrade() -> None:
    """Downgrade schema."""
    op.create_table(
        "billing_account",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("stripe_customer_id", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stripe_customer_id"),
    )
    op.create_index("ix_billing_account_user_id", "billing_account", ["user_id"], unique=True)

    op.create_table(
        "billing_subscription",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("stripe_subscription_id", sa.String(length=255), nullable=False),
        sa.Column("stripe_price_id", sa.String(length=255), nullable=True),
        sa.Column("plan_code", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stripe_subscription_id"),
    )
    op.create_index(
        "ix_billing_subscription_user_id",
        "billing_subscription",
        ["user_id"],
        unique=False,
    )

    op.create_table(
        "usage_ledger",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("sandbox_id", sa.Uuid(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("billable_seconds", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sandbox_id"),
    )
    op.create_index("ix_usage_ledger_user_id", "usage_ledger", ["user_id"], unique=False)
    op.create_index("ix_usage_ledger_workspace_id", "usage_ledger", ["workspace_id"], unique=False)

    op.execute(
        sa.text("UPDATE billing_grant SET grant_type = 'trial' WHERE grant_type = 'free_included'")
    )

    op.drop_table("sandbox_event_receipt")

    op.drop_index("ix_usage_segment_open_sandbox_id", table_name="usage_segment")
    op.drop_index("ix_usage_segment_external_sandbox_id", table_name="usage_segment")
    op.drop_index("ix_usage_segment_sandbox_id", table_name="usage_segment")
    op.drop_index("ix_usage_segment_workspace_id", table_name="usage_segment")
    op.drop_index("ix_usage_segment_user_id", table_name="usage_segment")
    op.drop_table("usage_segment")

    op.drop_index("ix_billing_entitlement_user_id", table_name="billing_entitlement")
    op.drop_table("billing_entitlement")

    op.drop_column("cloud_sandbox", "last_provider_event_kind")
    op.drop_column("cloud_sandbox", "last_provider_event_at")
    op.alter_column(
        "cloud_sandbox",
        "external_sandbox_id",
        existing_type=sa.String(length=255),
        nullable=False,
    )
