"""Remote AnyHarness workspace operations used by provisioning."""

from __future__ import annotations

import time
from uuid import UUID

from proliferate.integrations import anyharness
from proliferate.integrations.anyharness import ResolvedRemoteWorkspace
from proliferate.server.cloud._logging import log_cloud_event
from proliferate.utils.time import duration_ms


async def resolve_remote_workspace(
    runtime_url: str,
    access_token: str,
    *,
    runtime_workdir: str,
    workspace_id: UUID | None = None,
) -> ResolvedRemoteWorkspace:
    resolve_started = time.perf_counter()
    remote_workspace = await anyharness.resolve_runtime_workspace(
        runtime_url,
        access_token,
        runtime_workdir=runtime_workdir,
    )
    log_cloud_event(
        "cloud runtime workspace resolved",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        elapsed_ms=duration_ms(resolve_started),
        remote_workspace_id=remote_workspace.workspace_id,
        remote_repo_root_id=remote_workspace.repo_root_id,
    )
    return remote_workspace


async def prepare_remote_mobility_destination(
    runtime_url: str,
    access_token: str,
    *,
    repo_root_id: str,
    requested_branch: str,
    requested_base_sha: str,
    destination_id: str,
    preferred_workspace_name: str | None = None,
    workspace_id: UUID | None = None,
) -> ResolvedRemoteWorkspace:
    prepare_started = time.perf_counter()
    remote_workspace = await anyharness.prepare_runtime_mobility_destination(
        runtime_url,
        access_token,
        repo_root_id=repo_root_id,
        requested_branch=requested_branch,
        requested_base_sha=requested_base_sha,
        destination_id=destination_id,
        preferred_workspace_name=preferred_workspace_name,
    )
    log_cloud_event(
        "cloud runtime worktree destination prepared",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        elapsed_ms=duration_ms(prepare_started),
        remote_workspace_id=remote_workspace.workspace_id,
        remote_repo_root_id=remote_workspace.repo_root_id,
        destination_id=destination_id,
    )
    return remote_workspace
