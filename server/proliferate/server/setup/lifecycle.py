"""First-run setup steps that own session lifecycle or engine hooks.

Split from ``service.py`` so the service layer stays free of DB engine
imports (repo shape): this module plays the same role as
``organizations/invitation_delivery.py``, orchestrating engine-scoped work
around the pure session-scoped service functions.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db import engine as db_engine
from proliferate.server.setup import service


async def ensure_first_run_setup_token() -> None:
    """Mint or reuse the first-run setup token at API boot.

    No-op outside single-org mode. Opens its own short-lived session because
    it runs from the application lifespan, not a request.
    """
    if not settings.single_org_mode:
        return
    session = db_engine.async_session_factory()
    try:
        await service.ensure_setup_token(session)
        await session.commit()
    except BaseException:
        await db_engine.rollback_session(session)
        raise
    finally:
        await db_engine.close_session(session)


async def schedule_token_file_cleanup(db: AsyncSession) -> None:
    """Remove the plaintext token file once the claim transaction commits."""
    await db_engine.run_after_commit(db, service.remove_token_file_after_commit)
