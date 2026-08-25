"""Harness settings service: per-harness configuration toggles — not auth.

``agent_auth_harness_settings`` stores catalog-declared toggle values (for
example claude's "Use Claude Code with Chrome"), riding the agent-auth
surface as the delivery vehicle only (AGENT_AUTH.md "Not auth: harness
settings"). Split from ``service.py`` along the seam the store layer
already draws (``db/store/agent_gateway/harness_settings.py``), keeping
the auth service under its line ceiling.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.server.api_errors import CloudApiError


async def put_harness_settings(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    settings_dict: dict[str, object],
) -> dict[str, object]:
    """Validate shape (all values must be bool) and upsert harness settings."""
    for key, value in settings_dict.items():
        if not isinstance(key, str) or not isinstance(value, bool):
            raise CloudApiError(
                "invalid_harness_settings",
                "Settings must be a dict[str, bool]. "
                f"Key {key!r} has value of type {type(value).__name__}.",
                status_code=400,
            )
    return await agent_gateway_store.put_harness_settings(
        db,
        user_id=user_id,
        harness_kind=harness_kind,
        surface=surface,
        settings=settings_dict,
    )
