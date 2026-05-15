"""Best-effort cleanup helpers for cloud automation execution."""

from __future__ import annotations

import logging

from proliferate.constants.cloud import CloudCommandKind
from proliferate.server.automations.worker.cloud_execution.context import (
    AutomationExecutionContext,
)
from proliferate.server.automations.worker.cloud_executor_commands import (
    enqueue_automation_command,
)

logger = logging.getLogger("proliferate.server.automations.worker.cloud_executor")


async def close_orphan_session(
    ctx: AutomationExecutionContext,
    *,
    session_id: str,
) -> None:
    if ctx.target is None or ctx.workspace is None:
        return
    try:
        await enqueue_automation_command(
            ctx.claim,
            target_id=ctx.target.target_id,
            organization_id=ctx.target.organization_id,
            stage=f"close-orphan-session:{session_id}",
            kind=CloudCommandKind.close_session.value,
            workspace_id=ctx.workspace.anyharness_workspace_id,
            session_id=session_id,
            payload={},
        )
    except Exception:
        logger.warning(
            "automation cloud executor could not enqueue orphan session close "
            "run_id=%s session_id=%s",
            ctx.claim.id,
            session_id,
            exc_info=True,
        )
