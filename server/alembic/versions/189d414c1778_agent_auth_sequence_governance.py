"""agent_auth slice 3: sequence governance (acked_sequence + render-sequence row)

The sequence/fingerprint split (agent_auth spec §2 "How delivery is
governed"): the document field ``revision`` becomes ``sequence`` — monotonic
per (user, surface), bumped ONLY by a render whose ``harnesses`` content
changed — and ``fingerprint`` becomes a ``GET /state`` rider hashing the
canonical ``harnesses`` array only.

- ``agent_auth_delivery_ack.acked_revision`` renames to ``acked_sequence``,
  and every existing ack row is DELETED. Preserving those rows would wedge
  the system permanently. The tempting argument for keeping them — "a stale
  stamp is inert until the next content change re-renders, and the applied
  read compares against the CURRENT pair, so it reads pending, never wrong" —
  holds only if the old and new stamps live in the SAME ordered space, and
  they do not. A pre-slice-3 stamp is a
  ms-epoch ``max(updated_at)`` value around 1.75e12; the new counter starts
  at 1 and steps by 1. The store's only-forward predicate
  (``acked_sequence <= incoming``) therefore rejects EVERY ack the new space
  can ever produce, and rejects it SILENTLY — the suppressed upsert returns
  the stored row instead of raising, so the courier believes it acked. With
  no ack ever landing, ``applied`` (ack sequence == current sequence AND ack
  fingerprint == current fingerprint) reads false forever on every account
  that acked before this revision: the precise falsehood §3 flow 1 exists to
  prevent ("a selection reads 'applied' only when the ack carries the current
  sequence and fingerprint").
  DELETE rather than ``SET acked_sequence = 0``: both unwedge the gate (0
  sorts below every live sequence), but an ack row is a RECEIPT that one
  machine applied one document, addressed by the pair — and this revision
  re-bases BOTH coordinates (``fingerprint`` also narrows, from the whole
  canonical document to the canonical ``harnesses`` array). Neither field of
  a preserved row denotes anything in the new space, so zeroing keeps a row
  whose ``acked_fingerprint`` and ``acked_at`` still assert "a machine
  confirmed this content, then" — undecodable, and a trap for any later read
  that compares the fingerprint alone or treats row presence as "this surface
  has a live courier". Deleting states the honest post-governance fact: no
  machine has acknowledged anything in the new sequence space yet. Both
  choices read pending in the interim, which is truthful; deletion also makes
  ``get_delivery_ack`` return ``None``, the case the applied read already
  spells "no ack at all means everything with rows is pending". The courier
  re-acks on its next pass, which is event-driven and fires on app start, so
  the window closes on its own without a backfill.
- New ``agent_auth_render_sequence``: the persisted per-(user, surface)
  counter the renderer bumps through one atomic upsert exactly when the
  rendered content hash changed (no counter existed before — ``revision``
  was derived from ``max(updated_at)`` over selection rows, which a vault
  revoke or key rotation never moved: the bug this slice fixes).

Downgrade renames the column back and drops the table (data preservation is
not a constraint). It cannot resurrect the deleted ms-epoch stamps — that
information is gone, by intent — so a downgraded database holds no acks and
reads everything pending until its couriers ack again.

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
    # Drop every pre-slice-3 receipt. A preserved ms-epoch stamp (~1.75e12)
    # sits permanently above the store's only-forward gate and would suppress
    # every ack the new 1, 2, 3... counter can produce — silently, so nothing
    # retries. See the module docstring for why this is a delete and not a
    # rewrite to 0.
    op.execute(sa.text(f"DELETE FROM {_ACK_TABLE}"))
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
    # Symmetric, and honest about what it cannot do: the ms-epoch stamps
    # upgrade() deleted are unrecoverable, so this arm cannot restore the
    # pre-revision rows — it can only avoid handing the pre-revision code
    # receipts addressed in a sequence space (and a fingerprint domain) it
    # does not speak. Counter-space stamps sort below every ms-epoch revision,
    # so they would not wedge the old gate, but they would still claim a
    # confirmation that no longer decodes; drop them and let the couriers
    # re-ack.
    op.execute(sa.text(f"DELETE FROM {_ACK_TABLE}"))
    op.alter_column(_ACK_TABLE, "acked_sequence", new_column_name="acked_revision")
