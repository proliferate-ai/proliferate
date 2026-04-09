from __future__ import annotations

from collections.abc import Sequence

import httpx
import pytest

from proliferate.server.cloud.runtime import anyharness_api
from proliferate.server.cloud.runtime.anyharness_api import CloudRuntimeReconnectError


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


@pytest.mark.asyncio
async def test_verify_runtime_auth_enforced_accepts_authenticated_and_rejects_unauthenticated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        [
            httpx.Response(200, text="[]"),
            httpx.Response(401, text='{"detail":"unauthorized"}'),
        ]
    )
    monkeypatch.setattr(
        anyharness_api.httpx,
        "AsyncClient",
        lambda **_kwargs: client,
    )

    await anyharness_api.verify_runtime_auth_enforced(
        "https://runtime.invalid",
        "runtime-token",
    )


@pytest.mark.asyncio
async def test_verify_runtime_auth_enforced_raises_when_bearer_token_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient([httpx.Response(401, text="nope")])
    monkeypatch.setattr(
        anyharness_api.httpx,
        "AsyncClient",
        lambda **_kwargs: client,
    )

    with pytest.raises(CloudRuntimeReconnectError, match="stored bearer token"):
        await anyharness_api.verify_runtime_auth_enforced(
            "https://runtime.invalid",
            "runtime-token",
        )


@pytest.mark.asyncio
async def test_verify_runtime_auth_enforced_raises_when_runtime_accepts_unauthenticated_requests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        [
            httpx.Response(200, text="[]"),
            httpx.Response(200, text="[]"),
        ]
    )
    monkeypatch.setattr(
        anyharness_api.httpx,
        "AsyncClient",
        lambda **_kwargs: client,
    )

    with pytest.raises(CloudRuntimeReconnectError, match="did not reject"):
        await anyharness_api.verify_runtime_auth_enforced(
            "https://runtime.invalid",
            "runtime-token",
        )


@pytest.mark.asyncio
async def test_verify_runtime_auth_enforced_raises_when_probe_request_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = httpx.Request("GET", "https://runtime.invalid/v1/agents")
    client = _FakeAsyncClient(httpx.ConnectError("boom", request=request))
    monkeypatch.setattr(
        anyharness_api.httpx,
        "AsyncClient",
        lambda **_kwargs: client,
    )

    with pytest.raises(CloudRuntimeReconnectError, match="Failed to verify bearer authentication"):
        await anyharness_api.verify_runtime_auth_enforced(
            "https://runtime.invalid",
            "runtime-token",
        )


@pytest.mark.asyncio
async def test_reconcile_remote_agents_skips_install_when_synced_agents_are_already_ready(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    list_calls: list[str] = []
    install_calls: list[str] = []

    async def _list_remote_agents(*_args: object, **_kwargs: object) -> list[dict[str, str]]:
        list_calls.append("list")
        return [
            {"kind": "claude", "readiness": "ready"},
            {"kind": "codex", "readiness": "ready"},
        ]

    async def _install_remote_agent(*_args: object, **_kwargs: object) -> dict[str, str]:
        install_calls.append("install")
        return {"kind": "claude", "readiness": "ready"}

    monkeypatch.setattr(anyharness_api, "_list_remote_agents", _list_remote_agents)
    monkeypatch.setattr(anyharness_api, "_install_remote_agent", _install_remote_agent)

    ready_agents = await anyharness_api.reconcile_remote_agents(
        "https://runtime.invalid",
        "runtime-token",
        synced_providers=["claude", "codex"],
    )

    assert ready_agents == ["claude", "codex"]
    assert list_calls == ["list"]
    assert install_calls == []


@pytest.mark.asyncio
async def test_reconcile_remote_agents_installs_only_install_required_synced_agents(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    list_responses = [
        [
            {"kind": "claude", "readiness": "ready"},
            {"kind": "codex", "readiness": "install_required"},
            {"kind": "gemini", "readiness": "credentials_required"},
        ],
        [
            {"kind": "claude", "readiness": "ready"},
            {"kind": "codex", "readiness": "ready"},
            {"kind": "gemini", "readiness": "credentials_required"},
        ],
    ]
    install_calls: list[str] = []

    async def _list_remote_agents(*_args: object, **_kwargs: object) -> list[dict[str, str]]:
        return list_responses.pop(0)

    async def _install_remote_agent(
        _runtime_url: str,
        _access_token: str,
        kind: str,
        *,
        workspace_id: object | None = None,
    ) -> dict[str, str]:
        del workspace_id
        install_calls.append(kind)
        return {"kind": kind, "readiness": "ready"}

    monkeypatch.setattr(anyharness_api, "_list_remote_agents", _list_remote_agents)
    monkeypatch.setattr(anyharness_api, "_install_remote_agent", _install_remote_agent)

    ready_agents = await anyharness_api.reconcile_remote_agents(
        "https://runtime.invalid",
        "runtime-token",
        synced_providers=["claude", "codex", "gemini"],
    )

    assert ready_agents == ["claude", "codex"]
    assert install_calls == ["codex"]
