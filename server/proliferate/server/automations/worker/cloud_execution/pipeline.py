"""Ordered cloud automation execution pipeline."""

from __future__ import annotations

import asyncio

from proliferate.server.automations.worker.cloud_execution.context import (
    AutomationExecutionContext,
)
from proliferate.server.automations.worker.cloud_execution.stages.environment import (
    materialize_environment_stage,
)
from proliferate.server.automations.worker.cloud_execution.stages.git_identity import (
    ensure_git_identity_stage,
)
from proliferate.server.automations.worker.cloud_execution.stages.prompt import (
    dispatch_prompt_stage,
)
from proliferate.server.automations.worker.cloud_execution.stages.session import (
    apply_session_config_stage,
    start_session_stage,
)
from proliferate.server.automations.worker.cloud_execution.stages.target import (
    resolve_target_stage,
)
from proliferate.server.automations.worker.cloud_execution.stages.workspace import (
    materialize_workspace_stage,
)
from proliferate.server.automations.worker.cloud_executor_config import CloudExecutorConfig


def _claim_is_stale(stale_claim_event: asyncio.Event | None) -> bool:
    return stale_claim_event is not None and stale_claim_event.is_set()


async def run_automation_pipeline(
    ctx: AutomationExecutionContext,
    *,
    config: CloudExecutorConfig,
    stale_claim_event: asyncio.Event | None = None,
) -> AutomationExecutionContext | None:
    if _claim_is_stale(stale_claim_event):
        return None

    ctx = await resolve_target_stage(ctx)
    if ctx is None or _claim_is_stale(stale_claim_event):
        return None

    ctx = await ensure_git_identity_stage(ctx)
    if ctx is None or _claim_is_stale(stale_claim_event):
        return None

    ctx = await materialize_workspace_stage(ctx, config=config)
    if ctx is None or _claim_is_stale(stale_claim_event):
        return None

    ctx = await materialize_environment_stage(ctx)
    if ctx is None or _claim_is_stale(stale_claim_event):
        return None

    ctx = await start_session_stage(ctx)
    if ctx is None or _claim_is_stale(stale_claim_event):
        return None

    ctx = await apply_session_config_stage(ctx)
    if ctx is None or _claim_is_stale(stale_claim_event):
        return None

    await dispatch_prompt_stage(ctx)
    return ctx
