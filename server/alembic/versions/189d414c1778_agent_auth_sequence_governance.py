"""agent_auth slice 3: sequence governance (acked_sequence + render-sequence row)

The sequence/fingerprint split (agent_auth spec §2 "How delivery is
governed"): the document field ``revision`` becomes ``sequence`` — monotonic
per (user, surface), bumped ONLY by a render whose ``harnesses`` content
changed — and ``fingerprint`` becomes a ``GET /state`` rider hashing the
canonical ``harnesses`` array only.

- ``agent_auth_delivery_ack.acked_revision`` renames to ``acked_sequence``.
  Existing rows keep their ms-epoch values: the store's only-forward
  predicate (``acked_sequence <= incoming``) makes such a stamp inert until
  the next content change re-renders, and the applied read compares against
  the CURRENT rendered pair, so a stale stamp reads pending, never wrong.
- New ``agent_auth_render_sequence``: the persisted per-(user, surface)
  counter the renderer bumps through one atomic upsert exactly when the
  rendered content hash changed (no counter existed before — ``revision``
  was derived from ``max(updated_at)`` over selection rows, which a vault
  revoke or key rotation never moved: the bug this slice fixes).

Downgrade renames the column back and drops the table (data preservation is
not a constraint).

Revision ID: 189d414c1778
Revises: d9e4b7a2c6f1
Create Date: 2026-08-27 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "189d414c1778"
down_revision: str | Sequence[str] | None = "d9e4b7a2c6f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ACK_TABLE = "agent_auth_delivery_ack"
_SEQUENCE_TABLE = "agent_auth_render_sequence"


def upgrade() -> None:
    op.alter_column(_ACK_TABLE, "acked_revision", new_column_name="acked_sequence")
    op.create_table(
        _SEQUENCE_TABLE,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("surface", sa.Text(), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("fingerprint", sa.Text(), nullable=False),
        sa.Column("rendered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "surface IN ('local', 'cloud')",
            name="ck_agent_auth_render_sequence_surface",
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
            name="uq_agent_auth_render_sequence_scope",
        ),
    )
    op.create_index(
        op.f("ix_agent_auth_render_sequence_user_id"),
        _SEQUENCE_TABLE,
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_agent_auth_render_sequence_user_id"),
        table_name=_SEQUENCE_TABLE,
    )
    op.drop_table(_SEQUENCE_TABLE)
    op.alter_column(_ACK_TABLE, "acked_sequence", new_column_name="acked_revision")
