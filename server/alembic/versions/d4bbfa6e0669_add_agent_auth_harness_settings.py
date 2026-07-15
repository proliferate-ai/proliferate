"""Add agent_auth_harness_settings table for per-harness advanced settings.

Revision ID: a1b2c3d4e5f6
Revises: bcc0459a6f11
Create Date: 2026-07-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4bbfa6e0669"
down_revision: str | Sequence[str] | None = "bcc0459a6f11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_auth_harness_settings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("harness_kind", sa.String(64), nullable=False),
        sa.Column("surface", sa.Text(), nullable=False),
        sa.Column("settings_json", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "user_id",
            "harness_kind",
            "surface",
            name="uq_agent_auth_harness_settings_scope",
        ),
        sa.CheckConstraint(
            "surface IN ('local', 'cloud')",
            name="ck_agent_auth_harness_settings_surface",
        ),
    )


def downgrade() -> None:
    op.drop_table("agent_auth_harness_settings")
