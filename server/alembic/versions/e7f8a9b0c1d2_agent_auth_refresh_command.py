"""Add agent-auth refresh cloud command.

Revision ID: e7f8a9b0c1d2
Revises: e6f7a8b9c0d1
Create Date: 2026-05-18 10:20:00.000000
"""

from __future__ import annotations

from alembic import op

revision: str = "e7f8a9b0c1d2"
down_revision: str | None = "e6f7a8b9c0d1"
branch_labels: str | None = None
depends_on: str | None = None

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
)

_NEW_COMMAND_KINDS = (
    *_OLD_COMMAND_KINDS,
    "refresh_agent_auth_config",
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
    op.execute("DELETE FROM cloud_commands WHERE kind = 'refresh_agent_auth_config'")
    _replace_command_kind_constraint(_OLD_COMMAND_KINDS)
