from __future__ import annotations

import pytest

from proliferate.integrations.litellm import LiteLLMAdminClient, LiteLLMIntegrationError
from proliferate.integrations.litellm import client as litellm_client


class _FakeResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        payload: dict[str, object] | None = None,
        text: str = "{}",
    ) -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text
        self.content = text.encode()

    def json(self) -> dict[str, object]:
        return self._payload


class _FakeAsyncClient:
    calls: list[dict[str, object]] = []
    responses: list[_FakeResponse] = []

    def __init__(self, *, timeout: float) -> None:
        self.timeout = timeout

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, object],
    ) -> _FakeResponse:
        self.calls.append(
            {
                "method": method,
                "url": url,
                "headers": dict(headers),
                "json": dict(json),
                "timeout": self.timeout,
            }
        )
        return self.responses.pop(0)


@pytest.fixture(autouse=True)
def _fake_httpx(monkeypatch):
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.responses = []
    monkeypatch.setattr(litellm_client.httpx, "AsyncClient", _FakeAsyncClient)


@pytest.mark.asyncio
async def test_create_credential_posts_write_only_credential_payload() -> None:
    _FakeAsyncClient.responses = [
        _FakeResponse(payload={"credential_name": "cred-openai"})
    ]
    client = LiteLLMAdminClient(base_url="http://litellm.internal", master_key="sk-master")

    result = await client.create_credential(
        credential_name="cred-openai",
        credential_info={"custom_llm_provider": "openai"},
        credential_values={"api_key": "sk-provider-secret"},
    )

    assert result.credential_name == "cred-openai"
    assert _FakeAsyncClient.calls == [
        {
            "method": "POST",
            "url": "http://litellm.internal/credentials",
            "headers": {"Authorization": "Bearer sk-master"},
            "json": {
                "credential_name": "cred-openai",
                "credential_info": {"custom_llm_provider": "openai"},
                "credential_values": {"api_key": "sk-provider-secret"},
            },
            "timeout": 30.0,
        }
    ]


@pytest.mark.asyncio
async def test_reconcile_credential_routing_updates_team_model_config() -> None:
    _FakeAsyncClient.responses = [
        _FakeResponse(payload={"credential_name": "cred-anthropic"}),
        _FakeResponse(payload={"team_id": "team-a"}),
    ]
    client = LiteLLMAdminClient(base_url="http://litellm.internal", master_key="sk-master")

    await client.reconcile_credential_routing(
        team_id="team-a",
        credential_name="cred-anthropic",
        credential_info={"custom_llm_provider": "anthropic"},
        credential_values={"api_key": "sk-provider-secret"},
        model_config={
            "claude-sonnet": {
                "litellm_params": {"litellm_credential_name": "cred-anthropic"}
            }
        },
        existing_metadata={"owner": "proliferate"},
    )

    assert _FakeAsyncClient.calls[1] == {
        "method": "POST",
        "url": "http://litellm.internal/team/update",
        "headers": {"Authorization": "Bearer sk-master"},
        "json": {
            "team_id": "team-a",
            "metadata": {
                "owner": "proliferate",
                "model_config": {
                    "claude-sonnet": {
                        "litellm_params": {
                            "litellm_credential_name": "cred-anthropic"
                        }
                    }
                },
            },
        },
        "timeout": 30.0,
    }


@pytest.mark.asyncio
async def test_litellm_error_redacts_provider_credential_values() -> None:
    _FakeAsyncClient.responses = [
        _FakeResponse(
            status_code=500,
            text='{"error":"sk-provider-secret failed"}',
        )
    ]
    client = LiteLLMAdminClient(base_url="http://litellm.internal", master_key="sk-master")

    with pytest.raises(LiteLLMIntegrationError) as exc_info:
        await client.create_credential(
            credential_name="cred-openai",
            credential_info={"custom_llm_provider": "openai"},
            credential_values={"api_key": "sk-provider-secret"},
        )

    assert "sk-provider-secret" not in str(exc_info.value)
    assert "[REDACTED]" in str(exc_info.value)


@pytest.mark.asyncio
async def test_create_credential_falls_back_to_legacy_create_path() -> None:
    _FakeAsyncClient.responses = [
        _FakeResponse(status_code=404, text='{"error":"not found"}'),
        _FakeResponse(payload={"credential_name": "cred-openai"}),
    ]
    client = LiteLLMAdminClient(base_url="http://litellm.internal", master_key="sk-master")

    result = await client.create_credential(
        credential_name="cred-openai",
        credential_info={"custom_llm_provider": "openai"},
        credential_values={"api_key": "sk-provider-secret"},
    )

    assert result.credential_name == "cred-openai"
    assert [call["url"] for call in _FakeAsyncClient.calls] == [
        "http://litellm.internal/credentials",
        "http://litellm.internal/credentials/create",
    ]
