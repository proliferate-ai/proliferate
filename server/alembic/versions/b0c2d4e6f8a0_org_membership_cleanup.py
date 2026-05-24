"""Organization membership cleanup foundation.

Revision ID: b0c2d4e6f8a0
Revises: a0b1c2d3e4f5
Create Date: 2026-05-24 12:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b0c2d4e6f8a0"
down_revision: str | Sequence[str] | None = "a0b1c2d3e4f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in set(_inspector().get_table_names())


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {column["name"] for column in _inspector().get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {index["name"] for index in _inspector().get_indexes(table_name)}


def _has_check_constraint(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return constraint_name in {
        constraint["name"] for constraint in _inspector().get_check_constraints(table_name)
    }


def _add_column_once(table_name: str, column: sa.Column) -> None:
    if _has_table(table_name) and not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
    postgresql_where: sa.ColumnElement[bool] | None = None,
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
    _add_column_once(
        "organization",
        sa.Column(
            "status",
            sa.String(length=32),
            server_default=sa.text("'active'"),
            nullable=False,
        ),
    )
    if _has_table("organization") and not _has_check_constraint(
        "organization",
        "ck_organization_status",
    ):
        op.create_check_constraint(
            "ck_organization_status",
            "organization",
            "status IN ('pending_checkout', 'active', 'suspended', 'archived')",
        )
    _create_index_once("ix_organization_status", "organization", ["status"])

    if not _has_table("organization_checkout_intent"):
        op.create_table(
            "organization_checkout_intent",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=False),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
            sa.Column("billing_subject_id", sa.Uuid(), nullable=False),
            sa.Column("team_name", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column(
                "activation_status",
                sa.String(length=64),
                server_default=sa.text("'not_started'"),
                nullable=False,
            ),
            sa.Column("activation_error_code", sa.String(length=128), nullable=True),
            sa.Column("activation_error_message", sa.Text(), nullable=True),
            sa.Column("last_webhook_event_id", sa.String(length=255), nullable=True),
            sa.Column("stripe_checkout_session_id", sa.String(length=255), nullable=True),
            sa.Column("stripe_customer_id", sa.String(length=255), nullable=True),
            sa.Column("stripe_subscription_id", sa.String(length=255), nullable=True),
            sa.Column("idempotency_key", sa.String(length=255), nullable=False),
            sa.Column("invite_emails_json", sa.Text(), nullable=True),
            sa.Column("checkout_url", sa.Text(), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "status IN ('pending', 'completed', 'expired', 'cancelled', 'failed')",
                name="ck_organization_checkout_intent_status",
            ),
            sa.CheckConstraint(
                "activation_status IN ("
                "'not_started', 'activating', 'activated', 'failed_business_state', "
                "'failed_billing_state', 'failed_internal')",
                name="ck_organization_checkout_intent_activation_status",
            ),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organization.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["created_by_user_id"],
                ["user.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["billing_subject_id"],
                ["billing_subject.id"],
                ondelete="RESTRICT",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once(
        "ix_organization_checkout_intent_organization_id",
        "organization_checkout_intent",
        ["organization_id"],
    )
    _create_index_once(
        "ix_organization_checkout_intent_created_by_user_id",
        "organization_checkout_intent",
        ["created_by_user_id"],
    )
    _create_index_once(
        "ix_organization_checkout_intent_billing_subject_id",
        "organization_checkout_intent",
        ["billing_subject_id"],
    )
    _create_index_once(
        "ix_organization_checkout_intent_status",
        "organization_checkout_intent",
        ["status"],
    )
    _create_index_once(
        "ix_organization_checkout_intent_activation_status",
        "organization_checkout_intent",
        ["activation_status"],
    )
    _create_index_once(
        "uq_organization_checkout_intent_active_creator",
        "organization_checkout_intent",
        ["created_by_user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    _create_index_once(
        "ix_organization_checkout_intent_creator_status",
        "organization_checkout_intent",
        ["created_by_user_id", "status"],
    )
    _create_index_once(
        "ix_organization_checkout_intent_organization_status",
        "organization_checkout_intent",
        ["organization_id", "status"],
    )
    _create_index_once(
        "organization_checkout_intent_stripe_checkout_session_id_key",
        "organization_checkout_intent",
        ["stripe_checkout_session_id"],
        unique=True,
        postgresql_where=sa.text("stripe_checkout_session_id IS NOT NULL"),
    )
    _create_index_once(
        "organization_checkout_intent_stripe_subscription_id_key",
        "organization_checkout_intent",
        ["stripe_subscription_id"],
        unique=True,
        postgresql_where=sa.text("stripe_subscription_id IS NOT NULL"),
    )
    _create_index_once(
        "organization_checkout_intent_idempotency_key_key",
        "organization_checkout_intent",
        ["idempotency_key"],
        unique=True,
    )

    if _has_table("organization_membership"):
        op.execute(
            sa.text(
                """
                WITH ranked_active_memberships AS (
                    SELECT
                        membership.id,
                        row_number() OVER (
                            PARTITION BY membership.user_id
                            ORDER BY
                                membership.joined_at ASC NULLS LAST,
                                membership.created_at ASC NULLS LAST,
                                membership.id ASC
                        ) AS membership_rank
                    FROM organization_membership AS membership
                    JOIN organization AS organization
                        ON organization.id = membership.organization_id
                    WHERE membership.status = 'active'
                        AND organization.status IN ('active', 'suspended')
                )
                UPDATE organization_membership AS membership
                SET
                    status = 'removed',
                    removed_at = COALESCE(membership.removed_at, now()),
                    updated_at = now()
                FROM ranked_active_memberships AS ranked
                WHERE membership.id = ranked.id
                    AND ranked.membership_rank > 1
                """
            )
        )

    _create_index_once(
        "uq_organization_membership_active_user",
        "organization_membership",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )


def downgrade() -> None:
    if _has_index("organization_membership", "uq_organization_membership_active_user"):
        op.drop_index(
            "uq_organization_membership_active_user",
            table_name="organization_membership",
        )
    if _has_table("organization_checkout_intent"):
        op.drop_table("organization_checkout_intent")
    if _has_table("organization") and _has_check_constraint(
        "organization",
        "ck_organization_status",
    ):
        op.drop_constraint("ck_organization_status", "organization", type_="check")
    if _has_index("organization", "ix_organization_status"):
        op.drop_index("ix_organization_status", table_name="organization")
    if _has_column("organization", "status"):
        op.drop_column("organization", "status")
