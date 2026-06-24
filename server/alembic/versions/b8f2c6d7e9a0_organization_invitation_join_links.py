"""organization invitation join links

Revision ID: b8f2c6d7e9a0
Revises: b8e1f5a6c9d2
Create Date: 2026-06-24 13:05:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8f2c6d7e9a0"
down_revision: str | Sequence[str] | None = "b8e1f5a6c9d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _drop_index_once(table_name: str, index_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def _drop_column_once(table_name: str, column_name: str) -> None:
    if _has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def _add_column_once(table_name: str, column: sa.Column) -> None:
    if _has_table(table_name) and not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
    postgresql_where: sa.TextClause | None = None,
) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(
            index_name,
            table_name,
            columns,
            unique=unique,
            postgresql_where=postgresql_where,
        )


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("organization_invitation"):
        return

    _drop_index_once("organization_invitation", "ix_organization_invitation_handoff_token_hash")
    _drop_index_once("organization_invitation", "ix_organization_invitation_token_hash")
    _drop_column_once("organization_invitation", "handoff_expires_at")
    _drop_column_once("organization_invitation", "handoff_token_hash")
    _drop_column_once("organization_invitation", "token_hash")


def downgrade() -> None:
    """Downgrade schema."""
    if not _has_table("organization_invitation"):
        return

    _add_column_once(
        "organization_invitation",
        sa.Column("token_hash", sa.String(length=64), nullable=True),
    )
    _add_column_once(
        "organization_invitation",
        sa.Column("handoff_token_hash", sa.String(length=64), nullable=True),
    )
    _add_column_once(
        "organization_invitation",
        sa.Column("handoff_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    _create_index_once(
        "ix_organization_invitation_token_hash",
        "organization_invitation",
        ["token_hash"],
        unique=True,
    )
    _create_index_once(
        "ix_organization_invitation_handoff_token_hash",
        "organization_invitation",
        ["handoff_token_hash"],
        unique=True,
        postgresql_where=sa.text("handoff_token_hash IS NOT NULL"),
    )
