"""Command-triggered agent-auth refresh transaction helpers."""

from __future__ import annotations

import logging
from uuid import UUID

from proliferate.db import session_ops as db_session
from proliferate.server.cloud._logging import log_cloud_event
from proliferate.server.cloud.agent_auth.service import (
    request_agent_auth_refresh_for_profile_target,
)


async def queue_agent_auth_refresh_for_not_ready_preflight(
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    actor_user_id: UUID,
) -> None:
    try:
        async with db_session.open_async_transaction() as refresh_db:
            await request_agent_auth_refresh_for_profile_target(
                refresh_db,
                sandbox_profile_id=sandbox_profile_id,
                target_id=target_id,
                actor_user_id=actor_user_id,
                reason="command_preflight",
                force_restart=False,
            )
    except Exception as exc:
        log_cloud_event(
            "cloud command preflight agent auth refresh request failed",
            target_id=target_id,
            sandbox_profile_id=sandbox_profile_id,
            actor_user_id=actor_user_id,
            error_type=exc.__class__.__name__,
            level=logging.WARNING,
        )
