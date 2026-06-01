"""Agent-auth value redaction concern."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal, InvalidOperation

from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.server.cloud.agent_auth.errors import AgentAuthError

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


def _safe_error_message(
    message: str | None,
    secret_payload: dict[str, str],
) -> str | None:
    if message is None:
        return None
    safe = message
    for value in secret_payload.values():
        if value:
            safe = safe.replace(value, "[REDACTED]")
    return safe[:1000]


def _clean_display_name(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise AgentAuthError(
            "displayName is required.", code="missing_display_name", status_code=400
        )
    if len(cleaned) > 255:
        raise AgentAuthError(
            "displayName is too long.", code="display_name_too_long", status_code=400
        )
    return cleaned


def _budget_amount(value: str) -> str:
    try:
        amount = Decimal(value)
    except InvalidOperation as exc:
        raise AgentAuthError(
            "Included budget must be a decimal string.", code="invalid_budget", status_code=400
        ) from exc
    if amount < 0:
        raise AgentAuthError(
            "Included budget must be non-negative.", code="invalid_budget", status_code=400
        )
    return format(amount, "f")


def _redact_secret(value: str) -> str:
    if len(value) <= 8:
        return "[REDACTED]"
    return f"{value[:4]}...{value[-4:]}"
