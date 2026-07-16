"""Freeze managed target meaning before external effects."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.background.config import WORKFLOW_DELIVER_TASK
from proliferate.db.store import repositories as repository_store
from proliferate.db.store import workflow_invocations as invocation_store
from proliferate.db.store import workflow_managed_delivery as delivery_store
from proliferate.db.store import workflow_managed_execution as managed_store
from proliferate.server.cloud.cloud_sandboxes import service as sandbox_service
from proliferate.server.workflows.domain.managed_execution import (
    RepositoryTargetPlan,
    ScratchTargetPlan,
)
from proliferate.server.workflows.worker.coordination import enqueue


async def freeze_target_plan(
    db: AsyncSession,
    *,
    invocation: invocation_store.WorkflowInvocationSnapshot,
    managed: managed_store.WorkflowManagedExecutionSnapshot,
) -> None:
    sandbox = await sandbox_service.ensure_personal_cloud_sandbox_exists(
        db,
        user_id=invocation.user_id,
    )
    placement = invocation.invocation_json.get("placement")
    if not isinstance(placement, dict):
        await _fail(db, invocation.id, managed.delivery_generation, "workflow_invalid_placement")
        return
    if placement.get("kind") == "scratch":
        plan = ScratchTargetPlan(cloud_sandbox_id=str(sandbox.id)).as_json()
    elif placement.get("kind") == "repositoryWorktree":
        try:
            repo_config_id = UUID(str(placement.get("repoConfigId")))
        except ValueError:
            await _fail(
                db,
                invocation.id,
                managed.delivery_generation,
                "workflow_invalid_placement",
            )
            return
        repo = await repository_store.get_repo_config_by_id_for_user(
            db,
            user_id=invocation.user_id,
            repo_config_id=repo_config_id,
        )
        cloud_environments = (
            []
            if repo is None
            else [item for item in repo.environments if item.environment_kind == "cloud"]
        )
        if len(cloud_environments) != 1 or not cloud_environments[0].default_branch:
            await _fail(
                db,
                invocation.id,
                managed.delivery_generation,
                "workflow_repo_target_unavailable",
            )
            return
        environment = cloud_environments[0]
        base_ref = environment.default_branch.strip()
        if not base_ref:
            await _fail(
                db,
                invocation.id,
                managed.delivery_generation,
                "workflow_repo_base_ref_missing",
            )
            return
        plan = RepositoryTargetPlan(
            repo_config_id=str(repo_config_id),
            repo_environment_id=str(environment.id),
            base_ref=base_ref,
            cloud_sandbox_id=str(sandbox.id),
        ).as_json()
    else:
        await _fail(db, invocation.id, managed.delivery_generation, "workflow_invalid_placement")
        return
    advanced = await delivery_store.advance_delivery(
        db,
        invocation_id=invocation.id,
        expected_generation=managed.delivery_generation,
        expected_checkpoint="none",
        next_checkpoint="target_plan_frozen",
        target_plan_json=plan,
        target_cloud_sandbox_id=sandbox.id,
    )
    if advanced is not None:
        await enqueue(
            db,
            operation="deliver",
            invocation_id=invocation.id,
            generation=advanced.delivery_generation,
            task_name=WORKFLOW_DELIVER_TASK,
        )


async def _fail(
    db: AsyncSession,
    invocation_id: UUID,
    generation: int,
    code: str,
) -> None:
    await delivery_store.mark_delivery_failed(
        db,
        invocation_id=invocation_id,
        expected_generation=generation,
        error_code=code,
    )
