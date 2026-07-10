"""merge billing budget limits and org agent policy native route heads

Revision ID: 75e8009a52c7
Revises: 76c0a297415c, 7c2ab9f4d0e1
Create Date: 2026-07-08 02:14:56.892749

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '75e8009a52c7'
down_revision: Union[str, Sequence[str], None] = ('76c0a297415c', '7c2ab9f4d0e1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
