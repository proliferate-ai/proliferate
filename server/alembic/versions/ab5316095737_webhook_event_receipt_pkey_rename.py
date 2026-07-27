"""webhook event receipt pkey rename

Revision ID: ab5316095737
Revises: 35fa0038d703
Create Date: 2026-07-26 00:00:00.000000

``9a0b1c2d3e4f_stripe_cloud_billing_foundation.py`` renamed
``sandbox_event_receipt`` to ``webhook_event_receipt`` via ``op.rename_table``,
which renames only the table. Postgres left the PRIMARY KEY constraint (and its
backing index, since Postgres keeps the two names identical) on
``sandbox_event_receipt_pkey``. A database that ran that migration therefore
diverges from ``Base.metadata.create_all``, which names the constraint
``webhook_event_receipt_pkey`` on a fresh install — forever, since nothing
after 9a0b1c2d3e4f touched it.

This is the same bug class B4 (``b7c1e4d9f082_agent_model_snapshot_rekey.py``)
fixed for its own rename, and this migration follows that precedent: rename
the constraint under its old name if present, do nothing if the name is
already correct (fresh create_all, or a database that already ran this
migration), and never touch a database that already has the new name.

No FOREIGN KEY constraint exists on this table (no FK-typed columns), and
``id`` has no server-side sequence (UUID default generated client-side), so
the PRIMARY KEY is the only artifact the table rename left behind.

Downgrade renames the constraint back, which is symmetric with the pre-B4-fix
downgrade in 9a0b1c2d3e4f (that downgrade path recreates
``sandbox_event_receipt`` and its ``_pkey`` from scratch via
``op.rename_table``, so this migration's downgrade only has work to do when
run against a database still on ``webhook_event_receipt``).

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ab5316095737"
down_revision: str | Sequence[str] | None = "a1c2f4d6b8e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "webhook_event_receipt"
_OLD_PKEY = "sandbox_event_receipt_pkey"
_NEW_PKEY = "webhook_event_receipt_pkey"


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _pkey_name(table_name: str) -> str | None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    name = inspector.get_pk_constraint(table_name).get("name")
    return str(name) if name else None


def _rename_pkey(table_name: str, old_name: str, new_name: str) -> None:
    """Rename the PRIMARY KEY constraint when it is present under ``old_name``.

    Postgres has no ``RENAME CONSTRAINT IF EXISTS``, hence the inspector check
    first. A no-op when the table is missing (downgrade ran past this table
    already), when the constraint is already named ``new_name`` (fresh
    create_all, or this migration already ran), or when it carries neither
    name (unexpected shape — left alone rather than guessed at).

    Renaming the PRIMARY KEY constraint also renames its backing index, since
    Postgres keeps the two names identical — no separate ``ALTER INDEX`` is
    issued, since one would fail on a name that no longer exists.
    """
    if not _has_table(table_name):
        return
    current = _pkey_name(table_name)
    if current != old_name:
        return
    op.execute(sa.text(f'ALTER TABLE {table_name} RENAME CONSTRAINT "{old_name}" TO "{new_name}"'))


def upgrade() -> None:
    """Upgrade schema."""
    _rename_pkey(_TABLE, _OLD_PKEY, _NEW_PKEY)


def downgrade() -> None:
    """Downgrade schema."""
    _rename_pkey(_TABLE, _NEW_PKEY, _OLD_PKEY)
