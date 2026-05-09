"""Workspace stages for cloud automation execution."""

from __future__ import annotations

import logging

from proliferate.constants.cloud import CloudWorkspaceStatus
from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue
from proliferate.db.store.automation_run_claims import (
    mark_run_creating_workspace,
    mark_run_provisioning_workspace,
)
from proliferate.db.store.cloud_workspaces import load_cloud_workspace_by_id
from proliferate.db.store.users import load_user_with_oauth_accounts_by_id
from proliferate.server.automations.worker.cloud_executor_claims import (
    fail_claim,
    require_current_claim,
)
from proliferate.server.automations.worker.cloud_executor_config import (
    CloudExecutorConfig,
    automation_branch_name,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime.service import provision_workspace
from proliferate.server.cloud.workspaces.service import create_cloud_workspace_for_automation_run
from proliferate.utils.time import utcnow

logger = logging.getLogger("proliferate.server.automations.worker.cloud_executor")


async def create_or_load_workspace(
    claim: AutomationRunClaimValue,
    *,
    config: CloudExecutorConfig,
) -> AutomationRunClaimValue | None:
    current = await mark_run_creating_workspace(
        run_id=claim.id,
        claim_id=claim.claim_id,
        now=utcnow(),
    )
    if current is None:
        return None
    if current.cloud_workspace_id is not None:
        return current

    user = await load_user_with_oauth_accounts_by_id(current.user_id)
    if user is None:
        await fail_claim(current, code="user_not_found")
        return None

    try:
        workspace = await create_cloud_workspace_for_automation_run(
            user,
            run_id=current.id,
            claim_id=current.claim_id,
            git_owner=current.git_owner,
            git_repo_name=current.git_repo_name,
            branch_name=automation_branch_name(current, config=config),
            display_name=current.title,
            required_agent_kind=current.agent_kind or "",
        )
    except CloudApiError as exc:
        await fail_claim(current, code=exc.code, message=exc.message)
        return None
    if workspace is None:
        await fail_claim(current, code="workspace_create_stale_claim")
        return None
    return await require_current_claim(current)


async def provision_workspace_for_claim(
    claim: AutomationRunClaimValue,
) -> AutomationRunClaimValue | None:
    current = await mark_run_provisioning_workspace(
        run_id=claim.id,
        claim_id=claim.claim_id,
        now=utcnow(),
    )
    if current is None or current.cloud_workspace_id is None:
        return None
    workspace = await load_cloud_workspace_by_id(current.cloud_workspace_id)
    if (
        workspace is not None
        and workspace.status == CloudWorkspaceStatus.ready.value
        and workspace.anyharness_workspace_id
    ):
        return await require_current_claim(current)
    try:
        await provision_workspace(current.cloud_workspace_id)
    except Exception:
        logger.exception(
            "automation cloud executor provisioning failed run_id=%s workspace_id=%s",
            current.id,
            current.cloud_workspace_id,
        )
        await fail_claim(current, code="workspace_provision_failed")
        return None
    return await require_current_claim(current)
