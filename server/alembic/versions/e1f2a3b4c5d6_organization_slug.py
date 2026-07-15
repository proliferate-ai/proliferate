"""organization slug for per-org SSO login links

Adds a human-friendly, URL-safe ``slug`` to organizations so admins can hand
out ``/login/<slug>`` links that resolve to their org's SSO connection. The
column is nullable with a partial unique index; existing rows are backfilled
from their name.

Revision ID: e1f2a3b4c5d6
Revises: d10c0a11e5ef
Create Date: 2026-07-09 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from proliferate.utils.slug import slugify

# revision identifiers, used by Alembic.
revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, Sequence[str], None] = "d10c0a11e5ef"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("organization", sa.Column("slug", sa.String(length=64), nullable=True))

    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT id, name FROM organization ORDER BY created_at ASC")
    ).fetchall()

    used: set[str] = set()
    for row in rows:
        base = slugify(row.name)
        candidate = base
        suffix = 2
        while candidate in used:
            candidate = f"{base}-{suffix}"
            suffix += 1
        used.add(candidate)
        connection.execute(
            sa.text("UPDATE organization SET slug = :slug WHERE id = :id"),
            {"slug": candidate, "id": row.id},
        )

    op.create_index(
        "ux_organization_slug",
        "organization",
        ["slug"],
        unique=True,
        postgresql_where=sa.text("slug IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_organization_slug", table_name="organization")
    op.drop_column("organization", "slug")
