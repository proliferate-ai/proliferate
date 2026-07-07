"""local merge for integration run

Revision ID: 3600456201a0
Revises: bcc0459a6f11, d4bbfa6e0669
Create Date: 2026-07-06 23:22:11.799396

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3600456201a0'
down_revision: Union[str, Sequence[str], None] = ('bcc0459a6f11', 'd4bbfa6e0669')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
