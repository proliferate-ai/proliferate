"""AnyHarness session helpers for remote cloud runtimes."""

from __future__ import annotations

import asyncio
import time
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


CONFIG_APPLY_POLL_INTERVAL_SECONDS = 1.0
CONFIG_APPLY_TIMEOUT_SECONDS = 30.0


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


def _extract_reasoning_control(payload: dict[str, Any]) -> dict[str, Any] | None:
    live_config = payload.get("liveConfig")
    if not isinstance(live_config, dict):
        return None
    normalized_controls = live_config.get("normalizedControls")
    if not isinstance(normalized_controls, dict):
        return None
    effort = normalized_controls.get("effort")
    return effort if isinstance(effort, dict) else None


def _reasoning_control_accepts_value(control: dict[str, Any], value: str) -> bool:
    values = control.get("values")
    return isinstance(values, list) and any(
        isinstance(candidate, dict) and candidate.get("value") == value for candidate in values
    )


async def apply_runtime_reasoning_effort(
    runtime_url: str,
    access_token: str,
    *,
    session_id: str,
    reasoning_effort: str | None,
    timeout_seconds: float = CONFIG_APPLY_TIMEOUT_SECONDS,
    poll_interval_seconds: float = CONFIG_APPLY_POLL_INTERVAL_SECONDS,
) -> None:
    if not reasoning_effort:
        return

    deadline = time.monotonic() + timeout_seconds
    attempted_apply = False
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            while time.monotonic() < deadline:
                live_response = await client.get(
                    f"{runtime_url}/v1/sessions/{session_id}/live-config",
                    headers=_auth_headers(access_token),
                )
                if not live_response.is_success:
                    raise _safe_runtime_error("load automation runtime config", live_response)
                try:
                    live_payload = live_response.json()
                except ValueError as exc:
                    raise CloudRuntimeReconnectError(
                        "Cloud runtime returned invalid JSON when loading session config."
                    ) from exc
                if not isinstance(live_payload, dict):
                    raise CloudRuntimeReconnectError(
                        "Cloud runtime returned an invalid session config payload."
                    )

                effort = _extract_reasoning_control(live_payload)
                if effort is None:
                    await asyncio.sleep(poll_interval_seconds)
                    continue
                if effort.get("currentValue") == reasoning_effort:
                    return
                if not _reasoning_control_accepts_value(effort, reasoning_effort):
                    raise CloudRuntimeRequestRejectedError(
                        "Cloud runtime does not support the requested reasoning effort."
                    )

                raw_config_id = effort.get("rawConfigId")
                if not isinstance(raw_config_id, str) or not raw_config_id:
                    raise CloudRuntimeReconnectError(
                        "Cloud runtime returned a reasoning control without a config id."
                    )

                if not attempted_apply:
                    apply_response = await client.post(
                        f"{runtime_url}/v1/sessions/{session_id}/config-options",
                        headers=_auth_headers(access_token),
                        json={"configId": raw_config_id, "value": reasoning_effort},
                    )
                    if not apply_response.is_success:
                        raise _safe_runtime_error(
                            "apply automation runtime config",
                            apply_response,
                        )
                    try:
                        apply_payload = apply_response.json()
                    except ValueError as exc:
                        raise CloudRuntimeReconnectError(
                            "Cloud runtime returned invalid JSON when applying session config."
                        ) from exc
                    if not isinstance(apply_payload, dict):
                        raise CloudRuntimeReconnectError(
                            "Cloud runtime returned an invalid config apply payload."
                        )
                    apply_state = apply_payload.get("applyState")
                    if apply_state == "applied":
                        return
                    if apply_state != "queued":
                        raise CloudRuntimeRequestRejectedError(
                            "Cloud runtime rejected the requested reasoning effort."
                        )
                    attempted_apply = True

                await asyncio.sleep(poll_interval_seconds)
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Failed to apply automation runtime config.") from exc

    raise CloudRuntimeReconnectError("Timed out applying automation runtime config.")


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
