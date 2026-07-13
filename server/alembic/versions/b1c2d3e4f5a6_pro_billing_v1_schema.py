"""pro billing v1 schema

Revision ID: b1c2d3e4f5a6
Revises: a7c8d9e0f1a2
Create Date: 2026-05-01 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: str | Sequence[str] | None = "a7c8d9e0f1a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    return bool(
        bind.execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = current_schema() AND table_name = :table_name)"
            ),
            {"table_name": table_name},
        ).scalar()
    )


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    return bool(
        bind.execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = current_schema() "
                "AND table_name = :table_name AND column_name = :column_name)"
            ),
            {"table_name": table_name, "column_name": column_name},
        ).scalar()
    )


def _has_index(index_name: str) -> bool:
    bind = op.get_bind()
    return bool(
        bind.execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM pg_indexes "
                "WHERE schemaname = current_schema() AND indexname = :index_name)"
            ),
            {"index_name": index_name},
        ).scalar()
    )


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _drop_column_if_exists(table_name: str, column_name: str) -> None:
    if _has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def _drop_index_if_exists(index_name: str, *, table_name: str) -> None:
    if _has_index(index_name):
        op.drop_index(index_name, table_name=table_name)


def upgrade() -> None:
    """Upgrade schema."""
    _add_column_if_missing(
        "billing_subject",
        sa.Column(
            "overage_cap_cents_per_seat",
            sa.Integer(),
            server_default=sa.text("2000"),
            nullable=False,
        ),
    )
    _add_column_if_missing(
        "billing_subject",
        sa.Column("overage_preference_set_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column_if_missing(
        "billing_subscription",
        sa.Column("seat_quantity", sa.Integer(), nullable=True),
    )
    _add_column_if_missing(
        "billing_usage_export",
        sa.Column("meter_quantity_cents", sa.Integer(), nullable=True),
    )
    _add_column_if_missing(
        "billing_usage_export",
        sa.Column("cap_cents_snapshot", sa.Integer(), nullable=True),
    )
    _add_column_if_missing(
        "billing_usage_export",
        sa.Column("cap_used_cents_snapshot", sa.Integer(), nullable=True),
    )
    _add_column_if_missing(
        "billing_usage_export",
        sa.Column("writeoff_reason", sa.String(length=64), nullable=True),
    )

    if not _has_table("billing_seat_adjustment"):
        op.create_table(
            "billing_seat_adjustment",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("billing_subject_id", sa.Uuid(), nullable=False),
            sa.Column("billing_subscription_id", sa.Uuid(), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("membership_id", sa.Uuid(), nullable=True),
            sa.Column("stripe_subscription_id", sa.String(length=255), nullable=False),
            sa.Column("monthly_subscription_item_id", sa.String(length=255), nullable=True),
            sa.Column("previous_quantity", sa.Integer(), nullable=True),
            sa.Column("target_quantity", sa.Integer(), nullable=False),
            sa.Column("grant_quantity", sa.Integer(), server_default=sa.text("0"), nullable=False),
            sa.Column("attempt_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
            sa.Column("period_start", sa.DateTime(timezone=True), nullable=True),
            sa.Column("effective_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("source_ref", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("stripe_confirmed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("grant_issued_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint("target_quantity >= 0", name="ck_billing_seat_adjustment_quantity"),
            sa.CheckConstraint(
                "previous_quantity IS NULL OR previous_quantity >= 0",
                name="ck_billing_seat_adjustment_previous_quantity",
            ),
            sa.CheckConstraint(
                "grant_quantity >= 0",
                name="ck_billing_seat_adjustment_grant_quantity",
            ),
            sa.CheckConstraint(
                "attempt_count >= 0",
                name="ck_billing_seat_adjustment_attempt_count",
            ),
            sa.CheckConstraint(
                "status IN ('pending', 'succeeded', 'failed_retryable', 'failed_terminal')",
                name="ck_billing_seat_adjustment_status",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("source_ref", name="uq_billing_seat_adjustment_source_ref"),
        )
        op.create_index(
            "ix_billing_seat_adjustment_billing_subject_id",
            "billing_seat_adjustment",
            ["billing_subject_id"],
            unique=False,
        )
        op.create_index(
            "ix_billing_seat_adjustment_billing_subscription_id",
            "billing_seat_adjustment",
            ["billing_subscription_id"],
            unique=False,
        )
        op.create_index(
            "ix_billing_seat_adjustment_membership_id",
            "billing_seat_adjustment",
            ["membership_id"],
            unique=False,
        )
        op.create_index(
            "ix_billing_seat_adjustment_organization_id",
            "billing_seat_adjustment",
            ["organization_id"],
            unique=False,
        )
        op.create_index(
            "ix_billing_seat_adjustment_stripe_subscription_id",
            "billing_seat_adjustment",
            ["stripe_subscription_id"],
            unique=False,
        )
        op.create_index(
            "ix_billing_seat_adjustment_status",
            "billing_seat_adjustment",
            ["status"],
            unique=False,
        )
    else:
        _add_column_if_missing(
            "billing_seat_adjustment",
            sa.Column("previous_quantity", sa.Integer(), nullable=True),
        )
        _add_column_if_missing(
            "billing_seat_adjustment",
            sa.Column("grant_quantity", sa.Integer(), server_default=sa.text("0"), nullable=False),
        )
        _add_column_if_missing(
            "billing_seat_adjustment",
            sa.Column("attempt_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        )
        _add_column_if_missing(
            "billing_seat_adjustment",
            sa.Column("effective_at", sa.DateTime(timezone=True), nullable=True),
        )

    if not _has_table("billing_overage_remainder"):
        op.create_table(
            "billing_overage_remainder",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("billing_subject_id", sa.Uuid(), nullable=False),
            sa.Column("billing_subscription_id", sa.Uuid(), nullable=True),
            sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "fractional_cents",
                sa.Float(),
                server_default=sa.text("0"),
                nullable=False,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "fractional_cents >= 0",
                name="ck_billing_overage_remainder_nonnegative",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "billing_subject_id",
                "period_start",
                name="uq_billing_overage_remainder_subject_period",
            ),
        )
        op.create_index(
            "ix_billing_overage_remainder_billing_subject_id",
            "billing_overage_remainder",
            ["billing_subject_id"],
            unique=False,
        )
        op.create_index(
            "ix_billing_overage_remainder_billing_subscription_id",
            "billing_overage_remainder",
            ["billing_subscription_id"],
            unique=False,
        )
        op.create_index(
            "ix_billing_overage_remainder_period_start",
            "billing_overage_remainder",
            ["period_start"],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    _drop_index_if_exists(
        "ix_billing_overage_remainder_period_start",
        table_name="billing_overage_remainder",
    )
    _drop_index_if_exists(
        "ix_billing_overage_remainder_billing_subscription_id",
        table_name="billing_overage_remainder",
    )
    _drop_index_if_exists(
        "ix_billing_overage_remainder_billing_subject_id",
        table_name="billing_overage_remainder",
    )
    if _has_table("billing_overage_remainder"):
        op.drop_table("billing_overage_remainder")

    _drop_index_if_exists("ix_billing_seat_adjustment_status", table_name="billing_seat_adjustment")
    _drop_index_if_exists(
        "ix_billing_seat_adjustment_stripe_subscription_id",
        table_name="billing_seat_adjustment",
    )
    _drop_index_if_exists(
        "ix_billing_seat_adjustment_organization_id",
        table_name="billing_seat_adjustment",
    )
    _drop_index_if_exists(
        "ix_billing_seat_adjustment_membership_id",
        table_name="billing_seat_adjustment",
    )
    _drop_index_if_exists(
        "ix_billing_seat_adjustment_billing_subscription_id",
        table_name="billing_seat_adjustment",
    )
    _drop_index_if_exists(
        "ix_billing_seat_adjustment_billing_subject_id",
        table_name="billing_seat_adjustment",
    )
    if _has_table("billing_seat_adjustment"):
        op.drop_table("billing_seat_adjustment")

    _drop_column_if_exists("billing_usage_export", "writeoff_reason")
    _drop_column_if_exists("billing_usage_export", "cap_used_cents_snapshot")
    _drop_column_if_exists("billing_usage_export", "cap_cents_snapshot")
    _drop_column_if_exists("billing_usage_export", "meter_quantity_cents")
    _drop_column_if_exists("billing_subscription", "seat_quantity")
    _drop_column_if_exists("billing_subject", "overage_preference_set_at")
    _drop_column_if_exists("billing_subject", "overage_cap_cents_per_seat")
