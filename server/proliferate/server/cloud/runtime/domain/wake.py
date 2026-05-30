"""Pure wake policy for managed cloud runtime commands."""

from __future__ import annotations

from proliferate.constants.cloud import CloudCommandKind

WAKE_REQUIRED_CLOUD_COMMAND_KINDS: frozenset[str] = frozenset(
    {
        CloudCommandKind.materialize_workspace.value,
        CloudCommandKind.materialize_environment.value,
        CloudCommandKind.refresh_agent_auth_config.value,
        CloudCommandKind.start_session.value,
        CloudCommandKind.send_prompt.value,
        CloudCommandKind.decide_plan.value,
        CloudCommandKind.resolve_interaction.value,
        CloudCommandKind.update_session_config.value,
        CloudCommandKind.cancel_turn.value,
        CloudCommandKind.close_session.value,
        CloudCommandKind.backfill_exposed_workspace.value,
    }
)


def command_kind_requires_wake(kind: str) -> bool:
    return kind in WAKE_REQUIRED_CLOUD_COMMAND_KINDS
