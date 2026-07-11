"""workflow credential audiences + per-slot issuance handles (WS3b, spec §5.3)

Revision ID: e5f1a2b3c4d7
Revises: a7e2c4f1b9d0
Create Date: 2026-07-10 21:00:00.000000

WS3b (completion plan §6 WS3, feature spec §5.3/§7.1): typed credential audiences
and per-slot one-use integration-credential issuance.

1. ``cloud_workflow_run_gateway_token``: ADD ``audience`` (NULL = a LEGACY
   all-purpose run token, authenticates everywhere it did pre-migration; a
   non-NULL audience is a new-style token strictly enforced to one endpoint
   family), the session-bound integration binding (``slot_id``, ``session_id``,
   ``generation`` for rotation fencing), and ``issuance_id`` (the one-use handle
   the credential came from). A NULL-permitting CHECK gates the audience vocab.
2. ``workflow_credential_issuance``: NEW — one per-slot one-use issuance handle
   per (run, slot). Only ``handle_hash`` is stored; the plaintext handle rides
   the private envelope and never lands in a row or log.

ADD-ONLY, nullable — every existing/pre-feature run + token row validates
unchanged. Forward-only; idempotent-guarded like the rest of the workflow chain
so a re-run against a populated database is a genuine no-op.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5f1a2b3c4d7"
down_revision: str | Sequence[str] | None = "a7e2c4f1b9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TOKEN_TABLE = "cloud_workflow_run_gateway_token"
_ISSUANCE_TABLE = "workflow_credential_issuance"

_TOKEN_COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("audience", sa.String(length=32)),
    ("slot_id", sa.String(length=64)),
    ("session_id", sa.String(length=255)),
    ("generation", sa.Integer()),
    ("issuance_id", UUID(as_uuid=True)),
)
_TOKEN_AUDIENCE_CHECK = "ck_cloud_workflow_run_gateway_token_audience"


def _inspector() -> sa.engine.reflection.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in set(_inspector().get_table_names())


def _has_column(table_name: str, column_name: str) -> bool:
    return column_name in {col["name"] for col in _inspector().get_columns(table_name)}


def _has_constraint(table_name: str, constraint_name: str) -> bool:
    names = {ck["name"] for ck in _inspector().get_check_constraints(table_name)}
    return constraint_name in names


def upgrade() -> None:
    if _has_table(_TOKEN_TABLE):
        for column_name, column_type in _TOKEN_COLUMNS:
            if not _has_column(_TOKEN_TABLE, column_name):
                op.add_column(_TOKEN_TABLE, sa.Column(column_name, column_type, nullable=True))
        if not _has_constraint(_TOKEN_TABLE, _TOKEN_AUDIENCE_CHECK):
            op.create_check_constraint(
                _TOKEN_AUDIENCE_CHECK,
                _TOKEN_TABLE,
                "audience IS NULL OR audience IN "
                "('integration', 'run_report', 'ping', 'delivery_claim')",
            )

    if not _has_table(_ISSUANCE_TABLE):
        op.create_table(
            _ISSUANCE_TABLE,
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "workflow_run_id",
                UUID(as_uuid=True),
                sa.ForeignKey("workflow_run.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("slot_id", sa.String(length=64), nullable=False),
            sa.Column("handle_hash", sa.String(length=64), nullable=False),
            sa.Column("plan_hash", sa.String(length=80), nullable=True),
            sa.Column("session_id", sa.String(length=255), nullable=True),
            sa.Column("generation", sa.Integer(), nullable=False, server_default=sa.text("1")),
            sa.Column(
                "status", sa.String(length=32), nullable=False, server_default=sa.text("'pending'")
            ),
            sa.Column("integration_token_id", UUID(as_uuid=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.CheckConstraint(
                "status IN ('pending', 'exchanged', 'acknowledged')",
                name="ck_workflow_credential_issuance_status",
            ),
            sa.UniqueConstraint(
                "workflow_run_id",
                "slot_id",
                name="uq_workflow_credential_issuance_run_slot",
            ),
        )
        op.create_index(
            "ix_workflow_credential_issuance_handle_hash",
            _ISSUANCE_TABLE,
            ["handle_hash"],
            unique=True,
        )
        op.create_index(
            "ix_workflow_credential_issuance_run_id",
            _ISSUANCE_TABLE,
            ["workflow_run_id"],
        )


def downgrade() -> None:
    if _has_table(_ISSUANCE_TABLE):
        op.drop_index("ix_workflow_credential_issuance_run_id", table_name=_ISSUANCE_TABLE)
        op.drop_index("ix_workflow_credential_issuance_handle_hash", table_name=_ISSUANCE_TABLE)
        op.drop_table(_ISSUANCE_TABLE)
    if _has_table(_TOKEN_TABLE):
        if _has_constraint(_TOKEN_TABLE, _TOKEN_AUDIENCE_CHECK):
            op.drop_constraint(_TOKEN_AUDIENCE_CHECK, _TOKEN_TABLE, type_="check")
        for column_name, _ in reversed(_TOKEN_COLUMNS):
            if _has_column(_TOKEN_TABLE, column_name):
                op.drop_column(_TOKEN_TABLE, column_name)
