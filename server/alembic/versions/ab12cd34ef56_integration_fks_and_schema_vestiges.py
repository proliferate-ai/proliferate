"""Integration/worker foreign keys, schema vestige fixes, worker version columns.

- Adds the missing foreign keys across the nine integration/worker tables.
  Intra-domain references default to NO ACTION (RESTRICT semantics) except the
  pure-derivative children (tool schema cache, oauth flow, gateway token) which
  cascade from their account/worker. Cross-domain references mirror the sibling
  cloud models: user/org/sandbox *owners* cascade; pure attribution columns
  (``updated_by_user_id``, ``created_by_user_id``) stay NO ACTION so deleting
  the acting user can never silently drop an org's policy or enrollment row.
- Sweeps pre-existing orphans before creating the FKs: the tables lived FK-less
  until now and the app is known to have produced dangling references (e.g.
  removing an OAuth-connected account never deleted its oauth flows), which
  would otherwise abort every ``ADD CONSTRAINT``.
- Drops the vestigial ``stale`` tool-cache status (writers only ever persist
  ``ready`` or ``error``).
- Makes ``cloud_integration_account.credential_format`` nullable with no
  default: a fresh account has no credentials, so a format claim of
  ``json-v1`` was a lie; ``set_account_credentials`` always supplies the real
  format alongside the ciphertext.
- Adds the worker/anyharness version + host identity columns the worker
  versions work needs on ``cloud_runtime_worker``.

Revision ID: ab12cd34ef56
Revises: d2e3f4a5b6c8
Create Date: 2026-07-02 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "ab12cd34ef56"
down_revision: str | None = "d2e3f4a5b6c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (table, column, remote table, ondelete) — ondelete None means NO ACTION,
# i.e. deleting the parent while children exist raises. Ordered parent-first
# within the domain so the orphan sweep below can rely on it.
_FOREIGN_KEYS: tuple[tuple[str, str, str, str | None], ...] = (
    ("cloud_integration_definition", "organization_id", "organization", "CASCADE"),
    ("cloud_integration_policy", "organization_id", "organization", "CASCADE"),
    ("cloud_integration_policy", "definition_id", "cloud_integration_definition", None),
    # Attribution, not ownership: the policy belongs to the org, so deleting
    # the admin who last toggled it must not drop (and thereby silently
    # re-enable) the org's policy.
    ("cloud_integration_policy", "updated_by_user_id", "user", None),
    ("cloud_integration_account", "definition_id", "cloud_integration_definition", None),
    ("cloud_integration_account", "owner_user_id", "user", "CASCADE"),
    ("cloud_integration_oauth_client", "definition_id", "cloud_integration_definition", None),
    ("cloud_integration_oauth_flow", "account_id", "cloud_integration_account", "CASCADE"),
    ("cloud_integration_oauth_flow", "owner_user_id", "user", "CASCADE"),
    ("cloud_integration_oauth_flow", "definition_id", "cloud_integration_definition", None),
    (
        "cloud_integration_tool_schema_cache",
        "account_id",
        "cloud_integration_account",
        "CASCADE",
    ),
    ("cloud_runtime_worker", "owner_user_id", "user", "CASCADE"),
    ("cloud_runtime_worker", "organization_id", "organization", "CASCADE"),
    ("cloud_runtime_worker", "cloud_sandbox_id", "cloud_sandbox", "CASCADE"),
    ("cloud_runtime_worker_enrollment", "owner_user_id", "user", "CASCADE"),
    ("cloud_runtime_worker_enrollment", "organization_id", "organization", "CASCADE"),
    ("cloud_runtime_worker_enrollment", "cloud_sandbox_id", "cloud_sandbox", "CASCADE"),
    # Attribution, not ownership (see updated_by_user_id above).
    ("cloud_runtime_worker_enrollment", "created_by_user_id", "user", None),
    # A gateway token is a pure derivative of its worker (hash-only row,
    # revoked alongside it); without the cascade a future hard-delete of a
    # cloud_sandbox would cascade to the worker but trip over its tokens.
    ("cloud_integration_gateway_token", "runtime_worker_id", "cloud_runtime_worker", "CASCADE"),
    ("cloud_integration_gateway_token", "owner_user_id", "user", "CASCADE"),
    ("cloud_integration_gateway_token", "organization_id", "organization", "CASCADE"),
)


# Orphaned references whose row stays meaningful without the parent: NULL the
# column instead of deleting the row. Everything else is deleted — either the
# column is NOT NULL, or a CHECK constraint forbids NULLing it
# (org_custom definitions require organization_id, cloud_sandbox workers /
# enrollments require cloud_sandbox_id).
_NULL_ORPHANS: frozenset[tuple[str, str]] = frozenset(
    {
        ("cloud_integration_oauth_flow", "account_id"),
        ("cloud_runtime_worker", "organization_id"),
        ("cloud_runtime_worker_enrollment", "organization_id"),
        ("cloud_integration_gateway_token", "organization_id"),
    }
)


def _fk_name(table: str, column: str) -> str:
    return f"{table}_{column}_fkey"


def upgrade() -> None:
    # These tables lived FK-less until now, so deployed databases hold orphaned
    # references — guaranteed for cloud_integration_oauth_flow.account_id
    # (removing an integration account deleted the account but never its oauth
    # flows), defensively assumed everywhere else. Sweep them first or every
    # ADD CONSTRAINT below aborts the migration. _FOREIGN_KEYS is ordered
    # parent-first, so rows deleted here are caught by their children's sweep.
    for table, column, remote_table, _ondelete in _FOREIGN_KEYS:
        predicate = (
            f'child."{column}" IS NOT NULL AND NOT EXISTS '
            f'(SELECT 1 FROM "{remote_table}" parent WHERE parent.id = child."{column}")'
        )
        if (table, column) in _NULL_ORPHANS:
            op.execute(f'UPDATE "{table}" AS child SET "{column}" = NULL WHERE {predicate}')
        else:
            op.execute(f'DELETE FROM "{table}" AS child WHERE {predicate}')

    # Each ADD CONSTRAINT takes SHARE ROW EXCLUSIVE on child + parent until the
    # migration transaction commits, briefly blocking writes to hot parents
    # (user/organization/cloud_sandbox). Accepted at current row counts; the
    # NOT VALID + VALIDATE split would not help while Alembic runs the whole
    # migration in one transaction (the lock is held to commit either way).
    for table, column, remote_table, ondelete in _FOREIGN_KEYS:
        op.create_foreign_key(
            _fk_name(table, column),
            table,
            remote_table,
            [column],
            ["id"],
            ondelete=ondelete,
        )

    # Tool cache status: nothing writes 'stale' (staleness is derived from the
    # auth_version snapshot + fetched_at age), so the state goes away.
    op.execute(
        "UPDATE cloud_integration_tool_schema_cache SET status = 'error' WHERE status = 'stale'"
    )
    op.drop_constraint(
        "ck_cloud_integration_tool_schema_cache_status",
        "cloud_integration_tool_schema_cache",
        type_="check",
    )
    op.create_check_constraint(
        "ck_cloud_integration_tool_schema_cache_status",
        "cloud_integration_tool_schema_cache",
        "status IN ('ready', 'error')",
    )

    # credential_format is only meaningful next to a ciphertext; accounts that
    # have not stored credentials carry NULL instead of a bogus 'json-v1'.
    # Drop NOT NULL FIRST — the backfill UPDATE writes NULLs.
    op.alter_column(
        "cloud_integration_account",
        "credential_format",
        existing_type=sa.String(length=64),
        nullable=True,
    )
    op.execute(
        "UPDATE cloud_integration_account "
        "SET credential_format = NULL WHERE credential_ciphertext IS NULL"
    )

    op.add_column(
        "cloud_runtime_worker",
        sa.Column("worker_version", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "cloud_runtime_worker",
        sa.Column("anyharness_version", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "cloud_runtime_worker",
        sa.Column("hostname", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "cloud_runtime_worker",
        sa.Column("machine_fingerprint", sa.String(length=128), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cloud_runtime_worker", "machine_fingerprint")
    op.drop_column("cloud_runtime_worker", "hostname")
    op.drop_column("cloud_runtime_worker", "anyharness_version")
    op.drop_column("cloud_runtime_worker", "worker_version")

    op.execute(
        "UPDATE cloud_integration_account "
        "SET credential_format = 'json-v1' WHERE credential_format IS NULL"
    )
    op.alter_column(
        "cloud_integration_account",
        "credential_format",
        existing_type=sa.String(length=64),
        nullable=False,
    )

    op.drop_constraint(
        "ck_cloud_integration_tool_schema_cache_status",
        "cloud_integration_tool_schema_cache",
        type_="check",
    )
    op.create_check_constraint(
        "ck_cloud_integration_tool_schema_cache_status",
        "cloud_integration_tool_schema_cache",
        "status IN ('ready', 'stale', 'error')",
    )

    for table, column, _remote_table, _ondelete in reversed(_FOREIGN_KEYS):
        op.drop_constraint(_fk_name(table, column), table, type_="foreignkey")
