"""Pure product rules for agent-auth credentials and selections."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from proliferate.auth.authorization import PolicyAllowed, PolicyDenied, PolicyVerdict
from proliferate.constants.cloud import SUPPORTED_CLOUD_AGENTS


@dataclass(frozen=True)
class SelectionPlan:
    materialization_mode: Literal["gateway_env", "synced_files"]
    protocol_facade: Literal["anthropic", "openai"] | None


def is_supported_agent_kind(agent_kind: str) -> bool:
    return agent_kind in SUPPORTED_CLOUD_AGENTS


def selection_plan_for_credential(
    *,
    agent_kind: str,
    credential_kind: str,
) -> SelectionPlan | PolicyDenied:
    if credential_kind == "synced_path":
        return SelectionPlan(materialization_mode="synced_files", protocol_facade=None)
    if credential_kind != "managed_gateway":
        return PolicyDenied(
            code="unsupported_credential_kind",
            message="Unsupported credential kind.",
            status_code=400,
        )
    if agent_kind == "claude":
        return SelectionPlan(materialization_mode="gateway_env", protocol_facade="anthropic")
    if agent_kind in {"codex", "opencode"}:
        return SelectionPlan(materialization_mode="gateway_env", protocol_facade="openai")
    return PolicyDenied(
        code="gateway_not_supported_for_agent",
        message="Gateway auth is not supported for this agent.",
        status_code=400,
    )


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
