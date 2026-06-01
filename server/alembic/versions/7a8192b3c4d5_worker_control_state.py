"""Add worker control wait state."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "7a8192b3c4d5"
down_revision: str | Sequence[str] | None = "6f708192a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name)


def upgrade() -> None:
    if _has_table("cloud_worker_target_control_state"):
        return

    op.create_table(
        "cloud_worker_target_control_state",
        sa.Column("target_id", sa.UUID(), nullable=False),
        sa.Column(
            "control_revision", sa.BigInteger(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "exposure_revision", sa.BigInteger(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "exposure_fingerprint_hash",
            sa.String(length=64),
            server_default=sa.text("''"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("exposure_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("target_id"),
    )


def downgrade() -> None:
    if _has_table("cloud_worker_target_control_state"):
        op.drop_table("cloud_worker_target_control_state")
