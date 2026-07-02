"""AnyHarness workspace preparation helpers for cloud runtime provisioning."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from proliferate.constants.cloud import CloudWorkspaceStatus
from proliferate.integrations.sandbox import SandboxProvider
from proliferate.server.cloud.runtime.config_sync.worktree_policy import (
    sync_cloud_worktree_policy_to_runtime,
)
from proliferate.server.cloud.runtime.git_operations import (
    ensure_requested_base_sha_available,
    resolve_runtime_root_head_sha,
)
from proliferate.server.cloud.runtime.liveness.health import (
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.models import (
    CloudProvisionInput,
    ConnectedSandbox,
    ProvisionStep,
    RuntimeHandshake,
)
from proliferate.server.cloud.runtime.provisioning.remote_workspace import (
    prepare_remote_mobility_destination,
    resolve_remote_workspace,
)
from proliferate.server.cloud.runtime.provisioning.step_tracker import ProvisionStepTracker
from proliferate.server.cloud.runtime.remote_agents import reconcile_remote_agents

SetWorkspaceStatus = Callable[..., Awaitable[None]]


async def attach_workspace_to_running_runtime(
    tracker: ProvisionStepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    connected: ConnectedSandbox,
    *,
    runtime_token: str,
    set_workspace_status: SetWorkspaceStatus,
) -> RuntimeHandshake:
    await set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Waiting for AnyHarness health",
    )
    tracker.begin(
        ProvisionStep.wait_for_runtime_health,
        runtime_url=connected.endpoint.runtime_url,
        reused_runtime=True,
    )
    await wait_for_runtime_health(
        connected.endpoint.runtime_url,
        workspace_id=ctx.workspace_id,
        required_successes=1,
        total_attempts=10,
        delay_seconds=0.5,
    )
    tracker.complete(runtime_url=connected.endpoint.runtime_url, reused_runtime=True)
    await verify_runtime_auth_enforced(
        connected.endpoint.runtime_url,
        runtime_token,
        workspace_id=ctx.workspace_id,
    )
    await sync_cloud_worktree_policy_to_runtime(
        user_id=ctx.user_id,
        runtime_url=connected.endpoint.runtime_url,
        access_token=runtime_token,
        workspace_id=ctx.workspace_id,
        run_deferred_startup_cleanup=True,
        await_deferred_startup_cleanup=False,
    )
    return await prepare_workspace_in_runtime(
        tracker,
        ctx,
        provider,
        connected,
        runtime_token=runtime_token,
        set_workspace_status=set_workspace_status,
    )


async def prepare_workspace_in_runtime(
    tracker: ProvisionStepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    connected: ConnectedSandbox,
    *,
    runtime_token: str,
    set_workspace_status: SetWorkspaceStatus,
) -> RuntimeHandshake:
    required_agent_kinds: tuple[str, ...] = ()
    await set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Preparing cloud agents",
    )
    tracker.begin(
        ProvisionStep.reconcile_agents,
        required_agents=",".join(required_agent_kinds),
    )
    ready_agents = await reconcile_remote_agents(
        connected.endpoint.runtime_url,
        runtime_token,
        workspace_id=ctx.workspace_id,
        required_agent_kinds=required_agent_kinds,
    )
    tracker.complete(ready_agents=",".join(ready_agents))

    await set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Resolving workspace",
    )
    await ensure_requested_base_sha_available(
        provider,
        connected.sandbox,
        ctx=ctx,
        runtime_context=connected.runtime_context,
    )
    tracker.begin(
        ProvisionStep.resolve_remote_workspace,
        runtime_url=connected.endpoint.runtime_url,
    )
    root_workspace = await resolve_remote_workspace(
        connected.endpoint.runtime_url,
        runtime_token,
        runtime_workdir=connected.runtime_context.runtime_workdir,
        workspace_id=ctx.workspace_id,
    )
    base_sha = ctx.requested_base_sha or await resolve_runtime_root_head_sha(
        provider,
        connected.sandbox,
        ctx=ctx,
        runtime_context=connected.runtime_context,
    )
    visible_workspace = await prepare_remote_mobility_destination(
        connected.endpoint.runtime_url,
        runtime_token,
        repo_root_id=root_workspace.repo_root_id,
        requested_branch=ctx.git_branch,
        requested_base_sha=base_sha,
        destination_id=str(ctx.workspace_id),
        preferred_workspace_name=ctx.git_branch,
        workspace_id=ctx.workspace_id,
    )
    tracker.complete(
        root_anyharness_workspace_id=root_workspace.workspace_id,
        anyharness_workspace_id=visible_workspace.workspace_id,
        anyharness_repo_root_id=root_workspace.repo_root_id,
    )

    return RuntimeHandshake(
        runtime_token=runtime_token,
        ready_agents=ready_agents,
        anyharness_workspace_id=visible_workspace.workspace_id,
        root_anyharness_workspace_id=root_workspace.workspace_id,
        anyharness_repo_root_id=root_workspace.repo_root_id,
    )
