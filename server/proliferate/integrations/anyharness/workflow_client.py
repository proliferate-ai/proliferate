"""Shared secret-safe transport classification for managed Workflow calls."""

from __future__ import annotations

import httpx

from proliferate.integrations.anyharness.errors import WorkflowRuntimeError


def classify_status(status_code: int, *, operation: str) -> WorkflowRuntimeError:
    if status_code in {401, 403}:
        return WorkflowRuntimeError(
            f"{operation}_authentication_failed",
            authentication=True,
        )
    if status_code == 404:
        return WorkflowRuntimeError(f"{operation}_not_found", not_found=True)
    if status_code in {400, 409, 422}:
        return WorkflowRuntimeError(f"{operation}_rejected")
    if status_code >= 500:
        return WorkflowRuntimeError(f"{operation}_unavailable", retryable=True)
    return WorkflowRuntimeError(f"{operation}_unexpected_status")


def classify_transport(operation: str) -> WorkflowRuntimeError:
    return WorkflowRuntimeError(f"{operation}_unreachable", retryable=True)


async def request_json(
    method: str,
    url: str,
    *,
    access_token: str,
    operation: str,
    expected_statuses: frozenset[int],
    body: dict[str, object] | None = None,
    timeout_seconds: float = 30.0,
) -> tuple[int, object]:
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.request(
                method,
                url,
                headers={"Authorization": f"Bearer {access_token}"},
                json=body,
            )
    except httpx.HTTPError as error:
        raise classify_transport(operation) from error
    if response.status_code not in expected_statuses:
        raise classify_status(response.status_code, operation=operation)
    try:
        return response.status_code, response.json()
    except ValueError as error:
        raise WorkflowRuntimeError(f"{operation}_invalid_response") from error
