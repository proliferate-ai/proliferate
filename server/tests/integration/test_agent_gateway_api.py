from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from unittest.mock import ANY
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.db.store.cloud_agent_auth import store
from proliferate.integrations.litellm import LiteLLMRuntimeResponse, LiteLLMRuntimeStatusError
from proliferate.server.cloud.agent_auth.service import issue_runtime_grant_for_selection
from proliferate.utils.crypto import encrypt_json, encrypt_text
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class _GatewaySeed:
    raw_token: str
    target_id: UUID
    sandbox_profile_id: UUID
    policy_id: UUID
    selection_id: UUID


@pytest.fixture(autouse=True)
def _enable_agent_gateway(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_byok_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_anthropic_byok_enabled", True)


async def _seed_gateway_grant(
    db_session: AsyncSession,
    *,
    agent_kind: str = "claude",
    materialization_mode: str = "gateway_env",
) -> _GatewaySeed:
    user = User(
        email=f"gateway-{uuid.uuid4().hex[:8]}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name="Gateway User",
    )
    db_session.add(user)
    await db_session.flush()
    target = CloudTarget(
        display_name="Gateway Test Target",
        kind="managed_cloud",
        status="online",
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        created_by_user_id=user.id,
        default_workspace_root=None,
        update_channel="stable",
    )
    db_session.add(target)
    await db_session.flush()
    profile = await store.ensure_personal_sandbox_profile(
        db_session,
        user_id=user.id,
        managed_target_id=target.id,
    )
    credential = await store.create_agent_auth_credential(
        db_session,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        created_by_user_id=user.id,
        agent_kind=agent_kind,
        credential_kind="managed_gateway",
        display_name="Gateway test credential",
        redacted_summary_json=json.dumps({"providerKind": "test"}, sort_keys=True),
        status="ready",
    )
    policy = await store.ensure_gateway_policy(
        db_session,
        credential_id=credential.id,
        policy_kind="personal_byok",
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        budget_subject_id=None,
        litellm_team_id="team-test",
        litellm_virtual_key_id="key-test",
        litellm_virtual_key_ciphertext=encrypt_text("litellm-runtime-key"),
        litellm_virtual_key_ciphertext_key_id="cloud_secret_key:v1",
        litellm_sync_status="synced",
        litellm_sync_fingerprint="fingerprint",
        status="ready",
    )
    await store.upsert_provider_credential(
        db_session,
        policy_id=policy.id,
        provider_kind="anthropic_api_key",
        payload_ciphertext=encrypt_json({"apiKey": "sk-provider-secret"}),
        payload_ciphertext_key_id="cloud_secret_key:v1",
        redacted_summary_json='{"providerKind":"anthropic_api_key"}',
        validation_status="valid",
        validated_at=utcnow(),
        validation_error_code=None,
        validation_error_message=None,
    )
    selection = await store.upsert_selection(
        db_session,
        sandbox_profile_id=profile.id,
        owner_scope="personal",
        agent_kind=agent_kind,
        credential_id=credential.id,
        credential_share_id=None,
        materialization_mode=materialization_mode,
        selected_revision=credential.revision,
        status="active",
        last_error_code=None,
        last_error_message=None,
    )
    result = await issue_runtime_grant_for_selection(
        db_session,
        selection=selection,
        profile=profile,
        target_id=target.id,
    )
    await db_session.commit()
    return _GatewaySeed(
        raw_token=result.raw_token,
        target_id=target.id,
        sandbox_profile_id=profile.id,
        policy_id=policy.id,
        selection_id=selection.id,
    )


class _FakeRuntimeClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.error: Exception | None = None

    async def forward(self, **kwargs: object) -> LiteLLMRuntimeResponse:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return LiteLLMRuntimeResponse(
            status_code=200,
            headers={"content-type": "application/json"},
            content=b'{"ok":true}',
        )


class _LogRecordHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.mark.asyncio
async def test_anthropic_gateway_forwards_valid_grant_to_litellm(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed = await _seed_gateway_grant(db_session)
    fake_client = _FakeRuntimeClient()
    monkeypatch.setattr(
        "proliferate.server.agent_gateway.service.LiteLLMRuntimeClient",
        lambda: fake_client,
    )

    response = await client.post(
        "/anthropic/v1/messages?beta=true",
        headers={
            "Authorization": f"Bearer {seed.raw_token}",
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "messages-2023-12-15",
        },
        json={
            "model": "us.anthropic.claude-sonnet-4-6",
            "messages": [],
            "context_management": {"edits": []},
        },
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert fake_client.calls[0]["path"] == "/v1/messages"
    assert fake_client.calls[0]["query_string"] == ""
    assert json.loads(fake_client.calls[0]["body"]) == {
        "model": "us.anthropic.claude-sonnet-4-6",
        "messages": [],
    }
    assert fake_client.calls[0]["protocol_headers"] == {
        "anthropic-version": "2023-06-01",
    }
    assert fake_client.calls[0]["litellm_key"] == "litellm-runtime-key"
    assert fake_client.calls[0]["metadata"] == {
        "target_id": str(seed.target_id),
        "sandbox_profile_id": str(seed.sandbox_profile_id),
        "agent_kind": "claude",
        "policy_id": str(seed.policy_id),
        "user_id": ANY,
    }


@pytest.mark.asyncio
async def test_gateway_request_logging_is_privacy_safe(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed = await _seed_gateway_grant(db_session)
    fake_client = _FakeRuntimeClient()
    monkeypatch.setattr(
        "proliferate.server.agent_gateway.service.LiteLLMRuntimeClient",
        lambda: fake_client,
    )
    gateway_logger = logging.getLogger("proliferate.agent_gateway")
    previous_level = gateway_logger.level
    previous_disabled = gateway_logger.disabled
    handler = _LogRecordHandler()
    gateway_logger.setLevel(logging.INFO)
    gateway_logger.disabled = False
    gateway_logger.addHandler(handler)

    try:
        response = await client.post(
            "/anthropic/v1/messages",
            headers={"Authorization": f"Bearer {seed.raw_token}"},
            json={
                "model": "us.anthropic.claude-sonnet-4-6",
                "messages": [{"role": "user", "content": "super-secret-prompt"}],
            },
        )
    finally:
        gateway_logger.removeHandler(handler)
        gateway_logger.setLevel(previous_level)
        gateway_logger.disabled = previous_disabled

    assert response.status_code == 200
    records = [
        record
        for record in handler.records
        if getattr(record, "event", None) == "agent_gateway_request"
    ]
    assert len(records) == 1
    record = records[0]
    assert record.outcome == "success"
    assert record.policy_hash != str(seed.policy_id)
    assert not hasattr(record, "policy_id")
    assert not hasattr(record, "target_id")
    assert not hasattr(record, "sandbox_profile_id")
    assert record.model_hash != "us.anthropic.claude-sonnet-4-6"
    rendered_records = "\n".join(
        f"{captured.getMessage()} {captured.__dict__}" for captured in handler.records
    )
    assert "super-secret-prompt" not in rendered_records
    assert str(seed.policy_id) not in rendered_records
    assert str(seed.target_id) not in rendered_records
    assert str(seed.sandbox_profile_id) not in rendered_records
    assert seed.raw_token not in rendered_records
    assert "litellm-runtime-key" not in rendered_records


@pytest.mark.asyncio
async def test_gateway_rejects_invalid_token(client: AsyncClient) -> None:
    response = await client.post(
        "/anthropic/v1/messages",
        headers={"Authorization": "Bearer nope"},
        json={"model": "us.anthropic.claude-sonnet-4-6", "messages": []},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "invalid_gateway_token"


@pytest.mark.asyncio
async def test_gateway_fails_closed_when_disabled(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed = await _seed_gateway_grant(db_session)
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)

    response = await client.post(
        "/anthropic/v1/messages",
        headers={"Authorization": f"Bearer {seed.raw_token}"},
        json={"model": "us.anthropic.claude-sonnet-4-6", "messages": []},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "gateway_route_unavailable"


@pytest.mark.asyncio
async def test_gateway_fails_closed_when_byok_disabled_after_grant_issue(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed = await _seed_gateway_grant(db_session)
    fake_client = _FakeRuntimeClient()
    monkeypatch.setattr(
        "proliferate.server.agent_gateway.service.LiteLLMRuntimeClient",
        lambda: fake_client,
    )
    monkeypatch.setattr(settings, "agent_gateway_byok_enabled", False)

    response = await client.post(
        "/anthropic/v1/messages",
        headers={"Authorization": f"Bearer {seed.raw_token}"},
        json={"model": "us.anthropic.claude-sonnet-4-6", "messages": []},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "gateway_byok_disabled"
    assert fake_client.calls == []


@pytest.mark.asyncio
async def test_gateway_fails_closed_when_byok_provider_disabled_after_grant_issue(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed = await _seed_gateway_grant(db_session)
    fake_client = _FakeRuntimeClient()
    monkeypatch.setattr(
        "proliferate.server.agent_gateway.service.LiteLLMRuntimeClient",
        lambda: fake_client,
    )
    monkeypatch.setattr(settings, "agent_gateway_anthropic_byok_enabled", False)

    response = await client.post(
        "/anthropic/v1/messages",
        headers={"Authorization": f"Bearer {seed.raw_token}"},
        json={"model": "us.anthropic.claude-sonnet-4-6", "messages": []},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "gateway_byok_disabled"
    assert fake_client.calls == []


@pytest.mark.asyncio
async def test_gateway_rejects_oversized_body_before_authorization(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_max_request_bytes", 8)

    response = await client.post(
        "/anthropic/v1/messages",
        headers={"Authorization": "Bearer invalid"},
        content=b'{"model":"too-large"}',
    )

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "gateway_request_too_large"


@pytest.mark.asyncio
async def test_gateway_rejects_missing_model(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    seed = await _seed_gateway_grant(db_session)

    response = await client.post(
        "/anthropic/v1/messages",
        headers={"Authorization": f"Bearer {seed.raw_token}"},
        json={"messages": []},
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_model"


@pytest.mark.asyncio
async def test_gateway_rejects_wrong_protocol(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    seed = await _seed_gateway_grant(db_session)

    response = await client.post(
        "/openai/v1/responses",
        headers={"Authorization": f"Bearer {seed.raw_token}"},
        json={"model": "gpt-5.5", "input": "hello"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "protocol_not_supported"


@pytest.mark.asyncio
async def test_gateway_rejects_revoked_token(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    seed = await _seed_gateway_grant(db_session)
    await store.revoke_runtime_grants_for_selection(db_session, selection_id=seed.selection_id)
    await db_session.commit()

    response = await client.post(
        "/anthropic/v1/messages",
        headers={"Authorization": f"Bearer {seed.raw_token}"},
        json={"model": "us.anthropic.claude-sonnet-4-6", "messages": []},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "invalid_gateway_token"


@pytest.mark.asyncio
async def test_gateway_rejects_stale_profile_revision(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    seed = await _seed_gateway_grant(db_session)
    await store.bump_sandbox_profile_agent_auth_revision(
        db_session,
        sandbox_profile_id=seed.sandbox_profile_id,
        reason="test_revision_change",
        actor_user_id=None,
        force_restart=True,
    )
    await db_session.commit()

    response = await client.post(
        "/anthropic/v1/messages",
        headers={"Authorization": f"Bearer {seed.raw_token}"},
        json={"model": "us.anthropic.claude-sonnet-4-6", "messages": []},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "invalid_gateway_token"


@pytest.mark.asyncio
async def test_gateway_rejects_grant_after_target_rebind(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    seed = await _seed_gateway_grant(db_session)
    profile = await store.get_sandbox_profile(db_session, seed.sandbox_profile_id)
    assert profile is not None
    user_id = profile.owner_user_id
    assert user_id is not None
    target = CloudTarget(
        display_name="Replacement Target",
        kind="managed_cloud",
        status="online",
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
        created_by_user_id=user_id,
        default_workspace_root=None,
        update_channel="stable",
    )
    db_session.add(target)
    await db_session.flush()
    await store.ensure_personal_sandbox_profile(
        db_session,
        user_id=user_id,
        managed_target_id=target.id,
    )
    await db_session.commit()

    response = await client.post(
        "/anthropic/v1/messages",
        headers={"Authorization": f"Bearer {seed.raw_token}"},
        json={"model": "us.anthropic.claude-sonnet-4-6", "messages": []},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "invalid_gateway_token"


@pytest.mark.asyncio
async def test_gateway_rejects_unavailable_model(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    seed = await _seed_gateway_grant(db_session)

    response = await client.post(
        "/anthropic/v1/messages",
        headers={"Authorization": f"Bearer {seed.raw_token}"},
        json={"model": "not-allowed", "messages": []},
    )

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "model_not_available"


@pytest.mark.asyncio
async def test_runtime_grant_rotation_keeps_one_grace_grant(
    db_session: AsyncSession,
) -> None:
    seed = await _seed_gateway_grant(db_session)
    profile = await store.get_sandbox_profile(db_session, seed.sandbox_profile_id)
    selection = await store.get_selection(db_session, seed.selection_id)
    assert profile is not None
    assert selection is not None

    await issue_runtime_grant_for_selection(
        db_session,
        selection=selection,
        profile=profile,
        target_id=seed.target_id,
    )
    await issue_runtime_grant_for_selection(
        db_session,
        selection=selection,
        profile=profile,
        target_id=seed.target_id,
    )
    active = await store.list_active_runtime_grants_for_route(
        db_session,
        policy_id=seed.policy_id,
        target_id=seed.target_id,
        sandbox_profile_id=seed.sandbox_profile_id,
        agent_kind="claude",
        now=profile.updated_at,
    )

    assert len(active) == 2


@pytest.mark.asyncio
async def test_gateway_maps_litellm_budget_errors(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed = await _seed_gateway_grant(db_session)
    fake_client = _FakeRuntimeClient()
    fake_client.error = LiteLLMRuntimeStatusError(
        "budget",
        status_code=429,
        body=b"max_budget exceeded",
    )
    monkeypatch.setattr(
        "proliferate.server.agent_gateway.service.LiteLLMRuntimeClient",
        lambda: fake_client,
    )

    response = await client.post(
        "/anthropic/v1/messages",
        headers={"Authorization": f"Bearer {seed.raw_token}"},
        json={"model": "us.anthropic.claude-sonnet-4-6", "messages": []},
    )

    assert response.status_code == 402
    assert response.json()["detail"]["code"] == "credits_exhausted"


@pytest.mark.asyncio
async def test_gateway_models_endpoint_returns_allowed_models(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    seed = await _seed_gateway_grant(db_session)

    response = await client.get(
        "/anthropic/v1/models",
        headers={"Authorization": f"Bearer {seed.raw_token}"},
    )

    assert response.status_code == 200
    assert response.json()["data"][0]["id"] == "us.anthropic.claude-sonnet-4-6"
