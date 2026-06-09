"""Pure product rules for agent-auth credentials and selections."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from proliferate.auth.authorization import PolicyAllowed, PolicyDenied, PolicyVerdict
from proliferate.constants.cloud import SUPPORTED_CLOUD_AGENTS
from proliferate.server.cloud.agent_auth.registry import (
    materialization_mode_for_slot,
    protocol_facade_for_slot,
    slot_allows_credential_provider,
)


@dataclass(frozen=True)
class SelectionPlan:
    materialization_mode: Literal["gateway_env", "synced_files"]
    protocol_facade: Literal["anthropic", "openai", "genai"] | None


def is_supported_agent_kind(agent_kind: str) -> bool:
    return agent_kind in SUPPORTED_CLOUD_AGENTS


def selection_plan_for_credential(
    *,
    agent_kind: str,
    auth_slot_id: str,
    credential_provider_id: str,
    credential_kind: str,
    synced_source_agent_kind: str | None = None,
) -> SelectionPlan | PolicyDenied:
    if not slot_allows_credential_provider(
        agent_kind=agent_kind,
        auth_slot_id=auth_slot_id,
        credential_provider_id=credential_provider_id,
    ):
        return PolicyDenied(
            code="credential_provider_mismatch",
            message="Credential provider is not compatible with this auth slot.",
            status_code=400,
        )
    mode = materialization_mode_for_slot(
        agent_kind=agent_kind,
        auth_slot_id=auth_slot_id,
        credential_kind=credential_kind,
    )
    if mode is None:
        return PolicyDenied(
            code="unsupported_credential_kind",
            message="Credential kind is not supported for this auth slot.",
            status_code=400,
        )
    if (
        credential_kind == "synced_path"
        and synced_source_agent_kind is not None
        and synced_source_agent_kind != agent_kind
    ):
        return PolicyDenied(
            code="synced_credential_agent_mismatch",
            message="Synced native auth is only compatible with its source agent.",
            status_code=400,
        )
    protocol_facade = (
        protocol_facade_for_slot(agent_kind, auth_slot_id) if mode == "gateway_env" else None
    )
    return SelectionPlan(materialization_mode=mode, protocol_facade=protocol_facade)


def can_select_credential_for_profile(
    *,
    profile_owner_scope: str,
    profile_owner_user_id: object | None,
    profile_organization_id: object | None,
    credential_owner_scope: str,
    credential_owner_user_id: object | None,
    credential_organization_id: object | None,
    credential_kind: str,
    has_active_share: bool,
) -> PolicyVerdict:
    if profile_owner_scope == "personal":
        if credential_owner_scope == "system":
            return PolicyAllowed()
        if (
            credential_owner_scope == "personal"
            and credential_owner_user_id == profile_owner_user_id
        ):
            return PolicyAllowed()
        if (
            credential_owner_scope == "organization"
            and profile_organization_id is not None
            and credential_organization_id == profile_organization_id
        ):
            return PolicyAllowed()
        return PolicyDenied(
            code="credential_not_visible",
            message="Credential is not visible to this sandbox profile.",
        )

    if profile_owner_scope != "organization":
        return PolicyDenied(
            code="invalid_profile_owner_scope",
            message="Invalid sandbox profile owner scope.",
            status_code=400,
        )
    if credential_owner_scope == "system":
        return PolicyAllowed()
    if (
        credential_owner_scope == "organization"
        and credential_organization_id == profile_organization_id
    ):
        return PolicyAllowed()
    if credential_owner_scope == "personal" and credential_kind == "synced_path":
        return PolicyAllowed()
    return PolicyDenied(
        code="credential_not_selectable",
        message="Credential cannot be selected for this sandbox profile.",
    )
