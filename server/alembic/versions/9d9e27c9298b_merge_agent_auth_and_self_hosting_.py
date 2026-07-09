"""Merge the agent-auth and self-hosting migration heads.

Three PR stacks landed migrations on main in parallel (instance setup token,
LLM credit grants, agent-auth route selection slot), leaving multiple alembic
heads. No schema changes; this only rejoins the history so `upgrade head`
resolves again.

Revision ID: 9d9e27c9298b
Revises: b2f4d6a8c0e1, b8d1e2f3a4c5, e5f6a7b8c9d0
Create Date: 2026-07-02
"""

from collections.abc import Sequence

revision: str = "9d9e27c9298b"
down_revision: str | Sequence[str] | None = ("b2f4d6a8c0e1", "b8d1e2f3a4c5", "e5f6a7b8c9d0")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
