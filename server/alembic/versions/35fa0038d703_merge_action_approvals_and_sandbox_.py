"""merge action approvals and sandbox recovery heads

Revision ID: 35fa0038d703
Revises: f1c2d3e4a5b6, f2c4a6e8b0d1
Create Date: 2026-07-17 18:24:47.325458

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '35fa0038d703'
down_revision: Union[str, Sequence[str], None] = ('f1c2d3e4a5b6', 'f2c4a6e8b0d1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
