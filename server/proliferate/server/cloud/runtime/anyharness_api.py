"""Remote AnyHarness runtime helpers for cloud workspaces."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx

from proliferate.constants.cloud import SUPPORTED_CLOUD_AGENTS
from proliferate.server.cloud._logging import format_exception_message, log_cloud_event
from proliferate.utils.time import duration_ms


class CloudRuntimeReconnectError(RuntimeError):
    """Raised when a persistent sandbox cannot be reused safely."""


@dataclass(frozen=True)
class ResolvedRemoteWorkspace:
    workspace_id: str
    repo_root_id: str


def _auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def _agent_readiness_summary(agent_summaries: Sequence[dict[str, Any]]) -> str:
    parts: list[str] = []
    for item in agent_summaries:
        kind = item.get("kind")
        readiness = item.get("readiness")
        if isinstance(kind, str):
            parts.append(f"{kind}:{readiness}")
    return ",".join(parts) or "none"


def _ready_cloud_agents_from_summaries(agent_summaries: Sequence[dict[str, Any]]) -> list[str]:
    ready: list[str] = []
    for item in agent_summaries:
        kind = item.get("kind")
        readiness = item.get("readiness")
        if kind in SUPPORTED_CLOUD_AGENTS and readiness == "ready":
            ready.append(kind)
    return sorted(set(ready))


def _install_required_synced_providers(
    agent_summaries: Sequence[dict[str, Any]],
    synced_providers: Sequence[str],
) -> list[str]:
    summaries_by_kind = {
        item.get("kind"): item for item in agent_summaries if isinstance(item.get("kind"), str)
    }
    install_required: list[str] = []
    for provider in synced_providers:
        if provider not in SUPPORTED_CLOUD_AGENTS:
            continue
        summary = summaries_by_kind.get(provider)
        if summary is None or summary.get("readiness") == "install_required":
            install_required.append(provider)
    return install_required


def _synced_ready_providers(
    agent_summaries: Sequence[dict[str, Any]],
    synced_providers: Sequence[str],
) -> list[str]:
    ready = set(_ready_cloud_agents_from_summaries(agent_summaries))
    return sorted(
        provider
        for provider in synced_providers
        if provider in SUPPORTED_CLOUD_AGENTS and provider in ready
    )


def _agent_install_timeout_seconds(kind: str) -> float:
    if kind == "codex":
        return 1800.0
    return 180.0


def _response_preview(text: str, *, max_chars: int = 240) -> str | None:
    normalized = text.strip()
    if not normalized:
        return None
    if len(normalized) <= max_chars:
        return normalized
    return f"{normalized[:max_chars]}..."


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
    async with httpx.AsyncClient(timeout=5.0) as client:
        for attempt in range(1, total_attempts + 1):
            attempt_started = time.perf_counter()
            try:
                response = await client.get(f"{runtime_url}/health")
                if response.is_success:
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
                        status_code=response.status_code,
                        elapsed_ms=duration_ms(attempt_started),
                        response_preview=_response_preview(response.text),
                    )
            except httpx.HTTPError as exc:
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
        async with httpx.AsyncClient(timeout=5.0) as client:
            auth_response = await client.get(
                f"{runtime_url}/v1/agents",
                headers=_auth_headers(access_token),
            )

            if not auth_response.is_success:
                log_cloud_event(
                    "cloud runtime auth verification rejected bearer token",
                    level=logging.WARNING,
                    workspace_id=workspace_id,
                    runtime_url=runtime_url,
                    elapsed_ms=duration_ms(verify_started),
                    status_code=auth_response.status_code,
                    response_preview=_response_preview(auth_response.text),
                )
                if auth_response.status_code == 401:
                    raise CloudRuntimeReconnectError(
                        "Runtime rejected the stored bearer token during auth verification."
                    )
                raise CloudRuntimeReconnectError(
                    "Runtime failed authenticated auth verification in the cloud sandbox."
                )

            unauth_response = await client.get(f"{runtime_url}/v1/agents")
    except httpx.HTTPError as exc:
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

    if unauth_response.status_code != 401:
        log_cloud_event(
            "cloud runtime auth verification accepted unauthenticated request",
            level=logging.WARNING,
            workspace_id=workspace_id,
            runtime_url=runtime_url,
            elapsed_ms=duration_ms(verify_started),
            status_code=unauth_response.status_code,
            response_preview=_response_preview(unauth_response.text),
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


async def update_runtime_worktree_retention_policy(
    runtime_url: str,
    access_token: str,
    *,
    max_materialized_worktrees_per_repo: int,
    workspace_id: UUID | None = None,
) -> None:
    sync_started = time.perf_counter()
    log_cloud_event(
        "cloud runtime worktree policy sync started",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        max_materialized_worktrees_per_repo=max_materialized_worktrees_per_repo,
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.put(
                f"{runtime_url}/v1/worktrees/retention-policy",
                headers=_auth_headers(access_token),
                json={
                    "maxMaterializedWorktreesPerRepo": max_materialized_worktrees_per_repo,
                },
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError(
            "Failed to sync cloud worktree retention policy to the runtime."
        ) from exc
    log_cloud_event(
        "cloud runtime worktree policy sync finished",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        max_materialized_worktrees_per_repo=max_materialized_worktrees_per_repo,
        elapsed_ms=duration_ms(sync_started),
    )


async def run_runtime_worktree_retention(
    runtime_url: str,
    access_token: str,
    *,
    workspace_id: UUID | None = None,
) -> None:
    run_started = time.perf_counter()
    log_cloud_event(
        "cloud runtime deferred worktree retention run started",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
    )
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{runtime_url}/v1/worktrees/retention/run",
                headers=_auth_headers(access_token),
                json={},
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError(
            "Failed to run deferred cloud worktree retention cleanup."
        ) from exc
    log_cloud_event(
        "cloud runtime deferred worktree retention run finished",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        elapsed_ms=duration_ms(run_started),
    )


async def _list_remote_agents(
    runtime_url: str,
    access_token: str,
    *,
    workspace_id: UUID | None = None,
) -> list[dict[str, Any]]:
    list_started = time.perf_counter()
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{runtime_url}/v1/agents",
            headers=_auth_headers(access_token),
        )
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, list):
        raise CloudRuntimeReconnectError("Cloud runtime did not return a valid agent list.")
    agent_summaries = [item for item in payload if isinstance(item, dict)]
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
) -> dict[str, Any]:
    install_started = time.perf_counter()
    log_cloud_event(
        "cloud runtime agent install started",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        agent=kind,
    )
    try:
        async with httpx.AsyncClient(timeout=_agent_install_timeout_seconds(kind)) as client:
            response = await client.post(
                f"{runtime_url}/v1/agents/{kind}/install",
                headers=_auth_headers(access_token),
                json={},
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.ReadTimeout as exc:
        raise CloudRuntimeReconnectError(
            f"Timed out while preparing cloud agent '{kind}'."
        ) from exc
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError(f"Failed to prepare cloud agent '{kind}': {exc}") from exc

    if not isinstance(payload, dict):
        raise CloudRuntimeReconnectError(
            f"Cloud runtime returned an invalid install response for agent '{kind}'."
        )

    agent_summary = payload.get("agent")
    already_installed = payload.get("alreadyInstalled")
    if not isinstance(agent_summary, dict):
        raise CloudRuntimeReconnectError(
            f"Cloud runtime did not return agent status after installing '{kind}'."
        )

    log_cloud_event(
        "cloud runtime agent install finished",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        agent=kind,
        elapsed_ms=duration_ms(install_started),
        already_installed=already_installed,
        readiness=agent_summary.get("readiness"),
        credential_state=agent_summary.get("credentialState"),
    )
    return agent_summary


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
    synced_providers: Sequence[str],
) -> list[str]:
    reconcile_started = time.perf_counter()
    log_cloud_event(
        "cloud runtime reconcile started",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        synced_providers=",".join(synced_providers) or "none",
    )
    initial_summaries = await _list_remote_agents(
        runtime_url,
        access_token,
        workspace_id=workspace_id,
    )
    providers_to_install = _install_required_synced_providers(initial_summaries, synced_providers)
    providers_ready_from_template = _synced_ready_providers(initial_summaries, synced_providers)
    log_cloud_event(
        "cloud runtime reconcile assessed",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        synced_providers=",".join(synced_providers) or "none",
        ready_from_template=",".join(providers_ready_from_template) or "none",
        install_required=",".join(providers_to_install) or "none",
        agents=_agent_readiness_summary(initial_summaries),
    )
    install_summaries: list[dict[str, Any]] = []
    for provider in providers_to_install:
        install_summaries.append(
            await _install_remote_agent(
                runtime_url,
                access_token,
                provider,
                workspace_id=workspace_id,
            )
        )
    dict_summaries = (
        await _list_remote_agents(
            runtime_url,
            access_token,
            workspace_id=workspace_id,
        )
        if providers_to_install
        else initial_summaries
    )
    ready_agent_kinds = _ready_cloud_agents_from_summaries(dict_summaries)
    log_cloud_event(
        "cloud runtime reconcile finished",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        elapsed_ms=duration_ms(reconcile_started),
        ready_agents=",".join(ready_agent_kinds) or "none",
        agents=_agent_readiness_summary(dict_summaries),
        prepared_agents=_agent_readiness_summary(install_summaries),
        ready_from_template=",".join(providers_ready_from_template) or "none",
        install_required=",".join(providers_to_install) or "none",
        installed_count=len(install_summaries),
    )
    if not any(provider in ready_agent_kinds for provider in synced_providers):
        raise CloudRuntimeReconnectError(
            "No synced cloud agents became ready in the cloud sandbox runtime."
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
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            f"{runtime_url}/v1/workspaces/resolve",
            headers=_auth_headers(access_token),
            json={
                "path": runtime_workdir,
                "origin": {"kind": "human", "entrypoint": "cloud"},
            },
        )
        response.raise_for_status()
        try:
            payload = response.json()
        except ValueError as exc:
            raise CloudRuntimeReconnectError(
                "Cloud runtime returned invalid JSON when resolving the AnyHarness workspace."
            ) from exc

    if not isinstance(payload, dict):
        raise CloudRuntimeReconnectError(
            "Cloud runtime did not return a valid AnyHarness workspace id."
        )

    workspace = payload.get("workspace")
    if not isinstance(workspace, dict):
        raise CloudRuntimeReconnectError(
            "Cloud runtime did not return a valid AnyHarness workspace id."
        )

    remote_workspace_id = workspace.get("id")
    if not isinstance(remote_workspace_id, str) or not remote_workspace_id:
        raise CloudRuntimeReconnectError(
            "Cloud runtime did not return a valid AnyHarness workspace id."
        )
    remote_repo_root_id = workspace.get("repoRootId")
    if not isinstance(remote_repo_root_id, str) or not remote_repo_root_id:
        repo_root = payload.get("repoRoot")
        if isinstance(repo_root, dict):
            remote_repo_root_id = repo_root.get("id")
    if not isinstance(remote_repo_root_id, str) or not remote_repo_root_id:
        raise CloudRuntimeReconnectError(
            "Cloud runtime did not return a valid AnyHarness repo root id."
        )
    log_cloud_event(
        "cloud runtime workspace resolved",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        elapsed_ms=duration_ms(resolve_started),
        remote_workspace_id=remote_workspace_id,
        remote_repo_root_id=remote_repo_root_id,
    )
    return ResolvedRemoteWorkspace(
        workspace_id=remote_workspace_id,
        repo_root_id=remote_repo_root_id,
    )


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
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{runtime_url}/v1/repo-roots/{repo_root_id}/mobility/prepare-destination",
            headers=_auth_headers(access_token),
            json={
                "requestedBranch": requested_branch,
                "requestedBaseSha": requested_base_sha,
                "destinationId": destination_id,
                "preferredWorkspaceName": preferred_workspace_name,
            },
        )
        response.raise_for_status()
        try:
            payload = response.json()
        except ValueError as exc:
            raise CloudRuntimeReconnectError(
                "Cloud runtime returned invalid JSON when preparing a worktree destination."
            ) from exc

    if not isinstance(payload, dict) or not isinstance(payload.get("workspace"), dict):
        raise CloudRuntimeReconnectError(
            "Cloud runtime did not return a valid prepared workspace."
        )
    workspace = payload["workspace"]
    remote_workspace_id = workspace.get("id")
    remote_repo_root_id = workspace.get("repoRootId")
    if not isinstance(remote_workspace_id, str) or not remote_workspace_id:
        raise CloudRuntimeReconnectError(
            "Cloud runtime did not return a valid prepared workspace id."
        )
    if not isinstance(remote_repo_root_id, str) or not remote_repo_root_id:
        raise CloudRuntimeReconnectError(
            "Cloud runtime did not return a valid prepared repo root id."
        )
    log_cloud_event(
        "cloud runtime worktree destination prepared",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        elapsed_ms=duration_ms(prepare_started),
        remote_workspace_id=remote_workspace_id,
        remote_repo_root_id=remote_repo_root_id,
        destination_id=destination_id,
    )
    return ResolvedRemoteWorkspace(
        workspace_id=remote_workspace_id,
        repo_root_id=remote_repo_root_id,
    )
