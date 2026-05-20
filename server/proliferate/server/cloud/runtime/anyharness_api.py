"""Remote AnyHarness runtime helpers for cloud workspaces."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Sequence
from uuid import UUID

from proliferate.constants.cloud import SUPPORTED_CLOUD_AGENTS
from proliferate.integrations import anyharness
from proliferate.integrations.anyharness import (
    CloudRuntimeReconnectError,
    RemoteAgentSummary,
    ResolvedRemoteWorkspace,
)
from proliferate.server.cloud._logging import format_exception_message, log_cloud_event
from proliferate.utils.time import duration_ms


def _agent_readiness_summary(agent_summaries: Sequence[RemoteAgentSummary]) -> str:
    parts: list[str] = []
    for item in agent_summaries:
        parts.append(f"{item.kind}:{item.readiness}")
    return ",".join(parts) or "none"


def _ready_cloud_agents_from_summaries(
    agent_summaries: Sequence[RemoteAgentSummary],
) -> list[str]:
    ready: list[str] = []
    for item in agent_summaries:
        if item.kind in SUPPORTED_CLOUD_AGENTS and item.readiness == "ready":
            ready.append(item.kind)
    return sorted(set(ready))


def _install_required_agent_kinds(
    agent_summaries: Sequence[RemoteAgentSummary],
    required_agent_kinds: Sequence[str],
) -> list[str]:
    summaries_by_kind = {item.kind: item for item in agent_summaries}
    install_required: list[str] = []
    for agent_kind in required_agent_kinds:
        if agent_kind not in SUPPORTED_CLOUD_AGENTS:
            continue
        summary = summaries_by_kind.get(agent_kind)
        if summary is None or summary.readiness == "install_required":
            install_required.append(agent_kind)
    return install_required


def _ready_required_agent_kinds(
    agent_summaries: Sequence[RemoteAgentSummary],
    required_agent_kinds: Sequence[str],
) -> list[str]:
    ready = set(_ready_cloud_agents_from_summaries(agent_summaries))
    return sorted(
        agent_kind
        for agent_kind in required_agent_kinds
        if agent_kind in SUPPORTED_CLOUD_AGENTS and agent_kind in ready
    )


async def wait_for_runtime_health(
    runtime_url: str,
    *,
    workspace_id: UUID | None = None,
    required_successes: int = 1,
    total_attempts: int = 10,
    delay_seconds: float = 0.5,
) -> None:
    successes = 0
    log_cloud_event(
        "cloud runtime health wait started",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        required_successes=required_successes,
        max_attempts=total_attempts,
    )
    for attempt in range(1, total_attempts + 1):
        attempt_started = time.perf_counter()
        try:
            probe = await anyharness.probe_runtime_health(runtime_url)
            if probe.is_success:
                successes += 1
                log_cloud_event(
                    "cloud runtime health probe succeeded",
                    workspace_id=workspace_id,
                    runtime_url=runtime_url,
                    attempt=attempt,
                    consecutive_successes=successes,
                    elapsed_ms=duration_ms(attempt_started),
                )
                if successes >= required_successes:
                    log_cloud_event(
                        "cloud runtime health wait finished",
                        workspace_id=workspace_id,
                        runtime_url=runtime_url,
                        attempts=attempt,
                        required_successes=required_successes,
                    )
                    return
            else:
                successes = 0
                log_cloud_event(
                    "cloud runtime health probe returned non-success",
                    level=logging.WARNING,
                    workspace_id=workspace_id,
                    runtime_url=runtime_url,
                    attempt=attempt,
                    status_code=probe.status_code,
                    elapsed_ms=duration_ms(attempt_started),
                    response_preview=probe.response_preview,
                )
        except CloudRuntimeReconnectError as exc:
            successes = 0
            log_cloud_event(
                "cloud runtime health probe failed",
                level=logging.WARNING,
                workspace_id=workspace_id,
                runtime_url=runtime_url,
                attempt=attempt,
                elapsed_ms=duration_ms(attempt_started),
                error=format_exception_message(exc),
                error_type=exc.__class__.__name__,
            )
        await asyncio.sleep(delay_seconds)
    raise CloudRuntimeReconnectError("AnyHarness did not become healthy in the cloud sandbox.")


async def verify_runtime_auth_enforced(
    runtime_url: str,
    access_token: str,
    *,
    workspace_id: UUID | None = None,
) -> None:
    verify_started = time.perf_counter()
    log_cloud_event(
        "cloud runtime auth verification started",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
    )
    try:
        probe = await anyharness.check_runtime_auth_enforcement(runtime_url, access_token)
    except CloudRuntimeReconnectError as exc:
        log_cloud_event(
            "cloud runtime auth verification failed",
            level=logging.WARNING,
            workspace_id=workspace_id,
            runtime_url=runtime_url,
            elapsed_ms=duration_ms(verify_started),
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
        raise CloudRuntimeReconnectError(
            "Failed to verify bearer authentication on the cloud runtime."
        ) from exc

    if not probe.authenticated_success:
        log_cloud_event(
            "cloud runtime auth verification rejected bearer token",
            level=logging.WARNING,
            workspace_id=workspace_id,
            runtime_url=runtime_url,
            elapsed_ms=duration_ms(verify_started),
            status_code=probe.authenticated_status_code,
            response_preview=probe.authenticated_response_preview,
        )
        if probe.authenticated_status_code == 401:
            raise CloudRuntimeReconnectError(
                "Runtime rejected the stored bearer token during auth verification."
            )
        raise CloudRuntimeReconnectError(
            "Runtime failed authenticated auth verification in the cloud sandbox."
        )

    if probe.unauthenticated_status_code != 401:
        log_cloud_event(
            "cloud runtime auth verification accepted unauthenticated request",
            level=logging.WARNING,
            workspace_id=workspace_id,
            runtime_url=runtime_url,
            elapsed_ms=duration_ms(verify_started),
            status_code=probe.unauthenticated_status_code,
            response_preview=probe.unauthenticated_response_preview,
        )
        raise CloudRuntimeReconnectError(
            "Runtime did not reject an unauthenticated request during auth verification."
        )

    log_cloud_event(
        "cloud runtime auth verification finished",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        elapsed_ms=duration_ms(verify_started),
    )


async def _list_remote_agents(
    runtime_url: str,
    access_token: str,
    *,
    workspace_id: UUID | None = None,
) -> list[RemoteAgentSummary]:
    list_started = time.perf_counter()
    agent_summaries = await anyharness.list_runtime_agents(runtime_url, access_token)
    log_cloud_event(
        "cloud runtime agent list loaded",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        elapsed_ms=duration_ms(list_started),
        agents=_agent_readiness_summary(agent_summaries),
    )
    return agent_summaries


async def _install_remote_agent(
    runtime_url: str,
    access_token: str,
    kind: str,
    *,
    workspace_id: UUID | None = None,
) -> RemoteAgentSummary:
    install_started = time.perf_counter()
    log_cloud_event(
        "cloud runtime agent install started",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        agent=kind,
    )
    install_result = await anyharness.install_runtime_agent(runtime_url, access_token, kind)

    log_cloud_event(
        "cloud runtime agent install finished",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        agent=kind,
        elapsed_ms=duration_ms(install_started),
        already_installed=install_result.already_installed,
        readiness=install_result.agent.readiness,
        credential_state=install_result.agent.credential_state,
    )
    return install_result.agent


async def get_runtime_ready_agent_kinds(
    runtime_url: str,
    access_token: str,
    *,
    workspace_id: UUID | None = None,
) -> list[str]:
    return _ready_cloud_agents_from_summaries(
        await _list_remote_agents(runtime_url, access_token, workspace_id=workspace_id)
    )


async def reconcile_remote_agents(
    runtime_url: str,
    access_token: str,
    *,
    workspace_id: UUID | None = None,
    required_agent_kinds: Sequence[str],
) -> list[str]:
    reconcile_started = time.perf_counter()
    log_cloud_event(
        "cloud runtime reconcile started",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        required_agents=",".join(required_agent_kinds) or "none",
    )
    initial_summaries = await _list_remote_agents(
        runtime_url,
        access_token,
        workspace_id=workspace_id,
    )
    agent_kinds_to_install = _install_required_agent_kinds(
        initial_summaries,
        required_agent_kinds,
    )
    agent_kinds_ready_from_template = _ready_required_agent_kinds(
        initial_summaries,
        required_agent_kinds,
    )
    log_cloud_event(
        "cloud runtime reconcile assessed",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        required_agents=",".join(required_agent_kinds) or "none",
        ready_from_template=",".join(agent_kinds_ready_from_template) or "none",
        install_required=",".join(agent_kinds_to_install) or "none",
        agents=_agent_readiness_summary(initial_summaries),
    )
    install_summaries: list[RemoteAgentSummary] = []
    for agent_kind in agent_kinds_to_install:
        install_summaries.append(
            await _install_remote_agent(
                runtime_url,
                access_token,
                agent_kind,
                workspace_id=workspace_id,
            )
        )
    agent_summaries = (
        await _list_remote_agents(
            runtime_url,
        access_token,
        workspace_id=workspace_id,
    )
        if agent_kinds_to_install
        else initial_summaries
    )
    ready_agent_kinds = _ready_cloud_agents_from_summaries(agent_summaries)
    log_cloud_event(
        "cloud runtime reconcile finished",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        elapsed_ms=duration_ms(reconcile_started),
        ready_agents=",".join(ready_agent_kinds) or "none",
        agents=_agent_readiness_summary(agent_summaries),
        prepared_agents=_agent_readiness_summary(install_summaries),
        ready_from_template=",".join(agent_kinds_ready_from_template) or "none",
        install_required=",".join(agent_kinds_to_install) or "none",
        installed_count=len(install_summaries),
    )
    if not any(agent_kind in ready_agent_kinds for agent_kind in required_agent_kinds):
        raise CloudRuntimeReconnectError(
            "No configured cloud agents became ready in the cloud sandbox runtime."
        )
    return ready_agent_kinds


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
