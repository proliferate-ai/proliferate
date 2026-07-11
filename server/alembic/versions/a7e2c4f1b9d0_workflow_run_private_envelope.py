"""workflow_run private execution envelope (WS2b secret-free plan)

Revision ID: a7e2c4f1b9d0
Revises: b3d1f5a9c7e2
Create Date: 2026-07-10 18:00:00.000000

WS2b (completion plan §6 WS2, feature spec §5.2/§5.3): the resolved plan becomes
secret-free. The per-run gateway block (plaintext bearer + url + ping_url +
granted namespaces) moves out of ``resolved_plan_json`` into this PRIVATE
envelope column. Ordinary run list/detail/status APIs return only the logical
(secret-free) plan; the envelope is folded into the delivered plan on the cloud
delivery task and the desktop claim/deliver paths only.

ADD-ONLY, nullable — every existing/pre-feature run row validates unchanged.
Forward-only; idempotent-guarded like the rest of the workflow chain so a re-run
against a populated database is a no-op.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7e2c4f1b9d0"
down_revision: str | Sequence[str] | None = "b3d1f5a9c7e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.engine.reflection.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in set(_inspector().get_table_names())


def _has_column(table_name: str, column_name: str) -> bool:
    return column_name in {col["name"] for col in _inspector().get_columns(table_name)}


def upgrade() -> None:
    if _has_table("workflow_run") and not _has_column("workflow_run", "private_envelope_json"):
        op.add_column(
            "workflow_run",
            sa.Column("private_envelope_json", JSONB(), nullable=True),
        )


def downgrade() -> None:
    if _has_table("workflow_run") and _has_column("workflow_run", "private_envelope_json"):
        op.drop_column("workflow_run", "private_envelope_json")
