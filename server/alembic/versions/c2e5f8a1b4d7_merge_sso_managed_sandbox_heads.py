"""merge sso and managed sandbox heads

Revision ID: c2e5f8a1b4d7
Revises: b5c6d7e8f9a0, c1d4e7f8a9b2
Create Date: 2026-06-25 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "c2e5f8a1b4d7"
down_revision: str | Sequence[str] | None = ("b5c6d7e8f9a0", "c1d4e7f8a9b2")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
