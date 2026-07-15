"""merge support_report client_release_provided and workflow definitions v1 heads

Revision ID: d6e7f8a9b0c2
Revises: c4d5e6f7a8b0, c5d6e7f8a9b1
Create Date: 2026-07-13 00:00:00.000001

"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "d6e7f8a9b0c2"
down_revision: str | Sequence[str] | None = ("c4d5e6f7a8b0", "c5d6e7f8a9b1")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
