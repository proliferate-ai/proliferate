"""Add decide plan cloud command.

Revision ID: 2b3c4d5e6f70
Revises: 1a2b3c4d5e6f
Create Date: 2026-05-30 12:30:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "2b3c4d5e6f70"
down_revision: str | Sequence[str] | None = "1a2b3c4d5e6f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_COMMAND_KINDS = (
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
)

_NEW_COMMAND_KINDS = (
    *_OLD_COMMAND_KINDS,
    "decide_plan",
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
    _replace_command_kind_constraint(_NEW_COMMAND_KINDS)


def downgrade() -> None:
    op.execute("DELETE FROM cloud_commands WHERE kind = 'decide_plan'")
    _replace_command_kind_constraint(_OLD_COMMAND_KINDS)
