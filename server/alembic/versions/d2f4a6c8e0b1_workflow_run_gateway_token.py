"""workflow run gateway token + two-layer function scope + sandbox purpose

Revision ID: d2f4a6c8e0b1
Revises: f1c3d5b7a9e2
Create Date: 2026-07-08 00:00:00.000000

PR E (spec 6 / L16, L22, L25, L26):

* ``cloud_workflow_run_gateway_token`` — one per run, hashed token, frozen
  function scope (§6.4/OPEN-3a). status active|expired|revoked.
* L25 layer 1: additive nullable ``scope_json`` on
  ``cloud_integration_gateway_token`` (provider-namespace allowlist; NULL =
  unscoped = today's behavior, never conflated with empty; no backfill).
* L25 admin: nullable ``scope_json`` on ``cloud_integration_policy`` (extend the
  existing per-org policy row, not a parallel table).
* L26: ``purpose`` on ``cloud_sandbox`` (CHECK interactive|workflow-run, NOT NULL
  server_default 'interactive' — existing rows are interactive).

All idempotent-guarded like the rest of the stack.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2f4a6c8e0b1"
down_revision: str | Sequence[str] | None = "f1c3d5b7a9e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {col["name"] for col in inspector.get_columns(table_name)}


def upgrade() -> None:
    # (a) the per-run gateway token table.
    if not _has_table("cloud_workflow_run_gateway_token"):
        op.create_table(
            "cloud_workflow_run_gateway_token",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("workflow_run_id", sa.Uuid(), nullable=False),
            sa.Column("owner_user_id", sa.Uuid(), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("scope_json", JSONB(), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "status IN ('active', 'expired', 'revoked')",
                name="ck_cloud_workflow_run_gateway_token_status",
            ),
            sa.ForeignKeyConstraint(
                ["workflow_run_id"], ["workflow_run.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "token_hash", name="uq_cloud_workflow_run_gateway_token_hash"
            ),
        )
    if not _has_index(
        "cloud_workflow_run_gateway_token", "ix_cloud_workflow_run_gateway_token_run_id"
    ):
        op.create_index(
            "ix_cloud_workflow_run_gateway_token_run_id",
            "cloud_workflow_run_gateway_token",
            ["workflow_run_id"],
        )
    if not _has_index(
        "cloud_workflow_run_gateway_token", "ix_cloud_workflow_run_gateway_token_hash"
    ):
        op.create_index(
            "ix_cloud_workflow_run_gateway_token_hash",
            "cloud_workflow_run_gateway_token",
            ["token_hash"],
        )
    if not _has_index(
        "cloud_workflow_run_gateway_token", "ix_cloud_workflow_run_gateway_token_owner_user_id"
    ):
        op.create_index(
            "ix_cloud_workflow_run_gateway_token_owner_user_id",
            "cloud_workflow_run_gateway_token",
            ["owner_user_id"],
        )
    if not _has_index(
        "cloud_workflow_run_gateway_token",
        "ix_cloud_workflow_run_gateway_token_organization_id",
    ):
        op.create_index(
            "ix_cloud_workflow_run_gateway_token_organization_id",
            "cloud_workflow_run_gateway_token",
            ["organization_id"],
        )

    # (b) L25 layer 1: worker-level allowlist (NULL = unscoped, no backfill).
    if not _has_column("cloud_integration_gateway_token", "scope_json"):
        op.add_column(
            "cloud_integration_gateway_token",
            sa.Column("scope_json", JSONB(), nullable=True),
        )

    # (c) L25 admin: org-policy scope key (nullable; extend, don't parallel-table).
    if not _has_column("cloud_integration_policy", "scope_json"):
        op.add_column(
            "cloud_integration_policy",
            sa.Column("scope_json", JSONB(), nullable=True),
        )

    # (d) L26: sandbox purpose, NOT NULL server_default 'interactive'.
    if not _has_column("cloud_sandbox", "purpose"):
        op.add_column(
            "cloud_sandbox",
            sa.Column(
                "purpose",
                sa.String(length=32),
                nullable=False,
                server_default="interactive",
            ),
        )
        op.create_check_constraint(
            "ck_cloud_sandbox_purpose",
            "cloud_sandbox",
            "purpose IN ('interactive', 'workflow-run')",
        )


def downgrade() -> None:
    if _has_column("cloud_sandbox", "purpose"):
        op.drop_constraint("ck_cloud_sandbox_purpose", "cloud_sandbox", type_="check")
        op.drop_column("cloud_sandbox", "purpose")
    if _has_column("cloud_integration_policy", "scope_json"):
        op.drop_column("cloud_integration_policy", "scope_json")
    if _has_column("cloud_integration_gateway_token", "scope_json"):
        op.drop_column("cloud_integration_gateway_token", "scope_json")
    if _has_table("cloud_workflow_run_gateway_token"):
        for index_name in (
            "ix_cloud_workflow_run_gateway_token_organization_id",
            "ix_cloud_workflow_run_gateway_token_owner_user_id",
            "ix_cloud_workflow_run_gateway_token_hash",
            "ix_cloud_workflow_run_gateway_token_run_id",
        ):
            if _has_index("cloud_workflow_run_gateway_token", index_name):
                op.drop_index(index_name, table_name="cloud_workflow_run_gateway_token")
        op.drop_table("cloud_workflow_run_gateway_token")
