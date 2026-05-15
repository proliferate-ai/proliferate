"""Target Git identity bootstrap stage for cloud automations."""

from __future__ import annotations

from uuid import UUID

from proliferate.db import engine as db_engine
from proliferate.db.store.users import get_user_by_id
from proliferate.server.automations.worker.cloud_execution.commands import command_wait_timeout
from proliferate.server.automations.worker.cloud_execution.context import (
    AutomationExecutionContext,
)
from proliferate.server.automations.worker.cloud_executor_claims import fail_claim
from proliferate.server.automations.worker.cloud_executor_commands import (
    load_command,
    wait_for_command_result,
)
from proliferate.server.cloud.target_git_identity.service import materialize_target_git_identity


async def ensure_git_identity_stage(
    ctx: AutomationExecutionContext,
) -> AutomationExecutionContext | None:
    assert ctx.target is not None
    response = None
    try:
        async with db_engine.async_session_factory() as db, db.begin():
            user = await get_user_by_id(db, ctx.claim.user_id)
            if user is not None:
                response = await materialize_target_git_identity(
                    db,
                    target_id=ctx.target.target_id,
                    user=user,
                    source="automation",
                    idempotency_key=f"automation-run:{ctx.claim.id}",
                )
    except Exception:
        await fail_claim(ctx.claim, code="git_bootstrap_failed")
        return None
    if response is None:
        await fail_claim(ctx.claim, code="user_not_found")
        return None

    command = await load_command(UUID(response.command.command_id))
    if command is None:
        await fail_claim(ctx.claim, code="git_bootstrap_failed")
        return None
    try:
        await wait_for_command_result(command, timeout=command_wait_timeout(ctx))
    except Exception:
        await fail_claim(ctx.claim, code="git_bootstrap_failed")
        return None
    return ctx
