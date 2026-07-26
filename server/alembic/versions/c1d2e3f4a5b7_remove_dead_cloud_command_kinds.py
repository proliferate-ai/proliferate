"""Remove dead cloud command kinds.

Revision ID: c1d2e3f4a5b7
Revises: 35fa0038d703
Create Date: 2026-07-26 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "c1d2e3f4a5b7"
down_revision: str | Sequence[str] | None = "35fa0038d703"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PREVIOUS_COMMAND_KINDS = (
    "start_session",
    "configure_git_identity",
    "ensure_repo_checkout",
    "materialize_workspace",
    "materialize_environment",
    "resume_session",
    "send_prompt",
    "resolve_interaction",
    "update_session_config",
    "cancel_turn",
    "close_session",
    "cancel_session",
    "stop_workspace",
    "hibernate_workspace",
    "resume_workspace",
    "prune_workspace",
    "extend_workspace_ttl",
    "backfill_exposed_workspace",
    "refresh_agent_auth_config",
    "prune_workspace_worktree",
    "decide_plan",
)

_CURRENT_COMMAND_KINDS = tuple(
    kind
    for kind in _PREVIOUS_COMMAND_KINDS
    if kind not in {"configure_git_identity", "prune_workspace_worktree"}
)


def _in_constraint(column_name: str, values: tuple[str, ...]) -> str:
    return f"{column_name} IN {values}"


def _replace_command_kind_constraint(values: tuple[str, ...]) -> None:
    op.drop_constraint("ck_cloud_commands_kind", "cloud_commands", type_="check")
    op.create_check_constraint(
        "ck_cloud_commands_kind",
        "cloud_commands",
        _in_constraint("kind", values),
    )


def upgrade() -> None:
    op.execute(
        "DELETE FROM cloud_commands "
        "WHERE kind IN ('configure_git_identity', 'prune_workspace_worktree')"
    )
    _replace_command_kind_constraint(_CURRENT_COMMAND_KINDS)


def downgrade() -> None:
    _replace_command_kind_constraint(_PREVIOUS_COMMAND_KINDS)
