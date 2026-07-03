"""Merge the workspace_move and agent-auth-catalog migration heads.

The migration-v2 stack adds ``42530134293a`` (``workspace_move``), which
parents ``9d9e27c9298b``. When rebased onto the agent-auth refactor
(#906/#907/#908) main already carries ``c3f7a1e9d2b4`` (user token generation)
and, on top of it, ``c9b8a7d6e5f4`` (agent auth selection rebuild) ->
``d2e3f4a5b6c8`` (agent catalog runtime mirror source), whose tip is the agent
head. Cherry-picking ``workspace_move`` therefore leaves two heads
(``42530134293a`` and ``d2e3f4a5b6c8``). No schema changes; this only rejoins
the history so ``upgrade head`` resolves to a single head again (and
``scripts/check_migration_heads.py`` passes).

Revision ID: 53b86a01da39
Revises: 42530134293a, d2e3f4a5b6c8
Create Date: 2026-07-02
"""

from collections.abc import Sequence

revision: str = "53b86a01da39"
down_revision: str | Sequence[str] | None = ("42530134293a", "d2e3f4a5b6c8")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
