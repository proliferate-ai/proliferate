"""merge support-report and workflow-definitions heads

Revision ID: dbf7f8e64a52
Revises: c4d5e6f7a8b0, c5d6e7f8a9b1
Create Date: 2026-07-13 14:20:47.941004

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dbf7f8e64a52'
down_revision: Union[str, Sequence[str], None] = ('c4d5e6f7a8b0', 'c5d6e7f8a9b1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
