"""AnyHarness runtime health, auth, and agent operations."""

from __future__ import annotations

from typing import Any

import httpx

from proliferate.integrations.anyharness.client import (
    auth_headers,
    rejected_response_message,
    response_preview,
)
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.models import (
    RemoteAgentInstallResult,
    RemoteAgentSummary,
    RuntimeAuthProbe,
    RuntimeHealthProbe,
)


def _agent_install_timeout_seconds(kind: str) -> float:
    if kind == "codex":
        return 1800.0
    return 180.0


def _parse_agent_summary(
    payload: object,
    *,
    fallback_kind: str | None = None,
) -> RemoteAgentSummary | None:
    if not isinstance(payload, dict):
        return None
    kind = payload.get("kind")
    if not isinstance(kind, str):
        kind = fallback_kind
    if not isinstance(kind, str):
        return None
    readiness = payload.get("readiness")
    credential_state = payload.get("credentialState")
    return RemoteAgentSummary(
        kind=kind,
        readiness=readiness if isinstance(readiness, str) else None,
        credential_state=credential_state if isinstance(credential_state, str) else None,
    )


async def probe_runtime_health(runtime_url: str) -> RuntimeHealthProbe:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{runtime_url}/health")
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Cloud runtime health probe failed.") from exc
    return RuntimeHealthProbe(
        is_success=response.is_success,
        status_code=response.status_code,
        response_preview=response_preview(response.text),
    )


async def check_runtime_auth_enforcement(
    runtime_url: str,
    access_token: str,
) -> RuntimeAuthProbe:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            auth_response = await client.get(
                f"{runtime_url}/v1/agents",
                headers=auth_headers(access_token),
            )
            unauth_response = (
                await client.get(f"{runtime_url}/v1/agents") if auth_response.is_success else None
            )
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError(
            "Failed to verify bearer authentication on the cloud runtime."
        ) from exc

    return RuntimeAuthProbe(
        authenticated_success=auth_response.is_success,
        authenticated_status_code=auth_response.status_code,
        authenticated_response_preview=response_preview(auth_response.text),
        unauthenticated_status_code=(
            unauth_response.status_code if unauth_response is not None else None
        ),
        unauthenticated_response_preview=(
            response_preview(unauth_response.text) if unauth_response is not None else None
        ),
    )


async def list_runtime_agents(
    runtime_url: str,
    access_token: str,
) -> list[RemoteAgentSummary]:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{runtime_url}/v1/agents",
                headers=auth_headers(access_token),
            )
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Failed to list cloud runtime agents.") from exc
    if not response.is_success:
        raise CloudRuntimeReconnectError(
            rejected_response_message(
                "list cloud runtime agents", response.status_code, response.text
            )
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise CloudRuntimeReconnectError(
            "Cloud runtime returned invalid JSON when listing cloud runtime agents."
        ) from exc
    if not isinstance(payload, list):
        raise CloudRuntimeReconnectError("Cloud runtime did not return a valid agent list.")
    return [summary for item in payload if (summary := _parse_agent_summary(item)) is not None]


async def install_runtime_agent(
    runtime_url: str,
    access_token: str,
    kind: str,
) -> RemoteAgentInstallResult:
    try:
        async with httpx.AsyncClient(timeout=_agent_install_timeout_seconds(kind)) as client:
            response = await client.post(
                f"{runtime_url}/v1/agents/{kind}/install",
                headers=auth_headers(access_token),
                json={},
            )
    except httpx.ReadTimeout as exc:
        raise CloudRuntimeReconnectError(
            f"Timed out while preparing cloud agent '{kind}'."
        ) from exc
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError(f"Failed to prepare cloud agent '{kind}': {exc}") from exc
    if not response.is_success:
        raise CloudRuntimeReconnectError(
            rejected_response_message(
                f"prepare cloud agent '{kind}'",
                response.status_code,
                response.text,
            )
        )
    try:
        payload: Any = response.json()
    except ValueError as exc:
        raise CloudRuntimeReconnectError(
            f"Cloud runtime returned invalid JSON after installing '{kind}'."
        ) from exc

    if not isinstance(payload, dict):
        raise CloudRuntimeReconnectError(
            f"Cloud runtime returned an invalid install response for agent '{kind}'."
        )

    agent = _parse_agent_summary(payload.get("agent"), fallback_kind=kind)
    if agent is None:
        raise CloudRuntimeReconnectError(
            f"Cloud runtime did not return agent status after installing '{kind}'."
        )

    already_installed = payload.get("alreadyInstalled")
    return RemoteAgentInstallResult(
        agent=agent,
        already_installed=already_installed if isinstance(already_installed, bool) else None,
    )


async def apply_runtime_config(
    runtime_url: str,
    access_token: str,
    body: dict[str, object],
) -> dict[str, object]:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.put(
                f"{runtime_url}/v1/runtime-config",
                headers=auth_headers(access_token),
                json=body,
            )
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Failed to apply cloud runtime config.") from exc
    if not response.is_success:
        preview = response_preview(response.text)
        suffix = f" Response: {preview}" if preview else ""
        raise CloudRuntimeReconnectError(
            f"Cloud runtime rejected runtime config (status {response.status_code}).{suffix}"
        )
    try:
        payload: object = response.json()
    except ValueError as exc:
        raise CloudRuntimeReconnectError(
            "Cloud runtime returned invalid JSON after applying runtime config."
        ) from exc
    if not isinstance(payload, dict):
        raise CloudRuntimeReconnectError(
            "Cloud runtime returned an invalid runtime config apply response."
        )
    return payload
