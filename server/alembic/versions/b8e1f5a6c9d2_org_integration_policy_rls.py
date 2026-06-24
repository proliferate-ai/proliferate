"""enforce organization integration policy RLS

Revision ID: b8e1f5a6c9d2
Revises: b4c5d6e7f8a9
Create Date: 2026-06-23 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b8e1f5a6c9d2"
down_revision: str | Sequence[str] | None = "b4c5d6e7f8a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE_NAME = "cloud_organization_integration_policy"
_POLICY_NAME = "cloud_org_integration_policy_org_rls"
_ORG_ISOLATION_EXPR = """
current_setting('app.owner_scope', true) = 'organization'
AND organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
"""


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table(_TABLE_NAME):
        return

    op.execute(f"ALTER TABLE {_TABLE_NAME} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {_TABLE_NAME} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {_POLICY_NAME} ON {_TABLE_NAME}")
    op.execute(
        f"""
        CREATE POLICY {_POLICY_NAME}
        ON {_TABLE_NAME}
        FOR ALL
        USING ({_ORG_ISOLATION_EXPR})
        WITH CHECK ({_ORG_ISOLATION_EXPR})
        """
    )


def downgrade() -> None:
    if not _has_table(_TABLE_NAME):
        return

    op.execute(f"DROP POLICY IF EXISTS {_POLICY_NAME} ON {_TABLE_NAME}")
    op.execute(f"ALTER TABLE {_TABLE_NAME} NO FORCE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {_TABLE_NAME} DISABLE ROW LEVEL SECURITY")
