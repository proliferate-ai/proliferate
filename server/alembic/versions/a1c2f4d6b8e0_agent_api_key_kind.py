"""agent_api_key gains a kind column (D1: typed provider-config foundations)

agent-auth.md's vault ("The vault"): a typed provider configuration is not a
separate table and not multiple rows — it is one ``agent_api_key`` row whose
``kind`` says how to interpret the encrypted payload. Adds the column that
closes the "no ``kind`` column" half of the agent-auth.md Current-gaps bullet
"Typed provider configurations do not exist."

- ``kind`` (text, NOT NULL, default/backfill ``'api_key'``): every row created
  before this migration is the pre-existing bare-secret shape, which is
  exactly what ``'api_key'`` means, so backfilling every existing row to it is
  lossless — there is no typed data to migrate because typed rows could not
  exist before this column did.
- CHECK ``kind IN ('api_key', 'aws_bedrock', 'azure_openai')`` — the closed
  vocabulary of storable vault-entry shapes (constants.agent_gateway's
  ``AGENT_API_KEY_KINDS``). Which harness may pick which typed kind is a
  registry declaration (registry.json's ``providerConfig``), not a DB
  constraint.

Chained on B4's migration head (b7c1e4d9f082, agent_model_snapshot re-key) per
the alembic-heads collision corridor (agents-impl-plan.md §3: B2 -> B4 -> D1).

Revision ID: a1c2f4d6b8e0
Revises: b7c1e4d9f082
Create Date: 2026-07-26 13:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a1c2f4d6b8e0"
down_revision: str | Sequence[str] | None = "b7c1e4d9f082"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent_api_key"
_CONSTRAINT = "ck_agent_api_key_kind"


def _has_column(table_name: str, column_name: str) -> bool:
    return column_name in {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)
    }


def upgrade() -> None:
    if not _has_column(_TABLE, "kind"):
        op.add_column(
            _TABLE,
            sa.Column(
                "kind",
                sa.Text(),
                nullable=False,
                server_default="api_key",
            ),
        )
        op.create_check_constraint(
            _CONSTRAINT,
            _TABLE,
            "kind IN ('api_key', 'aws_bedrock', 'azure_openai')",
        )


def downgrade() -> None:
    if _has_column(_TABLE, "kind"):
        op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
        op.drop_column(_TABLE, "kind")
