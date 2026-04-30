"""AnyHarness session helpers for remote cloud runtimes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from proliferate.server.cloud.runtime.anyharness_api import (
    CloudRuntimeReconnectError,
    _auth_headers,
    _response_preview,
)


@dataclass(frozen=True)
class RemoteSession:
    session_id: str


class CloudRuntimeRequestRejectedError(CloudRuntimeReconnectError):
    """Runtime definitively rejected a session API request."""


class CloudRuntimePromptDeliveryUncertainError(CloudRuntimeReconnectError):
    """Prompt request was sent but the delivery outcome is unknown."""


def _safe_runtime_error(action: str, response: httpx.Response) -> CloudRuntimeRequestRejectedError:
    preview = _response_preview(response.text)
    suffix = f" Response: {preview}" if preview else ""
    return CloudRuntimeRequestRejectedError(
        f"Cloud runtime failed to {action} (status {response.status_code}).{suffix}"
    )


def _safe_prompt_error(action: str, response: httpx.Response) -> CloudRuntimeReconnectError:
    if response.status_code >= 500:
        return CloudRuntimePromptDeliveryUncertainError(
            f"Cloud runtime prompt delivery outcome is uncertain (status {response.status_code})."
        )
    return _safe_runtime_error(action, response)


async def create_runtime_session(
    runtime_url: str,
    access_token: str,
    *,
    anyharness_workspace_id: str,
    agent_kind: str,
    model_id: str | None,
    mode_id: str | None,
) -> RemoteSession:
    body: dict[str, Any] = {
        "workspaceId": anyharness_workspace_id,
        "agentKind": agent_kind,
        "origin": {"kind": "system", "entrypoint": "cloud"},
    }
    if model_id:
        body["modelId"] = model_id
    if mode_id:
        body["modeId"] = mode_id

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{runtime_url}/v1/sessions",
                headers=_auth_headers(access_token),
                json=body,
            )
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Failed to create automation runtime session.") from exc

    if not response.is_success:
        raise _safe_runtime_error("create automation runtime session", response)

    try:
        payload = response.json()
    except ValueError as exc:
        raise CloudRuntimeReconnectError(
            "Cloud runtime returned invalid JSON when creating an automation session."
        ) from exc
    if not isinstance(payload, dict):
        raise CloudRuntimeReconnectError("Cloud runtime returned an invalid session payload.")
    session_id = payload.get("id")
    if not isinstance(session_id, str) or not session_id:
        raise CloudRuntimeReconnectError("Cloud runtime did not return a valid session id.")
    return RemoteSession(session_id=session_id)


async def prompt_runtime_session(
    runtime_url: str,
    access_token: str,
    *,
    session_id: str,
    prompt: str,
) -> None:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{runtime_url}/v1/sessions/{session_id}/prompt",
                headers=_auth_headers(access_token),
                json={"blocks": [{"type": "text", "text": prompt}]},
            )
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
        raise CloudRuntimeReconnectError(
            "Failed to connect before sending automation prompt."
        ) from exc
    except (httpx.ReadTimeout, httpx.WriteTimeout, httpx.RemoteProtocolError) as exc:
        raise CloudRuntimePromptDeliveryUncertainError(
            "Automation prompt delivery outcome is uncertain."
        ) from exc
    except httpx.TransportError as exc:
        raise CloudRuntimePromptDeliveryUncertainError(
            "Automation prompt delivery outcome is uncertain."
        ) from exc

    if not response.is_success:
        raise _safe_prompt_error("send automation prompt", response)


async def close_runtime_session(
    runtime_url: str,
    access_token: str,
    *,
    session_id: str,
) -> None:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{runtime_url}/v1/sessions/{session_id}/close",
                headers=_auth_headers(access_token),
            )
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Failed to close automation runtime session.") from exc

    if not response.is_success:
        raise _safe_runtime_error("close automation runtime session", response)
