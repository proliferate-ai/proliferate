"""Target resolution for cloud automation execution."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from uuid import UUID

from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue
from proliferate.db.store.cloud_workspaces import load_cloud_workspace_by_id
from proliferate.server.automations.worker.cloud_executor_claims import fail_claim
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime.models import RuntimeConnectionTarget
from proliferate.server.cloud.runtime.service import get_workspace_connection

logger = logging.getLogger("proliferate.server.automations.worker.cloud_executor")


@dataclass(frozen=True)
class CloudRunTargetContext:
    target_id: UUID
    anyharness_workspace_id: str
    runtime: RuntimeConnectionTarget


async def resolve_target_for_claim(
    claim: AutomationRunClaimValue,
) -> CloudRunTargetContext | None:
    if claim.cloud_workspace_id is None:
        return None
    workspace = await load_cloud_workspace_by_id(claim.cloud_workspace_id)
    if workspace is None:
        await fail_claim(claim, code="workspace_missing")
        return None
    if workspace.user_id != claim.user_id:
        logger.error(
            "automation cloud executor workspace ownership mismatch run_id=%s "
            "workspace_id=%s run_user_id=%s workspace_user_id=%s",
            claim.id,
            claim.cloud_workspace_id,
            claim.user_id,
            workspace.user_id,
        )
        await fail_claim(claim, code="workspace_ownership_mismatch")
        return None
    try:
        target = await get_workspace_connection(workspace)
    except CloudApiError as exc:
        await fail_claim(claim, code=exc.code, message=exc.message)
        return None
    except Exception:
        logger.exception("automation cloud executor runtime connection failed run_id=%s", claim.id)
        await fail_claim(claim, code="runtime_not_ready")
        return None

    if claim.agent_kind not in target.ready_agent_kinds:
        await fail_claim(claim, code="agent_not_ready")
        return None
    if target.anyharness_workspace_id is None:
        await fail_claim(claim, code="runtime_not_ready")
        return None
    if target.target_id is None:
        await fail_claim(claim, code="target_not_ready")
        return None
    return CloudRunTargetContext(
        target_id=target.target_id,
        anyharness_workspace_id=target.anyharness_workspace_id,
        runtime=target,
    )
