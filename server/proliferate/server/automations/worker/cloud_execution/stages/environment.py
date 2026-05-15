"""Target environment materialization stage for cloud automations."""

from __future__ import annotations

from dataclasses import replace
from uuid import UUID

from proliferate.constants.cloud import SUPPORTED_GIT_PROVIDER
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
from proliferate.server.cloud.target_config.models import MaterializeTargetConfigRequest
from proliferate.server.cloud.target_config.service import materialize_target_config


async def materialize_environment_stage(
    ctx: AutomationExecutionContext,
) -> AutomationExecutionContext | None:
    assert ctx.target is not None
    assert ctx.workspace is not None
    response = None
    try:
        async with db_engine.async_session_factory() as db, db.begin():
            user = await get_user_by_id(db, ctx.claim.user_id)
            if user is None:
                response = None
            else:
                response = await materialize_target_config(
                    db,
                    target_id=ctx.target.target_id,
                    user=user,
                    body=MaterializeTargetConfigRequest.model_validate(
                        {
                            "gitProvider": SUPPORTED_GIT_PROVIDER,
                            "gitOwner": ctx.claim.git_owner,
                            "gitRepoName": ctx.claim.git_repo_name,
                            "workspaceRoot": ctx.workspace.path,
                            "source": "automation",
                            "idempotencyKey": f"automation-run:{ctx.claim.id}",
                        }
                    ),
                )
    except Exception:
        await fail_claim(ctx.claim, code="config_apply_failed")
        return None
    if response is None:
        await fail_claim(ctx.claim, code="user_not_found")
        return None

    command = await load_command(UUID(response.command.command_id))
    if command is None:
        await fail_claim(ctx.claim, code="config_apply_failed")
        return None
    try:
        await wait_for_command_result(command, timeout=command_wait_timeout(ctx))
    except Exception:
        await fail_claim(ctx.claim, code="config_apply_failed")
        return None

    return ctx.with_workspace(
        replace(
            ctx.workspace,
            target_config_id=UUID(response.target_config.id),
            target_config_version=response.target_config.config_version,
        )
    )
