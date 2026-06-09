"""Protected environment variable policy for cloud agent auth materialization."""

from __future__ import annotations

from proliferate.constants.cloud import CloudAgentKind
from proliferate.server.cloud.agent_auth.registry import protected_env_keys_for_slot


def allowed_protected_env_keys(
    *,
    agent_kind: CloudAgentKind | str,
    auth_slot_id: str,
    materialization_mode: str,
) -> frozenset[str]:
    return protected_env_keys_for_slot(
        agent_kind=str(agent_kind),
        auth_slot_id=auth_slot_id,
        materialization_mode=materialization_mode,
    )


def reject_unallowed_protected_env(
    *,
    agent_kind: CloudAgentKind | str,
    auth_slot_id: str,
    materialization_mode: str,
    keys: set[str] | frozenset[str],
) -> None:
    allowed = allowed_protected_env_keys(
        agent_kind=agent_kind,
        auth_slot_id=auth_slot_id,
        materialization_mode=materialization_mode,
    )
    extra = sorted(key for key in keys if key not in allowed)
    if extra:
        joined = ", ".join(extra)
        raise ValueError(
            "Protected env contains keys not allowed for "
            f"{agent_kind}/{auth_slot_id}/{materialization_mode}: {joined}."
        )
