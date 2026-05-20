from __future__ import annotations

from proliferate.auth.authorization import PolicyDenied, PolicyAllowed
from proliferate.server.cloud.agent_auth.domain.policy import (
    SelectionPlan,
    can_select_credential_for_profile,
    selection_plan_for_credential,
)
from proliferate.server.cloud.agent_auth.protected_env import (
    allowed_protected_env_keys,
    reject_unallowed_protected_env,
)


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


def test_org_profile_requires_share_for_personal_synced_credential() -> None:
    denied = can_select_credential_for_profile(
        profile_owner_scope="organization",
        profile_owner_user_id=None,
        profile_organization_id="org-1",
        credential_owner_scope="personal",
        credential_owner_user_id="user-1",
        credential_organization_id=None,
        credential_kind="synced_path",
        has_active_share=False,
    )
    assert isinstance(denied, PolicyDenied)
    assert denied.code == "credential_share_required"

    allowed = can_select_credential_for_profile(
        profile_owner_scope="organization",
        profile_owner_user_id=None,
        profile_organization_id="org-1",
        credential_owner_scope="personal",
        credential_owner_user_id="user-1",
        credential_organization_id=None,
        credential_kind="synced_path",
        has_active_share=True,
    )
    assert isinstance(allowed, PolicyAllowed)


def test_protected_env_allowlist_is_agent_and_mode_scoped() -> None:
    assert "ANTHROPIC_CUSTOM_HEADERS" in allowed_protected_env_keys(
        agent_kind="claude",
        materialization_mode="gateway_env",
    )
    assert "OPENAI_API_KEY" not in allowed_protected_env_keys(
        agent_kind="claude",
        materialization_mode="gateway_env",
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
