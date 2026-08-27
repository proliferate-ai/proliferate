"""Retire the env-passthrough selection form (agent_auth slice 6, lane A).

The retired shape: an ``api_key`` selection row that names an env var without
referencing a vault entry (``env_var_name`` set, ``api_key_id`` NULL) — "use
whatever value the machine's own environment holds for that name". Ruled
deleted in the agent_auth spec rewrite (decision "Does env-var passthrough
survive as a method?"): the key goes in the vault like everyone else's, and
the recipes and method picker collapse to exactly three cases.

Plain words for anyone who had one: a selection that pointed at your
machine's own environment variable no longer launches anything — save the
key itself in Settings → Agents and select it there. The machine's value
never reached a routed launch anyway; only the vault's did.

Production carried ZERO such rows at the read-only audit of 2026-08-27 (98
selection rows, every ``api_key`` row vault-backed), and the
``ck_agent_auth_selection_api_key_shape`` CHECK has forbidden the shape since
the 2026-07-02 selection rebuild — so on the hosted database the DELETE is a
proven no-op. The migration's teeth are for drifted databases (self-hosted
installs whose constraint was dropped or that predate the rebuild's CHECK):
it deletes any surviving rows and re-asserts the CHECK so the shape is
unstorable everywhere after this revision.

Revision ID: b3d5f7a9c1e3
Revises: f2a3b4c5d6e7
Create Date: 2026-08-27 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b3d5f7a9c1e3"
down_revision: str | None = "f2a3b4c5d6e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent_auth_selection"
_CONSTRAINT = "ck_agent_auth_selection_api_key_shape"
_CHECK = "source_kind != 'api_key' OR api_key_id IS NOT NULL"


def _has_check_constraint() -> bool:
    inspector = sa.inspect(op.get_bind())
    return _CONSTRAINT in {
        constraint["name"] for constraint in inspector.get_check_constraints(_TABLE)
    }


def upgrade() -> None:
    # Delete any env-passthrough rows a drifted database still holds. On the
    # hosted database this deletes nothing (see the audit in the docstring).
    op.execute(
        f"DELETE FROM {_TABLE} WHERE source_kind = 'api_key' AND api_key_id IS NULL"
    )
    # Re-assert the CHECK so the shape is unstorable from here on, including
    # on databases where the constraint went missing.
    if not _has_check_constraint():
        op.create_check_constraint(_CONSTRAINT, _TABLE, _CHECK)


def downgrade() -> None:
    # The deleted rows are unrecoverable (data preservation is not a
    # constraint for this shape: the rows never produced a working launch).
    # The CHECK predates this revision, so it stays — a downgrade that passes
    # through this revision keeps working for the migration suite.
    pass
