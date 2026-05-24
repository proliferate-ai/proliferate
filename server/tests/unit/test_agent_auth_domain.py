from __future__ import annotations

from proliferate.auth.authorization import PolicyDenied, PolicyAllowed
from proliferate.server.cloud.agent_auth.domain.policy import (
    SelectionPlan,
    can_select_credential_for_profile,
    selection_plan_for_credential,
)
from proliferate.server.cloud.agent_auth import service as agent_auth_service
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.domain.byok_policy import (
    gateway_byok_policy_verdict,
    gateway_route_isolation_ready,
)
from proliferate.server.cloud.agent_auth.protected_env import (
    allowed_protected_env_keys,
    reject_unallowed_protected_env,
)


class _FakeProviderValidationResponse:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


class _FakeProviderValidationClient:
    calls: list[dict[str, object]] = []
    response = _FakeProviderValidationResponse(200)

    def __init__(self, *, timeout: float) -> None:
        self.timeout = timeout

    async def __aenter__(self) -> _FakeProviderValidationClient:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def get(
        self,
        url: str,
        *,
        headers: dict[str, str],
    ) -> _FakeProviderValidationResponse:
        self.calls.append({"url": url, "headers": dict(headers), "timeout": self.timeout})
        return self.response


def test_gateway_selection_plan_maps_agent_protocols() -> None:
    claude = selection_plan_for_credential(
        agent_kind="claude",
        credential_kind="managed_gateway",
    )
    assert claude == SelectionPlan(materialization_mode="gateway_env", protocol_facade="anthropic")

    codex = selection_plan_for_credential(
        agent_kind="codex",
        credential_kind="managed_gateway",
    )
    assert codex == SelectionPlan(materialization_mode="gateway_env", protocol_facade="openai")

    gemini = selection_plan_for_credential(
        agent_kind="gemini",
        credential_kind="managed_gateway",
    )
    assert isinstance(gemini, PolicyDenied)
    assert gemini.code == "gateway_not_supported_for_agent"


def test_org_profile_allows_personal_synced_credential_without_share() -> None:
    allowed = can_select_credential_for_profile(
        profile_owner_scope="organization",
        profile_owner_user_id=None,
        profile_organization_id="org-1",
        credential_owner_scope="personal",
        credential_owner_user_id="user-1",
        credential_organization_id=None,
        credential_kind="synced_path",
        has_active_share=False,
    )
    assert isinstance(allowed, PolicyAllowed)

    shared = can_select_credential_for_profile(
        profile_owner_scope="organization",
        profile_owner_user_id=None,
        profile_organization_id="org-1",
        credential_owner_scope="personal",
        credential_owner_user_id="user-1",
        credential_organization_id=None,
        credential_kind="synced_path",
        has_active_share=True,
    )
    assert isinstance(shared, PolicyAllowed)


def test_protected_env_allowlist_is_agent_and_mode_scoped() -> None:
    assert "ANTHROPIC_CUSTOM_HEADERS" in allowed_protected_env_keys(
        agent_kind="claude",
        materialization_mode="gateway_env",
    )
    assert "OPENAI_API_KEY" not in allowed_protected_env_keys(
        agent_kind="claude",
        materialization_mode="gateway_env",
    )
    assert "ANTHROPIC_API_KEY" not in allowed_protected_env_keys(
        agent_kind="claude",
        materialization_mode="synced_files",
    )
    reject_unallowed_protected_env(
        agent_kind="opencode",
        materialization_mode="gateway_env",
        keys={"OPENAI_API_KEY", "OPENAI_BASE_URL"},
    )
    try:
        reject_unallowed_protected_env(
            agent_kind="claude",
            materialization_mode="gateway_env",
            keys={"OPENAI_API_KEY"},
        )
    except ValueError as exc:
        assert "OPENAI_API_KEY" in str(exc)
    else:
        raise AssertionError("expected protected env violation")
    try:
        reject_unallowed_protected_env(
            agent_kind="claude",
            materialization_mode="synced_files",
            keys={"ANTHROPIC_API_KEY"},
        )
    except ValueError as exc:
        assert "ANTHROPIC_API_KEY" in str(exc)
    else:
        raise AssertionError("expected synced protected env violation")


def test_gateway_byok_requires_enterprise_isolation_proof_ref() -> None:
    assert not gateway_route_isolation_ready(
        litellm_topology="enterprise_shared",
        customer_secret_isolation_verified=True,
        isolation_proof_ref="",
    )
    assert gateway_route_isolation_ready(
        litellm_topology="enterprise_shared",
        customer_secret_isolation_verified=True,
        isolation_proof_ref="runbook/proofs/litellm-team-isolation-2026-05-24",
    )
    assert not gateway_route_isolation_ready(
        litellm_topology="isolated_router",
        customer_secret_isolation_verified=True,
        isolation_proof_ref="runbook/proofs/litellm-team-isolation-2026-05-24",
    )

    verdict = gateway_byok_policy_verdict(
        policy_kind="personal_byok",
        gateway_byok_enabled=True,
        personal_byok_enabled=True,
        litellm_topology="enterprise_shared",
        customer_secret_isolation_verified=True,
        isolation_proof_ref="",
    )
    assert not verdict.allowed
    assert verdict.code == "gateway_byok_route_isolation_unverified"

    managed = gateway_byok_policy_verdict(
        policy_kind="proliferate_managed",
        gateway_byok_enabled=True,
        personal_byok_enabled=True,
        litellm_topology="oss_shared",
        customer_secret_isolation_verified=False,
        isolation_proof_ref=None,
    )
    assert managed.allowed


def test_openai_compatible_url_rejects_credentialed_metadata_and_internal_hosts(
    monkeypatch,
) -> None:
    invalid_urls = [
        "https://user:pass@example.com/v1",
        "https://api.example.com/v1?key=value",
        "https://metadata.google.internal/computeMetadata/v1",
        "https://169.254.169.254/latest/meta-data",
    ]
    for raw_url in invalid_urls:
        try:
            agent_auth_service._validate_openai_compatible_url(raw_url)
        except AgentAuthError as exc:
            assert exc.code == "invalid_base_url"
        else:
            raise AssertionError(f"expected {raw_url} to be rejected")

    def _private_addrinfo(*_args, **_kwargs):
        return [(None, None, None, "", ("10.0.0.1", 443))]

    monkeypatch.setattr(agent_auth_service.socket, "getaddrinfo", _private_addrinfo)
    try:
        agent_auth_service._validate_openai_compatible_url("https://api.example.com/v1")
    except AgentAuthError as exc:
        assert exc.code == "invalid_base_url"
    else:
        raise AssertionError("expected private DNS result to be rejected")

    def _public_addrinfo(*_args, **_kwargs):
        return [(None, None, None, "", ("8.8.8.8", 443))]

    monkeypatch.setattr(agent_auth_service.socket, "getaddrinfo", _public_addrinfo)
    assert (
        agent_auth_service._validate_openai_compatible_url("https://api.example.com/v1/")
        == "https://api.example.com/v1"
    )


async def test_provider_payload_live_validation_marks_openai_ready(monkeypatch) -> None:
    monkeypatch.setattr(
        agent_auth_service.settings,
        "agent_gateway_provider_live_validation_enabled",
        True,
    )
    _FakeProviderValidationClient.calls = []
    _FakeProviderValidationClient.response = _FakeProviderValidationResponse(200)
    monkeypatch.setattr(agent_auth_service.httpx, "AsyncClient", _FakeProviderValidationClient)

    validation = await agent_auth_service._validate_provider_payload(
        "openai_api_key",
        {"apiKey": "sk-test-secret"},
    )

    assert validation.status == "valid"
    assert validation.error_code is None
    assert validation.redacted_summary["apiKey"] != "sk-test-secret"
    assert _FakeProviderValidationClient.calls == [
        {
            "url": "https://api.openai.com/v1/models",
            "headers": {"Authorization": "Bearer sk-test-secret"},
            "timeout": 10.0,
        }
    ]


async def test_provider_payload_live_validation_rejects_provider_auth(monkeypatch) -> None:
    monkeypatch.setattr(
        agent_auth_service.settings,
        "agent_gateway_provider_live_validation_enabled",
        True,
    )
    _FakeProviderValidationClient.calls = []
    _FakeProviderValidationClient.response = _FakeProviderValidationResponse(401)
    monkeypatch.setattr(agent_auth_service.httpx, "AsyncClient", _FakeProviderValidationClient)

    validation = await agent_auth_service._validate_provider_payload(
        "anthropic_api_key",
        {"apiKey": "sk-ant-test-secret"},
    )

    assert validation.status == "invalid"
    assert validation.error_code == "provider_auth_failed"
    assert _FakeProviderValidationClient.calls[0]["url"] == "https://api.anthropic.com/v1/models"
    assert _FakeProviderValidationClient.calls[0]["headers"] == {
        "x-api-key": "sk-ant-test-secret",
        "anthropic-version": "2023-06-01",
    }


async def test_bedrock_payload_live_validation_stays_proof_gated(monkeypatch) -> None:
    monkeypatch.setattr(
        agent_auth_service.settings,
        "agent_gateway_provider_live_validation_enabled",
        True,
    )

    validation = await agent_auth_service._validate_provider_payload(
        "bedrock_assume_role",
        {
            "roleArn": "arn:aws:iam::123456789012:role/proliferate-bedrock",
            "externalId": "proliferate-external-id",
            "region": "us-east-1",
        },
    )

    assert validation.status == "unvalidated"
    assert validation.error_code == "bedrock_live_validation_requires_proof"
    assert validation.redacted_summary == {
        "providerKind": "bedrock_assume_role",
        "roleArn": "arn:aws:iam::123456789012:role/proliferate-bedrock",
        "region": "us-east-1",
        "accountId": "123456789012",
    }
