from __future__ import annotations

from collections.abc import Sequence

import httpx
import pytest

from proliferate.integrations.anyharness import runtime


class _FakeAsyncClient:
    def __init__(self, responses: Sequence[httpx.Response] | Exception) -> None:
        self._responses = responses
        self._index = 0

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def get(self, _url: str, **_kwargs: object) -> httpx.Response:
        if isinstance(self._responses, Exception):
            raise self._responses
        response = self._responses[self._index]
        self._index += 1
        return response

    async def post(self, _url: str, **_kwargs: object) -> httpx.Response:
        return await self.get(_url, **_kwargs)


def _response(
    status_code: int,
    *,
    json: object | None = None,
    text: str | None = None,
    method: str = "GET",
    url: str = "https://runtime.invalid/v1/agents",
) -> httpx.Response:
    kwargs: dict[str, object] = {"request": httpx.Request(method, url)}
    if json is not None:
        kwargs["json"] = json
    if text is not None:
        kwargs["text"] = text
    return httpx.Response(status_code, **kwargs)


@pytest.mark.asyncio
async def test_check_runtime_auth_enforcement_returns_both_probe_statuses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        [
            _response(200, text="[]"),
            _response(401, text='{"detail":"unauthorized"}'),
        ]
    )
    monkeypatch.setattr(runtime.httpx, "AsyncClient", lambda **_kwargs: client)

    probe = await runtime.check_runtime_auth_enforcement(
        "https://runtime.invalid",
        "runtime-token",
    )

    assert probe.authenticated_success is True
    assert probe.authenticated_status_code == 200
    assert probe.unauthenticated_status_code == 401
    assert probe.unauthenticated_response_preview == '{"detail":"unauthorized"}'


@pytest.mark.asyncio
async def test_check_runtime_auth_enforcement_skips_unauthenticated_probe_on_rejection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient([_response(401, text="nope")])
    monkeypatch.setattr(runtime.httpx, "AsyncClient", lambda **_kwargs: client)

    probe = await runtime.check_runtime_auth_enforcement(
        "https://runtime.invalid",
        "runtime-token",
    )

    assert probe.authenticated_success is False
    assert probe.authenticated_status_code == 401
    assert probe.authenticated_response_preview == "nope"
    assert probe.unauthenticated_status_code is None


@pytest.mark.asyncio
async def test_list_runtime_agents_normalizes_agent_summaries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        [
            _response(
                200,
                json=[
                    {
                        "kind": "codex",
                        "readiness": "ready",
                        "credentialState": "available",
                    },
                    {"readiness": "ignored"},
                ],
            )
        ]
    )
    monkeypatch.setattr(runtime.httpx, "AsyncClient", lambda **_kwargs: client)

    agents = await runtime.list_runtime_agents("https://runtime.invalid", "runtime-token")

    assert len(agents) == 1
    assert agents[0].kind == "codex"
    assert agents[0].readiness == "ready"
    assert agents[0].credential_state == "available"


@pytest.mark.asyncio
async def test_list_runtime_agents_error_includes_response_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient([_response(500, text="runtime stack trace")])
    monkeypatch.setattr(runtime.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(runtime.CloudRuntimeReconnectError) as exc_info:
        await runtime.list_runtime_agents("https://runtime.invalid", "runtime-token")

    assert "status 500" in str(exc_info.value)
    assert "runtime stack trace" in str(exc_info.value)


@pytest.mark.asyncio
async def test_install_runtime_agent_returns_install_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        [
            _response(
                200,
                method="POST",
                json={
                    "alreadyInstalled": True,
                    "agent": {"kind": "codex", "readiness": "ready"},
                },
            )
        ]
    )
    monkeypatch.setattr(runtime.httpx, "AsyncClient", lambda **_kwargs: client)

    result = await runtime.install_runtime_agent(
        "https://runtime.invalid",
        "runtime-token",
        "codex",
    )

    assert result.already_installed is True
    assert result.agent.kind == "codex"
    assert result.agent.readiness == "ready"


@pytest.mark.asyncio
async def test_install_runtime_agent_uses_requested_kind_when_agent_payload_omits_kind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        [
            _response(
                200,
                method="POST",
                json={
                    "agent": {"readiness": "ready"},
                },
            )
        ]
    )
    monkeypatch.setattr(runtime.httpx, "AsyncClient", lambda **_kwargs: client)

    result = await runtime.install_runtime_agent(
        "https://runtime.invalid",
        "runtime-token",
        "codex",
    )

    assert result.agent.kind == "codex"
    assert result.agent.readiness == "ready"


@pytest.mark.asyncio
async def test_install_runtime_agent_error_includes_response_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient([_response(409, method="POST", text="install already running")])
    monkeypatch.setattr(runtime.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(runtime.CloudRuntimeReconnectError) as exc_info:
        await runtime.install_runtime_agent(
            "https://runtime.invalid",
            "runtime-token",
            "codex",
        )

    assert "status 409" in str(exc_info.value)
    assert "install already running" in str(exc_info.value)
