from __future__ import annotations

import json

import httpx
import pytest

from proliferate.config import settings
from proliferate.integrations import litellm
from proliferate.integrations.litellm import client as litellm_client

BASE_URL = "http://litellm.test:4000"
MASTER_KEY = "sk-test-master-key"


class _FakeAsyncClient:
    def __init__(self, responses: list[httpx.Response | Exception]) -> None:
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        request = httpx.Request(
            method,
            url,
            headers=kwargs.get("headers") or {},
            params=kwargs.get("params"),
            json=kwargs.get("json"),
        )
        self.requests.append(request)
        if not self.responses:
            raise AssertionError(f"Unexpected extra request: {method} {url}")
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def _response(status_code: int, payload: object) -> httpx.Response:
    return httpx.Response(
        status_code,
        json=payload,
        request=httpx.Request("POST", f"{BASE_URL}/key/generate"),
    )


@pytest.fixture(autouse=True)
def _gateway_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "agent_gateway_litellm_base_url", BASE_URL)
    monkeypatch.setattr(settings, "agent_gateway_litellm_master_key", MASTER_KEY)
    monkeypatch.setattr(settings, "agent_gateway_litellm_timeout_seconds", 5.0)


def _install(monkeypatch: pytest.MonkeyPatch, client: _FakeAsyncClient) -> None:
    monkeypatch.setattr(litellm_client.httpx, "AsyncClient", lambda **_kwargs: client)


def _request_body(request: httpx.Request) -> dict[str, object]:
    return json.loads(request.content.decode("utf-8"))


@pytest.mark.asyncio
async def test_mint_virtual_key_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeAsyncClient(
        [
            _response(
                200,
                {
                    "key": "sk-virtual-123",
                    "token_id": "hash-abc",
                    "key_alias": "user-1-personal",
                    "user_id": "user-1",
                    "team_id": "team-1",
                    "max_budget": 5.0,
                },
            )
        ]
    )
    _install(monkeypatch, client)

    key = await litellm.mint_virtual_key(
        user_id="user-1",
        team_id="team-1",
        alias="user-1-personal",
        max_budget=5.0,
        metadata={"billing_subject_id": "bs-1"},
    )

    assert key.key == "sk-virtual-123"
    assert key.token_id == "hash-abc"
    assert key.team_id == "team-1"

    request = client.requests[0]
    assert request.url.path == "/key/generate"
    assert request.headers["Authorization"] == f"Bearer {MASTER_KEY}"
    body = _request_body(request)
    assert body == {
        "user_id": "user-1",
        "team_id": "team-1",
        "key_alias": "user-1-personal",
        "max_budget": 5.0,
        "metadata": {"billing_subject_id": "bs-1"},
    }


@pytest.mark.asyncio
async def test_mint_virtual_key_400_surfaces_error(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeAsyncClient(
        [
            _response(
                400,
                {
                    "error": {
                        "message": "Key with alias 'dupe' already exists.",
                        "type": "bad_request_error",
                    }
                },
            )
        ]
    )
    _install(monkeypatch, client)

    with pytest.raises(litellm.LiteLLMIntegrationError) as excinfo:
        await litellm.mint_virtual_key(user_id="user-1", alias="dupe")

    assert excinfo.value.code == "litellm_request_failed"
    assert excinfo.value.status_code == 400
    assert "already exists" in excinfo.value.message


@pytest.mark.asyncio
async def test_mint_virtual_key_500_surfaces_error(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeAsyncClient([_response(500, {"detail": "boom"})])
    _install(monkeypatch, client)

    with pytest.raises(litellm.LiteLLMIntegrationError) as excinfo:
        await litellm.mint_virtual_key(user_id="user-1")

    assert excinfo.value.status_code == 500
    assert excinfo.value.message == "boom"


@pytest.mark.asyncio
async def test_network_error_wraps_as_integration_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient([httpx.ConnectError("connection refused")])
    _install(monkeypatch, client)

    with pytest.raises(litellm.LiteLLMIntegrationError) as excinfo:
        await litellm.health()

    assert excinfo.value.code == "litellm_request_failed"
    assert excinfo.value.status_code == 502


@pytest.mark.asyncio
async def test_unconfigured_master_key_raises_before_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_litellm_master_key", "")

    def fail_if_called(**_kwargs: object) -> _FakeAsyncClient:
        raise AssertionError("AsyncClient should not be constructed without a master key")

    monkeypatch.setattr(litellm_client.httpx, "AsyncClient", fail_if_called)

    with pytest.raises(litellm.LiteLLMIntegrationError) as excinfo:
        await litellm.ensure_user(user_id="user-1")

    assert excinfo.value.code == "litellm_unconfigured"
    assert excinfo.value.status_code == 503


@pytest.mark.asyncio
async def test_ensure_team_returns_existing_team(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeAsyncClient(
        [
            _response(
                200,
                [
                    {"team_alias": "org-42", "team_id": "team-existing"},
                ],
            )
        ]
    )
    _install(monkeypatch, client)

    team_id = await litellm.ensure_team(alias="org-42", max_budget=10.0)

    assert team_id == "team-existing"
    # Only the lookup ran; no /team/new call.
    assert [request.url.path for request in client.requests] == ["/team/list"]
    assert client.requests[0].url.params["team_alias"] == "org-42"


@pytest.mark.asyncio
async def test_ensure_team_creates_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeAsyncClient(
        [
            _response(200, []),
            _response(200, {"team_id": "team-created", "team_alias": "org-42"}),
        ]
    )
    _install(monkeypatch, client)

    team_id = await litellm.ensure_team(alias="org-42", max_budget=10.0)

    assert team_id == "team-created"
    assert [request.url.path for request in client.requests] == ["/team/list", "/team/new"]
    body = _request_body(client.requests[1])
    assert body == {"team_alias": "org-42", "max_budget": 10.0}


@pytest.mark.asyncio
async def test_ensure_user_treats_conflict_as_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        [
            _response(
                409,
                {"error": {"message": "User with id user-1 already exists", "code": "409"}},
            )
        ]
    )
    _install(monkeypatch, client)

    assert await litellm.ensure_user(user_id="user-1") == "user-1"


@pytest.mark.asyncio
async def test_list_models_uses_virtual_key_bearer(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeAsyncClient(
        [
            _response(
                200,
                {
                    "data": [
                        {"id": "claude-haiku-4-5", "object": "model"},
                        {"id": "gpt-5-mini", "object": "model"},
                    ]
                },
            )
        ]
    )
    _install(monkeypatch, client)

    models = await litellm.list_models(virtual_key="sk-virtual-123")

    assert models == ["claude-haiku-4-5", "gpt-5-mini"]
    request = client.requests[0]
    assert request.url.path == "/v1/models"
    assert request.headers["Authorization"] == "Bearer sk-virtual-123"


@pytest.mark.asyncio
async def test_page_spend_logs_parses_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeAsyncClient(
        [
            _response(
                200,
                [
                    {
                        "request_id": "req-1",
                        "api_key": "hash-abc",
                        "model": "claude-haiku-4-5-20251001",
                        "spend": 0.0123,
                        "total_tokens": 100,
                        "prompt_tokens": 60,
                        "completion_tokens": 40,
                        "startTime": "2026-07-01T10:22:36.512000Z",
                        "endTime": "2026-07-01T10:22:38.000000Z",
                        "team_id": "team-1",
                        "metadata": {"user_api_key_alias": "user-1-personal"},
                        "unknown_extra_field": {"ignored": True},
                    },
                    {
                        "request_id": "req-2",
                        "api_key": "hash-def",
                        "model": "gpt-5-mini",
                        "spend": 0.5,
                        "total_tokens": 2000,
                        "prompt_tokens": 1500,
                        "completion_tokens": 500,
                    },
                ],
            )
        ]
    )
    _install(monkeypatch, client)

    rows = await litellm.page_spend_logs(start_date="2026-06-30", end_date="2026-07-01")

    assert len(rows) == 2
    first = rows[0]
    assert first.request_id == "req-1"
    assert first.api_key == "hash-abc"
    assert first.spend == pytest.approx(0.0123)
    assert first.start_time == "2026-07-01T10:22:36.512000Z"
    assert first.metadata["user_api_key_alias"] == "user-1-personal"
    second = rows[1]
    assert second.request_id == "req-2"
    assert second.team_id is None

    request = client.requests[0]
    assert request.url.path == "/spend/logs"
    assert request.url.params["summarize"] == "false"
    assert request.url.params["start_date"] == "2026-06-30"
    assert request.url.params["end_date"] == "2026-07-01"


@pytest.mark.asyncio
async def test_page_spend_logs_invalid_payload_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient([_response(200, {"not": "a list"})])
    _install(monkeypatch, client)

    with pytest.raises(litellm.LiteLLMIntegrationError) as excinfo:
        await litellm.page_spend_logs(start_date="2026-06-30", end_date="2026-07-01")

    assert excinfo.value.code == "litellm_invalid_response"


@pytest.mark.asyncio
async def test_rotate_virtual_key_deletes_then_mints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        [
            _response(200, {"deleted_keys": ["hash-old"]}),
            _response(
                200,
                {"key": "sk-virtual-new", "token_id": "hash-new", "user_id": "user-1"},
            ),
        ]
    )
    _install(monkeypatch, client)

    key = await litellm.rotate_virtual_key(
        key_or_token_id="hash-old",
        user_id="user-1",
        alias="user-1-personal",
    )

    assert key.key == "sk-virtual-new"
    assert [request.url.path for request in client.requests] == [
        "/key/delete",
        "/key/generate",
    ]
    assert _request_body(client.requests[0]) == {"keys": ["hash-old"]}


@pytest.mark.asyncio
async def test_ensure_team_reuses_stored_id_without_listing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A stored team id is the durable get-or-create path: no /team/list or
    # /team/new call is made, so there is no duplicate-team window.
    client = _FakeAsyncClient([])
    _install(monkeypatch, client)

    team_id = await litellm.ensure_team(alias="org-42", team_id="team-stored", max_budget=10.0)

    assert team_id == "team-stored"
    assert client.requests == []


@pytest.mark.asyncio
async def test_rotate_virtual_key_tolerates_missing_key_on_delete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A previous attempt deleted the key but crashed before minting; the retry
    # sees a 404 on /key/delete and must proceed to mint rather than loop.
    client = _FakeAsyncClient(
        [
            _response(404, {"error": {"message": "key not found"}}),
            _response(
                200,
                {"key": "sk-virtual-new", "token_id": "hash-new", "user_id": "user-1"},
            ),
        ]
    )
    _install(monkeypatch, client)

    key = await litellm.rotate_virtual_key(
        key_or_token_id="hash-old",
        user_id="user-1",
        alias="user-1-personal",
    )

    assert key.key == "sk-virtual-new"
    assert [request.url.path for request in client.requests] == [
        "/key/delete",
        "/key/generate",
    ]


@pytest.mark.asyncio
async def test_rotate_virtual_key_reraises_non_404_delete_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient([_response(500, {"detail": "boom"})])
    _install(monkeypatch, client)

    with pytest.raises(litellm.LiteLLMIntegrationError) as excinfo:
        await litellm.rotate_virtual_key(key_or_token_id="hash-old", user_id="user-1")

    assert excinfo.value.status_code == 500
    # No mint attempted after a hard delete failure.
    assert [request.url.path for request in client.requests] == ["/key/delete"]


@pytest.mark.asyncio
async def test_mint_virtual_key_malformed_200_wraps_validation_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 200 with the required ``key`` field missing must surface as an integration
    # error, not a raw pydantic ValidationError.
    client = _FakeAsyncClient([_response(200, {"token_id": "hash-only"})])
    _install(monkeypatch, client)

    with pytest.raises(litellm.LiteLLMIntegrationError) as excinfo:
        await litellm.mint_virtual_key(user_id="user-1")

    assert excinfo.value.code == "litellm_invalid_response"


@pytest.mark.asyncio
async def test_page_spend_logs_malformed_row_wraps_validation_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient([_response(200, [{"api_key": "hash-abc"}])])
    _install(monkeypatch, client)

    with pytest.raises(litellm.LiteLLMIntegrationError) as excinfo:
        await litellm.page_spend_logs(start_date="2026-06-30", end_date="2026-07-01")

    assert excinfo.value.code == "litellm_invalid_response"


@pytest.mark.asyncio
async def test_disable_and_budget_updates_hit_expected_paths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeAsyncClient(
        [
            _response(200, {"token": "hash-abc"}),
            _response(200, {"key": "hash-abc", "max_budget": 9.0}),
            _response(200, {"team_id": "team-1", "max_budget": 50.0}),
        ]
    )
    _install(monkeypatch, client)

    await litellm.disable_virtual_key(key_or_token_id="hash-abc")
    await litellm.set_key_budget(key_or_token_id="hash-abc", max_budget=9.0)
    await litellm.update_team_budget(team_id="team-1", max_budget=50.0)

    assert [request.url.path for request in client.requests] == [
        "/key/block",
        "/key/update",
        "/team/update",
    ]
    assert _request_body(client.requests[0]) == {"key": "hash-abc"}
    assert _request_body(client.requests[1]) == {"key": "hash-abc", "max_budget": 9.0}
    assert _request_body(client.requests[2]) == {"team_id": "team-1", "max_budget": 50.0}
