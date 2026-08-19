"""add target-scoped harness launch option state

Revision ID: 19c4e7a2b5d8
Revises: e7f1a3c9d20b
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "19c4e7a2b5d8"
down_revision: str | None = "e7f1a3c9d20b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "harness_launch_option_state",
        sa.Column("cloud_sandbox_id", sa.Uuid(), nullable=False),
        sa.Column("harness_kind", sa.String(length=64), nullable=False),
        sa.Column("source_revision", sa.BigInteger(), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("copied_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["cloud_sandbox_id"], ["cloud_sandbox.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("cloud_sandbox_id", "harness_kind"),
    )
def downgrade() -> None:
    op.drop_table("harness_launch_option_state")
