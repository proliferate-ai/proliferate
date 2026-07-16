"""Checkpoint-sized managed Workflow delivery."""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.background.config import (
    WORKFLOW_CANCEL_TASK,
    WORKFLOW_DELIVER_TASK,
    WORKFLOW_OBSERVE_TASK,
)
from proliferate.db.store import repositories as repository_store
from proliferate.db.store import workflow_invocations as invocation_store
from proliferate.db.store import workflow_managed_delivery as delivery_store
from proliferate.db.store import workflow_managed_execution as managed_store
from proliferate.db.store import workflow_managed_projection as projection_store
from proliferate.integrations.anyharness import (
    WorkflowRuntimeError,
    put_workflow_run,
    put_workflow_workspace,
    resolve_workflow_repo_root,
)
from proliferate.server.cloud.materialization import paths as materialization_paths
from proliferate.server.cloud.materialization import service as materialization_service
from proliferate.server.cloud.workspaces import workflow_binding
from proliferate.server.workflows.domain.managed_execution import (
    access_retry_delay_seconds,
    delivery_error_action,
    execution_is_terminal,
)
from proliferate.server.workflows.worker.coordination import (
    enqueue,
    load_delivery,
    retryable,
    runtime_access,
    safe_error_code,
)
from proliferate.server.workflows.worker.target_plan import freeze_target_plan
from proliferate.server.workflows.worker.telemetry import emit_attempt

logger = logging.getLogger(__name__)


async def run_delivery_task(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    invocation_id: UUID,
    generation: int,
) -> None:
    """Run one persisted checkpoint or one bounded external phase."""

    async with session_factory() as db, db.begin():
        claimed = await delivery_store.claim_delivery_generation(
            db,
            invocation_id=invocation_id,
            generation=generation,
        )
        if claimed is None:
            return
        invocation = await invocation_store.get_workflow_invocation_global(
            db,
            invocation_id=invocation_id,
        )
        if invocation is None:
            return
        checkpoint = claimed.delivery_checkpoint
        if checkpoint == "none":
            await freeze_target_plan(db, invocation=invocation, managed=claimed)
            return
        if checkpoint in {"target_bound", "workspace_ready"}:
            next_checkpoint = (
                "workspace_put_started" if checkpoint == "target_bound" else "run_put_started"
            )
            advanced = await delivery_store.advance_delivery(
                db,
                invocation_id=invocation_id,
                expected_generation=generation,
                expected_checkpoint=checkpoint,
                next_checkpoint=next_checkpoint,
            )
            if advanced is not None:
                await _enqueue_delivery(db, invocation_id, advanced.delivery_generation)
            return

    try:
        if checkpoint == "target_plan_frozen":
            await _target_bound(session_factory, invocation_id, generation)
        elif checkpoint == "workspace_put_started":
            await _workspace_ready(session_factory, invocation_id, generation)
        elif checkpoint == "run_put_started":
            await _run_accepted(session_factory, invocation_id, generation)
    except Exception as error:  # noqa: BLE001 - closed durable classification.
        await _handle_error(session_factory, invocation_id, generation, error)


async def _target_bound(
    session_factory: async_sessionmaker[AsyncSession],
    invocation_id: UUID,
    generation: int,
) -> None:
    async with session_factory() as db:
        _invocation, managed = await load_delivery(db, invocation_id)
        plan = managed.target_plan_json or {}
        sandbox_id = UUID(str(plan["cloudSandboxId"]))
        if plan.get("kind") == "repositoryWorktree":
            await db.commit()
            await materialization_service.materialize_repo_environment_at_frozen_base(
                db,
                repo_environment_id=UUID(str(plan["repoEnvironmentId"])),
                base_ref=str(plan["baseRef"]),
                expected_cloud_sandbox_id=sandbox_id,
            )
    access = await runtime_access(
        session_factory,
        sandbox_id=sandbox_id,
        expected_store_id=None,
    )
    async with session_factory() as db, db.begin():
        advanced = await delivery_store.advance_delivery(
            db,
            invocation_id=invocation_id,
            expected_generation=generation,
            expected_checkpoint="target_plan_frozen",
            next_checkpoint="target_bound",
            target_execution_store_id=access.execution_store_id,
        )
        if advanced is not None:
            await _enqueue_delivery(db, invocation_id, advanced.delivery_generation)


async def _workspace_ready(
    session_factory: async_sessionmaker[AsyncSession],
    invocation_id: UUID,
    generation: int,
) -> None:
    async with session_factory() as db:
        invocation, managed = await load_delivery(db, invocation_id)
        plan = managed.target_plan_json or {}
        sandbox_id = UUID(str(plan["cloudSandboxId"]))
        expected_store_id = managed.target_execution_store_id
        if expected_store_id is None:
            raise WorkflowRuntimeError("workflow_delivery_state_missing")
        repo_environment = None
        if plan.get("kind") == "repositoryWorktree":
            repo_environment = await repository_store.get_repo_environment_by_id(
                db,
                UUID(str(plan["repoEnvironmentId"])),
            )
            if repo_environment is None or repo_environment.user_id != invocation.user_id:
                raise WorkflowRuntimeError("workflow_repo_target_unavailable")
    access = await runtime_access(
        session_factory,
        sandbox_id=sandbox_id,
        expected_store_id=expected_store_id,
    )
    if repo_environment is None:
        placement: dict[str, object] = {"kind": "scratch"}
    else:
        repo_root_id = await resolve_workflow_repo_root(
            access.runtime_url,
            access.access_token,
            runtime_workdir=materialization_paths.repo_path(repo_environment),
        )
        placement = {
            "kind": "repositoryWorktree",
            "repoRootId": repo_root_id,
            "baseRef": str(plan["baseRef"]),
        }
    accepted = await put_workflow_workspace(
        access.runtime_url,
        access.access_token,
        run_id=str(invocation_id),
        placement=placement,
    )
    async with session_factory() as db, db.begin():
        current = await managed_store.get_managed_execution(
            db,
            invocation_id=invocation_id,
            lock_row=True,
        )
        if (
            current is None
            or current.delivery_generation != generation
            or current.delivery_checkpoint != "workspace_put_started"
            or current.desired_state != "active"
        ):
            return
        cloud_workspace = await workflow_binding.bind_managed_workflow_workspace(
            db,
            user_id=invocation.user_id,
            invocation_id=invocation_id,
            placement_kind=("scratch" if repo_environment is None else "repositoryWorktree"),
            repo_environment=repo_environment,
            base_ref=None if repo_environment is None else str(plan["baseRef"]),
            cloud_sandbox_id=sandbox_id,
            anyharness_workspace_id=accepted.workspace_id,
            expected_cloud_workspace_id=current.cloud_workspace_id,
        )
        advanced = await delivery_store.advance_delivery(
            db,
            invocation_id=invocation_id,
            expected_generation=generation,
            expected_checkpoint="workspace_put_started",
            next_checkpoint="workspace_ready",
            target_workspace_id=accepted.workspace_id,
            cloud_workspace_id=cloud_workspace.id,
        )
        if advanced is not None:
            await _enqueue_delivery(db, invocation_id, advanced.delivery_generation)


async def _run_accepted(
    session_factory: async_sessionmaker[AsyncSession],
    invocation_id: UUID,
    generation: int,
) -> None:
    async with session_factory() as db:
        invocation, managed = await load_delivery(db, invocation_id)
    if (
        managed.target_cloud_sandbox_id is None
        or managed.target_execution_store_id is None
        or managed.target_workspace_id is None
    ):
        raise WorkflowRuntimeError("workflow_delivery_state_missing")
    access = await runtime_access(
        session_factory,
        sandbox_id=managed.target_cloud_sandbox_id,
        expected_store_id=managed.target_execution_store_id,
    )
    projection = await put_workflow_run(
        access.runtime_url,
        access.access_token,
        run_id=str(invocation_id),
        expected_workspace_id=managed.target_workspace_id,
        request={
            "schemaVersion": 2,
            "workspaceId": managed.target_workspace_id,
            "definition": invocation.invocation_json["definition"],
            "arguments": invocation.invocation_json["arguments"],
        },
    )
    async with session_factory() as db, db.begin():
        accepted = await delivery_store.mark_delivery_accepted(
            db,
            invocation_id=invocation_id,
            expected_generation=generation,
            projection=projection.value,
        )
        if accepted is None:
            return
        if accepted.desired_state == "cancelled":
            accepted = await delivery_store.ensure_cancel_generation(
                db,
                invocation_id=invocation_id,
            )
            if accepted is not None:
                await enqueue(
                    db,
                    operation="cancel",
                    invocation_id=invocation_id,
                    generation=accepted.cancel_generation,
                    task_name=WORKFLOW_CANCEL_TASK,
                )
        elif not execution_is_terminal(accepted.execution_status):
            await enqueue(
                db,
                operation="observe",
                invocation_id=invocation_id,
                generation=accepted.observation_generation,
                task_name=WORKFLOW_OBSERVE_TASK,
                delay_seconds=1,
            )


async def _handle_error(
    session_factory: async_sessionmaker[AsyncSession],
    invocation_id: UUID,
    generation: int,
    error: BaseException,
) -> None:
    code = safe_error_code(error)
    async with session_factory() as db, db.begin():
        current = await managed_store.get_managed_execution(
            db,
            invocation_id=invocation_id,
        )
        if current is None or current.delivery_generation != generation:
            return
        action = delivery_error_action(
            checkpoint=current.delivery_checkpoint,
            code=code,
            retryable=retryable(error),
            authentication=(isinstance(error, WorkflowRuntimeError) and error.authentication),
            previous_code=current.last_delivery_error_code,
        )
        if (
            action == "target_lost"
            and current.target_cloud_sandbox_id is not None
            and current.target_execution_store_id is not None
        ):
            await projection_store.mark_target_lost(
                db,
                invocation_id=invocation_id,
                operation="deliver",
                expected_generation=generation,
                expected_cloud_sandbox_id=current.target_cloud_sandbox_id,
                expected_execution_store_id=current.target_execution_store_id,
                error_code=code,
            )
        elif action == "fail":
            await delivery_store.mark_delivery_failed(
                db,
                invocation_id=invocation_id,
                expected_generation=generation,
                error_code=code,
                definitive_after_run_put=current.delivery_checkpoint == "run_put_started",
            )
        elif action == "retry":
            retried = await delivery_store.schedule_delivery_retry(
                db,
                invocation_id=invocation_id,
                expected_generation=generation,
                error_code=code,
            )
            if retried is not None:
                await enqueue(
                    db,
                    operation="deliver",
                    invocation_id=invocation_id,
                    generation=retried.delivery_generation,
                    task_name=WORKFLOW_DELIVER_TASK,
                    delay_seconds=access_retry_delay_seconds(
                        max(0, retried.delivery_attempt_count - 1)
                    ),
                )
        else:
            await delivery_store.mark_delivery_failed(
                db,
                invocation_id=invocation_id,
                expected_generation=generation,
                error_code=code,
            )
    logger.warning(
        "managed workflow delivery attempt failed",
        extra={
            "workflow_invocation_id": str(invocation_id),
            "workflow_generation": generation,
            "workflow_safe_code": code,
        },
    )
    emit_attempt(
        operation="deliver",
        safe_code=code,
        invocation_id=invocation_id,
        generation=generation,
    )


async def _enqueue_delivery(db: AsyncSession, invocation_id: UUID, generation: int) -> None:
    await enqueue(
        db,
        operation="deliver",
        invocation_id=invocation_id,
        generation=generation,
        task_name=WORKFLOW_DELIVER_TASK,
    )
