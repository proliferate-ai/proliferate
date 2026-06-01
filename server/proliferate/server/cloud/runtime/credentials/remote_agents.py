"""Agent readiness reconciliation for managed AnyHarness runtimes."""

from __future__ import annotations

import time
from collections.abc import Sequence
from uuid import UUID

from proliferate.constants.cloud import SUPPORTED_CLOUD_AGENTS
from proliferate.integrations import anyharness
from proliferate.integrations.anyharness import CloudRuntimeReconnectError, RemoteAgentSummary
from proliferate.server.cloud._logging import log_cloud_event
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


def _auth_overlay_ready_agent_kinds(
    agent_summaries: Sequence[RemoteAgentSummary],
    auth_overlay_agent_kinds: Sequence[str],
) -> list[str]:
    """Agents whose binaries are present and only need launch-time auth overlay."""
    auth_overlay_kinds = set(auth_overlay_agent_kinds)
    ready: list[str] = []
    for item in agent_summaries:
        if item.kind not in SUPPORTED_CLOUD_AGENTS or item.kind not in auth_overlay_kinds:
            continue
        if item.readiness in {"login_required", "credentials_required"}:
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
    auth_overlay_agent_kinds: Sequence[str] = (),
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
    agent_kinds_ready_from_auth_overlay = _auth_overlay_ready_agent_kinds(
        initial_summaries,
        auth_overlay_agent_kinds,
    )
    log_cloud_event(
        "cloud runtime reconcile assessed",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        required_agents=",".join(required_agent_kinds) or "none",
        ready_from_template=",".join(agent_kinds_ready_from_template) or "none",
        ready_from_auth_overlay=",".join(agent_kinds_ready_from_auth_overlay) or "none",
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
    ready_agent_kinds = sorted(
        set(_ready_cloud_agents_from_summaries(agent_summaries))
        | set(_auth_overlay_ready_agent_kinds(agent_summaries, auth_overlay_agent_kinds))
    )
    log_cloud_event(
        "cloud runtime reconcile finished",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        elapsed_ms=duration_ms(reconcile_started),
        ready_agents=",".join(ready_agent_kinds) or "none",
        agents=_agent_readiness_summary(agent_summaries),
        prepared_agents=_agent_readiness_summary(install_summaries),
        ready_from_template=",".join(agent_kinds_ready_from_template) or "none",
        ready_from_auth_overlay=",".join(
            _auth_overlay_ready_agent_kinds(agent_summaries, auth_overlay_agent_kinds)
        )
        or "none",
        install_required=",".join(agent_kinds_to_install) or "none",
        installed_count=len(install_summaries),
    )
    if not any(agent_kind in ready_agent_kinds for agent_kind in required_agent_kinds):
        raise CloudRuntimeReconnectError(
            "No configured cloud agents became ready in the cloud sandbox runtime."
        )
    return ready_agent_kinds
