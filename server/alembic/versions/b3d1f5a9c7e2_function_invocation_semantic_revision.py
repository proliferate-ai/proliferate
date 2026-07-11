"""function invocation semantic_revision (WS3a exact grants)

Revision ID: b3d1f5a9c7e2
Revises: d9578c0275f3
Create Date: 2026-07-10 15:00:00.000000

WS3a (completion plan §6, feature spec §7.2): a workflow run freezes the exact
``CapabilityRef`` per slot at StartRun. A function-invocation capability is
identified by ``(definition_id, semantic_revision)``. This adds the monotonic
``semantic_revision`` counter to ``function_invocation_definition`` — it bumps on
any SEMANTIC edit (endpoint/method/mapping/schema/header names/templates/status/
redirect/idempotency) but NOT on a secret-value-only header rotation behind the
same binding identity.

ADD-ONLY, NOT NULL with ``server_default = 1`` so every existing row backfills to
revision 1 without a data migration. Forward-only; idempotent-guarded like the
rest of the workflow chain so a re-run against a populated database is a no-op.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3d1f5a9c7e2"
down_revision: str | Sequence[str] | None = "d9578c0275f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.engine.reflection.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in set(_inspector().get_table_names())


def _has_column(table_name: str, column_name: str) -> bool:
    return column_name in {col["name"] for col in _inspector().get_columns(table_name)}


def upgrade() -> None:
    if _has_table("function_invocation_definition") and not _has_column(
        "function_invocation_definition", "semantic_revision"
    ):
        op.add_column(
            "function_invocation_definition",
            sa.Column(
                "semantic_revision",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("1"),
            ),
        )


def downgrade() -> None:
    if _has_table("function_invocation_definition") and _has_column(
        "function_invocation_definition", "semantic_revision"
    ):
        op.drop_column("function_invocation_definition", "semantic_revision")
