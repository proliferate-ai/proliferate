"""Canonical external-action identity and safe human presentation."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from uuid import UUID

from proliferate.server.cloud.integration_gateway.domain.tool_policy import (
    ToolCallRequiresApproval,
)


class InvalidActionPayload(ValueError):
    """Raised when a value cannot be represented as canonical JSON."""


@dataclass(frozen=True)
class SafeActionPresentation:
    summary: str
    account_label: str
    source_label: str
    target: str | None
    content_preview: str | None
    content_character_count: int | None


@dataclass(frozen=True)
class ActionBinding:
    owner_user_id: UUID
    organization_id: UUID | None
    integration_account_id: UUID
    integration_account_auth_version: int
    runtime_worker_id: UUID
    gateway_session_id: UUID
    workspace_id: str
    anyharness_session_id: str
    provider: str
    tool: str
    payload_digest: str
    binding_digest: str
    idempotency_key: str
    presentation: SafeActionPresentation


_MAX_LABEL_CHARACTERS = 255


def canonical_payload_digest(arguments: dict[str, object]) -> str:
    """Hash one stable JSON representation without retaining raw arguments."""
    try:
        canonical = json.dumps(
            arguments,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as error:
        raise InvalidActionPayload("Action arguments must be canonical JSON values.") from error
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _digest(value: dict[str, str]) -> str:
    canonical = json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _clean_text(value: str, *, limit: int) -> str:
    return " ".join(value.split())[:limit]


def _safe_label(value: str) -> str:
    cleaned = _clean_text(value, limit=_MAX_LABEL_CHARACTERS)
    return cleaned or "Integration action"


def _safe_summary(*, provider: str, tool: str) -> str:
    prefix = f"{provider}_"
    action_name = tool.removeprefix(prefix).replace("_", " ")
    return f"{provider.title()} external action: {action_name}."


def bind_action(
    *,
    owner_user_id: UUID,
    organization_id: UUID | None,
    integration_account_id: UUID,
    integration_account_auth_version: int,
    runtime_worker_id: UUID,
    gateway_session_id: UUID,
    workspace_id: str,
    anyharness_session_id: str,
    verdict: ToolCallRequiresApproval,
    arguments: dict[str, object],
    account_label: str,
    source_label: str,
) -> ActionBinding:
    """Bind an exact action only from the typed hosted tool-policy verdict."""
    payload_digest = canonical_payload_digest(arguments)
    binding_digest = _digest(
        {
            "account": str(integration_account_id),
            "accountAuthVersion": str(integration_account_auth_version),
            "gatewaySession": str(gateway_session_id),
            "workspace": workspace_id,
            "anyharnessSession": anyharness_session_id,
            "organization": str(organization_id) if organization_id is not None else "personal",
            "owner": str(owner_user_id),
            "provider": verdict.provider,
            "runtimeWorker": str(runtime_worker_id),
            "tool": verdict.tool,
            "version": "integration-action-binding-v3",
        }
    )
    idempotency_key = _digest(
        {
            "binding": binding_digest,
            "payload": payload_digest,
            "version": "integration-action-idempotency-v3",
        }
    )
    # Raw provider arguments have no frozen per-tool schema in this slice. Do
    # not guess which aliases or rich fields the provider will honor: that can
    # both persist secrets and show a benign value while a conflicting hidden
    # field is later delivered. The exact full payload is bound only by its
    # digest. A delivery slice must add one canonical action parser and derive
    # both UI presentation and provider execution from that same typed object.
    presentation = SafeActionPresentation(
        summary=_safe_summary(provider=verdict.provider, tool=verdict.tool),
        account_label=_safe_label(account_label),
        source_label=_safe_label(source_label),
        target=None,
        content_preview=None,
        content_character_count=None,
    )
    return ActionBinding(
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        integration_account_id=integration_account_id,
        integration_account_auth_version=integration_account_auth_version,
        runtime_worker_id=runtime_worker_id,
        gateway_session_id=gateway_session_id,
        workspace_id=workspace_id,
        anyharness_session_id=anyharness_session_id,
        provider=verdict.provider,
        tool=verdict.tool,
        payload_digest=payload_digest,
        binding_digest=binding_digest,
        idempotency_key=idempotency_key,
        presentation=presentation,
    )
