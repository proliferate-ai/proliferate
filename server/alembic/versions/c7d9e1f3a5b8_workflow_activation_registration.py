"""workflow required-invocation activation registration (WS3c, spec §7.3)

Revision ID: c7d9e1f3a5b8
Revises: e5f1a2b3c4d7
Create Date: 2026-07-10 22:30:00.000000

WS3c (completion plan §6 WS3, feature spec §7.3 required invocation receipts):
the runtime-created, non-agent-controlled activation identity a required
invocation registers BEFORE the agent turn starts. ``workflow_gateway_receipt``
(WS2a) already durably records the activation-keyed OUTCOME once the gateway
executes the call; this table is the earlier, separate durable record of the
activation's IDENTITY itself — (run, plan_hash, slot, session, step_key,
attempt, activation_id, capability_key) — so:

* the runtime's registration call is idempotent (same activation_id + same
  identity tuple -> the same row back) and a conflicting reuse of an
  ``activation_id`` under a different identity fails typed at the service
  layer (the ``uq_workflow_activation_id`` constraint is the DB backstop);
* the gateway can authenticate an inbound tool call's trusted activation
  context by looking up the activation's real, runtime-registered identity,
  rather than trusting anything the call itself asserts beyond the bare
  ``activation_id``.

ADD-ONLY, forward-only; idempotent-guarded like the rest of the workflow chain
so a re-run against a populated database is a genuine no-op. No secret ever
lands here (no arguments, headers, or credentials — just identity fields).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7d9e1f3a5b8"
down_revision: str | Sequence[str] | None = "e5f1a2b3c4d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "workflow_activation"


def _inspector() -> sa.engine.reflection.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in set(_inspector().get_table_names())


def upgrade() -> None:
    if _has_table(_TABLE):
        return
    op.create_table(
        _TABLE,
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            UUID(as_uuid=True),
            sa.ForeignKey("workflow_run.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("plan_hash", sa.String(length=80), nullable=False),
        sa.Column("slot_id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=255), nullable=False),
        sa.Column("step_key", sa.String(length=255), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("activation_id", sa.String(length=255), nullable=False),
        sa.Column("capability_key", sa.String(length=255), nullable=False),
        sa.Column("turn_id", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("activation_id", name="uq_workflow_activation_id"),
    )
    op.create_index(
        "ix_workflow_activation_run_id",
        _TABLE,
        ["run_id"],
    )
    op.create_index(
        "ix_workflow_activation_run_step_attempt",
        _TABLE,
        ["run_id", "step_key", "attempt"],
    )


def downgrade() -> None:
    if not _has_table(_TABLE):
        return
    op.drop_index("ix_workflow_activation_run_step_attempt", table_name=_TABLE)
    op.drop_index("ix_workflow_activation_run_id", table_name=_TABLE)
    op.drop_table(_TABLE)
