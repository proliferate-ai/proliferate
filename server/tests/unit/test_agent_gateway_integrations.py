from __future__ import annotations

import pytest

from proliferate.integrations.aws import AwsIntegrationError, validate_bedrock_assume_role_payload
from proliferate.integrations.bifrost.client import (
    _collect_sensitive_values as bifrost_collect_sensitive_values,
)
from proliferate.integrations.bifrost.client import _redact as bifrost_redact
from proliferate.integrations.bifrost.client import bifrost_env_var
from proliferate.server.cloud.agent_auth import service as agent_auth_service
from proliferate.server.cloud.agent_auth.domain.status import allowed_agent_kinds


def test_bedrock_assume_role_validation_extracts_account_id() -> None:
    result = validate_bedrock_assume_role_payload(
        role_arn="arn:aws:iam::123456789012:role/ProliferateBedrockRole",
        external_id="org_abc",
        region="us-west-2",
    )

    assert result.account_id == "123456789012"
    assert result.region == "us-west-2"


def test_bedrock_assume_role_validation_rejects_non_role_arn() -> None:
    with pytest.raises(AwsIntegrationError) as exc:
        validate_bedrock_assume_role_payload(
            role_arn="arn:aws:iam::123456789012:user/not-a-role",
            external_id="org_abc",
            region="us-west-2",
        )

    assert exc.value.code == "invalid_role_arn"


def test_bifrost_env_var_uses_inline_secret_shape() -> None:
    assert bifrost_env_var("secret-value") == {
        "value": "secret-value",
        "env_var": "",
        "from_env": False,
    }


def test_bifrost_sensitive_value_collection_handles_nested_payloads() -> None:
    payload = {
        "value": "sk-provider",
        "bedrock_key_config": {
            "role_arn": {"value": "arn:aws:iam::123456789012:role/Test"},
            "external_id": {"value": "external-id"},
            "region": {"value": "us-west-2"},
        },
        "safe": "visible",
    }

    assert set(bifrost_collect_sensitive_values(payload)) == {
        "sk-provider",
        "arn:aws:iam::123456789012:role/Test",
        "external-id",
        "us-west-2",
    }


def test_bifrost_redaction_scrubs_nested_provider_secrets() -> None:
    assert bifrost_redact("bad sk-provider and external-id", ("sk-provider", "external-id")) == (
        "bad [REDACTED] and [REDACTED]"
    )


def test_bifrost_provider_key_fingerprint_changes_when_secrets_change() -> None:
    base = {
        "provider": "anthropic",
        "key_id": "key-1",
        "name": "Provider key",
        "value": "sk-ant-first",
        "models": ["claude-sonnet-4-6"],
        "aliases": {},
    }
    rotated = {**base, "value": "sk-ant-second"}
    bedrock = {
        "provider": "bedrock",
        "key_id": "key-1",
        "name": "Provider key",
        "value": None,
        "models": ["us.anthropic.claude-sonnet-4-6"],
        "aliases": {},
        "bedrock_key_config": {
            "role_arn": bifrost_env_var("arn:aws:iam::123456789012:role/First"),
            "external_id": bifrost_env_var("external-id-one"),
            "region": bifrost_env_var("us-west-2"),
        },
    }
    bedrock_rotated = {
        **bedrock,
        "bedrock_key_config": {
            "role_arn": bifrost_env_var("arn:aws:iam::123456789012:role/Second"),
            "external_id": bifrost_env_var("external-id-two"),
            "region": bifrost_env_var("us-east-1"),
        },
    }

    assert agent_auth_service._bifrost_provider_key_fingerprint(base) != (
        agent_auth_service._bifrost_provider_key_fingerprint(rotated)
    )
    assert agent_auth_service._bifrost_provider_key_fingerprint(bedrock) != (
        agent_auth_service._bifrost_provider_key_fingerprint(bedrock_rotated)
    )
    assert "sk-ant-first" not in agent_auth_service._bifrost_provider_key_fingerprint(base)


def test_allowed_agent_kinds_include_opencode() -> None:
    assert allowed_agent_kinds() == ["claude", "codex", "opencode", "gemini"]
