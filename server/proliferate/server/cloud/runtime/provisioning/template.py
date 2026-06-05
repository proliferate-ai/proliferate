"""Runtime template preparation helpers for cloud provisioning."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from proliferate.constants.cloud import CloudWorkspaceStatus
from proliferate.integrations.sandbox import SandboxProvider
from proliferate.server.cloud.runtime.bundle import (
    check_runtime_bundle_preinstalled,
    stage_runtime_bundle,
)
from proliferate.server.cloud.runtime.models import (
    CloudProvisionInput,
    ConnectedSandbox,
    ProvisionStep,
)
from proliferate.server.cloud.runtime.provisioning.step_tracker import ProvisionStepTracker
from proliferate.server.cloud.runtime.toolchains import check_node_runtime, install_node_runtime

SetWorkspaceStatus = Callable[..., Awaitable[None]]


async def prepare_runtime_template(
    tracker: ProvisionStepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    connected: ConnectedSandbox,
    *,
    set_workspace_status: SetWorkspaceStatus,
) -> None:
    tracker.begin(ProvisionStep.check_preinstalled_runtime)
    bundle_preinstalled = await check_runtime_bundle_preinstalled(
        provider,
        connected.sandbox,
        workspace_id=ctx.workspace_id,
        runtime_context=connected.runtime_context,
    )
    tracker.complete(preinstalled=bundle_preinstalled)
    if bundle_preinstalled:
        await set_workspace_status(
            ctx.workspace_id,
            CloudWorkspaceStatus.materializing,
            detail="Using prebuilt runtime bundle",
        )
        tracker.begin(ProvisionStep.stage_runtime_binary)
        tracker.complete(skipped=True, reason="template_runtime_bundle_present")

        await set_workspace_status(
            ctx.workspace_id,
            CloudWorkspaceStatus.materializing,
            detail="Using prebuilt Node.js runtime",
        )
        tracker.begin(ProvisionStep.check_node_runtime)
        tracker.complete(skipped=True, reason="template_runtime_present")
        return

    await set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Uploading runtime bundle",
    )
    tracker.begin(ProvisionStep.stage_runtime_binary)
    binary_paths = await stage_runtime_bundle(
        provider,
        connected.sandbox,
        workspace_id=ctx.workspace_id,
        runtime_context=connected.runtime_context,
    )
    tracker.complete(
        binary_paths={key: str(value) for key, value in binary_paths.items()},
        preinstalled=bundle_preinstalled,
    )

    await set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Checking Node.js runtime",
    )
    tracker.begin(ProvisionStep.check_node_runtime)
    node_version = await check_node_runtime(
        provider,
        connected.sandbox,
        workspace_id=ctx.workspace_id,
        runtime_context=connected.runtime_context,
    )
    tracker.complete(node_version=node_version or "missing")

    if node_version is None:
        await set_workspace_status(
            ctx.workspace_id,
            CloudWorkspaceStatus.materializing,
            detail="Installing Node.js",
        )
        tracker.begin(ProvisionStep.install_node_runtime)
        installed_version = await install_node_runtime(
            provider,
            connected.sandbox,
            workspace_id=ctx.workspace_id,
            runtime_context=connected.runtime_context,
        )
        tracker.complete(node_version=installed_version)
