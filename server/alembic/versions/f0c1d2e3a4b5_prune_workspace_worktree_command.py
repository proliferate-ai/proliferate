"""Add prune workspace worktree cloud command.

Revision ID: f0c1d2e3a4b5
Revises: e9f0a1b2c3d5
Create Date: 2026-05-25 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "f0c1d2e3a4b5"
down_revision: str | Sequence[str] | None = "e9f0a1b2c3d5"
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
)

_NEW_COMMAND_KINDS = (
    *_OLD_COMMAND_KINDS,
    "prune_workspace_worktree",
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
    op.execute("DELETE FROM cloud_commands WHERE kind = 'prune_workspace_worktree'")
    _replace_command_kind_constraint(_OLD_COMMAND_KINDS)
