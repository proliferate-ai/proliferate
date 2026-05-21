from __future__ import annotations

import pytest

from proliferate.integrations.aws import AwsIntegrationError, validate_bedrock_assume_role_payload
from proliferate.integrations.litellm.client import _redact
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


def test_litellm_redaction_scrubs_master_key() -> None:
    assert _redact("bad sk-secret-token payload", "sk-secret-token") == "bad [REDACTED] payload"


def test_litellm_redaction_scrubs_provider_secrets() -> None:
    assert (
        _redact(
            "bad sk-master payload with sk-provider-key and external-id",
            ("sk-master", "sk-provider-key", "external-id"),
        )
        == "bad [REDACTED] payload with [REDACTED] and [REDACTED]"
    )


def test_synced_native_auth_does_not_advertise_opencode_yet() -> None:
    assert allowed_agent_kinds() == ["claude", "codex", "gemini"]
