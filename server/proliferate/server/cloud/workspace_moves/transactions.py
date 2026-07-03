"""Transaction helpers for workspace_move orchestration.

``service.py`` is not allowed to touch session/session_ops boundary methods
directly (enforced by ``scripts/check_server_boundaries.py``); it commits
mid-saga through these thin wrappers instead -- same pattern as
``cloud_sandboxes/transactions.py``. A mid-saga commit exists so a reserved
``workspace_move`` row survives even if a later step (e.g. the sandbox-side
destination build) fails, letting an idempotency-key replay resume from where
it left off.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import session_ops


async def commit_workspace_move_session(db: AsyncSession) -> None:
    await session_ops.commit_session(db)
