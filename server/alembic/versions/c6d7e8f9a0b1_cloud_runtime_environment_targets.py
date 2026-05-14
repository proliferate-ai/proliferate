"""cloud runtime environment targets

Revision ID: c6d7e8f9a0b1
Revises: c5d6e7f8a9b0
Create Date: 2026-05-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c6d7e8f9a0b1"
down_revision: str | Sequence[str] | None = "c5d6e7f8a9b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_column("cloud_runtime_environment", "target_id"):
        op.add_column(
            "cloud_runtime_environment",
            sa.Column("target_id", sa.Uuid(), nullable=True),
        )
        op.create_foreign_key(
            "fk_cloud_runtime_environment_target_id_cloud_targets",
            "cloud_runtime_environment",
            "cloud_targets",
            ["target_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if not _has_index("cloud_runtime_environment", "ix_cloud_runtime_environment_target_id"):
        op.create_index(
            "ix_cloud_runtime_environment_target_id",
            "cloud_runtime_environment",
            ["target_id"],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_cloud_runtime_environment_target_id", table_name="cloud_runtime_environment")
    op.drop_constraint(
        "fk_cloud_runtime_environment_target_id_cloud_targets",
        "cloud_runtime_environment",
        type_="foreignkey",
    )
    op.drop_column("cloud_runtime_environment", "target_id")
