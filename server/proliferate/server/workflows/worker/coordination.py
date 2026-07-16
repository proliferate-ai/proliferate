"""Coordination primitives shared by managed Workflow worker phases."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.background.config import DEFAULT_QUEUE
from proliferate.db.store import workflow_invocations as invocation_store
from proliferate.db.store import workflow_managed_execution as managed_store
from proliferate.db.store.background_outbox import enqueue_outbox_task
from proliferate.integrations.anyharness import (
    WorkflowRuntimeError,
    get_execution_store_identity,
)
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.sandbox import (
    SandboxProviderConfigurationError,
    SandboxProviderTargetUnavailableError,
    SandboxProviderUnavailableError,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.materialization import operation
from proliferate.server.cloud.materialization.locks import (
    CloudMaterializationLockLost,
    CloudMaterializationLockTimeout,
    CloudMaterializationLockUnavailable,
)
from proliferate.server.cloud.materialization.materialize import workflow_runtime
from proliferate.server.cloud.materialization.materialize.repo_environment import (
    CloudRepoCheckoutError,
)
from proliferate.server.cloud.materialization.sandbox_io.target import (
    CloudMaterializationCommandError,
)
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class RuntimeAccess:
    sandbox_id: UUID
    runtime_url: str
    access_token: str
    execution_store_id: str


@dataclass(frozen=True)
class ManagedDeliveryError:
    code: str
    retryable: bool
    authentication: bool = False


def classify_delivery_error(error: BaseException) -> ManagedDeliveryError:
    """Map only known delivery failures into durable retry policy."""

    if isinstance(error, WorkflowRuntimeError):
        return ManagedDeliveryError(
            code=error.code,
            retryable=error.retryable or error.authentication,
            authentication=error.authentication,
        )
    if isinstance(error, CloudRepoCheckoutError):
        return ManagedDeliveryError("workflow_repo_checkout_conflict", False)
    if isinstance(error, operation.CloudMaterializationTargetUnavailable):
        return ManagedDeliveryError("workflow_target_unavailable", False)
    if isinstance(error, SandboxProviderTargetUnavailableError):
        return ManagedDeliveryError("workflow_target_unavailable", False)
    if isinstance(error, SandboxProviderConfigurationError):
        return ManagedDeliveryError("workflow_provider_configuration_invalid", False)
    if isinstance(error, SandboxProviderUnavailableError):
        return ManagedDeliveryError("workflow_target_unreachable", True)
    if isinstance(error, CloudMaterializationLockTimeout):
        return ManagedDeliveryError("workflow_materialization_busy", True)
    if isinstance(error, (CloudMaterializationLockUnavailable, CloudMaterializationLockLost)):
        return ManagedDeliveryError("workflow_materialization_unavailable", True)
    if isinstance(error, CloudApiError):
        return ManagedDeliveryError(error.code[:128], error.status_code >= 500)
    if isinstance(
        error,
        (
            CloudMaterializationCommandError,
            CloudRuntimeReconnectError,
        ),
    ):
        return ManagedDeliveryError("workflow_target_unreachable", True)
    return ManagedDeliveryError("managed_workflow_internal_error", False)


def safe_error_code(error: BaseException) -> str:
    return classify_delivery_error(error).code


def retryable(error: BaseException) -> bool:
    return classify_delivery_error(error).retryable


async def enqueue(
    db: AsyncSession,
    *,
    operation: str,
    invocation_id: UUID,
    generation: int,
    task_name: str,
    delay_seconds: float = 0,
) -> None:
    await enqueue_outbox_task(
        db,
        task_name=task_name,
        queue=DEFAULT_QUEUE,
        args_json=(str(invocation_id), generation),
        idempotency_key=f"workflow:{operation}:{invocation_id}:{generation}",
        available_at=utcnow() + timedelta(seconds=delay_seconds),
    )


async def runtime_access(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    sandbox_id: UUID,
    expected_store_id: str | None,
    prepare_agent_auth_for_user_id: UUID | None = None,
) -> RuntimeAccess:
    async with session_factory() as db:

        async def _probe(runtime_url: str, access_token: str) -> RuntimeAccess:
            identity = await get_execution_store_identity(runtime_url, access_token)
            return RuntimeAccess(
                sandbox_id=sandbox_id,
                runtime_url=runtime_url,
                access_token=access_token,
                execution_store_id=identity.execution_store_id,
            )

        try:
            access = await workflow_runtime.run_managed_workflow_runtime_operation(
                db,
                sandbox_id=sandbox_id,
                user_id=prepare_agent_auth_for_user_id,
                run=_probe,
            )
        except operation.CloudMaterializationTargetUnavailable as error:
            raise WorkflowRuntimeError("workflow_target_destroyed", not_found=True) from error
    if expected_store_id is not None and access.execution_store_id != expected_store_id:
        raise WorkflowRuntimeError("workflow_execution_store_changed", not_found=True)
    return access


async def load_delivery(
    db: AsyncSession,
    invocation_id: UUID,
) -> tuple[
    invocation_store.WorkflowInvocationSnapshot,
    managed_store.WorkflowManagedExecutionSnapshot,
]:
    invocation = await invocation_store.get_workflow_invocation_global(
        db,
        invocation_id=invocation_id,
    )
    managed = await managed_store.get_managed_execution(db, invocation_id=invocation_id)
    if invocation is None or managed is None or managed.target_plan_json is None:
        raise WorkflowRuntimeError("workflow_delivery_state_missing")
    return invocation, managed
