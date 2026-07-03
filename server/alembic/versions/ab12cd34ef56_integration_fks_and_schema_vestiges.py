"""Integration/worker foreign keys, schema vestige fixes, worker version columns.

- Adds the missing foreign keys across the nine integration/worker tables.
  Intra-domain references default to NO ACTION (RESTRICT semantics) except the
  two pure-derivative children (tool schema cache, oauth flow) which cascade
  from their account. Cross-domain references mirror the sibling cloud models:
  user/org/sandbox owners cascade.
- Drops the vestigial ``stale`` tool-cache status (writers only ever persist
  ``ready`` or ``error``).
- Makes ``cloud_integration_account.credential_format`` nullable with no
  default: a fresh account has no credentials, so a format claim of
  ``json-v1`` was a lie; ``set_account_credentials`` always supplies the real
  format alongside the ciphertext.
- Adds the worker/anyharness version + host identity columns the worker
  versions work needs on ``cloud_runtime_worker``.

Revision ID: ab12cd34ef56
Revises: c3f7a1e9d2b4
Create Date: 2026-07-02 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "ab12cd34ef56"
down_revision: str | None = "c3f7a1e9d2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (table, column, remote table, ondelete) — ondelete None means NO ACTION,
# i.e. deleting the parent while children exist raises.
_FOREIGN_KEYS: tuple[tuple[str, str, str, str | None], ...] = (
    ("cloud_integration_definition", "organization_id", "organization", "CASCADE"),
    ("cloud_integration_policy", "organization_id", "organization", "CASCADE"),
    ("cloud_integration_policy", "definition_id", "cloud_integration_definition", None),
    ("cloud_integration_policy", "updated_by_user_id", "user", "CASCADE"),
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
    ("cloud_runtime_worker_enrollment", "created_by_user_id", "user", "CASCADE"),
    ("cloud_integration_gateway_token", "runtime_worker_id", "cloud_runtime_worker", None),
    ("cloud_integration_gateway_token", "owner_user_id", "user", "CASCADE"),
    ("cloud_integration_gateway_token", "organization_id", "organization", "CASCADE"),
)


def _fk_name(table: str, column: str) -> str:
    return f"{table}_{column}_fkey"


def upgrade() -> None:
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
