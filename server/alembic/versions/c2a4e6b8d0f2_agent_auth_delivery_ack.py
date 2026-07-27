"""agent auth delivery ack

Revision ID: c2a4e6b8d0f2
Revises: ab5316095737
Create Date: 2026-07-27 00:00:00.000000

Corridor C-2 of the agent-auth re-cut (agent-auth.md "Applied means
acknowledged"): one row per (user, surface) recording the last agent-auth
``state.json`` delivery the surface's runtime acknowledged — cloud when the
materialization operation completes against the sandbox, local when the
desktop reports its runtime's accepted state push. ``acked_fingerprint`` is
the renderer's sha256 of the canonical document (the change detector);
``acked_revision`` is the document revision (ms-epoch max(updated_at) over
the surface's selection rows), kept only as the out-of-order backstop so a
delayed ack for an older document can never clobber a newer one.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c2a4e6b8d0f2"
down_revision: str | Sequence[str] | None = "ab5316095737"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_auth_delivery_ack",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("surface", sa.Text(), nullable=False),
        sa.Column("acked_revision", sa.BigInteger(), nullable=False),
        sa.Column("acked_fingerprint", sa.String(length=128), nullable=False),
        sa.Column("acked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "surface IN ('local', 'cloud')",
            name="ck_agent_auth_delivery_ack_surface",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "surface",
            name="uq_agent_auth_delivery_ack_scope",
        ),
    )
    op.create_index(
        op.f("ix_agent_auth_delivery_ack_user_id"),
        "agent_auth_delivery_ack",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_agent_auth_delivery_ack_user_id"),
        table_name="agent_auth_delivery_ack",
    )
    op.drop_table("agent_auth_delivery_ack")
