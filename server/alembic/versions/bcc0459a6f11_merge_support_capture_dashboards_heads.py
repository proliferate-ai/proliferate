"""merge support capture + dashboards heads

Revision ID: bcc0459a6f11
Revises: c7f2a9b41d38, 15649bf2cf24
Create Date: 2026-07-06 14:59:44.975527

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bcc0459a6f11'
down_revision: Union[str, Sequence[str], None] = ('c7f2a9b41d38', '15649bf2cf24')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
