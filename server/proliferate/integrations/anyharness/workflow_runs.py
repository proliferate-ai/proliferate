"""AnyHarness runtime workflow-run delivery + read helpers (spec 3.2 cloud lane).

The raw HTTP to sandbox anyharness lives here (the integration boundary), not in
the product workflows domain — same split as ``workspaces.py``. Callers pass a
resolved gateway ``runtime_url`` + ``access_token``; failures surface as
``CloudRuntimeReconnectError`` for the product layer to classify.
"""

from __future__ import annotations

import httpx

from proliferate.integrations.anyharness.client import auth_headers
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError

_WORKFLOW_RUNS_PATH = "/v1/workflow-runs"


def _client(runtime_url: str, access_token: str, timeout: float) -> httpx.AsyncClient:
    """Build the gateway-authenticated client (swapped for a MockTransport in tests)."""

    return httpx.AsyncClient(
        base_url=runtime_url.rstrip("/"),
        headers=auth_headers(access_token),
        timeout=timeout,
        follow_redirects=False,
    )


async def deliver_workflow_run(
    runtime_url: str,
    access_token: str,
    *,
    plan: dict[str, object],
    workspace_id: str,
    timeout: float,
) -> None:
    """POST the resolved plan to the runtime. Idempotent: anyharness dedupes on
    the plan's ``run_id`` and echoes 202 for a re-delivery."""

    try:
        async with _client(runtime_url, access_token, timeout) as client:
            response = await client.post(
                _WORKFLOW_RUNS_PATH,
                json={"plan": plan, "workspaceId": workspace_id},
            )
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError(str(exc) or exc.__class__.__name__) from exc
    if response.status_code != httpx.codes.ACCEPTED:
        raise CloudRuntimeReconnectError(
            f"Sandbox rejected workflow delivery (status {response.status_code})."
        )


async def cancel_workflow_run(
    runtime_url: str,
    access_token: str,
    *,
    run_id: str,
    timeout: float,
) -> None:
    """POST the runtime's take-over/cancel (D15 runtime half): stop the live actor
    at the next step boundary and best-effort tear down the in-flight turn. The
    server has already flipped the run terminal + released ownership, so this is a
    best-effort nudge — a 404 (runtime never saw the run, or already forgot it) is
    benign and swallowed by the caller."""

    try:
        async with _client(runtime_url, access_token, timeout) as client:
            response = await client.post(f"{_WORKFLOW_RUNS_PATH}/{run_id}/cancel")
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError(str(exc) or exc.__class__.__name__) from exc
    if response.status_code not in (
        httpx.codes.OK,
        httpx.codes.ACCEPTED,
        httpx.codes.NO_CONTENT,
        httpx.codes.NOT_FOUND,
    ):
        raise CloudRuntimeReconnectError(
            f"Sandbox rejected workflow cancel (status {response.status_code})."
        )


async def read_workflow_run(
    runtime_url: str,
    access_token: str,
    *,
    run_id: str,
    timeout: float,
) -> dict[str, object] | None:
    """Read the runtime's run view. ``None`` when the runtime has no such run (404)."""

    try:
        async with _client(runtime_url, access_token, timeout) as client:
            response = await client.get(f"{_WORKFLOW_RUNS_PATH}/{run_id}")
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError(str(exc) or exc.__class__.__name__) from exc
    if response.status_code == httpx.codes.NOT_FOUND:
        return None
    if response.status_code != httpx.codes.OK:
        raise CloudRuntimeReconnectError(
            f"Sandbox refresh read failed (status {response.status_code})."
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise CloudRuntimeReconnectError(
            "Cloud runtime returned invalid JSON for a workflow run view."
        ) from exc
    return payload if isinstance(payload, dict) else {}
