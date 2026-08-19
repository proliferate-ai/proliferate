"""merge launch-options and integration-admission heads

Revision ID: e7a9c2d41f56
Revises: d4e6f8a10235, b32d45e67f89
Create Date: 2026-08-19 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "e7a9c2d41f56"
down_revision: str | Sequence[str] | None = ("d4e6f8a10235", "b32d45e67f89")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
