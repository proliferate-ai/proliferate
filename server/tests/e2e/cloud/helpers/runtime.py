from __future__ import annotations

import json
import time

import httpx

from tests.e2e.cloud.helpers.shared import (
    CloudE2ETestError,
    DEFAULT_RUNTIME_SMOKE_TIMEOUT_SECONDS,
    RuntimeSmokeResult,
    require_string,
)


async def runtime_health_check(
    connection: dict[str, object],
    *,
    provider_kind: str,
) -> dict[str, object]:
    del provider_kind
    runtime_url = require_string(connection, "runtimeUrl")
    access_token = require_string(connection, "accessToken")
    workspace_id = require_string(connection, "anyharnessWorkspaceId")
    async with httpx.AsyncClient(timeout=30.0) as client:
        health = await client.get(f"{runtime_url}/health")
        health.raise_for_status()
        workspace = await client.get(
            f"{runtime_url}/v1/workspaces/{workspace_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        workspace.raise_for_status()
        payload = workspace.json()
        if payload.get("id") != workspace_id:
            raise CloudE2ETestError(
                f"Runtime workspace mismatch: expected {workspace_id}, got {payload.get('id')}"
            )
        return {"health": health.json(), "workspace": payload}


async def runtime_single_query_smoke(
    connection: dict[str, object],
    *,
    agent_kind: str,
    prompt_text: str = "Reply with exactly OK",
    timeout_seconds: float = DEFAULT_RUNTIME_SMOKE_TIMEOUT_SECONDS,
) -> RuntimeSmokeResult:
    runtime_url = require_string(connection, "runtimeUrl")
    access_token = require_string(connection, "accessToken")
    workspace_id = require_string(connection, "anyharnessWorkspaceId")
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=60.0) as client:
        create = await client.post(
            f"{runtime_url}/v1/sessions",
            headers=headers,
            json={"workspaceId": workspace_id, "agentKind": agent_kind},
        )
        create.raise_for_status()
        session = create.json()
        session_id = require_string(session, "id")
        prompt = await client.post(
            f"{runtime_url}/v1/sessions/{session_id}/prompt",
            headers=headers,
            json={"blocks": [{"type": "text", "text": prompt_text}]},
        )
        prompt.raise_for_status()
        try:
            events = await collect_session_events_until_turn_end(
                runtime_url=runtime_url,
                access_token=access_token,
                session_id=session_id,
                timeout_seconds=timeout_seconds,
            )
        finally:
            await client.post(
                f"{runtime_url}/v1/sessions/{session_id}/close",
                headers=headers,
                json={},
            )

    assistant_events = [
        envelope
        for envelope in events
        if envelope.get("event", {}).get("type") in {"item_started", "item_completed"}
        and envelope.get("event", {}).get("item", {}).get("kind") == "assistant_message"
    ]
    if not assistant_events:
        raise CloudE2ETestError("Runtime smoke did not produce an assistant item.")
    if not any(envelope.get("event", {}).get("type") == "turn_ended" for envelope in events):
        raise CloudE2ETestError("Runtime smoke did not emit a closing turn_ended event.")
    return RuntimeSmokeResult(session_id=session_id, events=events)


async def collect_session_events_until_turn_end(
    *,
    runtime_url: str,
    access_token: str,
    session_id: str,
    timeout_seconds: float,
) -> list[dict[str, object]]:
    deadline = time.monotonic() + timeout_seconds
    events: list[dict[str, object]] = []
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "text/event-stream"}
    async with (
        httpx.AsyncClient(timeout=None) as client,
        client.stream(
            "GET",
            f"{runtime_url}/v1/sessions/{session_id}/stream?after_seq=0",
            headers=headers,
        ) as response,
    ):
        response.raise_for_status()
        data_lines: list[str] = []
        async for line in response.aiter_lines():
            if time.monotonic() >= deadline:
                raise CloudE2ETestError("Timed out waiting for streamed turn completion.")
            if line == "":
                if not data_lines:
                    continue
                envelope = json.loads("\n".join(data_lines))
                data_lines = []
                if isinstance(envelope, dict):
                    events.append(envelope)
                    if envelope.get("event", {}).get("type") == "turn_ended":
                        return events
                continue
            if line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
    raise CloudE2ETestError("Session stream ended before emitting turn_ended.")


async def assert_workspace_sane(
    connection: dict[str, object],
    *,
    expected_branch: str,
    agent_kind: str,
) -> dict[str, object]:
    runtime_url = require_string(connection, "runtimeUrl")
    access_token = require_string(connection, "accessToken")
    workspace_id = require_string(connection, "anyharnessWorkspaceId")
    headers = {"Authorization": f"Bearer {access_token}"}

    async with httpx.AsyncClient(timeout=60.0) as client:
        health = await client.get(f"{runtime_url}/health")
        health.raise_for_status()

        workspace = await client.get(
            f"{runtime_url}/v1/workspaces/{workspace_id}",
            headers=headers,
        )
        workspace.raise_for_status()
        workspace_payload = workspace.json()
        if workspace_payload.get("id") != workspace_id:
            raise CloudE2ETestError(
                "Runtime workspace mismatch: "
                f"expected {workspace_id}, got {workspace_payload.get('id')}"
            )

        git_status = await client.get(
            f"{runtime_url}/v1/workspaces/{workspace_id}/git/status",
            headers=headers,
        )
        git_status.raise_for_status()

        branches_response = await client.get(
            f"{runtime_url}/v1/workspaces/{workspace_id}/git/branches",
            headers=headers,
        )
        branches_response.raise_for_status()
        branches_payload = branches_response.json()
        if not isinstance(branches_payload, list):
            raise CloudE2ETestError("Runtime git branch list was not a list.")

        head_branch = next(
            (
                branch
                for branch in branches_payload
                if isinstance(branch, dict)
                and branch.get("name") == expected_branch
                and branch.get("isHead") is True
            ),
            None,
        )
        if head_branch is None:
            raise CloudE2ETestError(
                f"Expected runtime branch {expected_branch!r} to be checked out."
            )

    smoke = await runtime_single_query_smoke(connection, agent_kind=agent_kind)
    return {
        "health": health.json(),
        "workspace": workspace_payload,
        "gitStatus": git_status.json(),
        "branches": branches_payload,
        "smoke": smoke,
    }
