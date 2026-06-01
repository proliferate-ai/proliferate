"""Workspace materialization stage for cloud automation execution."""

from __future__ import annotations

import re
from typing import cast

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTOR_KIND_CLOUD,
)
from proliferate.constants.cloud import CloudWorkspaceStatus
from proliferate.db import engine as db_engine
from proliferate.db.store.automation_run_claims import (
    ClaimTransitionRule as StoreClaimTransitionRule,
)
from proliferate.db.store.cloud_workspaces import (
    attach_anyharness_workspace_id,
    load_cloud_workspace_by_id,
)
from proliferate.db.store.users import load_user_with_oauth_accounts_by_id
from proliferate.server.automations.domain.claim_lifecycle import (
    ANYHARNESS_WORKSPACE_ATTACHMENT_TRANSITION,
    CREATING_WORKSPACE_TRANSITION,
    claim_is_active,
    provisioning_workspace_transition,
)
from proliferate.server.automations.worker.claim_transactions import (
    attach_anyharness_workspace_to_run,
    mark_run_creating_workspace,
    mark_run_provisioning_workspace,
)
from proliferate.server.automations.worker.cloud_execution.command_models import (
    EnsureRepoCheckoutPayload,
    MaterializeWorkspacePayload,
)
from proliferate.server.automations.worker.cloud_execution.commands import (
    command_wait_timeout,
    enqueue_ensure_repo_checkout,
    enqueue_materialize_workspace,
    wait_for_ensure_repo_checkout,
    wait_for_materialize_workspace,
)
from proliferate.server.automations.worker.cloud_execution.context import (
    AutomationExecutionContext,
    WorkspaceExecutionContext,
)
from proliferate.server.automations.worker.cloud_executor_claims import (
    fail_claim,
    require_current_claim,
)
from proliferate.server.automations.worker.cloud_executor_config import (
    CloudExecutorConfig,
    automation_branch_name,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces.service import create_cloud_workspace_for_automation_run
from proliferate.utils.time import utcnow


def _store_transition(rule: object) -> StoreClaimTransitionRule:
    return cast(StoreClaimTransitionRule, rule)


def _path_component(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-")
    return cleaned or "workspace"


def _workspace_paths(ctx: AutomationExecutionContext, *, branch_name: str) -> tuple[str, str]:
    assert ctx.target is not None
    root = (ctx.target.default_workspace_root or "~/proliferate-workspaces").rstrip("/")
    repo_root = (
        f"{root}/{_path_component(ctx.claim.git_owner)}/{_path_component(ctx.claim.git_repo_name)}"
    )
    worktree = f"{repo_root}/worktrees/{_path_component(branch_name)}"
    return repo_root, worktree


async def _create_workspace_record(
    ctx: AutomationExecutionContext,
    *,
    config: CloudExecutorConfig,
) -> AutomationExecutionContext | None:
    current = await mark_run_creating_workspace(
        run_id=ctx.claim.id,
        claim_id=ctx.claim.claim_id,
        now=utcnow(),
        transition=_store_transition(CREATING_WORKSPACE_TRANSITION),
        claim_is_active=claim_is_active,
    )
    if current is None:
        return None
    if current.cloud_workspace_id is not None:
        return ctx.with_claim(current)

    user = await load_user_with_oauth_accounts_by_id(current.user_id)
    if user is None:
        await fail_claim(current, code="user_not_found")
        return None
    branch_name = automation_branch_name(current, config=config)
    _repo_root_path, worktree_path = _workspace_paths(ctx, branch_name=branch_name)
    try:
        workspace = await create_cloud_workspace_for_automation_run(
            user,
            run_id=current.id,
            claim_id=current.claim_id,
            target_id=ctx.target.target_id,
            sandbox_profile_id=ctx.target.sandbox_profile_id,
            git_owner=current.git_owner,
            git_repo_name=current.git_repo_name,
            branch_name=branch_name,
            worktree_path=worktree_path,
            display_name=current.title,
            required_agent_kind=current.agent_kind or "",
        )
    except CloudApiError as exc:
        await fail_claim(current, code=exc.code, message=exc.message)
        return None
    if workspace is None:
        await fail_claim(current, code="workspace_create_stale_claim")
        return None
    refreshed = await require_current_claim(current)
    return ctx.with_claim(refreshed) if refreshed is not None else None


async def materialize_workspace_stage(
    ctx: AutomationExecutionContext,
    *,
    config: CloudExecutorConfig,
) -> AutomationExecutionContext | None:
    assert ctx.target is not None
    ctx = await _create_workspace_record(ctx, config=config)
    if ctx is None or ctx.claim.cloud_workspace_id is None:
        return None

    if ctx.claim.anyharness_workspace_id is not None:
        workspace = await load_cloud_workspace_by_id(ctx.claim.cloud_workspace_id)
        branch_name = (
            workspace.git_branch
            if workspace is not None and workspace.git_branch
            else automation_branch_name(ctx.claim, config=config)
        )
        _repo_root_path, worktree_path = _workspace_paths(ctx, branch_name=branch_name)
        return ctx.with_workspace(
            WorkspaceExecutionContext(
                cloud_workspace_id=ctx.claim.cloud_workspace_id,
                anyharness_workspace_id=ctx.claim.anyharness_workspace_id,
                anyharness_repo_root_id=None,
                path=worktree_path,
                branch=branch_name,
            )
        )

    current = await mark_run_provisioning_workspace(
        run_id=ctx.claim.id,
        claim_id=ctx.claim.claim_id,
        now=utcnow(),
        transition=_store_transition(
            provisioning_workspace_transition(ctx.claim.execution_target)
        ),
        claim_is_active=claim_is_active,
    )
    if current is None:
        return None
    ctx = ctx.with_claim(current)

    workspace = await load_cloud_workspace_by_id(current.cloud_workspace_id)
    if workspace is None:
        await fail_claim(current, code="workspace_missing")
        return None
    branch_name = workspace.git_branch or automation_branch_name(current, config=config)
    base_branch = workspace.git_base_branch or workspace.git_branch or None
    repo_root_path, worktree_path = _workspace_paths(ctx, branch_name=branch_name)
    origin = {"kind": "system", "entrypoint": "cloud"}
    creator_context = {
        "kind": "automation",
        "automationId": str(current.automation_id),
        "automationRunId": str(current.id),
    }
    try:
        checkout_command = await enqueue_ensure_repo_checkout(
            ctx,
            target_id=ctx.target.target_id,
            payload=EnsureRepoCheckoutPayload(
                provider=current.git_provider,
                owner=current.git_owner,
                name=current.git_repo_name,
                path=repo_root_path,
                base_branch=base_branch,
            ),
        )
        await wait_for_ensure_repo_checkout(
            checkout_command,
            timeout=command_wait_timeout(ctx),
        )
        root_command = await enqueue_materialize_workspace(
            ctx,
            target_id=ctx.target.target_id,
            stage="materialize-workspace:repo-root",
            cloud_workspace_id=current.cloud_workspace_id,
            payload=MaterializeWorkspacePayload(
                mode="existing_path",
                path=repo_root_path,
                display_name=f"{current.git_owner}/{current.git_repo_name}",
                origin=origin,
                creator_context=creator_context,
            ),
        )
        root = await wait_for_materialize_workspace(
            root_command,
            timeout=command_wait_timeout(ctx),
        )
        worktree_command = await enqueue_materialize_workspace(
            ctx,
            target_id=ctx.target.target_id,
            stage="materialize-workspace:worktree",
            cloud_workspace_id=current.cloud_workspace_id,
            payload=MaterializeWorkspacePayload(
                mode="worktree",
                repo_root_id=root.repo_root_id,
                target_path=worktree_path,
                new_branch_name=branch_name,
                base_branch=base_branch,
                origin=origin,
                creator_context=creator_context,
            ),
        )
        materialized = await wait_for_materialize_workspace(
            worktree_command,
            timeout=command_wait_timeout(ctx),
        )
    except TimeoutError:
        await fail_claim(current, code="workspace_provision_failed")
        return None
    except Exception:
        await fail_claim(current, code="workspace_provision_failed")
        return None

    attached = await attach_anyharness_workspace_to_run(
        run_id=current.id,
        claim_id=current.claim_id,
        anyharness_workspace_id=materialized.anyharness_workspace_id,
        now=utcnow(),
        transition=_store_transition(ANYHARNESS_WORKSPACE_ATTACHMENT_TRANSITION),
        claim_is_active=claim_is_active,
        execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
        executor_kind=AUTOMATION_EXECUTOR_KIND_CLOUD,
    )
    if attached is None:
        await fail_claim(current, code="stale_claim")
        return None
    cloud_workspace_id = attached.cloud_workspace_id or current.cloud_workspace_id
    if cloud_workspace_id is None:
        await fail_claim(attached, code="workspace_missing")
        return None

    async with db_engine.async_session_factory() as db, db.begin():
        await attach_anyharness_workspace_id(
            db,
            workspace_id=cloud_workspace_id,
            anyharness_workspace_id=materialized.anyharness_workspace_id,
            status=CloudWorkspaceStatus.ready,
        )

    return ctx.with_claim(attached).with_workspace(
        WorkspaceExecutionContext(
            cloud_workspace_id=cloud_workspace_id,
            anyharness_workspace_id=materialized.anyharness_workspace_id,
            anyharness_repo_root_id=materialized.repo_root_id,
            path=worktree_path,
            branch=materialized.current_branch,
        )
    )
