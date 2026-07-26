"""agent_catalog_snapshot -> agent_model_snapshot re-key (B4)

Re-keys the cloud snapshot store from coarse route to auth context, per
model-catalog.md §Storage:

- table rename ``agent_catalog_snapshot`` -> ``agent_model_snapshot``
- ``route`` -> ``auth_context_id`` (catalog auth-context ids: 'anthropic-api',
  'gateway', 'baseline', …)
- ``models_json`` -> ``snapshot_json`` (one machine-document entry verbatim,
  not a models-only array)
- ``surface`` and ``source`` DROP: only the cloud sandbox's document ever syncs,
  and every row is a machine's observation — the server never generates one
- ``owner_user_id`` becomes NOT NULL, because there is no ownerless seed row any
  more; the seed tier is a read-time fallback to the served shipped catalog
- new scope ``(harness_kind, auth_context_id, owner_user_id)``, with no unique
  key on it: the soft-versioning discipline is kept as-is per the spec, so a
  racing duplicate upload is a benign extra row the next write collapses rather
  than a 500 the fire-and-forget Worker tick cannot act on

Data disposition — every pre-existing row is DROPPED, deliberately:

- ownerless seed rows have no successor concept (they are what the read-time
  fallback replaces), so they cannot be mapped;
- owned rows carry a coarse ``route`` ('native' | 'api_key' | 'gateway') and a
  models-only ``models_json``. Two things make a faithful mapping impossible
  rather than merely lossy. First, ``route`` is not an auth context: 'native'
  and 'api_key' each fan out to several catalog contexts per harness
  (claude's 'native' covers 'anthropic-oauth', its 'api_key' covers both
  'anthropic-api' and 'bedrock'), so any single target id would be a guess about
  which credential the observation actually ran under — and the whole point of
  the re-key is that the context is the identity. Second, the payload shape
  changed: an entry needs ``probedAt``, ``mechanism``, ``attestation`` and
  ``authFingerprint``, and a models-only array carries no attestation or
  fingerprint, so the migrated row would be permanently stale-indeterminate and
  could never be invalidated correctly.

  Only 'gateway' has a 1:1 route→context name, and those rows are exactly the
  ones the deleted server-side prober produced — i.e. not machine observations
  at all, which is the invariant the new table asserts.

  The cost of dropping is one probe: the runtime's reconciler re-probes any
  (harness, context) with no fresh entry, and the layered read serves shipped
  catalog models in the meantime, so no surface renders an empty picker.

Downgrade recreates the pre-B4 shape (all columns, nullable owner, the three
check constraints, both indexes) and is likewise empty of data.

Revision ID: b7c1e4d9f082
Revises: 28adf1a9e376
Create Date: 2026-07-26 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b7c1e4d9f082"
down_revision: str | Sequence[str] | None = "28adf1a9e376"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_TABLE = "agent_catalog_snapshot"
_NEW_TABLE = "agent_model_snapshot"


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _check_constraints(table_name: str) -> set[str]:
    return {
        constraint["name"]
        for constraint in _inspector().get_check_constraints(table_name)
        if constraint["name"]
    }


def _indexes(table_name: str) -> set[str]:
    return {index["name"] for index in _inspector().get_indexes(table_name) if index["name"]}


def upgrade() -> None:
    if _has_table(_NEW_TABLE):
        return
    if not _has_table(_OLD_TABLE):
        # A database provisioned after this revision (or one where the pre-B4
        # table never existed) gets the target shape built directly.
        _create_new_table()
        return

    # Drop every pre-existing row before the shape changes. This has to precede
    # the NOT NULL on owner_user_id (ownerless seed rows would fail it) and it is
    # what makes the whole migration safe to run on a live database: nothing is
    # being reinterpreted, so no row can be silently mis-attributed to a context
    # it was not observed under. See the module docstring for why mapping is not
    # merely lossy but impossible.
    op.execute(sa.text(f"DELETE FROM {_OLD_TABLE}"))

    for name in (
        f"ck_{_OLD_TABLE}_surface",
        f"ck_{_OLD_TABLE}_route",
        f"ck_{_OLD_TABLE}_source",
    ):
        if name in _check_constraints(_OLD_TABLE):
            op.drop_constraint(name, _OLD_TABLE, type_="check")

    if f"ix_{_OLD_TABLE}_scope" in _indexes(_OLD_TABLE):
        op.drop_index(f"ix_{_OLD_TABLE}_scope", table_name=_OLD_TABLE)
    if f"ix_{_OLD_TABLE}_owner_user_id" in _indexes(_OLD_TABLE):
        op.drop_index(f"ix_{_OLD_TABLE}_owner_user_id", table_name=_OLD_TABLE)

    op.drop_column(_OLD_TABLE, "surface")
    op.drop_column(_OLD_TABLE, "source")
    op.alter_column(_OLD_TABLE, "route", new_column_name="auth_context_id")
    op.alter_column(
        _OLD_TABLE,
        "auth_context_id",
        type_=sa.String(length=64),
        existing_type=sa.String(length=16),
        existing_nullable=False,
    )
    op.alter_column(_OLD_TABLE, "models_json", new_column_name="snapshot_json")
    op.alter_column(_OLD_TABLE, "owner_user_id", nullable=False, existing_type=sa.Uuid())

    op.rename_table(_OLD_TABLE, _NEW_TABLE)

    op.create_check_constraint(
        f"ck_{_NEW_TABLE}_status",
        _NEW_TABLE,
        "status IN ('active', 'inactive')",
    )
    _create_new_indexes()


def _create_new_table() -> None:
    op.create_table(
        _NEW_TABLE,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("harness_kind", sa.String(length=64), nullable=False),
        sa.Column("auth_context_id", sa.String(length=64), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("snapshot_json", sa.Text(), nullable=False),
        sa.Column("probed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'inactive')",
            name=f"ck_{_NEW_TABLE}_status",
        ),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_new_indexes()


def _create_new_indexes() -> None:
    op.create_index(
        f"ix_{_NEW_TABLE}_owner_user_id",
        _NEW_TABLE,
        ["owner_user_id"],
    )
    op.create_index(
        f"ix_{_NEW_TABLE}_scope",
        _NEW_TABLE,
        ["harness_kind", "auth_context_id", "owner_user_id", "probed_at"],
    )


def downgrade() -> None:
    if not _has_table(_NEW_TABLE):
        return

    # Symmetric with the upgrade: entries cannot be projected back onto a coarse
    # route + models-only payload without inventing a route, so the rows go.
    op.execute(sa.text(f"DELETE FROM {_NEW_TABLE}"))

    for name in (
        f"ix_{_NEW_TABLE}_scope",
        f"ix_{_NEW_TABLE}_owner_user_id",
    ):
        if name in _indexes(_NEW_TABLE):
            op.drop_index(name, table_name=_NEW_TABLE)
    if f"ck_{_NEW_TABLE}_status" in _check_constraints(_NEW_TABLE):
        op.drop_constraint(f"ck_{_NEW_TABLE}_status", _NEW_TABLE, type_="check")

    op.rename_table(_NEW_TABLE, _OLD_TABLE)

    op.alter_column(_OLD_TABLE, "snapshot_json", new_column_name="models_json")
    op.alter_column(_OLD_TABLE, "owner_user_id", nullable=True, existing_type=sa.Uuid())
    op.alter_column(
        _OLD_TABLE,
        "auth_context_id",
        type_=sa.String(length=16),
        existing_type=sa.String(length=64),
        existing_nullable=False,
    )
    op.alter_column(_OLD_TABLE, "auth_context_id", new_column_name="route")
    op.add_column(
        _OLD_TABLE,
        sa.Column("surface", sa.String(length=16), nullable=False, server_default="cloud"),
    )
    op.add_column(
        _OLD_TABLE,
        sa.Column("source", sa.String(length=16), nullable=False, server_default="probe"),
    )
    op.alter_column(_OLD_TABLE, "surface", server_default=None)
    op.alter_column(_OLD_TABLE, "source", server_default=None)

    op.create_check_constraint(
        f"ck_{_OLD_TABLE}_surface",
        _OLD_TABLE,
        "surface IN ('local', 'cloud')",
    )
    op.create_check_constraint(
        f"ck_{_OLD_TABLE}_route",
        _OLD_TABLE,
        "route IN ('native', 'api_key', 'gateway')",
    )
    op.create_check_constraint(
        f"ck_{_OLD_TABLE}_source",
        _OLD_TABLE,
        "source IN ('probe', 'seed', 'override', 'runtime-mirror')",
    )
    op.create_index(
        f"ix_{_OLD_TABLE}_owner_user_id",
        _OLD_TABLE,
        ["owner_user_id"],
    )
    op.create_index(
        f"ix_{_OLD_TABLE}_scope",
        _OLD_TABLE,
        ["harness_kind", "surface", "route", "owner_user_id", "probed_at"],
    )
