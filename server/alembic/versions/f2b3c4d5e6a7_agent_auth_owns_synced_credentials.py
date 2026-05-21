"""Move synced credentials fully into agent auth.

Revision ID: f2b3c4d5e6a7
Revises: f1a2b3c4d5e6
Create Date: 2026-05-20 16:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "f2b3c4d5e6a7"
down_revision: str | None = "f1a2b3c4d5e6"
branch_labels: str | None = None
depends_on: str | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {column["name"] for column in _inspector().get_columns(table_name)}


def _add_column_once(table_name: str, column: sa.Column) -> None:
    if _has_table(table_name) and not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _drop_column_once(table_name: str, column_name: str) -> None:
    if _has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def _drop_foreign_keys_for_column(table_name: str, column_name: str) -> None:
    if not _has_table(table_name):
        return
    for fk in _inspector().get_foreign_keys(table_name):
        if column_name in fk.get("constrained_columns", ()):
            op.drop_constraint(fk["name"], table_name, type_="foreignkey")


def _drop_unique_constraints_for_column(table_name: str, column_name: str) -> None:
    if not _has_table(table_name):
        return
    for constraint in _inspector().get_unique_constraints(table_name):
        if column_name in constraint.get("column_names", ()):
            op.drop_constraint(constraint["name"], table_name, type_="unique")


def _drop_index_once(table_name: str, index_name: str) -> None:
    if not _has_table(table_name):
        return
    if index_name in {index["name"] for index in _inspector().get_indexes(table_name)}:
        op.drop_index(index_name, table_name=table_name)


def _drop_table_once(table_name: str) -> None:
    if _has_table(table_name):
        op.drop_table(table_name)


def upgrade() -> None:
    _add_column_once(
        "agent_auth_credential",
        sa.Column("payload_ciphertext", sa.Text(), nullable=True),
    )
    _add_column_once(
        "agent_auth_credential",
        sa.Column("payload_ciphertext_key_id", sa.String(length=64), nullable=True),
    )
    _drop_foreign_keys_for_column("agent_auth_credential", "legacy_cloud_credential_id")
    _drop_unique_constraints_for_column("agent_auth_credential", "legacy_cloud_credential_id")
    _drop_column_once("agent_auth_credential", "legacy_cloud_credential_id")
    _drop_index_once("cloud_credential", "ix_cloud_credential_user_id")
    _drop_table_once("cloud_credential")


def downgrade() -> None:
    if not _has_table("cloud_credential"):
        op.create_table(
            "cloud_credential",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("provider", sa.String(length=32), nullable=False),
            sa.Column("auth_mode", sa.String(length=16), nullable=False),
            sa.Column("payload_ciphertext", sa.Text(), nullable=False),
            sa.Column("payload_format", sa.String(length=32), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_cloud_credential_user_id", "cloud_credential", ["user_id"])
    if _has_table("agent_auth_credential") and not _has_column(
        "agent_auth_credential",
        "legacy_cloud_credential_id",
    ):
        op.add_column(
            "agent_auth_credential",
            sa.Column("legacy_cloud_credential_id", sa.Uuid(), nullable=True),
        )
        op.create_foreign_key(
            "fk_agent_auth_credential_legacy_cloud_credential_id",
            "agent_auth_credential",
            "cloud_credential",
            ["legacy_cloud_credential_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_unique_constraint(
            "uq_agent_auth_credential_legacy_cloud_credential_id",
            "agent_auth_credential",
            ["legacy_cloud_credential_id"],
        )
    _drop_column_once("agent_auth_credential", "payload_ciphertext_key_id")
    _drop_column_once("agent_auth_credential", "payload_ciphertext")
