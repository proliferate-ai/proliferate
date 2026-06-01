"""Agent-auth byok validation concern."""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import urlparse

from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.integrations.aws import (
    AwsIntegrationError,
    validate_bedrock_assume_role_payload,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.value_redaction import _redact_secret

_ORG_ADMIN_ROLES = {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}
_GATEWAY_GRANT_TTL = timedelta(days=7)
_DEFAULT_MANAGED_CREDIT_AGENT_KINDS: tuple[CloudAgentKind, ...] = ("claude",)
_USER_FREE_CREDIT_SOURCE = "signup_free_credit"
_CLEANUP_SELECTION_ERROR_CODES = {
    "credential_revoked",
    "credential_share_revoked",
}
_MANAGED_CODEX_HOME = "/home/user/.proliferate/anyharness/agent-auth/codex"
_OPENCODE_ALLOWED_AUTH_FILES: frozenset[str] = frozenset({".config/opencode/auth.json"})
_TERMINAL_AGENT_AUTH_REFRESH_COMMAND_STATUSES = frozenset(
    {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.expired.value,
        CloudCommandStatus.superseded.value,
        CloudCommandStatus.failed_delivery.value,
    }
)


@dataclass(frozen=True)
class _ProviderValidation:
    status: str
    redacted_summary: dict[str, object]
    error_code: str | None
    error_message: str | None


def _validate_provider_payload(
    provider_kind: str,
    payload: dict[str, str],
) -> _ProviderValidation:
    try:
        if provider_kind in {"anthropic_api_key", "openai_api_key", "gemini_api_key"}:
            api_key = payload.get("apiKey", "").strip()
            if not api_key:
                raise AgentAuthError(
                    "apiKey is required.", code="missing_api_key", status_code=400
                )
            return _ProviderValidation(
                status="valid",
                redacted_summary={
                    "providerKind": provider_kind,
                    "apiKey": _redact_secret(api_key),
                },
                error_code=None,
                error_message=None,
            )
        if provider_kind == "bedrock_assume_role":
            result = validate_bedrock_assume_role_payload(
                role_arn=payload.get("roleArn", ""),
                external_id=payload.get("externalId", ""),
                region=payload.get("region", ""),
            )
            return _ProviderValidation(
                status="valid",
                redacted_summary={
                    "providerKind": provider_kind,
                    "roleArn": result.role_arn,
                    "region": result.region,
                    "accountId": result.account_id,
                },
                error_code=None,
                error_message=None,
            )
        if provider_kind == "openai_compatible":
            base_url = _validate_openai_compatible_url(payload.get("baseUrl", ""))
            api_key = payload.get("apiKey", "").strip()
            if not api_key:
                raise AgentAuthError(
                    "apiKey is required.", code="missing_api_key", status_code=400
                )
            return _ProviderValidation(
                status="unvalidated",
                redacted_summary={
                    "providerKind": provider_kind,
                    "baseUrl": base_url,
                    "apiKey": _redact_secret(api_key),
                },
                error_code="provider_live_validation_deferred",
                error_message="Provider credentials require live validation before use.",
            )
    except AwsIntegrationError as exc:
        return _ProviderValidation(
            status="invalid",
            redacted_summary={"providerKind": provider_kind},
            error_code=exc.code,
            error_message=str(exc),
        )
    raise AgentAuthError(
        "Unsupported provider kind.", code="unsupported_provider_kind", status_code=400
    )


def _validate_openai_compatible_url(raw_url: str) -> str:
    parsed = urlparse(raw_url.strip())
    if parsed.scheme != "https" or not parsed.netloc:
        raise AgentAuthError(
            "OpenAI-compatible base URL must be an HTTPS URL.",
            code="invalid_base_url",
            status_code=400,
        )
    host = parsed.hostname
    if host is None:
        raise AgentAuthError(
            "OpenAI-compatible base URL host is required.",
            code="invalid_base_url",
            status_code=400,
        )
    if host in {"localhost", "127.0.0.1", "::1"}:
        raise AgentAuthError(
            "OpenAI-compatible base URL cannot point to localhost.",
            code="invalid_base_url",
            status_code=400,
        )
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, None)}
    except socket.gaierror as exc:
        raise AgentAuthError(
            "OpenAI-compatible base URL host could not be resolved.",
            code="invalid_base_url",
            status_code=400,
        ) from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast:
            raise AgentAuthError(
                "OpenAI-compatible base URL cannot resolve to a private network.",
                code="invalid_base_url",
                status_code=400,
            )
    return raw_url.strip().rstrip("/")
