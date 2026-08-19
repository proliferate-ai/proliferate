"""AnyHarness runtime session operations."""

from __future__ import annotations

import httpx

from proliferate.integrations.anyharness.client import auth_headers, response_preview
from proliferate.integrations.anyharness.errors import (
    CloudRuntimePromptDeliveryUncertainError,
    CloudRuntimeReconnectError,
    CloudRuntimeRequestRejectedError,
)


def _safe_runtime_error(action: str, response: httpx.Response) -> CloudRuntimeRequestRejectedError:
    preview = response_preview(response.text)
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
                headers=auth_headers(access_token),
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
                headers=auth_headers(access_token),
            )
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Failed to close automation runtime session.") from exc

    if not response.is_success:
        raise _safe_runtime_error("close automation runtime session", response)
