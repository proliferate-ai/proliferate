"""cloud target updates

Revision ID: d2e3f4a5b6c7
Revises: d0e1f2a3b4c5
Create Date: 2026-05-14 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2e3f4a5b6c7"
down_revision: str | Sequence[str] | None = "d0e1f2a3b4c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TARGET_UPDATE_STATUSES = (
    "idle",
    "staging",
    "staged",
    "applying",
    "applied",
    "failed",
    "rolled_back",
)
_TARGET_UPDATE_CHANNELS = ("stable", "beta", "pinned")


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_check_constraint(table_name: str, constraint_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return constraint_name in {
        constraint["name"] for constraint in inspector.get_check_constraints(table_name)
    }


def _add_column_once(table_name: str, column: sa.Column) -> None:
    if not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _drop_column_once(table_name: str, column_name: str) -> None:
    if _has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def upgrade() -> None:
    """Upgrade schema."""
    _add_column_once(
        "cloud_targets",
        sa.Column(
            "update_channel",
            sa.String(length=32),
            nullable=False,
            server_default="stable",
        ),
    )
    _add_column_once(
        "cloud_targets",
        sa.Column("update_generation", sa.Integer(), nullable=False, server_default="0"),
    )
    _add_column_once(
        "cloud_targets",
        sa.Column("desired_anyharness_version", sa.String(length=128), nullable=True),
    )
    _add_column_once(
        "cloud_targets",
        sa.Column("desired_worker_version", sa.String(length=128), nullable=True),
    )
    _add_column_once(
        "cloud_targets",
        sa.Column("desired_supervisor_version", sa.String(length=128), nullable=True),
    )
    _add_column_once(
        "cloud_targets",
        sa.Column("update_status", sa.String(length=32), nullable=True),
    )
    _add_column_once(
        "cloud_targets",
        sa.Column("update_status_detail", sa.Text(), nullable=True),
    )
    _add_column_once(
        "cloud_targets",
        sa.Column("update_component", sa.String(length=64), nullable=True),
    )
    _add_column_once(
        "cloud_targets",
        sa.Column("update_version", sa.String(length=128), nullable=True),
    )
    _add_column_once(
        "cloud_targets",
        sa.Column("update_reported_at", sa.DateTime(timezone=True), nullable=True),
    )
    if not _has_check_constraint("cloud_targets", "ck_cloud_targets_update_status"):
        op.create_check_constraint(
            "ck_cloud_targets_update_status",
            "cloud_targets",
            f"update_status IS NULL OR update_status IN {_TARGET_UPDATE_STATUSES}",
        )
    if not _has_check_constraint("cloud_targets", "ck_cloud_targets_update_channel"):
        op.create_check_constraint(
            "ck_cloud_targets_update_channel",
            "cloud_targets",
            f"update_channel IN {_TARGET_UPDATE_CHANNELS}",
        )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_check_constraint("cloud_targets", "ck_cloud_targets_update_channel"):
        op.drop_constraint("ck_cloud_targets_update_channel", "cloud_targets", type_="check")
    if _has_check_constraint("cloud_targets", "ck_cloud_targets_update_status"):
        op.drop_constraint("ck_cloud_targets_update_status", "cloud_targets", type_="check")
    _drop_column_once("cloud_targets", "update_reported_at")
    _drop_column_once("cloud_targets", "update_version")
    _drop_column_once("cloud_targets", "update_component")
    _drop_column_once("cloud_targets", "update_status_detail")
    _drop_column_once("cloud_targets", "update_status")
    _drop_column_once("cloud_targets", "desired_supervisor_version")
    _drop_column_once("cloud_targets", "desired_worker_version")
    _drop_column_once("cloud_targets", "desired_anyharness_version")
    _drop_column_once("cloud_targets", "update_generation")
    _drop_column_once("cloud_targets", "update_channel")
