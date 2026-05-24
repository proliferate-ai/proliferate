"""agent gateway free credits

Revision ID: e9f0a1b2c3d5
Revises: b0c2d4e6f8a0
Create Date: 2026-05-24 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e9f0a1b2c3d5"
down_revision: str | Sequence[str] | None = "b0c2d4e6f8a0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def _constraints(table_name: str) -> set[str]:
    return {
        constraint["name"]
        for constraint in sa.inspect(op.get_bind()).get_check_constraints(table_name)
        if constraint.get("name")
    }


def _indexes(table_name: str) -> set[str]:
    return {
        index["name"]
        for index in sa.inspect(op.get_bind()).get_indexes(table_name)
        if index.get("name")
    }


def _drop_constraint_once(table_name: str, constraint_name: str) -> None:
    if constraint_name in _constraints(table_name):
        op.drop_constraint(constraint_name, table_name, type_="check")


def _drop_index_once(table_name: str, index_name: str) -> None:
    if index_name in _indexes(table_name):
        op.drop_index(index_name, table_name=table_name)


def upgrade() -> None:
    """Upgrade schema."""
    if _has_table("agent_gateway_budget_subject"):
        columns = _columns("agent_gateway_budget_subject")
        if "owner_user_id" not in columns:
            op.add_column(
                "agent_gateway_budget_subject",
                sa.Column("owner_user_id", sa.UUID(), nullable=True),
            )
            op.create_index(
                "ix_agent_gateway_budget_subject_owner_user_id",
                "agent_gateway_budget_subject",
                ["owner_user_id"],
            )
            op.create_foreign_key(
                "fk_agent_gateway_budget_subject_owner_user_id_user",
                "agent_gateway_budget_subject",
                "user",
                ["owner_user_id"],
                ["id"],
                ondelete="CASCADE",
            )
        if "entitlement_source" not in columns:
            op.add_column(
                "agent_gateway_budget_subject",
                sa.Column("entitlement_source", sa.String(length=64), nullable=True),
            )
        if "entitlement_period_key" not in columns:
            op.add_column(
                "agent_gateway_budget_subject",
                sa.Column("entitlement_period_key", sa.String(length=64), nullable=True),
            )

        op.alter_column("agent_gateway_budget_subject", "organization_id", nullable=True)
        op.alter_column("agent_gateway_budget_subject", "budget_duration", nullable=True)

        _drop_constraint_once(
            "agent_gateway_budget_subject",
            "ck_agent_gateway_budget_subject_owner_scope",
        )
        _drop_constraint_once(
            "agent_gateway_budget_subject",
            "ck_agent_gateway_budget_subject_org",
        )
        constraints = _constraints("agent_gateway_budget_subject")
        if "ck_agent_gateway_budget_subject_owner_scope" not in constraints:
            op.create_check_constraint(
                "ck_agent_gateway_budget_subject_owner_scope",
                "agent_gateway_budget_subject",
                "owner_scope IN ('personal', 'organization')",
            )
        if "ck_agent_gateway_budget_subject_owner_fields" not in constraints:
            op.create_check_constraint(
                "ck_agent_gateway_budget_subject_owner_fields",
                "agent_gateway_budget_subject",
                "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
                "AND organization_id IS NULL) OR "
                "(owner_scope = 'organization' AND owner_user_id IS NULL "
                "AND organization_id IS NOT NULL))",
            )

        _drop_index_once(
            "agent_gateway_budget_subject",
            "uq_agent_gateway_managed_budget_subject_org",
        )
        op.create_index(
            "uq_agent_gateway_managed_budget_subject_org",
            "agent_gateway_budget_subject",
            ["organization_id"],
            unique=True,
            postgresql_where=sa.text(
                "owner_scope = 'organization' "
                "AND budget_kind = 'proliferate_managed' "
                "AND status != 'revoked'"
            ),
        )
        if "uq_agent_gateway_managed_budget_subject_user" not in _indexes(
            "agent_gateway_budget_subject"
        ):
            op.create_index(
                "uq_agent_gateway_managed_budget_subject_user",
                "agent_gateway_budget_subject",
                ["owner_user_id"],
                unique=True,
                postgresql_where=sa.text(
                    "owner_scope = 'personal' "
                    "AND budget_kind = 'proliferate_managed' "
                    "AND status != 'revoked'"
                ),
            )

    if not _has_table("agent_gateway_free_credit_entitlement"):
        op.create_table(
            "agent_gateway_free_credit_entitlement",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("user_id", sa.UUID(), nullable=False),
            sa.Column("budget_subject_id", sa.UUID(), nullable=True),
            sa.Column(
                "source",
                sa.String(length=64),
                nullable=False,
                server_default="signup_free_credit",
            ),
            sa.Column(
                "period_key",
                sa.String(length=64),
                nullable=False,
                server_default="registration",
            ),
            sa.Column("included_budget_usd", sa.String(length=64), nullable=False),
            sa.Column(
                "status",
                sa.String(length=32),
                nullable=False,
                server_default="provisioning",
            ),
            sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("exhausted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error_code", sa.String(length=128), nullable=True),
            sa.Column("last_error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "status IN ('provisioning', 'active', 'exhausted', 'expired', 'revoked')",
                name="ck_agent_gateway_free_credit_entitlement_status",
            ),
            sa.ForeignKeyConstraint(
                ["budget_subject_id"],
                ["agent_gateway_budget_subject.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_agent_gateway_free_credit_entitlement_user_id",
            "agent_gateway_free_credit_entitlement",
            ["user_id"],
        )
        op.create_index(
            "ix_agent_gateway_free_credit_entitlement_status",
            "agent_gateway_free_credit_entitlement",
            ["status"],
        )
        op.create_index(
            "ix_agent_gateway_free_credit_entitlement_budget_subject",
            "agent_gateway_free_credit_entitlement",
            ["budget_subject_id"],
        )
        op.create_index(
            "uq_agent_gateway_free_credit_entitlement_user_period_source",
            "agent_gateway_free_credit_entitlement",
            ["user_id", "period_key", "source"],
            unique=True,
        )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_table("agent_gateway_free_credit_entitlement"):
        op.drop_index(
            "uq_agent_gateway_free_credit_entitlement_user_period_source",
            table_name="agent_gateway_free_credit_entitlement",
        )
        op.drop_index(
            "ix_agent_gateway_free_credit_entitlement_budget_subject",
            table_name="agent_gateway_free_credit_entitlement",
        )
        op.drop_index(
            "ix_agent_gateway_free_credit_entitlement_status",
            table_name="agent_gateway_free_credit_entitlement",
        )
        op.drop_index(
            "ix_agent_gateway_free_credit_entitlement_user_id",
            table_name="agent_gateway_free_credit_entitlement",
        )
        op.drop_table("agent_gateway_free_credit_entitlement")

    if not _has_table("agent_gateway_budget_subject"):
        return

    _drop_index_once(
        "agent_gateway_budget_subject",
        "uq_agent_gateway_managed_budget_subject_user",
    )
    _drop_index_once(
        "agent_gateway_budget_subject",
        "uq_agent_gateway_managed_budget_subject_org",
    )
    _drop_constraint_once(
        "agent_gateway_budget_subject",
        "ck_agent_gateway_budget_subject_owner_fields",
    )
    _drop_constraint_once(
        "agent_gateway_budget_subject",
        "ck_agent_gateway_budget_subject_owner_scope",
    )

    op.execute(
        """
        DELETE FROM agent_gateway_policy
        WHERE budget_subject_id IN (
            SELECT id
            FROM agent_gateway_budget_subject
            WHERE owner_scope = 'personal'
        )
        """
    )
    op.execute(
        "DELETE FROM agent_gateway_budget_subject WHERE owner_scope = 'personal'"
    )

    op.create_check_constraint(
        "ck_agent_gateway_budget_subject_owner_scope",
        "agent_gateway_budget_subject",
        "owner_scope = 'organization'",
    )
    op.create_check_constraint(
        "ck_agent_gateway_budget_subject_org",
        "agent_gateway_budget_subject",
        "organization_id IS NOT NULL",
    )
    op.create_index(
        "uq_agent_gateway_managed_budget_subject_org",
        "agent_gateway_budget_subject",
        ["organization_id"],
        unique=True,
        postgresql_where=sa.text("budget_kind = 'proliferate_managed' AND status != 'revoked'"),
    )

    columns = _columns("agent_gateway_budget_subject")
    if "entitlement_period_key" in columns:
        op.drop_column("agent_gateway_budget_subject", "entitlement_period_key")
    if "entitlement_source" in columns:
        op.drop_column("agent_gateway_budget_subject", "entitlement_source")
    if "owner_user_id" in columns:
        op.drop_constraint(
            "fk_agent_gateway_budget_subject_owner_user_id_user",
            "agent_gateway_budget_subject",
            type_="foreignkey",
        )
        _drop_index_once(
            "agent_gateway_budget_subject",
            "ix_agent_gateway_budget_subject_owner_user_id",
        )
        op.drop_column("agent_gateway_budget_subject", "owner_user_id")
    op.alter_column("agent_gateway_budget_subject", "budget_duration", nullable=False)
    op.alter_column("agent_gateway_budget_subject", "organization_id", nullable=False)
