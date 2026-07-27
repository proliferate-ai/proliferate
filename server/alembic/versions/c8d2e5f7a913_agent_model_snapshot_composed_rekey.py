"""agent_model_snapshot (harness, context, owner) -> (harness, owner) re-key (B-3)

The composed-observation re-cut of the cloud snapshot store, per
model-catalog.md §The cloud copy / §Storage:

- ``auth_context_id`` DROPS: the per-context re-key is superseded — one
  composed observation per harness, keyed (harness_kind, owner_user_id). The
  spec is explicit that there is no ``authContextId``, no ``authFingerprint``
  and no per-context anything: each was a door back to context-division.
- the scope index re-cuts to ``(harness_kind, owner_user_id, probed_at)``,
  still with **no unique key on the scope** — soft-versioning is kept as-is,
  so a racing duplicate upload stays a benign extra row the next write
  collapses rather than a 500 the fire-and-forget Worker tick cannot act on.
- ``snapshot_json`` now holds the whole schemaVersion-2 machine document
  (validated at ingest); no column change — the payload was already Text.

Data disposition — every pre-existing row is marked ``inactive``, not dropped
and not transformed:

- the rows are context-keyed v1 entries (per-context payloads carrying
  ``authFingerprint``), and no single context's entry IS the composed
  observation — promoting one would present a slice of the auth world as the
  whole menu, which is exactly the fiction the re-cut deletes;
- they are derived state: the runtime re-probes under the event model and the
  Worker uploads a fresh composed document, while the layered read serves the
  shipped catalog's models in the gap — no surface renders an empty picker;
- retiring them (rather than deleting) keeps the soft-versioned audit trail
  the spec names as the reason inactive rows exist at all. Their
  ``snapshot_json`` still records what was observed, even though the
  column that keyed them is gone.

Downgrade deletes all rows: a composed document cannot be projected back onto
a per-context scope without inventing a context (the same impossibility, in
reverse, that made the B4 migration drop rather than map), and the restored
``auth_context_id`` column is NOT NULL so the retired context-keyed rows —
whose context id the upgrade discarded — cannot be resurrected either.

Revision ID: c8d2e5f7a913
Revises: ab5316095737
Create Date: 2026-07-27 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c8d2e5f7a913"
down_revision: str | Sequence[str] | None = "ab5316095737"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent_model_snapshot"
_SCOPE_INDEX = f"ix_{_TABLE}_scope"


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _columns() -> set[str]:
    return {column["name"] for column in _inspector().get_columns(_TABLE)}


def _indexes() -> set[str]:
    return {index["name"] for index in _inspector().get_indexes(_TABLE) if index["name"]}


def upgrade() -> None:
    if "auth_context_id" not in _columns():
        return

    # Retire every context-keyed row before the column that keyed it goes.
    # Reads filter on status = 'active', so from this statement on the layered
    # read serves the shipped seed until the first composed upload lands.
    op.execute(sa.text(f"UPDATE {_TABLE} SET status = 'inactive' WHERE status = 'active'"))

    # Explicit drop rather than relying on DROP COLUMN cascading to the index:
    # the replacement index reuses the name, so the old one must be gone first.
    if _SCOPE_INDEX in _indexes():
        op.drop_index(_SCOPE_INDEX, table_name=_TABLE)
    op.drop_column(_TABLE, "auth_context_id")
    op.create_index(
        _SCOPE_INDEX,
        _TABLE,
        ["harness_kind", "owner_user_id", "probed_at"],
    )


def downgrade() -> None:
    if "auth_context_id" in _columns():
        return

    # Composed documents cannot be attributed to a context, and the retired
    # v1 rows lost their context id on the way up — see the module docstring.
    op.execute(sa.text(f"DELETE FROM {_TABLE}"))

    if _SCOPE_INDEX in _indexes():
        op.drop_index(_SCOPE_INDEX, table_name=_TABLE)
    op.add_column(
        _TABLE,
        sa.Column("auth_context_id", sa.String(length=64), nullable=False),
    )
    op.create_index(
        _SCOPE_INDEX,
        _TABLE,
        ["harness_kind", "auth_context_id", "owner_user_id", "probed_at"],
    )
