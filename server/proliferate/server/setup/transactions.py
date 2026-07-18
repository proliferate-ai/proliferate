"""Commit helper for the first-run claim service.

Split out of service.py because the repo-shape server-boundary check forbids
service.py from calling session methods or DB session entrypoints directly
(SERVICE_DB_METHOD_CALL) — mirrors the transactions.py convention used
elsewhere (e.g. organizations/usage/transactions.py).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import commit_session


async def commit_first_run_claim(db: AsyncSession) -> None:
    """Commit the owner-account + organization claim durably.

    The claim owns its transaction: it must commit BEFORE the transport can
    queue the 2xx. Store callees only ``flush()``, and the request-scoped
    session dependency commits on cleanup — which FastAPI runs AFTER the
    response has been handed to the ASGI server. A client that claims /setup
    and immediately calls ``POST /auth/desktop/password/login`` (the desktop
    first-run flow, and the Tier-3 qualification harness) could then hit the
    user-not-found branch of ``authenticate_password_user`` and get a spurious
    401 (Release E2E run 29602686092, cell T3-INT-1). The commit also releases
    the first-run claim advisory lock and fires the scheduled token-file
    cleanup callback.
    """
    await commit_session(db)
