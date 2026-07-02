"""user token generation

Adds a monotonic ``token_generation`` counter to the ``user`` table. Every
issued access and refresh token embeds the value current at mint time; a
mismatch on use means the token predates a logout or password change and is
rejected. Bumping the counter is the server-side session-revocation primitive.

Revision ID: c3f7a1e9d2b4
Revises: 9d9e27c9298b
Create Date: 2026-07-02 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3f7a1e9d2b4"
down_revision: str | Sequence[str] | None = "9d9e27c9298b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_column("user", "token_generation"):
        op.add_column(
            "user",
            sa.Column(
                "token_generation",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
        )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_column("user", "token_generation"):
        op.drop_column("user", "token_generation")
