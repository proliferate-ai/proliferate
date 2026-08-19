"""merge launch-options and integration-lifecycle heads

Revision ID: d4e6f8a10235
Revises: 19c4e7a2b5d8, a21c34d56e78
Create Date: 2026-08-19 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "d4e6f8a10235"
down_revision: str | Sequence[str] | None = ("19c4e7a2b5d8", "a21c34d56e78")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
