"""AnyHarness runtime drivers shared by the workspace-move E2E round-trip.

These helpers speak the raw runtime HTTP surface (``/v1/workspaces``,
``/v1/sessions``, SSE stream) directly, so the *same* functions drive both the
local macOS runtime the test spawns AND the cloud sandbox runtime reached over
its ``anyharness_base_url`` + bearer. They mirror the conventions already used
by ``helpers/runtime.py`` (bearer header, ``{"blocks": [...]}`` prompt body,
SSE ``data:`` framing) and by the black-box vitest driver
(``anyharness/tests/src/scenarios/workspaces/mobility-roundtrip.test.ts``): a
prompt's stream is pinned to the session's current high-water ``seq`` so a
native-resumed session's replayed backlog can never resolve the wait before the
new turn even starts.

The pure event helpers (``latest_event_seq``, ``assistant_message_texts``,
``turn_contains_text``) are deliberately dependency-free so they can be unit
tested without a running runtime.
"""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from tests.e2e.cloud.helpers.shared import CloudE2ETestError

_DEFAULT_RUNTIME_HTTP_TIMEOUT = 60.0


def latest_event_seq(events: list[dict[str, Any]]) -> int:
    """Highest ``seq`` across ``events`` (0 when empty).

    This is the ``after_seq`` a follow-up prompt must stream from: the runtime
    replays the full backlog from ``after_seq ?? 0``, so a resumed session
    (which carries prior turns by construction) would otherwise resolve on an
    old, replayed ``turn_ended``.
    """
    highest = 0
    for envelope in events:
        seq = envelope.get("seq")
        if isinstance(seq, int) and seq > highest:
            highest = seq
    return highest


def assistant_message_texts(events: list[dict[str, Any]]) -> list[str]:
    """Text of every assistant message item found in ``events``.

    Reads the ``contentParts`` of ``assistant_message`` transcript items
    (``TranscriptItemPayload`` in the events contract). Robust to both
    ``item_started`` and ``item_completed`` envelopes.
    """
    texts: list[str] = []
    for envelope in events:
        event = envelope.get("event")
        if not isinstance(event, dict):
            continue
        if event.get("type") not in {"item_started", "item_completed"}:
            continue
        item = event.get("item")
        if not isinstance(item, dict) or item.get("kind") != "assistant_message":
            continue
        parts = item.get("contentParts")
        if not isinstance(parts, list):
            continue
        for part in parts:
            if (
                isinstance(part, dict)
                and part.get("type") == "text"
                and isinstance(part.get("text"), str)
            ):
                texts.append(part["text"])
    return texts


def turn_contains_text(events: list[dict[str, Any]], needle: str) -> bool:
    """True if ``needle`` appears in the assistant output of ``events``.

    Recall prompts in this suite never contain the codeword themselves, so any
    occurrence in a turn's assistant output proves the model recalled it. The
    primary check inspects assistant-message content parts; the fallback scans
    raw item/delta envelopes for agents that stream prose only via deltas.
    """
    if any(needle in text for text in assistant_message_texts(events)):
        return True
    for envelope in events:
        event = envelope.get("event")
        if not isinstance(event, dict):
            continue
        if event.get("type") not in {"item_started", "item_delta", "item_completed"}:
            continue
        if needle in json.dumps(envelope):
            return True
    return False


def _headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def _require_ok(response: httpx.Response, action: str) -> None:
    if response.status_code >= 400:
        detail = response.text.strip() or "<empty response body>"
        raise CloudE2ETestError(
            f"Runtime call failed ({action}, {response.status_code}): {detail}"
        )


async def runtime_create_plain_workspace(
    runtime_url: str,
    access_token: str,
    *,
    path: str,
) -> dict[str, Any]:
    """Create (adopt) a plain-directory workspace at ``path`` (a git clone)."""
    async with httpx.AsyncClient(timeout=_DEFAULT_RUNTIME_HTTP_TIMEOUT) as client:
        response = await client.post(
            f"{runtime_url}/v1/workspaces",
            headers=_headers(access_token),
            json={"path": path},
        )
        _require_ok(response, "create workspace")
        return response.json()


async def runtime_create_session(
    runtime_url: str,
    access_token: str,
    *,
    workspace_id: str,
    agent_kind: str = "claude",
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=_DEFAULT_RUNTIME_HTTP_TIMEOUT) as client:
        response = await client.post(
            f"{runtime_url}/v1/sessions",
            headers=_headers(access_token),
            json={"workspaceId": workspace_id, "agentKind": agent_kind},
        )
        _require_ok(response, "create session")
        return response.json()


async def runtime_get_session(
    runtime_url: str,
    access_token: str,
    session_id: str,
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=_DEFAULT_RUNTIME_HTTP_TIMEOUT) as client:
        response = await client.get(
            f"{runtime_url}/v1/sessions/{session_id}",
            headers=_headers(access_token),
        )
        _require_ok(response, "get session")
        return response.json()


async def runtime_list_sessions(
    runtime_url: str,
    access_token: str,
    *,
    workspace_id: str,
) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=_DEFAULT_RUNTIME_HTTP_TIMEOUT) as client:
        response = await client.get(
            f"{runtime_url}/v1/sessions",
            headers=_headers(access_token),
            params={"workspace_id": workspace_id},
        )
        _require_ok(response, "list sessions")
        payload = response.json()
    if not isinstance(payload, list):
        raise CloudE2ETestError("Runtime session list was not a list.")
    return payload


async def runtime_list_events(
    runtime_url: str,
    access_token: str,
    session_id: str,
) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=_DEFAULT_RUNTIME_HTTP_TIMEOUT) as client:
        response = await client.get(
            f"{runtime_url}/v1/sessions/{session_id}/events",
            headers=_headers(access_token),
            params={"after_seq": 0},
        )
        _require_ok(response, "list session events")
        payload = response.json()
    if not isinstance(payload, list):
        raise CloudE2ETestError("Runtime session event list was not a list.")
    return payload


async def runtime_event_high_water(
    runtime_url: str,
    access_token: str,
    session_id: str,
) -> int:
    return latest_event_seq(await runtime_list_events(runtime_url, access_token, session_id))


async def runtime_prompt_and_collect(
    runtime_url: str,
    access_token: str,
    session_id: str,
    text: str,
    *,
    timeout_seconds: float,
) -> list[dict[str, Any]]:
    """Prompt ``session_id`` and stream just the new turn's events.

    Pins the stream to the session's current high-water ``seq`` before
    prompting so a resumed session's replayed backlog cannot short-circuit the
    wait (see the module docstring).
    """
    after_seq = await runtime_event_high_water(runtime_url, access_token, session_id)
    async with httpx.AsyncClient(timeout=_DEFAULT_RUNTIME_HTTP_TIMEOUT) as client:
        prompt = await client.post(
            f"{runtime_url}/v1/sessions/{session_id}/prompt",
            headers=_headers(access_token),
            json={"blocks": [{"type": "text", "text": text}]},
        )
        _require_ok(prompt, "prompt session")
    return await _collect_until_turn_end(
        runtime_url=runtime_url,
        access_token=access_token,
        session_id=session_id,
        after_seq=after_seq,
        timeout_seconds=timeout_seconds,
    )


async def _collect_until_turn_end(
    *,
    runtime_url: str,
    access_token: str,
    session_id: str,
    after_seq: int,
    timeout_seconds: float,
) -> list[dict[str, Any]]:
    deadline = time.monotonic() + timeout_seconds
    events: list[dict[str, Any]] = []
    headers = {**_headers(access_token), "Accept": "text/event-stream"}
    async with (
        httpx.AsyncClient(timeout=None) as client,
        client.stream(
            "GET",
            f"{runtime_url}/v1/sessions/{session_id}/stream",
            headers=headers,
            params={"after_seq": after_seq},
        ) as response,
    ):
        response.raise_for_status()
        data_lines: list[str] = []
        async for line in response.aiter_lines():
            if time.monotonic() >= deadline:
                raise CloudE2ETestError(
                    f"Timed out waiting for turn_ended in session {session_id} "
                    f"after {timeout_seconds:.0f}s (events={len(events)})."
                )
            if line == "":
                if not data_lines:
                    continue
                envelope = json.loads("\n".join(data_lines))
                data_lines = []
                if isinstance(envelope, dict):
                    events.append(envelope)
                    event_type = envelope.get("event", {}).get("type")
                    if event_type in {"turn_ended", "session_ended"}:
                        return events
                continue
            if line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
    raise CloudE2ETestError(
        f"Session stream for {session_id} ended before emitting turn_ended."
    )
