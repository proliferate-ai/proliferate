"""Public runtime service entrypoints for cloud workspaces."""

from __future__ import annotations

from proliferate.constants.billing import BILLING_MODE_ENFORCE
from proliferate.db.models.cloud import CloudWorkspace
from proliferate.db.store.cloud_runtime_environments import load_runtime_environment_for_workspace
from proliferate.db.store.cloud_workspaces import load_cloud_workspace_by_id
from proliferate.server.billing.service import get_billing_snapshot_for_subject
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime.anyharness_api import (
    get_runtime_ready_agent_kinds,
)
from proliferate.server.cloud.runtime.credential_freshness import (
    ensure_runtime_environment_credentials_current,
)
from proliferate.server.cloud.runtime.ensure_running import (
    ensure_environment_runtime_ready,
)
from proliferate.server.cloud.runtime.models import RuntimeConnectionTarget
from proliferate.server.cloud.runtime.provision import provision_workspace as _provision_workspace
from proliferate.server.cloud.runtime.worktree_policy_sync import (
    sync_cloud_worktree_policy_to_runtime,
)
from proliferate.utils.crypto import decrypt_text

provision_workspace = _provision_workspace


async def sync_workspace_credentials(workspace: CloudWorkspace) -> None:
    runtime_environment = await load_runtime_environment_for_workspace(workspace)
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
                "Credentials will apply on the next allowed start."
            ),
            status_code=409,
        )

    if runtime_environment is None:
        raise CloudApiError(
            "workspace_not_ready",
            (
                "Cloud workspace does not have a runtime environment yet. "
                "Credentials will apply on the next start."
            ),
            status_code=409,
        )

    await ensure_runtime_environment_credentials_current(
        runtime_environment.id,
        workspace_id=workspace.id,
        allow_process_restart=True,
    )


async def get_workspace_connection(workspace: CloudWorkspace) -> RuntimeConnectionTarget:
    runtime_environment = await load_runtime_environment_for_workspace(workspace)
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
        workspace_id=workspace.id,
        allow_launcher_restart=True,
        access_token=access_token,
    )
    credential_freshness = await ensure_runtime_environment_credentials_current(
        runtime_environment.id,
        workspace_id=workspace.id,
        allow_process_restart=True,
    )
    reloaded_workspace = await load_cloud_workspace_by_id(workspace.id)
    reloaded_environment = await load_runtime_environment_for_workspace(
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
    access_token = decrypt_text(reloaded_environment.runtime_token_ciphertext)
    await sync_cloud_worktree_policy_to_runtime(
        user_id=reloaded_workspace.user_id,
        runtime_url=runtime_url,
        access_token=access_token,
        workspace_id=workspace.id,
        run_deferred_startup_cleanup=True,
        await_deferred_startup_cleanup=False,
    )
    ready_agent_kinds = await get_runtime_ready_agent_kinds(
        runtime_url,
        access_token,
        workspace_id=workspace.id,
    )
    return RuntimeConnectionTarget(
        runtime_url=runtime_url,
        access_token=access_token,
        anyharness_workspace_id=reloaded_workspace.anyharness_workspace_id,
        runtime_generation=reloaded_environment.runtime_generation,
        ready_agent_kinds=ready_agent_kinds,
        credential_freshness=credential_freshness,
    )
