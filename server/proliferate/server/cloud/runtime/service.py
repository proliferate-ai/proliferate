"""Public runtime service entrypoints for cloud workspaces."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import BILLING_MODE_ENFORCE
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_runtime_environments import load_runtime_environment_for_workspace
from proliferate.db.store.cloud_workspaces import get_cloud_workspace_by_id
from proliferate.server.billing.snapshots import get_billing_snapshot_for_subject
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime.config_sync.worktree_policy import (
    sync_cloud_worktree_policy_to_runtime,
)
from proliferate.server.cloud.runtime.credentials.auth_status import (
    load_workspace_runtime_auth_snapshot,
)
from proliferate.server.cloud.runtime.credentials.remote_agents import (
    get_runtime_ready_agent_kinds,
)
from proliferate.server.cloud.runtime.liveness.ensure_running import (
    ensure_environment_runtime_ready,
)
from proliferate.server.cloud.runtime.models import RuntimeConnectionTarget
from proliferate.server.cloud.runtime.provision import provision_workspace as _provision_workspace
from proliferate.utils.crypto import decrypt_text

provision_workspace = _provision_workspace


async def get_workspace_connection(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> RuntimeConnectionTarget:
    workspace_id = workspace.id
    runtime_environment = await load_runtime_environment_for_workspace(db, workspace)
    billing_subject_id = (
        runtime_environment.billing_subject_id
        if runtime_environment is not None
        else workspace.billing_subject_id
    )
    billing = await get_billing_snapshot_for_subject(billing_subject_id)
    if billing.billing_mode == BILLING_MODE_ENFORCE and billing.active_spend_hold:
        raise CloudApiError(
            "workspace_not_ready",
            (
                "Cloud workspace is currently blocked. "
                "Start is disabled until cloud usage is available again."
            ),
            status_code=409,
        )

    if workspace.status != "ready" or not workspace.anyharness_workspace_id:
        raise CloudApiError(
            "workspace_not_ready",
            "Cloud workspace is not ready yet.",
            status_code=409,
        )
    if runtime_environment is None:
        raise CloudApiError(
            "workspace_not_ready",
            "Cloud runtime environment is not ready yet.",
            status_code=409,
        )
    if not runtime_environment.runtime_token_ciphertext:
        raise CloudApiError(
            "workspace_not_ready",
            "Cloud workspace runtime token is not available.",
            status_code=409,
        )

    access_token = decrypt_text(runtime_environment.runtime_token_ciphertext)
    runtime_url = await ensure_environment_runtime_ready(
        runtime_environment,
        workspace_id=workspace_id,
        allow_launcher_restart=True,
        access_token=access_token,
    )
    db.expire_all()
    reloaded_workspace = await get_cloud_workspace_by_id(db, workspace_id)
    reloaded_environment = await load_runtime_environment_for_workspace(
        db,
        reloaded_workspace or workspace,
    )
    if (
        reloaded_workspace is None
        or reloaded_environment is None
        or not reloaded_environment.runtime_token_ciphertext
    ):
        raise CloudApiError(
            "workspace_not_ready",
            "Cloud workspace runtime is not ready yet.",
            status_code=409,
        )
    runtime_auth = await load_workspace_runtime_auth_snapshot(
        workspace=reloaded_workspace,
        runtime_environment=reloaded_environment,
    )
    if runtime_auth is None or not runtime_auth.target_current:
        raise CloudApiError(
            "agent_auth_not_current",
            "Cloud workspace agent authentication is not current yet.",
            status_code=409,
        )
    access_token = decrypt_text(reloaded_environment.runtime_token_ciphertext)
    await sync_cloud_worktree_policy_to_runtime(
        user_id=reloaded_workspace.user_id,
        runtime_url=runtime_url,
        access_token=access_token,
        workspace_id=workspace_id,
        run_deferred_startup_cleanup=True,
        await_deferred_startup_cleanup=False,
    )
    ready_agent_kinds = await get_runtime_ready_agent_kinds(
        runtime_url,
        access_token,
        workspace_id=workspace_id,
    )
    return RuntimeConnectionTarget(
        target_id=reloaded_environment.target_id,
        runtime_url=runtime_url,
        access_token=access_token,
        anyharness_workspace_id=reloaded_workspace.anyharness_workspace_id,
        runtime_generation=reloaded_environment.runtime_generation,
        ready_agent_kinds=ready_agent_kinds,
        runtime_auth=runtime_auth,
    )
